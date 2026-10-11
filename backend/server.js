const path = require("path");
// Support .env in either backend directory or root directory
require("dotenv").config({ path: path.resolve(__dirname, ".env") });
require("dotenv").config({ path: path.resolve(__dirname, "..", ".env") });

const express = require("express");
const cors = require("cors");
const crypto = require("crypto");

const { connectDB, db } = require("./db");
const { validateAndResolveUrl } = require("./security");
const { crawlWebsite } = require("./crawler");
const { processPagesIntoChunks } = require("./chunker");
const { generateEmbedding, retrieveRelevantChunks, generateAnswer } = require("./ai");

const app = express();
const PORT = process.env.PORT || 5000;

// Connect to database on startup (with graceful fallback)
connectDB();

// CORS configuration: Allow frontend origin and widget requests
const allowedOrigins = process.env.FRONTEND_URL
  ? [process.env.FRONTEND_URL.replace(/\/$/, "")]
  : ["http://localhost:3000"];

app.use(
  cors({
    origin: (origin, callback) => {
      // Allow requests with no origin (e.g. mobile apps, curl, or same-origin)
      if (!origin) return callback(null, true);
      // For the public widget and chat endpoint, allow any origin to embed the widget
      return callback(null, true);
    },
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);

app.use(express.json({ limit: "500kb" }));

// Serve widget.js statically
app.use(express.static(path.join(__dirname, "public")));

// 1. Health check endpoint
app.get("/api/health", (req, res) => {
  res.json({
    status: "ok",
    uptime: Math.floor(process.uptime()),
    database: db.isMongoActive() ? "mongodb-connected" : "in-memory-fallback",
    aiConfigured: !!(process.env.GEMINI_API_KEY || process.env.OPENAI_API_KEY),
    timestamp: new Date().toISOString(),
  });
});

// 2. Start a website crawl
app.post("/api/crawl", async (req, res) => {
  try {
    const { websiteUrl } = req.body;

    if (!websiteUrl || typeof websiteUrl !== "string") {
      return res.status(400).json({ error: "Missing or invalid websiteUrl field." });
    }

    // SSRF and protocol check
    let parsedUrl;
    try {
      parsedUrl = await validateAndResolveUrl(websiteUrl);
    } catch (valErr) {
      return res.status(400).json({ error: `Invalid or forbidden URL: ${valErr.message}` });
    }

    const crawlId = `crawl_${crypto.randomUUID().slice(0, 12)}`;
    const botId = `bot_${crypto.randomUUID().slice(0, 12)}`;
    const normalizedUrl = parsedUrl.origin;

    // Initialize job in database
    await db.createCrawlJob({
      crawlId,
      botId,
      websiteUrl: normalizedUrl,
      status: "crawling",
      totalPages: 0,
      crawledPages: 0,
      currentUrl: normalizedUrl,
    });

    // Start asynchronous crawl process so request returns immediately
    (async () => {
      try {
        const crawlResult = await crawlWebsite(
          normalizedUrl,
          { maxPages: 20, maxDepth: 2, timeoutPerRequestMs: 8000 },
          async (progress) => {
            await db.updateCrawlJob(crawlId, {
              crawledPages: progress.crawledCount,
              currentUrl: progress.currentUrl,
            });
          }
        );

        if (!crawlResult.pages || crawlResult.pages.length === 0) {
          throw new Error("No accessible HTML pages could be crawled from this website.");
        }

        await db.updateCrawlJob(crawlId, {
          status: "indexing",
          crawledPages: crawlResult.totalPages,
          totalPages: crawlResult.totalPages,
        });

        // Split text into chunks
        const chunks = processPagesIntoChunks(botId, crawlResult.pages);

        // Generate embeddings in batches if AI provider is configured
        if (process.env.GEMINI_API_KEY || process.env.OPENAI_API_KEY) {
          for (let i = 0; i < chunks.length; i++) {
            try {
              const embedding = await generateEmbedding(chunks[i].text);
              if (embedding) {
                chunks[i].embedding = embedding;
              }
            } catch (embErr) {
              console.warn(`[Index] Failed embedding for chunk ${i}: ${embErr.message}`);
            }
          }
        }

        // Save chunks to database
        await db.saveChunks(chunks);

        // Save bot record
        let siteName = "Website Assistant";
        if (crawlResult.pages[0] && crawlResult.pages[0].title) {
          siteName = crawlResult.pages[0].title.slice(0, 50);
        }

        await db.saveBot({
          botId,
          name: siteName,
          websiteUrl: normalizedUrl,
          pageCount: crawlResult.totalPages,
          chunkCount: chunks.length,
          status: "ready",
        });

        // Mark crawl job as completed
        await db.updateCrawlJob(crawlId, {
          status: "completed",
          totalPages: crawlResult.totalPages,
          crawledPages: crawlResult.totalPages,
        });

        console.log(`[Crawl] Successfully indexed bot ${botId} with ${crawlResult.totalPages} pages and ${chunks.length} chunks.`);
      } catch (crawlErr) {
        console.error(`[Crawl Error] Job ${crawlId} failed:`, crawlErr.message);
        await db.updateCrawlJob(crawlId, {
          status: "failed",
          error: crawlErr.message,
        });
      }
    })();

    res.json({
      success: true,
      crawlId,
      botId,
      websiteUrl: normalizedUrl,
      status: "crawling",
      message: "Crawl started successfully. Poll /api/crawl/:crawlId for progress.",
    });
  } catch (err) {
    console.error("[Crawl Start Error]", err);
    res.status(500).json({ error: err.message || "Failed to initialize crawl." });
  }
});

// 3. Check crawl job status
app.get("/api/crawl/:crawlId", async (req, res) => {
  try {
    const { crawlId } = req.params;
    const job = await db.getCrawlJob(crawlId);

    if (!job) {
      return res.status(404).json({ error: "Crawl job not found." });
    }

    res.json({
      crawlId: job.crawlId,
      botId: job.botId,
      websiteUrl: job.websiteUrl,
      status: job.status,
      crawledPages: job.crawledPages,
      totalPages: job.totalPages,
      currentUrl: job.currentUrl,
      error: job.error,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 4. Get bot details
app.get("/api/bot/:botId", async (req, res) => {
  try {
    const { botId } = req.params;
    const bot = await db.getBot(botId);

    if (!bot) {
      return res.status(404).json({ error: "Bot not found." });
    }

    res.json({
      botId: bot.botId,
      name: bot.name,
      websiteUrl: bot.websiteUrl,
      pageCount: bot.pageCount,
      chunkCount: bot.chunkCount,
      status: bot.status,
      createdAt: bot.createdAt,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 5. Chat API endpoint (RAG Grounded Response)
app.post("/api/chat", async (req, res) => {
  try {
    const { botId, message } = req.body;

    if (!botId || typeof botId !== "string") {
      return res.status(400).json({ error: "Missing or invalid botId." });
    }

    if (!message || typeof message !== "string" || message.trim().length === 0) {
      return res.status(400).json({ error: "Message cannot be empty." });
    }

    if (message.length > 1000) {
      return res.status(400).json({ error: "Message exceeds 1000 character limit." });
    }

    // Retrieve bot and verify existence
    const bot = await db.getBot(botId);
    if (!bot) {
      return res.status(404).json({ error: "Bot not found or has not finished crawling." });
    }

    // Retrieve stored chunks for this bot
    const chunks = await db.getChunksForBot(botId);
    if (!chunks || chunks.length === 0) {
      return res.json({
        answer: "This bot has no indexed content yet. Please verify that the website crawl completed successfully.",
        sources: [],
      });
    }

    // Perform retrieval
    const relevantChunks = await retrieveRelevantChunks(message, chunks, 4);

    // Generate grounded answer
    const result = await generateAnswer(message, relevantChunks, bot.name || "Website Assistant");

    res.json({
      botId,
      answer: result.answer,
      sources: result.sources || [],
      provider: result.provider,
    });
  } catch (err) {
    console.error("[Chat Error]", err);
    res.status(500).json({ error: err.message || "An error occurred while generating response." });
  }
});

// Global error handler
app.use((err, req, res, next) => {
  console.error("[Unhandled Error]", err);
  res.status(500).json({ error: "Internal Server Error" });
});

app.listen(PORT, () => {
  console.log(`Backend server running on http://localhost:${PORT}`);
});
