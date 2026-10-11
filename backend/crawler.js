const cheerio = require("cheerio");
const { URL } = require("url");
const { safeFetch } = require("./security");

// Normalize URL: remove hash, standard lowercase host, strip common tracking params
function normalizeUrl(rawUrl, baseUrl) {
  try {
    const parsed = new URL(rawUrl, baseUrl);
    // Ignore non-http protocols
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return null;
    }
    parsed.hash = "";
    // Remove analytics query params
    const searchParams = parsed.searchParams;
    const trackingParams = ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "ref", "fbclid", "gclid"];
    trackingParams.forEach((param) => searchParams.delete(param));
    
    // Normalize trailing slash for pathname
    if (parsed.pathname.length > 1 && parsed.pathname.endsWith("/")) {
      parsed.pathname = parsed.pathname.slice(0, -1);
    }
    return parsed.toString();
  } catch {
    return null;
  }
}

// Clean and extract readable text from HTML
function extractPageContent(html, pageUrl) {
  const $ = cheerio.load(html);

  // Remove clutter
  $("script, style, noscript, iframe, svg, canvas, nav, footer, header, aside, form, dialog, [aria-hidden='true']").remove();

  // Extract page title
  const title = $("title").first().text().trim() ||
                $("h1").first().text().trim() ||
                $("meta[property='og:title']").attr("content") ||
                "Untitled Page";

  // Extract headings for additional semantic context
  const headings = [];
  $("h1, h2, h3").each((_, el) => {
    const hText = $(el).text().replace(/\s+/g, " ").trim();
    if (hText && hText.length > 2 && !headings.includes(hText)) {
      headings.push(hText);
    }
  });

  // Extract text from main content area if available, otherwise body
  let mainContainer = $("main, article, [role='main']");
  if (mainContainer.length === 0) {
    mainContainer = $("body");
  }

  // Replace block elements with newlines to keep structure
  mainContainer.find("p, div, li, tr, section, article").each((_, el) => {
    $(el).append("\n");
  });

  const rawText = mainContainer.text();
  // Normalize whitespace: collapse multiple empty lines into double newlines
  const cleanText = rawText
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .join("\n")
    .replace(/\n{3,}/g, "\n\n");

  // Extract internal links for continued crawling
  const links = new Set();
  $("a[href]").each((_, el) => {
    const href = $(el).attr("href");
    if (!href) return;
    const normalized = normalizeUrl(href, pageUrl);
    if (normalized) {
      links.add(normalized);
    }
  });

  return {
    url: pageUrl,
    title: title.slice(0, 200),
    headings: headings.slice(0, 15),
    text: cleanText,
    charCount: cleanText.length,
    links: Array.from(links),
  };
}

// Attempt to parse sitemap.xml to seed the crawler
async function discoverSitemapUrls(originUrl) {
  const urls = [];
  try {
    const parsedOrigin = new URL(originUrl);
    const sitemapUrl = `${parsedOrigin.origin}/sitemap.xml`;
    const res = await safeFetch(sitemapUrl, { timeoutMs: 5000, maxBytes: 1024 * 1024 });
    if (res && res.body) {
      const $ = cheerio.load(res.body, { xmlMode: true });
      $("loc").each((_, el) => {
        const loc = $(el).text().trim();
        const normalized = normalizeUrl(loc, originUrl);
        if (normalized) {
          const parsedLoc = new URL(normalized);
          if (parsedLoc.origin === parsedOrigin.origin) {
            urls.push(normalized);
          }
        }
      });
    }
  } catch (err) {
    // Sitemap discovery is best-effort
    console.log(`[Crawler] No sitemap found or error reading sitemap: ${err.message}`);
  }
  return urls;
}

// Main crawl execution with bounded limits and progress callback
async function crawlWebsite(startUrl, options = {}, onProgress = null) {
  const maxPages = options.maxPages || 20;
  const maxDepth = options.maxDepth || 3;
  const timeoutPerRequestMs = options.timeoutPerRequestMs || 10000;

  const normalizedStart = normalizeUrl(startUrl);
  if (!normalizedStart) {
    throw new Error("Invalid start URL provided");
  }

  const origin = new URL(normalizedStart).origin;
  const visited = new Set();
  const queue = [{ url: normalizedStart, depth: 0 }];
  const crawledPages = [];

  // Try to seed queue with sitemap URLs
  try {
    const sitemapLinks = await discoverSitemapUrls(normalizedStart);
    for (const link of sitemapLinks.slice(0, maxPages)) {
      if (link !== normalizedStart) {
        queue.push({ url: link, depth: 1 });
      }
    }
  } catch {}

  const concurrency = options.concurrency || 4;
  let activeWorkers = 0;

  async function worker() {
    while (queue.length > 0 && crawledPages.length < maxPages) {
      const current = queue.shift();
      if (!current || visited.has(current.url)) continue;

      visited.add(current.url);

      // Ensure it's still same origin
      try {
        const curParsed = new URL(current.url);
        if (curParsed.origin !== origin) continue;
      } catch {
        continue;
      }

      try {
        if (onProgress) {
          onProgress({
            status: "crawling",
            currentUrl: current.url,
            crawledCount: crawledPages.length,
            queueLength: queue.length,
          });
        }

        const res = await safeFetch(current.url, { timeoutMs: timeoutPerRequestMs });
        const extracted = extractPageContent(res.body, current.url);

        if (extracted.text.length > 50 && crawledPages.length < maxPages) {
          crawledPages.push({
            url: extracted.url,
            title: extracted.title,
            headings: extracted.headings,
            text: extracted.text,
            charCount: extracted.charCount,
          });
        }

        // If depth allows, enqueue new unvisited links from this page
        if (current.depth < maxDepth && crawledPages.length < maxPages) {
          for (const link of extracted.links) {
            if (!visited.has(link)) {
              try {
                const linkParsed = new URL(link);
                if (linkParsed.origin === origin) {
                  const ext = linkParsed.pathname.split(".").pop().toLowerCase();
                  const ignoredExts = ["png", "jpg", "jpeg", "gif", "svg", "pdf", "zip", "mp4", "mp3", "webp", "ico", "woff", "woff2", "css", "js"];
                  if (!ignoredExts.includes(ext)) {
                    queue.push({ url: link, depth: current.depth + 1 });
                  }
                }
              } catch {}
            }
          }
        }
      } catch (err) {
        // Silently skip inaccessible pages
      }
    }
  }

  // Run concurrency workers in parallel
  const workers = Array.from({ length: concurrency }, () => worker());
  await Promise.all(workers);

  return {
    origin,
    startUrl: normalizedStart,
    totalPages: crawledPages.length,
    pages: crawledPages,
  };
}

module.exports = {
  normalizeUrl,
  extractPageContent,
  crawlWebsite,
};
