
"use client";

import { useState } from "react";

export default function Home() {
  const [websiteUrl, setWebsiteUrl] = useState("");
  const [apiStatus, setApiStatus] = useState("");
  const [loading, setLoading] = useState(false);

  async function testBackend() {
    setLoading(true);
    setApiStatus("");

    try {
      const response = await fetch(
        "http://localhost:5000/api/health"
      );

      if (!response.ok) {
        throw new Error("Backend request failed");
      }

      const data = await response.json();
      setApiStatus(data.message);
    } catch {
      setApiStatus(
        "Backend se connection nahi ho saka. Check karo server run ho raha hai."
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen bg-slate-950 text-white flex items-center justify-center p-6">
      <div className="w-full max-w-2xl text-center">
        <p className="mb-4 text-sm text-cyan-400">
          AI CHATBOT SAAS
        </p>

        <h1 className="text-4xl font-bold md:text-6xl">
          Your Website, Powered by AI
        </h1>

        <p className="mt-4 text-slate-400">
          Connect your website and build an AI chatbot
          that answers questions using your content.
        </p>

        <div className="mt-8 flex flex-col gap-3 sm:flex-row">
          <input
            type="url"
            value={websiteUrl}
            onChange={(e) => setWebsiteUrl(e.target.value)}
            placeholder="https://yourwebsite.com"
            className="flex-1 rounded-xl border border-slate-700 bg-slate-900 px-4 py-3 outline-none focus:border-cyan-400"
          />

          <button
            onClick={testBackend}
            disabled={loading}
            className="rounded-xl bg-cyan-500 px-6 py-3 font-semibold text-slate-950 disabled:opacity-50"
          >
            {loading ? "Connecting..." : "Test Connection"}
          </button>
        </div>

        {apiStatus && (
          <p className="mt-5 rounded-xl bg-slate-900 p-4 text-sm text-cyan-300">
            {apiStatus}
          </p>
        )}

        <p className="mt-4 text-xs text-slate-500">
          Website entered: {websiteUrl || "None yet"}
        </p>
      </div>
    </main>
  );
}
