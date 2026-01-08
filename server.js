import express from "express";
import fetch from "node-fetch";
import cors from "cors";
import { JSDOM } from "jsdom";

const app = express();
app.use(cors());
app.use(express.json());

const TIMEOUT = 15000;

async function fetchWithTimeout(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT);

  try {
    return await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (compatible; BulkMetaExtractor/1.0)"
      }
    });
  } finally {
    clearTimeout(timeout);
  }
}

async function extractMeta(url) {
  const res = await fetchWithTimeout(url);
  if (!res.ok) throw new Error("Fetch failed");

  const html = await res.text();
  const dom = new JSDOM(html);
  const doc = dom.window.document;

  return {
    title: doc.querySelector("title")?.textContent.trim() || "",
    description:
      doc.querySelector('meta[name="description"]')?.content?.trim() || "",
    h1: [...doc.querySelectorAll("h1")]
      .map(h => h.textContent.trim())
      .filter(Boolean)
      .join("\n"),
    h2: [...doc.querySelectorAll("h2")]
      .map(h => h.textContent.trim())
      .filter(Boolean)
      .join("\n")
  };
}

app.post("/extract", async (req, res) => {
  const urls = req.body.urls || [];
  const results = [];

  for (const url of urls) {
    let data = null;

    // retry once
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        data = await extractMeta(url);
        break;
      } catch {}
    }

    if (data) {
      results.push({
        url,
        title: data.title,
        description: data.description,
        h1: data.h1,
        h2: data.h2,
        status: "Success"
      });
    } else {
      results.push({
        url,
        title: "",
        description: "",
        h1: "",
        h2: "",
        status: "Failed (retried)"
      });
    }
  }

  res.json(results);
});

app.get("/", (_, res) => {
  res.send("Bulk Meta Extractor backend running");
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("Backend running on port", PORT);
});
