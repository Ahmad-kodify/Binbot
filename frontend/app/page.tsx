"use client";

import { useState, useEffect, useRef } from "react";

interface CrawlProgress {
  crawlId: string;
  botId: string;
  websiteUrl: string;
  status: "pending" | "crawling" | "indexing" | "completed" | "failed";
  crawledPages: number;
  totalPages: number;
  currentUrl?: string;
  error?: string | null;
}

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  sources?: { url: string; title: string }[];
}

export default function Home() {
  const [websiteUrl, setWebsiteUrl] = useState("");
  const [crawlLoading, setCrawlLoading] = useState(false);
  const [crawlError, setCrawlError] = useState("");
  const [crawlJob, setCrawlJob] = useState<CrawlProgress | null>(null);

  // Chat testing state
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [userQuery, setUserQuery] = useState("");
  const [chatLoading, setChatLoading] = useState(false);
  const [copySuccess, setCopySuccess] = useState(false);

  // Backend Health state
  const [backendStatus, setBackendStatus] = useState<string>("checking");
  const [backendDetails, setBackendDetails] = useState<any>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);

  // API base URL from env or fallback
  const apiUrl =
    process.env.NEXT_PUBLIC_API_URL ||
    (typeof window !== "undefined" && window.location.hostname === "localhost"
      ? "http://localhost:5000"
      : "");

  // Check health on mount
  useEffect(() => {
    async function checkHealth() {
      try {
        const res = await fetch(`${apiUrl}/api/health`);
        if (res.ok) {
          const data = await res.json();
          setBackendStatus("connected");
          setBackendDetails(data);
        } else {
          setBackendStatus("disconnected");
        }
      } catch {
        setBackendStatus("disconnected");
      }
    }
    checkHealth();
  }, [apiUrl]);

  // Scroll chat messages to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatMessages, chatLoading]);

  // Crawl starter
  async function handleStartCrawl(e: React.FormEvent) {
    e.preventDefault();
    if (!websiteUrl) return;

    let target = websiteUrl.trim();
    if (!target.startsWith("http://") && !target.startsWith("https://")) {
      target = `https://${target}`;
    }

    setCrawlLoading(true);
    setCrawlError("");
    setCrawlJob(null);
    setChatMessages([]);

    try {
      const res = await fetch(`${apiUrl}/api/crawl`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ websiteUrl: target }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "Failed to initiate crawl.");
      }

      setCrawlJob({
        crawlId: data.crawlId,
        botId: data.botId,
        websiteUrl: data.websiteUrl,
        status: "crawling",
        crawledPages: 0,
        totalPages: 0,
      });

      // Start polling status
      pollCrawlStatus(data.crawlId, data.botId);
    } catch (err: any) {
      setCrawlError(err.message || "Failed to start crawl.");
      setCrawlLoading(false);
    }
  }

  // Poll status until completion or failure
  async function pollCrawlStatus(crawlId: string, botId: string) {
    const interval = setInterval(async () => {
      try {
        const res = await fetch(`${apiUrl}/api/crawl/${crawlId}`);
        if (!res.ok) return;

        const data: CrawlProgress = await res.json();
        setCrawlJob(data);

        if (data.status === "completed") {
          clearInterval(interval);
          setCrawlLoading(false);
          // Set initial greeting
          setChatMessages([
            {
              role: "assistant",
              content: `Hello! I have indexed ${data.totalPages} page(s) from ${data.websiteUrl}. What would you like to know?`,
            },
          ]);
        } else if (data.status === "failed") {
          clearInterval(interval);
          setCrawlLoading(false);
          setCrawlError(data.error || "Crawl job failed unexpectedly.");
        }
      } catch (err) {
        console.error("Polling error:", err);
      }
    }, 2000);
  }

  // Send question to bot
  async function handleSendMessage(e: React.FormEvent) {
    e.preventDefault();
    if (!userQuery.trim() || !crawlJob?.botId || chatLoading) return;

    const query = userQuery.trim();
    setUserQuery("");
    setChatMessages((prev) => [...prev, { role: "user", content: query }]);
    setChatLoading(true);

    try {
      const res = await fetch(`${apiUrl}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          botId: crawlJob.botId,
          message: query,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "Failed to get an answer.");
      }

      setChatMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: data.answer || "No response generated.",
          sources: data.sources || [],
        },
      ]);
    } catch (err: any) {
      setChatMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: `Error: ${err.message || "Unable to reach chatbot service."}`,
        },
      ]);
    } finally {
      setChatLoading(false);
    }
  }

  // Generate embed code
  const embedSnippet = crawlJob?.botId
    ? `<script src="${
        typeof window !== "undefined" ? window.location.origin : "https://YOUR-FRONTEND-URL"
      }/widget.js" data-bot-id="${crawlJob.botId}" data-api-url="${apiUrl}" defer></script>`
    : "";

  function handleCopySnippet() {
    if (!embedSnippet) return;
    navigator.clipboard.writeText(embedSnippet);
    setCopySuccess(true);
    setTimeout(() => setCopySuccess(false), 3000);
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col selection:bg-cyan-500 selection:text-slate-950">
      {/* Top Navbar */}
      <header className="border-b border-slate-800/80 bg-slate-950/70 backdrop-blur sticky top-0 z-50 px-6 py-4">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-xl bg-gradient-to-tr from-cyan-500 to-blue-600 flex items-center justify-center font-bold text-slate-950 shadow-md shadow-cyan-500/20">
              B
            </div>
            <span className="font-bold text-xl tracking-tight text-white">Binbot</span>
            <span className="text-xs px-2 py-0.5 rounded-full bg-cyan-950/80 text-cyan-400 border border-cyan-800/50 font-mono">
              MVP
            </span>
          </div>

          <div className="flex items-center gap-3 text-xs">
            <span className="flex items-center gap-1.5 text-slate-400">
              <span
                className={`h-2 w-2 rounded-full ${
                  backendStatus === "connected"
                    ? "bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.8)]"
                    : "bg-amber-400"
                }`}
              />
              Backend: {backendStatus === "connected" ? "Live" : "Connecting..."}
            </span>
            {backendDetails?.database && (
              <span className="hidden sm:inline-block text-slate-500 border-l border-slate-800 pl-3">
                DB: {backendDetails.database}
              </span>
            )}
          </div>
        </div>
      </header>

      {/* Main Container */}
      <main className="flex-1 max-w-5xl mx-auto px-6 py-12 w-full space-y-16">
        {/* Hero Section */}
        <div className="text-center space-y-5 max-w-3xl mx-auto">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-slate-900 border border-slate-800 text-xs text-cyan-400 font-medium">
            <span className="h-1.5 w-1.5 rounded-full bg-cyan-400 animate-pulse" />
            AI Website Chatbot SaaS
          </div>

          <h1 className="text-4xl sm:text-6xl font-extrabold tracking-tight text-white leading-tight">
            Train an AI Chatbot on Your <span className="text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 to-blue-500">Website Content</span>
          </h1>

          <p className="text-base sm:text-lg text-slate-400 max-w-2xl mx-auto leading-relaxed">
            Enter your website URL. Binbot crawls your pages, extracts the content, and generates a grounded AI assistant you can test and embed anywhere in minutes.
          </p>

          {/* Crawl URL Input Form */}
          <form onSubmit={handleStartCrawl} className="pt-4 max-w-2xl mx-auto">
            <div className="flex flex-col sm:flex-row gap-3 p-1.5 rounded-2xl bg-slate-900/90 border border-slate-800 shadow-2xl focus-within:border-cyan-500 transition-colors">
              <input
                type="text"
                value={websiteUrl}
                onChange={(e) => setWebsiteUrl(e.target.value)}
                placeholder="https://yourwebsite.com"
                disabled={crawlLoading}
                required
                className="flex-1 bg-transparent px-4 py-3.5 text-sm sm:text-base outline-none text-white placeholder-slate-500"
              />
              <button
                type="submit"
                disabled={crawlLoading || !websiteUrl.trim()}
                className="px-6 py-3.5 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 font-semibold text-slate-950 text-sm sm:text-base transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shadow-cyan-500/20 active:scale-[0.98]"
              >
                {crawlLoading ? (
                  <span className="flex items-center gap-2">
                    <svg className="animate-spin h-4 w-4 text-slate-950" viewBox="0 0 24 24" fill="none">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                    </svg>
                    Crawling...
                  </span>
                ) : (
                  "Create My Chatbot"
                )}
              </button>
            </div>
          </form>

          {/* Error Banner */}
          {crawlError && (
            <div className="p-4 rounded-xl bg-red-950/50 border border-red-800 text-red-200 text-sm max-w-2xl mx-auto flex items-start gap-3 text-left">
              <span className="text-red-400 font-bold">Error:</span>
              <span>{crawlError}</span>
            </div>
          )}

          {/* Crawling Progress Card */}
          {crawlJob && (
            <div className="p-6 rounded-2xl bg-slate-900/80 border border-slate-800 text-left max-w-2xl mx-auto space-y-4 shadow-xl">
              <div className="flex items-center justify-between text-sm">
                <span className="font-medium text-slate-200 flex items-center gap-2">
                  {crawlJob.status === "completed" ? (
                    <span className="text-emerald-400 flex items-center gap-1.5 font-semibold">
                      <span className="h-2 w-2 rounded-full bg-emerald-400" />
                      Crawling & Indexing Complete!
                    </span>
                  ) : crawlJob.status === "failed" ? (
                    <span className="text-red-400 font-semibold">Crawl Failed</span>
                  ) : (
                    <span className="text-cyan-400 flex items-center gap-1.5 font-semibold">
                      <span className="h-2 w-2 rounded-full bg-cyan-400 animate-ping" />
                      {crawlJob.status === "indexing" ? "Generating Vector Index..." : "Crawling Pages..."}
                    </span>
                  )}
                </span>
                <span className="text-xs text-slate-400 font-mono">
                  {crawlJob.crawledPages} page(s) processed
                </span>
              </div>

              {/* Progress bar */}
              <div className="w-full bg-slate-800 h-2 rounded-full overflow-hidden">
                <div
                  className={`h-full transition-all duration-500 ${
                    crawlJob.status === "completed"
                      ? "bg-emerald-500 w-full"
                      : "bg-cyan-500 w-3/4 animate-pulse"
                  }`}
                />
              </div>

              {crawlJob.currentUrl && crawlJob.status !== "completed" && (
                <div className="text-xs text-slate-400 truncate">
                  Current target: <span className="text-slate-300 font-mono">{crawlJob.currentUrl}</span>
                </div>
              )}

              <div className="grid grid-cols-2 gap-2 pt-2 border-t border-slate-800 text-xs">
                <div>
                  <span className="text-slate-500">Website: </span>
                  <span className="text-slate-300 font-medium">{crawlJob.websiteUrl}</span>
                </div>
                <div>
                  <span className="text-slate-500">Bot ID: </span>
                  <span className="text-cyan-400 font-mono">{crawlJob.botId}</span>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Interactive Chatbot Playground & Embed Section (Shown when bot is ready) */}
        {crawlJob?.status === "completed" && (
          <div className="space-y-10 pt-4">
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
              {/* Chat Simulator */}
              <div className="lg:col-span-7 rounded-2xl bg-slate-900 border border-slate-800 shadow-2xl flex flex-col h-[520px] overflow-hidden">
                <div className="p-4 bg-slate-950/80 border-b border-slate-800 flex items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    <div className="h-3 w-3 rounded-full bg-emerald-400 animate-pulse" />
                    <span className="font-semibold text-sm text-white">Live Playground</span>
                    <span className="text-xs text-slate-400">({crawlJob.websiteUrl})</span>
                  </div>
                  <span className="text-xs px-2 py-0.5 rounded bg-slate-800 text-slate-300">
                    Grounded RAG
                  </span>
                </div>

                {/* Messages Container */}
                <div className="flex-1 p-4 overflow-y-auto space-y-3.5 bg-slate-950/40">
                  {chatMessages.map((msg, idx) => (
                    <div
                      key={idx}
                      className={`flex flex-col ${
                        msg.role === "user" ? "items-end" : "items-start"
                      }`}
                    >
                      <div
                        className={`max-w-[85%] rounded-2xl p-3.5 text-sm ${
                          msg.role === "user"
                            ? "bg-cyan-600 text-white rounded-br-none"
                            : "bg-slate-800/90 text-slate-200 border border-slate-700/60 rounded-bl-none"
                        }`}
                      >
                        <p className="whitespace-pre-wrap leading-relaxed">{msg.content}</p>

                        {/* Source citations */}
                        {msg.sources && msg.sources.length > 0 && (
                          <div className="mt-3 pt-2.5 border-t border-slate-700/80 text-xs">
                            <span className="text-cyan-400 font-medium block mb-1">Sources:</span>
                            <div className="space-y-1">
                              {msg.sources.map((s, sIdx) => (
                                <a
                                  key={sIdx}
                                  href={s.url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-cyan-300/80 hover:text-cyan-200 underline block truncate max-w-full"
                                >
                                  {s.title || s.url}
                                </a>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  ))}

                  {chatLoading && (
                    <div className="flex items-center gap-2 text-xs text-cyan-400 p-2">
                      <span className="h-2 w-2 rounded-full bg-cyan-400 animate-bounce" />
                      <span className="h-2 w-2 rounded-full bg-cyan-400 animate-bounce [animation-delay:0.2s]" />
                      <span className="h-2 w-2 rounded-full bg-cyan-400 animate-bounce [animation-delay:0.4s]" />
                      <span>Thinking...</span>
                    </div>
                  )}

                  <div ref={messagesEndRef} />
                </div>

                {/* Input Area */}
                <form
                  onSubmit={handleSendMessage}
                  className="p-3 bg-slate-950 border-t border-slate-800 flex gap-2"
                >
                  <input
                    type="text"
                    value={userQuery}
                    onChange={(e) => setUserQuery(e.target.value)}
                    placeholder="Ask a question about this website..."
                    disabled={chatLoading}
                    className="flex-1 bg-slate-900 border border-slate-700/80 rounded-xl px-4 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-cyan-400"
                  />
                  <button
                    type="submit"
                    disabled={chatLoading || !userQuery.trim()}
                    className="px-4 py-2.5 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-semibold text-sm transition-all disabled:opacity-50"
                  >
                    Send
                  </button>
                </form>
              </div>

              {/* Embed Script Generation Panel */}
              <div className="lg:col-span-5 rounded-2xl bg-slate-900 border border-slate-800 p-6 space-y-5 shadow-2xl">
                <div>
                  <h3 className="text-lg font-bold text-white flex items-center gap-2">
                    <span className="text-cyan-400">⚡</span> Embed On Your Website
                  </h3>
                  <p className="text-xs text-slate-400 mt-1">
                    Copy and paste this snippet right before the closing <code className="text-cyan-300">&lt;/body&gt;</code> tag on any HTML, WordPress, Webflow, or Shopify site.
                  </p>
                </div>

                <div className="relative">
                  <pre className="p-4 rounded-xl bg-slate-950 border border-slate-800 text-cyan-300 font-mono text-xs overflow-x-auto whitespace-pre-wrap break-all select-all">
                    {embedSnippet}
                  </pre>
                  <button
                    onClick={handleCopySnippet}
                    className="absolute top-2 right-2 px-3 py-1.5 rounded-lg bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-semibold text-xs transition-all shadow-md"
                  >
                    {copySuccess ? "Copied!" : "Copy Snippet"}
                  </button>
                </div>

                <div className="p-4 rounded-xl bg-slate-950/60 border border-slate-800/80 space-y-2 text-xs">
                  <div className="font-semibold text-slate-200">Widget Features:</div>
                  <ul className="list-disc list-inside space-y-1 text-slate-400">
                    <li>Zero-dependency isolated Shadow DOM (no CSS conflicts)</li>
                    <li>Automatic responsive floating chat launcher</li>
                    <li>Direct grounded retrieval from your crawled content</li>
                    <li>Source page citation links for visitor transparency</li>
                  </ul>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* How It Works Section */}
        <section className="pt-8 border-t border-slate-800/60">
          <div className="text-center max-w-md mx-auto mb-10">
            <h2 className="text-2xl font-bold text-white">How Binbot Works</h2>
            <p className="text-xs text-slate-400 mt-1">
              Three simple steps to deploy an AI agent trained on your business data.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="p-6 rounded-2xl bg-slate-900/50 border border-slate-800/80 space-y-3">
              <div className="h-10 w-10 rounded-xl bg-cyan-950 border border-cyan-800/60 flex items-center justify-center font-bold text-cyan-400">
                1
              </div>
              <h3 className="font-semibold text-base text-white">1. Intelligent Crawling</h3>
              <p className="text-xs text-slate-400 leading-relaxed">
                We discover your pages via sitemap and internal links, sanitizing HTML and stripping clutter while enforcing strict security rules.
              </p>
            </div>

            <div className="p-6 rounded-2xl bg-slate-900/50 border border-slate-800/80 space-y-3">
              <div className="h-10 w-10 rounded-xl bg-blue-950 border border-blue-800/60 flex items-center justify-center font-bold text-blue-400">
                2
              </div>
              <h3 className="font-semibold text-base text-white">2. Vector Indexing</h3>
              <p className="text-xs text-slate-400 leading-relaxed">
                Extracted content is cleaned, partitioned into semantic overlapping chunks, and indexed for rapid semantic similarity search.
              </p>
            </div>

            <div className="p-6 rounded-2xl bg-slate-900/50 border border-slate-800/80 space-y-3">
              <div className="h-10 w-10 rounded-xl bg-emerald-950 border border-emerald-800/60 flex items-center justify-center font-bold text-emerald-400">
                3
              </div>
              <h3 className="font-semibold text-base text-white">3. Embed & Deploy</h3>
              <p className="text-xs text-slate-400 leading-relaxed">
                Paste a single embed tag on your site. The lightweight widget answers visitor queries with strictly grounded responses and sources.
              </p>
            </div>
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer className="border-t border-slate-800/80 py-6 text-center text-xs text-slate-500">
        <p>© 2026 Binbot AI SaaS. Grounded AI website assistants.</p>
      </footer>
    </div>
  );
}
