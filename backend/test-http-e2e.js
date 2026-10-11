const http = require("http");

async function runE2E() {
  console.log("Starting End-to-End HTTP Integration Test...\n");
  
  process.env.PORT = "5099";
  const server = require("./server");

  // Wait 1 second for server to listen
  await new Promise((r) => setTimeout(r, 1000));
  const baseUrl = "http://localhost:5099";

  // 1. Health Endpoint Test
  console.log("1. Testing GET /api/health");
  const healthRes = await fetch(`${baseUrl}/api/health`);
  const healthData = await healthRes.json();
  console.log("   Health response:", healthData);
  if (healthData.status !== "ok") throw new Error("Health check failed");

  // 2. Widget Static Script Test
  console.log("2. Testing GET /widget.js");
  const widgetRes = await fetch(`${baseUrl}/widget.js`);
  if (!widgetRes.ok) throw new Error("Widget script not served");
  const widgetText = await widgetRes.text();
  if (!widgetText.includes("binbot-widget-root")) throw new Error("Widget script content mismatch");
  console.log("   Widget served successfully (length:", widgetText.length, "bytes)");

  // 3. SSRF Protection on Crawl Endpoint
  console.log("3. Testing SSRF Protection: POST /api/crawl with 127.0.0.1");
  const ssrfRes = await fetch(`${baseUrl}/api/crawl`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ websiteUrl: "http://127.0.0.1:8080" }),
  });
  if (ssrfRes.status !== 400) throw new Error(`Expected 400 for SSRF, got ${ssrfRes.status}`);
  const ssrfErr = await ssrfRes.json();
  console.log("   SSRF correctly blocked with error:", ssrfErr.error);

  // 4. Live Crawl of Public Website
  console.log("4. Testing real crawl: POST /api/crawl with https://example.com");
  const crawlRes = await fetch(`${baseUrl}/api/crawl`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ websiteUrl: "https://example.com" }),
  });
  if (!crawlRes.ok) throw new Error(`Crawl initiation failed: ${crawlRes.status}`);
  const crawlInit = await crawlRes.json();
  console.log("   Crawl initialized:", crawlInit);

  // 5. Poll crawl progress
  console.log("5. Polling crawl progress...");
  let attempts = 0;
  let jobStatus;
  while (attempts < 20) {
    await new Promise((r) => setTimeout(r, 1500));
    const pollRes = await fetch(`${baseUrl}/api/crawl/${crawlInit.crawlId}`);
    jobStatus = await pollRes.json();
    console.log(`   Attempt ${attempts + 1}: status = ${jobStatus.status}, pages = ${jobStatus.crawledPages}`);
    if (jobStatus.status === "completed" || jobStatus.status === "failed") break;
    attempts++;
  }

  if (jobStatus.status !== "completed") {
    throw new Error(`Crawl did not complete successfully. Status: ${jobStatus.status}, Error: ${jobStatus.error}`);
  }
  console.log("   Crawl completed! Total pages:", jobStatus.totalPages);

  // 6. Test Bot Info
  console.log("6. Testing GET /api/bot/:botId");
  const botRes = await fetch(`${baseUrl}/api/bot/${crawlInit.botId}`);
  const botData = await botRes.json();
  console.log("   Bot retrieved:", botData);

  // 7. Grounded Chat Test (relevant query)
  console.log("7. Testing POST /api/chat with relevant question");
  const chatRes1 = await fetch(`${baseUrl}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      botId: crawlInit.botId,
      message: "What is this domain used for?",
    }),
  });
  const chatData1 = await chatRes1.json();
  console.log("   Relevant question answer:", chatData1.answer.slice(0, 160) + "...");
  console.log("   Sources returned:", chatData1.sources);
  if (!chatData1.answer || chatData1.sources.length === 0) {
    throw new Error("Chat did not return expected grounded answer or sources");
  }

  // 8. Grounded Chat Test (irrelevant query)
  console.log("8. Testing POST /api/chat with out-of-domain question");
  const chatRes2 = await fetch(`${baseUrl}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      botId: crawlInit.botId,
      message: "How much do large pepperoni pizzas cost?",
    }),
  });
  const chatData2 = await chatRes2.json();
  console.log("   Irrelevant question answer:", chatData2.answer);
  if (!chatData2.answer.toLowerCase().includes("couldn't find") && !chatData2.answer.toLowerCase().includes("could not find")) {
    throw new Error("Chat should decline to answer questions absent from the crawled site");
  }

  console.log("\n==================================================");
  console.log("   ALL HTTP END-TO-END INTEGRATION TESTS PASSED!   ");
  console.log("==================================================");
  process.exit(0);
}

runE2E().catch((err) => {
  console.error("E2E Test Failure:", err);
  process.exit(1);
});
