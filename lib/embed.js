"use strict";

const https = require("https");
const http = require("http");

const EMBED_API_URL = process.env.EMBED_API_URL || "";
const EMBED_API_KEY = process.env.EMBED_API_KEY || "";
const EMBED_MODEL = process.env.EMBED_MODEL || "Qwen/Qwen3-Embedding-8B";

/**
 * Validate configuration and return error message if missing.
 * @returns {string|null} Error message or null if config is valid.
 */
function validateConfig() {
  if (!EMBED_API_URL) {
    return "EMBED_API_URL is not configured. Add it to .claude/mcp.json → env → EMBED_API_URL";
  }
  if (!EMBED_API_KEY) {
    return "EMBED_API_KEY is not configured. Add it to .claude/mcp.json → env → EMBED_API_KEY";
  }
  return null;
}

/**
 * Embed one or more texts using the configured embedding API (OpenAI-compatible).
 * @param {string[]} texts
 * @returns {Promise<number[][]>}
 */
function embedTexts(texts) {
  const configError = validateConfig();
  if (configError) {
    return Promise.reject(new Error(configError));
  }

  const baseUrl = EMBED_API_URL.replace(/\/$/, "");
  const apiUrl = new URL(baseUrl + "/embeddings");
  const body = JSON.stringify({
    model: EMBED_MODEL,
    input: texts,
    encoding_format: "float",
  });

  const options = {
    hostname: apiUrl.hostname,
    port: apiUrl.port || (apiUrl.protocol === "https:" ? 443 : 80),
    path: apiUrl.pathname,
    method: "POST",
    headers: {
      Authorization: `Bearer ${EMBED_API_KEY}`,
      "Content-Type": "application/json",
      "Content-Length": Buffer.byteLength(body),
    },
  };

  const transport = apiUrl.protocol === "https:" ? https : http;

  return new Promise((resolve, reject) => {
    const req = transport.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        try {
          if (res.statusCode >= 400) {
            reject(new Error(`Embedding API error ${res.statusCode}: ${data.substring(0, 200)}`));
            return;
          }
          const result = JSON.parse(data);
          const items = (result.data || []).sort((a, b) => a.index - b.index);
          resolve(items.map((item) => item.embedding));
        } catch {
          reject(new Error("Embedding API parse error: " + data.substring(0, 200)));
        }
      });
    });
    req.on("error", (err) => reject(new Error("Embedding API network error: " + err.message)));
    req.write(body);
    req.end();
  });
}

/**
 * Cosine similarity between two equal-length vectors.
 */
function cosineSimilarity(a, b) {
  let dot = 0, magA = 0, magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  if (magA === 0 || magB === 0) return 0;
  return dot / (Math.sqrt(magA) * Math.sqrt(magB));
}

module.exports = { embedTexts, cosineSimilarity, validateConfig };
