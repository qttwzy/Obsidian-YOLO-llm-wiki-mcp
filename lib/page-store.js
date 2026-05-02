"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { embedTexts, cosineSimilarity } = require("./embed");
const { VAULT_ROOT } = require("./config");

const STORE_PATH = path.join(VAULT_ROOT, ".source-tracker", "page_embeddings.json");
const WIKI_DIR = path.join(VAULT_ROOT, "wiki");

/**
 * @returns {object|null} The store or null if not built.
 */
function loadStore() {
  if (!fs.existsSync(STORE_PATH)) return null;
  return JSON.parse(fs.readFileSync(STORE_PATH, "utf-8"));
}

function saveStore(store) {
  const dir = path.dirname(STORE_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(STORE_PATH, JSON.stringify(store, null, 2), "utf-8");
}

/**
 * Read a .md file, strip frontmatter, return { title, summary, body }.
 */
function readPage(filepath) {
  const content = fs.readFileSync(filepath, "utf-8");
  let title = path.basename(filepath).replace(".md", "");
  let summary = "";
  let body = content;
  if (content.startsWith("---")) {
    const parts = content.split("---", 2);
    if (parts.length >= 3) {
      body = parts[2].trim();
      for (const line of parts[1].split("\n")) {
        const m = line.match(/^title:\s*(.+)/);
        if (m) title = m[1].trim().replace(/^["']|["']$/g, "");
      }
    }
  }
  for (const line of body.split("\n")) {
    const s = line.trim();
    if (s && !s.startsWith("#")) {
      summary = s.substring(0, 120);
      break;
    }
  }
  return { title, summary, body };
}

/**
 * Search page store with pre-computed query vector.
 * @returns {{ score: number, path: string, slug: string, title: string, summary: string }[]}
 */
function searchStore(queryVec, topK = 10) {
  const store = loadStore();
  if (!store) return [];

  const scored = store.entries.map((e) => ({
    score: Math.round(cosineSimilarity(queryVec, e.vector) * 10000) / 10000,
    path: e.path,
    slug: e.slug,
    title: e.title,
    summary: e.summary,
  }));

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, topK);
}

/**
 * Full rebuild of page_embeddings.json.
 */
async function buildStore() {
  const pages = [];
  function walk(dir) {
    for (const name of fs.readdirSync(dir)) {
      const fp = path.join(dir, name);
      const stat = fs.statSync(fp);
      if (stat.isDirectory()) {
        if (name !== "templates") walk(fp);
      } else if (name.endsWith(".md")) {
        const rel = path.relative(VAULT_ROOT, fp).replace(/\\/g, "/");
        if (rel === "wiki/log.md") continue;
        const { title, summary, body } = readPage(fp);
        const hash = crypto.createHash("sha256").update(body).digest("hex");
        const slug = path.relative(WIKI_DIR, fp).replace(/\\/g, "/").replace(/\.md$/, "");
        pages.push({ slug, path: rel, title, summary, contentHash: hash, body });
      }
    }
  }
  walk(WIKI_DIR);

  const bodies = pages.map((p) => p.body);
  const vectors = await embedTexts(bodies);

  const now = new Date().toISOString();
  const entries = pages.map((p, i) => ({
    slug: p.slug,
    path: p.path,
    title: p.title,
    summary: p.summary,
    content_hash: p.contentHash,
    vector: vectors[i],
    updatedAt: now,
  }));

  const store = {
    version: 1,
    model: "Qwen/Qwen3-Embedding-8B",
    dimensions: vectors[0] ? vectors[0].length : 0,
    updated: now,
    entries,
  };

  saveStore(store);
  return { pages: entries.length, size: (JSON.stringify(store).length / 1024).toFixed(0) + "KB" };
}

/**
 * Add or update a single page in the store.
 */
async function updateEntry(filepath) {
  if (!fs.existsSync(STORE_PATH)) return { error: "Store not found. Run build first." };

  const store = loadStore();
  const { title, summary, body } = readPage(filepath);
  const vectors = await embedTexts([body]);
  const hash = crypto.createHash("sha256").update(body).digest("hex");
  const rel = path.relative(VAULT_ROOT, filepath).replace(/\\/g, "/");
  const slug = path.relative(WIKI_DIR, filepath).replace(/\\/g, "/").replace(/\.md$/, "");

  const entry = {
    slug,
    path: rel,
    title,
    summary,
    content_hash: hash,
    vector: vectors[0],
    updatedAt: new Date().toISOString(),
  };

  const idx = store.entries.findIndex((e) => e.slug === slug || e.path === rel);
  const status = idx >= 0 ? "updated" : "added";
  if (idx >= 0) store.entries[idx] = entry;
  else store.entries.push(entry);

  store.updated = new Date().toISOString();
  saveStore(store);

  return { slug, status };
}

module.exports = { loadStore, saveStore, searchStore, buildStore, updateEntry };
