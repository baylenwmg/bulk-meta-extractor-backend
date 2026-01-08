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
  if (!res.ok) throw new Error("Fetch failed");

  const html = await res.text();
  const dom = new JSDOM(html);
  const doc = dom.window.document;

  return {
    title: doc.querySelector("title")?.textContent.trim() || "",
    description:
      doc.querySelector('meta[name="description"]')?.getAttribute("content")?.trim() || "",
    h1: [...doc.querySelectorAll("h1")].map(e => e.textContent.trim()).join("\n"),
    h2: [...doc.querySelectorAll("h2")].map(e => e.textContent.trim()).join("\n")
  };
}

/* ======================
   PROCESS URL
====================== */
async function processUrl(url) {
  for (let i = 0; i < RETRY_COUNT; i++) {
    try {
      const data = await extractMeta(url);
      return { url, ...data, status: "Success" };
    } catch {}
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

    res.setHeader("Access-Control-Allow-Origin", "*");
    res.json(results);

  } catch (err) {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.status(500).json({ error: "Extraction failed" });
  }
});

/* ======================
   HEALTH CHECK
====================== */
app.get("/", (_, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.send("Bulk Meta Extractor backend running");
});

/* ======================
   START
====================== */
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("Backend running on port", PORT);
});
