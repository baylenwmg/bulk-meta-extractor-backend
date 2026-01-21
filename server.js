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
const USER_AGENT = "Mozilla/5.0 (compatible; BulkMetaExtractor/1.0)";

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
   SITEMAP PARSING
====================== */
async function getUrlsFromSitemap(sitemapUrl) {
  try {
    const res = await fetchWithTimeout(sitemapUrl);
    if (!res.ok) throw new Error("Sitemap fetch failed");
    const xml = await res.text();
    
    // Regex to find <loc>URL</loc> tags
    const matches = xml.match(/<loc>(.*?)<\/loc>/g);
    if (!matches) return [];
    
    // Clean tags and remove duplicates
    const urls = matches.map(m => m.replace(/<\/?loc>/g, "").trim());
    return [...new Set(urls)];
  } catch (err) {
    console.error("Sitemap Error:", err);
    return [];
  }
}

/* ======================
   META EXTRACTION
====================== */
async function extractMeta(url) {
  const res = await fetchWithTimeout(url);
  if (!res.ok) throw new Error(`Fetch failed for ${url}`);

  const html = await res.text();
  const dom = new JSDOM(html);
  const doc = dom.window.document;

  return {
    title: doc.querySelector("title")?.textContent.trim() || "",
    description: doc.querySelector('meta[name="description"]')?.getAttribute("content")?.trim() || "",
    h1: [...doc.querySelectorAll("h1")].map(e => e.textContent.trim()).join("\n"),
    h2: [...doc.querySelectorAll("h2")].map(e => e.textContent.trim()).join("\n")
  };
}

/* ======================
   PROCESS URL (RETRY LOGIC)
====================== */
async function processUrl(url) {
  for (let i = 0; i < RETRY_COUNT; i++) {
    try {
      const data = await extractMeta(url);
      return { url, ...data, status: "Success" };
    } catch (e) {
      if (i === RETRY_COUNT - 1) console.error(`Failed after ${RETRY_COUNT} attempts: ${url}`);
    }
  }

  return {
    url,
    title: "",
    description: "",
    h1: "",
    h2: "",
    status: "Failed"
  };
}

/* ======================
   NEW ENDPOINT: PARSE SITEMAP ONLY
   (Used for Progress Bar Init)
====================== */
app.post("/parse-sitemap", async (req, res) => {
  try {
    const { sitemapUrl } = req.body;
    if (!sitemapUrl) return res.status(400).json({ error: "Sitemap URL required" });
    
    const urls = await getUrlsFromSitemap(sitemapUrl);
    res.json({ urls });
  } catch (err) {
    res.status(500).json({ error: "Failed to parse sitemap" });
  }
});

/* ======================
   EXTRACTION ENDPOINT
   (Handles both single and batch URLs)
====================== */
app.post("/extract", async (req, res) => {
  try {
    const urls = Array.isArray(req.body.urls) ? req.body.urls : [];
    if (urls.length === 0) return res.json([]);

    const results = [];
    // Process in internal batches to respect concurrency
    for (let i = 0; i < urls.length; i += CONCURRENCY) {
      const batch = urls.slice(i, i + CONCURRENCY);
      const batchResults = await Promise.all(batch.map(processUrl));
      results.push(...batchResults);
    }

    res.json(results);
  } catch (err) {
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
   START
====================== */
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("Backend running on port", PORT);
});
