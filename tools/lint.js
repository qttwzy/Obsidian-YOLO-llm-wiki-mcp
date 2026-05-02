"use strict";

const fs = require("fs");
const path = require("path");
const { loadStore, saveStore } = require("../lib/page-store");
const { cosineSimilarity } = require("../lib/embed");
const { VAULT_ROOT } = require("../lib/config");
const SKIPPED_PATH = path.join(VAULT_ROOT, ".source-tracker", "skipped_connections.json");
const LAST_LINT_PATH = path.join(VAULT_ROOT, ".source-tracker", "last_lint.json");

function loadSkipped() {
  if (!fs.existsSync(SKIPPED_PATH)) return new Set();
  const data = JSON.parse(fs.readFileSync(SKIPPED_PATH, "utf-8"));
  return new Set(
    (data.skipped || []).map((s) => JSON.stringify([s.a, s.b].sort()))
  );
}

function hasExistingLink(entryA, entryB) {
  const checkFile = (filePath, slug) => {
    try {
      const content = fs.readFileSync(filePath, "utf-8");
      return content.includes(`[[${slug}]]`) || content.includes(`[[${slug}|`);
    } catch {
      return false;
    }
  };

  const pathA = path.join(VAULT_ROOT, entryA.path);
  const pathB = path.join(VAULT_ROOT, entryB.path);
  return checkFile(pathA, entryB.slug) || checkFile(pathB, entryA.slug);
}

/**
 * Find candidate page pairs with high cosine similarity but no existing links.
 */
function lintConnections({ top = 30, minScore = 0.5 } = {}) {
  const store = loadStore();
  if (!store) return { error: "Page store not found. Run build_store first." };

  const entries = store.entries;
  const skipped = loadSkipped();

  const pairs = [];
  const seen = new Set();

  for (let i = 0; i < entries.length; i++) {
    for (let j = i + 1; j < entries.length; j++) {
      const a = entries[i], b = entries[j];
      const key = JSON.stringify([a.slug, b.slug].sort());
      if (seen.has(key)) continue;
      seen.add(key);
      if (skipped.has(key)) continue;

      const score = Math.round(cosineSimilarity(a.vector, b.vector) * 10000) / 10000;
      if (score < minScore) continue;
      if (hasExistingLink(a, b)) continue;

      pairs.push({
        slug_a: a.slug, title_a: a.title, summary_a: a.summary,
        slug_b: b.slug, title_b: b.title, summary_b: b.summary,
        score,
      });
    }
  }

  pairs.sort((a, b) => b.score - a.score);
  return { candidates: pairs.slice(0, top), totalFiltered: pairs.length };
}

/**
 * Record a pair as skipped (false positive).
 */
function markSkipped(slugA, slugB) {
  const dir = path.dirname(SKIPPED_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  let data = { skipped: [] };
  if (fs.existsSync(SKIPPED_PATH)) {
    data = JSON.parse(fs.readFileSync(SKIPPED_PATH, "utf-8"));
  }

  data.skipped.push({
    a: slugA, b: slugB,
    skippedAt: new Date().toISOString(),
  });

  fs.writeFileSync(SKIPPED_PATH, JSON.stringify(data, null, 2), "utf-8");
  return { status: "skipped", a: slugA, b: slugB };
}

/**
 * Update the last lint timestamp.
 */
function updateLintTimestamp() {
  const dir = path.dirname(LAST_LINT_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(LAST_LINT_PATH, JSON.stringify({
    lastLint: new Date().toISOString(),
  }), "utf-8");
}

module.exports = { lintConnections, markSkipped, updateLintTimestamp };
