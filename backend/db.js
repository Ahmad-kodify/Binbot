const mongoose = require("mongoose");

let isMongoConnected = false;

// In-Memory store fallback
const memoryStore = {
  bots: new Map(),
  chunks: new Map(), // chunkId -> chunk
  crawlJobs: new Map(),
};

// Mongoose Schemas
const BotSchema = new mongoose.Schema({
  botId: { type: String, required: true, unique: true, index: true },
  name: { type: String, default: "My Chatbot" },
  websiteUrl: { type: String, required: true },
  pageCount: { type: Number, default: 0 },
  chunkCount: { type: Number, default: 0 },
  status: { type: String, default: "ready" },
  createdAt: { type: Date, default: Date.now },
});

const ChunkSchema = new mongoose.Schema({
  botId: { type: String, required: true, index: true },
  url: { type: String, required: true },
  title: { type: String, default: "Untitled" },
  chunkIndex: { type: Number, default: 0 },
  text: { type: String, required: true },
  charCount: { type: Number, default: 0 },
  embedding: { type: [Number], default: [] },
  createdAt: { type: Date, default: Date.now },
});

const CrawlJobSchema = new mongoose.Schema({
  crawlId: { type: String, required: true, unique: true, index: true },
  botId: { type: String, required: true },
  websiteUrl: { type: String, required: true },
  status: { type: String, enum: ["pending", "crawling", "indexing", "completed", "failed"], default: "pending" },
  totalPages: { type: Number, default: 0 },
  crawledPages: { type: Number, default: 0 },
  currentUrl: { type: String, default: "" },
  error: { type: String, default: null },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
});

// Compile models
let BotModel;
let ChunkModel;
let CrawlJobModel;

try {
  BotModel = mongoose.model("Bot", BotSchema);
  ChunkModel = mongoose.model("Chunk", ChunkSchema);
  CrawlJobModel = mongoose.model("CrawlJob", CrawlJobSchema);
} catch {
  BotModel = mongoose.models.Bot;
  ChunkModel = mongoose.models.Chunk;
  CrawlJobModel = mongoose.models.CrawlJob;
}

async function connectDB() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.log("[Database] MONGODB_URI not provided. Using high-performance in-memory repository fallback.");
    return false;
  }

  try {
    await mongoose.connect(uri, {
      serverSelectionTimeoutMS: 5000,
    });
    isMongoConnected = true;
    console.log("[Database] Connected successfully to MongoDB Atlas.");
    return true;
  } catch (err) {
    console.warn(`[Database] MongoDB connection error: ${err.message}. Falling back to in-memory store.`);
    isMongoConnected = false;
    return false;
  }
}

// Unified Repository layer
const db = {
  isMongoActive() {
    return isMongoConnected && mongoose.connection.readyState === 1;
  },

  // Crawl Job operations
  async createCrawlJob(jobData) {
    if (this.isMongoActive()) {
      return await CrawlJobModel.create(jobData);
    }
    const job = { ...jobData, createdAt: new Date(), updatedAt: new Date() };
    memoryStore.crawlJobs.set(job.crawlId, job);
    return job;
  },

  async getCrawlJob(crawlId) {
    if (this.isMongoActive()) {
      return await CrawlJobModel.findOne({ crawlId }).lean();
    }
    return memoryStore.crawlJobs.get(crawlId) || null;
  },

  async updateCrawlJob(crawlId, updates) {
    if (this.isMongoActive()) {
      return await CrawlJobModel.findOneAndUpdate({ crawlId }, { ...updates, updatedAt: new Date() }, { new: true }).lean();
    }
    const job = memoryStore.crawlJobs.get(crawlId);
    if (job) {
      Object.assign(job, updates, { updatedAt: new Date() });
      memoryStore.crawlJobs.set(crawlId, job);
      return job;
    }
    return null;
  },

  // Bot operations
  async saveBot(botData) {
    if (this.isMongoActive()) {
      return await BotModel.findOneAndUpdate({ botId: botData.botId }, botData, { upsert: true, new: true }).lean();
    }
    const existing = memoryStore.bots.get(botData.botId) || {};
    const bot = { ...existing, ...botData, createdAt: existing.createdAt || new Date() };
    memoryStore.bots.set(botData.botId, bot);
    return bot;
  },

  async getBot(botId) {
    if (this.isMongoActive()) {
      return await BotModel.findOne({ botId }).lean();
    }
    return memoryStore.bots.get(botId) || null;
  },

  // Chunk operations
  async saveChunks(chunks) {
    if (this.isMongoActive()) {
      return await ChunkModel.insertMany(chunks);
    }
    for (const chunk of chunks) {
      const id = `${chunk.botId}-${chunk.chunkIndex}-${Date.now()}-${Math.random()}`;
      memoryStore.chunks.set(id, { ...chunk, _id: id });
    }
    return chunks;
  },

  async getChunksForBot(botId) {
    if (this.isMongoActive()) {
      return await ChunkModel.find({ botId }).lean();
    }
    const results = [];
    for (const chunk of memoryStore.chunks.values()) {
      if (chunk.botId === botId) {
        results.push(chunk);
      }
    }
    return results;
  },

  async deleteChunksForBot(botId) {
    if (this.isMongoActive()) {
      return await ChunkModel.deleteMany({ botId });
    }
    for (const [id, chunk] of memoryStore.chunks.entries()) {
      if (chunk.botId === botId) {
        memoryStore.chunks.delete(id);
      }
    }
  },
};

module.exports = {
  connectDB,
  db,
  BotModel,
  ChunkModel,
  CrawlJobModel,
};
