const assert = require("assert");
const { validateAndResolveUrl, isPrivateIPv4 } = require("./security");
const { chunkText, processPagesIntoChunks } = require("./chunker");
const { retrieveRelevantChunks, generateAnswer, cosineSimilarity } = require("./ai");

async function runTests() {
  console.log("=========================================");
  console.log("       BINBOT BACKEND TEST SUITE        ");
  console.log("=========================================\n");

  let passed = 0;
  let failed = 0;

  function test(name, fn) {
    try {
      fn();
      console.log(`[PASS] ${name}`);
      passed++;
    } catch (err) {
      console.error(`[FAIL] ${name}: ${err.message}`);
      failed++;
    }
  }

  async function testAsync(name, fn) {
    try {
      await fn();
      console.log(`[PASS] ${name}`);
      passed++;
    } catch (err) {
      console.error(`[FAIL] ${name}: ${err.message}`);
      failed++;
    }
  }

  // --- 1. SSRF & Security Tests ---
  console.log("--- 1. SSRF & Security Verification ---");
  test("Detect private IPv4 addresses correctly", () => {
    assert.strictEqual(isPrivateIPv4("127.0.0.1"), true);
    assert.strictEqual(isPrivateIPv4("10.0.0.1"), true);
    assert.strictEqual(isPrivateIPv4("192.168.1.1"), true);
    assert.strictEqual(isPrivateIPv4("169.254.169.254"), true); // Cloud metadata
    assert.strictEqual(isPrivateIPv4("8.8.8.8"), false); // Public DNS
    assert.strictEqual(isPrivateIPv4("93.184.216.34"), false); // Example.com
  });

  await testAsync("Reject localhost hostname", async () => {
    let threw = false;
    try {
      await validateAndResolveUrl("http://localhost:5000");
    } catch (err) {
      threw = true;
      assert(err.message.includes("blocked") || err.message.includes("private"));
    }
    assert.strictEqual(threw, true, "Localhost must be rejected");
  });

  await testAsync("Reject loopback IP 127.0.0.1", async () => {
    let threw = false;
    try {
      await validateAndResolveUrl("http://127.0.0.1:3000");
    } catch (err) {
      threw = true;
      assert(err.message.includes("blocked") || err.message.includes("forbidden"));
    }
    assert.strictEqual(threw, true, "127.0.0.1 must be rejected");
  });

  await testAsync("Reject non-http protocol like file:// or ftp://", async () => {
    let threw = false;
    try {
      await validateAndResolveUrl("file:///etc/passwd");
    } catch {
      threw = true;
    }
    assert.strictEqual(threw, true, "file:// protocol must be rejected");
  });

  await testAsync("Accept valid public domain", async () => {
    const parsed = await validateAndResolveUrl("https://example.com");
    assert.strictEqual(parsed.hostname, "example.com");
  });

  // --- 2. Chunker Tests ---
  console.log("\n--- 2. Chunker & Text Processing Verification ---");
  test("Chunking preserves boundaries and creates overlapping chunks", () => {
    const longText =
      "This is paragraph 1. It provides detailed context about services. " +
      "We offer AI chatbot engineering for companies across the globe. ".repeat(10);
    const chunks = chunkText(longText, { chunkSize: 200, chunkOverlap: 50 });
    assert(chunks.length > 1, "Should create multiple chunks for long text");
    assert(chunks[0].length <= 250, "Chunk should respect approximate boundary size");
  });

  test("processPagesIntoChunks maps metadata properly", () => {
    const pages = [
      { url: "https://example.com/about", title: "About Us", text: "Acme Corp builds innovative tools." },
    ];
    const chunks = processPagesIntoChunks("bot_123", pages);
    assert.strictEqual(chunks.length, 1);
    assert.strictEqual(chunks[0].botId, "bot_123");
    assert.strictEqual(chunks[0].url, "https://example.com/about");
    assert.strictEqual(chunks[0].title, "About Us");
  });

  // --- 3. Retrieval & Grounding Tests ---
  console.log("\n--- 3. Retrieval & Grounded AI Verification ---");
  test("Cosine similarity calculates exact vector matches", () => {
    const vecA = [1, 0, 0];
    const vecB = [1, 0, 0];
    const vecC = [0, 1, 0];
    assert.strictEqual(Math.round(cosineSimilarity(vecA, vecB)), 1);
    assert.strictEqual(Math.round(cosineSimilarity(vecA, vecC)), 0);
  });

  await testAsync("Retrieval ranks relevant chunks top", async () => {
    const mockChunks = [
      { text: "We provide cloud hosting and VPS deployments for clients worldwide.", title: "Cloud Hosting", url: "https://example.com/cloud" },
      { text: "Our company cafeteria serves coffee and fresh breakfast from 8am.", title: "Cafeteria", url: "https://example.com/cafe" },
    ];
    const retrieved = await retrieveRelevantChunks("What cloud hosting options exist?", mockChunks, 1);
    assert.strictEqual(retrieved.length, 1);
    assert.strictEqual(retrieved[0].title, "Cloud Hosting");
  });

  await testAsync("Grounded answer reports missing information when out-of-context", async () => {
    const mockChunks = [
      { text: "Acme specializes in enterprise cybersecurity and firewall protection.", title: "Security", url: "https://example.com/security" },
    ];
    const res = await generateAnswer("What are the prices for cheese pizzas?", mockChunks);
    assert(
      res.answer.toLowerCase().includes("couldn't find") ||
      res.answer.toLowerCase().includes("could not find") ||
      res.answer.toLowerCase().includes("sorry") ||
      res.answer.toLowerCase().includes("not contain"),
      "Must decline to invent facts when info is missing"
    );
  });

  console.log("\n=========================================");
  console.log(`TEST SUMMARY: ${passed} Passed, ${failed} Failed`);
  console.log("=========================================\n");

  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error("Test execution error:", err);
  process.exit(1);
});
