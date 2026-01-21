import express from "express";
import fetch from "node-fetch";
import cors from "cors";
import { JSDOM } from "jsdom";

const app = express();

/* ======================
   HARD CORS FIX (CRITICAL)
====================== */
app.use(cors({
  origin: "*",
  methods: ["GET", "POST", "OPTIONS"],
  allowedHeaders: ["Content-Type"]
}));

app.options("*", cors());
app.use(express.json());

/* ======================
   SETTINGS
====================== */
const TIMEOUT_MS = 10000;
const CONCURRENCY = 3;
const RETRY_COUNT = 2;
const USER_AGENT =
  "Mozilla/5.0 (compatible; BulkMetaExtractor/1.0)";

/* ======================
   FETCH WITH TIMEOUT
====================== */
async function fetchWithTimeout(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    return await fetch(url, {
      signal: controller.signal,
      headers: { "User-Agent": USER_AGENT }
    });
  } finally {
    clearTimeout(timeout);
  }
}

/* ======================
   META EXTRACTION
====================== */
async function extractMeta(url) {
  const res = await fetchWithTimeout(url);
  if (!res.ok) throw new Error(`Fetch failed (Status: ${res.status})`);

  const contentType = res.headers.get("content-type") || "";
  if (!contentType.includes("text/html")) {
    throw new Error(`Not an HTML page (Content-Type: ${contentType})`);
  }

  const html = await res.text();
  const dom = new JSDOM(html);
  const doc = dom.window.document;

  return {
    title: doc.querySelector("title")?.textContent.trim() || "",
    description:
      doc.querySelector('meta[name="description"]')?.getAttribute("content")?.trim() || "",
    h1: [...doc.querySelectorAll("h1")].map(e => e.textContent.trim()).join("\n"),
    h2: [...doc.querySelectorAll("h2")].map(e => e.textContent.trim()).join("\n"),
    ogTitle: doc.querySelector('meta[property="og:title"]')?.getAttribute("content")?.trim() || "",
    ogDescription: doc.querySelector('meta[property="og:description"]')?.getAttribute("content")?.trim() || "",
    ogImage: doc.querySelector('meta[property="og:image"]')?.getAttribute("content")?.trim() || "",
    twitterCard: doc.querySelector('meta[name="twitter:card"]')?.getAttribute("content")?.trim() || "",
    twitterTitle: doc.querySelector('meta[name="twitter:title"]')?.getAttribute("content")?.trim() || "",
    twitterDescription: doc.querySelector('meta[name="twitter:description"]')?.getAttribute("content")?.trim() || "",
    twitterImage: doc.querySelector('meta[name="twitter:image"]')?.getAttribute("content")?.trim() || "",
    canonical: doc.querySelector('link[rel="canonical"]')?.getAttribute("href")?.trim() || ""
  };
}

/* ======================
   PROCESS URL
====================== */
function isValidUrl(url) {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;

    const hostname = parsed.hostname.toLowerCase();
    // Basic SSRF protection
    const blockedHosts = ["localhost", "127.0.0.1", "0.0.0.0", "::1"];
    if (blockedHosts.includes(hostname)) return false;
    if (hostname.endsWith(".local")) return false;

    return true;
  } catch {
    return false;
  }
}

async function processUrl(url) {
  const emptyData = {
    title: "",
    description: "",
    h1: "",
    h2: "",
    ogTitle: "",
    ogDescription: "",
    ogImage: "",
    twitterCard: "",
    twitterTitle: "",
    twitterDescription: "",
    twitterImage: "",
    canonical: ""
  };

  if (!isValidUrl(url)) {
    return {
      url,
      ...emptyData,
      status: "Failed",
      reason: "Invalid URL"
    };
  }

  let lastError = null;
  for (let i = 0; i < RETRY_COUNT; i++) {
    try {
      const data = await extractMeta(url);
      return { url, ...data, status: "Success" };
    } catch (err) {
      lastError = err.message;
      console.warn(`Attempt ${i + 1} failed for ${url}: ${err.message}`);
    }
  }

  return {
    url,
    ...emptyData,
    status: "Failed",
    reason: lastError || "Unknown error"
  };
}

/* ======================
   API ENDPOINT
====================== */
app.post("/extract", async (req, res) => {
  try {
    const urls = Array.isArray(req.body.urls) ? req.body.urls : [];
    const results = [];

    for (let i = 0; i < urls.length; i += CONCURRENCY) {
      const batch = urls.slice(i, i + CONCURRENCY);
      const batchResults = await Promise.all(batch.map(processUrl));
      results.push(...batchResults);
    }

    res.json(results);

  } catch (err) {
    console.error("API Error:", err);
    res.status(500).json({ error: "Extraction failed" });
  }
});

/* ======================
   HEALTH CHECK
====================== */
app.get("/", (_, res) => {
  res.send("Bulk Meta Extractor backend running");
});

/* ======================
   ERROR HANDLING
====================== */
app.use((err, req, res, next) => {
  console.error("Unhandled Error:", err);
  res.status(500).json({ error: "Internal Server Error" });
});

/* ======================
   START
====================== */
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("Backend running on port", PORT);
});
