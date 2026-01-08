import express from "express";
import fetch from "node-fetch";
import cors from "cors";
import { JSDOM } from "jsdom";

const app = express();
app.use(cors());
app.use(express.json());

/* ======================
   PERFORMANCE SETTINGS
====================== */
const TIMEOUT_MS = 10000;        // faster fail
const CONCURRENCY = 4;           // safe parallelism
const RETRY_COUNT = 2;           // keep retry logic
const USER_AGENT =
  "Mozilla/5.0 (compatible; BulkMetaExtractor/1.0; +https://github.com)";

/* ======================
   SAFE FETCH WITH TIMEOUT
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
  const response = await fetchWithTimeout(url);
  if (!response.ok) throw new Error("Fetch failed");

  const html = await response.text();
  const dom = new JSDOM(html);
  const doc = dom.window.document;

  return {
    title: doc.querySelector("title")?.textContent.trim() || "",
    description:
      doc.querySelector('meta[name="description"]')?.getAttribute("content")?.trim() || "",
    h1: [...doc.querySelectorAll("h1")]
      .map(el => el.textContent.trim())
      .filter(Boolean)
      .join("\n"),
    h2: [...doc.querySelectorAll("h2")]
      .map(el => el.textContent.trim())
      .filter(Boolean)
      .join("\n")
  };
}

/* ======================
   PROCESS SINGLE URL
====================== */
async function processUrl(url) {
  for (let attempt = 1; attempt <= RETRY_COUNT; attempt++) {
    try {
      const data = await extractMeta(url);
      return {
        url,
        ...data,
        status: "Success"
      };
    } catch (err) {
      if (attempt === RETRY_COUNT) {
        return {
          url,
          title: "",
          description: "",
          h1: "",
          h2: "",
          status: "Failed (retried)"
        };
      }
    }
  }
}

/* ======================
   PARALLEL BATCH PROCESSOR
====================== */
async function processInBatches(urls) {
  const results = [];

  for (let i = 0; i < urls.length; i += CONCURRENCY) {
    const batch = urls.slice(i, i + CONCURRENCY);
    const batchResults = await Promise.all(
      batch.map(url => processUrl(url))
    );
    results.push(...batchResults);
  }

  return results;
}

/* ======================
   API ENDPOINT
====================== */
app.post("/extract", async (req, res) => {
  try {
    const urls = Array.isArray(req.body.urls) ? req.body.urls : [];

    if (!urls.length) {
      return res.status(400).json({ error: "No URLs provided" });
    }

    const results = await processInBatches(urls);
    res.json(results);

  } catch (error) {
    res.status(500).json({
      error: "Extraction failed",
      message: error.message
    });
  }
});

/* ======================
   HEALTH CHECK
====================== */
app.get("/", (_, res) => {
  res.send("Bulk Meta Extractor backend running");
});

/* ======================
   START SERVER
====================== */
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Backend running on port ${PORT}`);
});
