const dns = require("dns").promises;
const http = require("http");
const https = require("https");
const { URL } = require("url");

// Helper to check if an IPv4 address is in a private or reserved range
function isPrivateIPv4(ip) {
  const parts = ip.split(".").map((n) => parseInt(n, 10));
  if (parts.length !== 4 || parts.some((p) => isNaN(p) || p < 0 || p > 255)) {
    return true; // invalid -> treat as unsafe
  }

  const [a, b] = parts;

  // 0.0.0.0/8 (Current network)
  if (a === 0) return true;
  // 10.0.0.0/8 (Private)
  if (a === 10) return true;
  // 127.0.0.0/8 (Loopback)
  if (a === 127) return true;
  // 169.254.0.0/16 (Link-local / AWS / GCP / Azure metadata: 169.254.169.254)
  if (a === 169 && b === 254) return true;
  // 172.16.0.0/12 (Private: 172.16 - 172.31)
  if (a === 172 && b >= 16 && b <= 31) return true;
  // 192.168.0.0/16 (Private)
  if (a === 192 && b === 168) return true;
  // 100.64.0.0/10 (Shared address / CGNAT)
  if (a === 100 && b >= 64 && b <= 127) return true;
  // 198.18.0.0/15 (Benchmark testing)
  if (a === 198 && (b === 18 || b === 19)) return true;
  // 224.0.0.0/4 (Multicast)
  if (a >= 224 && a <= 239) return true;
  // 240.0.0.0/4 (Reserved)
  if (a >= 240) return true;
  // Broadcast
  if (ip === "255.255.255.255") return true;

  return false;
}

// Helper to check if an IPv6 address is private or reserved
function isPrivateIPv6(ip) {
  const normalized = ip.toLowerCase();
  if (normalized === "::1" || normalized === "::") return true;
  // IPv4-mapped IPv6 (::ffff:x.x.x.x)
  if (normalized.startsWith("::ffff:")) {
    const ipv4Part = normalized.slice(7);
    return isPrivateIPv4(ipv4Part);
  }
  // Unique local fc00::/7
  if (normalized.startsWith("fc") || normalized.startsWith("fd")) return true;
  // Link-local fe80::/10
  if (normalized.startsWith("fe8") || normalized.startsWith("fe9") || normalized.startsWith("fea") || normalized.startsWith("feb")) return true;
  return false;
}

// Validate a URL and resolve its DNS to ensure it is not targeting internal infrastructure
async function validateAndResolveUrl(rawUrl) {
  let parsedUrl;
  try {
    parsedUrl = new URL(rawUrl);
  } catch {
    throw new Error("Invalid URL format");
  }

  if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
    throw new Error("Only HTTP and HTTPS protocols are allowed");
  }

  const hostname = parsedUrl.hostname.toLowerCase();

  // Reject local and internal hostnames
  const forbiddenHostnames = ["localhost", "127.0.0.1", "::1", "metadata.google.internal"];
  if (
    forbiddenHostnames.includes(hostname) ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".internal") ||
    hostname.endsWith(".local") ||
    hostname.endsWith(".arpa")
  ) {
    throw new Error("Requests to local or private hostnames are blocked for security");
  }

  // Resolve DNS to verify all destination IPs
  try {
    const records = await dns.lookup(hostname, { all: true });
    if (!records || records.length === 0) {
      throw new Error(`Could not resolve hostname: ${hostname}`);
    }

    for (const record of records) {
      if (record.family === 4) {
        if (isPrivateIPv4(record.address)) {
          throw new Error(`Destination resolves to forbidden private or loopback IP: ${record.address}`);
        }
      } else if (record.family === 6) {
        if (isPrivateIPv6(record.address)) {
          throw new Error(`Destination resolves to forbidden private or loopback IPv6: ${record.address}`);
        }
      }
    }
  } catch (err) {
    if (err.message.includes("Destination resolves to forbidden")) {
      throw err;
    }
    throw new Error(`DNS resolution failed for hostname ${hostname}: ${err.message}`);
  }

  return parsedUrl;
}

// SSRF-safe fetch with redirect re-validation, timeout, and response size limit
async function safeFetch(rawUrl, options = {}) {
  const maxRedirects = options.maxRedirects || 3;
  const timeoutMs = options.timeoutMs || 10000;
  const maxBytes = options.maxBytes || 2 * 1024 * 1024; // 2MB

  let currentUrl = rawUrl;
  let redirectCount = 0;

  while (redirectCount <= maxRedirects) {
    const parsed = await validateAndResolveUrl(currentUrl);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(parsed.toString(), {
        method: "GET",
        headers: {
          "User-Agent": "Binbot-Crawler/1.0 (+https://binbot.example.com; AI Bot Indexer)",
          Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          ...options.headers,
        },
        signal: controller.signal,
        redirect: "manual",
      });

      clearTimeout(timeout);

      // Handle redirects securely by checking destination before following
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get("location");
        if (!location) {
          throw new Error(`Redirect with no Location header received from ${currentUrl}`);
        }
        currentUrl = new URL(location, currentUrl).toString();
        redirectCount++;
        continue;
      }

      if (!response.ok) {
        throw new Error(`HTTP ${response.status} ${response.statusText} for ${currentUrl}`);
      }

      const contentType = response.headers.get("content-type") || "";
      if (
        !contentType.includes("text/html") &&
        !contentType.includes("application/xhtml") &&
        !contentType.includes("text/plain") &&
        !contentType.includes("xml")
      ) {
        throw new Error(`Unsupported content type: ${contentType}`);
      }

      // Read response stream with size limitation
      const reader = response.body.getReader();
      let chunks = [];
      let totalBytes = 0;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        totalBytes += value.length;
        if (totalBytes > maxBytes) {
          controller.abort();
          throw new Error(`Response exceeded maximum size of ${maxBytes} bytes`);
        }
        chunks.push(value);
      }

      const fullBuffer = Buffer.concat(chunks);
      const text = fullBuffer.toString("utf-8");

      return {
        url: currentUrl,
        status: response.status,
        headers: response.headers,
        contentType,
        body: text,
      };
    } catch (err) {
      clearTimeout(timeout);
      if (err.name === "AbortError") {
        throw new Error(`Request timed out after ${timeoutMs}ms for ${currentUrl}`);
      }
      throw err;
    }
  }

  throw new Error(`Too many redirects (exceeded ${maxRedirects})`);
}

module.exports = {
  isPrivateIPv4,
  isPrivateIPv6,
  validateAndResolveUrl,
  safeFetch,
};
