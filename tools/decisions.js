"use strict";

const fs = require("fs");
const path = require("path");
const { VAULT_ROOT } = require("../lib/config");
const { atomicWriteFileSync, literalReplace } = require("../lib/fs-utils");

// Mirrors DECISIONS_SKELETON in tools/init-wiki.js (kept in sync) so
// createDecision can restore a missing/empty/header-less decisions.md
// without requiring init_wiki to have run first.
const DECISIONS_SKELETON = `---
type: log
---

# 决策日志

## 待决 (pending)

_(当前无待决条目)_

## 已决 (resolved)

_(当前无已决条目)_
`;

function getDecisionsPath(vaultRoot) {
  return path.join(vaultRoot || VAULT_ROOT, "wiki", "decisions.md");
}

function readDecisionsFile(vaultRoot) {
  const decisionsPath = getDecisionsPath(vaultRoot);
  if (!fs.existsSync(decisionsPath)) {
    return { raw: "", pending: [], resolved: [] };
  }
  const raw = fs.readFileSync(decisionsPath, "utf-8");
  return { raw, ...parseDecisions(raw) };
}

function writeDecisionsFile(content, vaultRoot) {
  const decisionsPath = getDecisionsPath(vaultRoot);
  atomicWriteFileSync(decisionsPath, content);
}

/**
 * Parse decisions.md into structured pending/resolved arrays.
 * Throws if the file is non-empty but neither section header matches —
 * a corrupt header previously caused silent data loss (empty arrays
 * with no signal). The throw is caught by safeHandler in server.js.
 */
function parseDecisions(raw) {
  const pending = [];
  const resolved = [];

  const pendingMatch = raw.match(/## 待决 \(pending\)\n([\s\S]*?)(?=\n## |$)/);
  const resolvedMatch = raw.match(/## 已决 \(resolved\)\n([\s\S]*?)(?=\n## |$)/);

  if (pendingMatch) {
    const blocks = pendingMatch[1].split(/(?=### DEC-)/).filter((b) => b.trim());
    for (const block of blocks) {
      pending.push(parseBlock(block.trim()));
    }
  }

  if (resolvedMatch) {
    const blocks = resolvedMatch[1].split(/(?=### DEC-)/).filter((b) => b.trim());
    for (const block of blocks) {
      resolved.push(parseBlock(block.trim()));
    }
  }

  // Detect a corrupt-but-non-empty file: both sections failed to match.
  // A legitimately empty file has no DEC blocks but still has the headers,
  // so pendingMatch/resolvedMatch would be non-null there.
  if (raw.trim() && !pendingMatch && !resolvedMatch) {
    throw new Error(
      "decisions.md is non-empty but neither '## 待决 (pending)' nor '## 已决 (resolved)' header was found — file may be corrupt"
    );
  }

  return { pending, resolved };
}

/**
 * Parse a single DEC block into structured data.
 */
function parseBlock(block) {
  const headerMatch = block.match(/^### (DEC-\d+) \| (.+?)(\n|$)/);
  if (!headerMatch) return { raw: block };

  const id = headerMatch[1];
  const dateRaw = headerMatch[2].trim();

  const situationMatch = block.match(/\*\*情境\*\*:\s*(.+?)(?=\n-|\n\n|$)/s);
  const situation = situationMatch ? situationMatch[1].trim() : "";

  const options = [];
  const optionRegex = /- \[([ x])\] \*\*([A-Z])\.\s*(.+?)\*\*\s*[—–-]\s*(.+?)(?=\n-|\n\n|$)/gs;
  let m;
  while ((m = optionRegex.exec(block)) !== null) {
    options.push({
      checked: m[1] === "x",
      label: m[2],
      action: m[3].trim(),
      consequence: m[4].trim(),
    });
  }

  const customMatch = block.match(/- \[([ x])\] _{10,}.*自定义/);
  const hasCustom = !!customMatch;
  const customChecked = customMatch ? customMatch[1] === "x" : false;

  const customTextMatch = block.match(/- \[x\] _{10,}\s*(.+?)$/m);
  const customText = customTextMatch ? customTextMatch[1].trim() : "";

  const isCorrecting = dateRaw.includes("修正中");
  const isSuperseded = dateRaw.includes("已废止");
  const originalMatch = block.match(/\*\*原决定\*\*:\s*(.+?)(?=\n|$)/);
  const reasonMatch = block.match(/\*\*修正原因\*\*:\s*(.+?)(?=\n|$)/s);

  return {
    id,
    date: dateRaw.replace(/ \| 🔄 修正中/, "").replace(/ \| ⚠️ 已废止.*$/, ""),
    situation,
    options,
    hasCustom,
    customChecked,
    customText,
    raw: block,
    isCorrecting,
    isSuperseded,
    originalDecision: originalMatch ? originalMatch[1].trim() : undefined,
    correctionReason: reasonMatch ? reasonMatch[1].trim() : undefined,
  };
}

/**
 * Extract the numeric part of a DEC id (e.g. "DEC-007" -> 7).
 * @param {string} id
 * @returns {number}
 */
function decIdNum(id) {
  const m = String(id).match(/^DEC-(\d+)$/);
  return m ? parseInt(m[1], 10) : 0;
}

/**
 * Generate a unique decision ID by taking max(existing numeric ids) + 1.
 * Scans both pending and resolved to avoid collisions after resolve/delete.
 * @param {Array} pending
 * @param {Array} resolved
 * @returns {string}
 */
function nextDecisionId(pending, resolved) {
  let max = 0;
  for (const d of pending) {
    if (d.id) max = Math.max(max, decIdNum(d.id));
  }
  for (const d of resolved) {
    if (d.id) max = Math.max(max, decIdNum(d.id));
  }
  return `DEC-${String(max + 1).padStart(3, "0")}`;
}

/**
 * List all decisions, optionally filtered by status.
 * Superseded blocks (⚠️ 已废止) are excluded from resolvedCount to avoid
 * double-counting after a correction, but remain in the resolved array
 * for historical traceability.
 */
function listDecisions({ status, vaultRoot } = {}) {
  const { pending, resolved } = readDecisionsFile(vaultRoot);

  const result = {};
  if (!status || status === "pending") result.pending = pending;
  if (!status || status === "resolved") result.resolved = resolved;

  const pendingCount = pending.length;
  const resolvedCount = resolved.filter((d) => !d.isSuperseded).length;

  return { ...result, summary: { pendingCount, resolvedCount } };
}

/**
 * Create a new pending decision entry.
 */
function createDecision({ id, situation, options, vaultRoot }) {
  const { raw, pending, resolved } = readDecisionsFile(vaultRoot);

  const allIds = [...pending, ...resolved].map((d) => d.id).filter(Boolean);
  if (id && allIds.includes(id)) {
    return { error: `Decision ${id} already exists` };
  }

  // Auto-generate from max(existing id) + 1 across BOTH sections, not
  // pending.length + 1 — the latter collides after a resolve shrinks pending.
  const decId = id || nextDecisionId(pending, resolved);
  if (allIds.includes(decId)) {
    return { error: `Decision ${decId} already exists` };
  }
  const date = new Date().toISOString().slice(0, 10);

  const optionsBlock = options
    .map((o) => `- [ ] **${o.label}. ${o.action}** — ${o.consequence}`)
    .join("\n");

  const entry = `\n### ${decId} | ${date}\n**情境**: ${situation}\n\n${optionsBlock}\n- [ ] __________ _(自定义：写下你的决定)_\n`;

  const pendingHeader = "## 待决 (pending)";
  const resolvedHeader = "## 已决 (resolved)";
  const placeholder = "_(当前无待决条目)_";

  // When decisions.md is missing/empty or has lost its "## 待决 (pending)"
  // header, raw.indexOf(pendingHeader) is -1 and the entry used to be spliced
  // in at a bogus offset (-1 + header.length), producing a header-less file
  // that made every later parseDecisions throw ("file may be corrupt").
  // Restore the skeleton first so the entry always lands under a proper
  // pending header.
  let base = raw;
  if (!base.includes(pendingHeader)) {
    if (base.includes(resolvedHeader)) {
      // Pending section header lost — rebuild it before the resolved section.
      base = base.replace(
        resolvedHeader,
        `${pendingHeader}\n\n${placeholder}\n\n${resolvedHeader}`
      );
    } else {
      // Missing or empty decisions.md — start from the standard skeleton.
      base = DECISIONS_SKELETON;
    }
  }

  let newRaw;
  if (base.includes(placeholder)) {
    newRaw = literalReplace(base, placeholder, entry.trimStart());
  } else {
    const pendingIdx = base.indexOf(pendingHeader);
    const afterHeader = pendingIdx + pendingHeader.length;
    newRaw = base.slice(0, afterHeader) + entry + base.slice(afterHeader);
  }

  writeDecisionsFile(newRaw, vaultRoot);
  return { status: "created", id: decId };
}

/**
 * Remove a single DEC block from raw text by locating it via `### DEC-`
 * block boundaries rather than substring replace. This is robust against
 * CRLF line endings, regex-special characters, and substring collisions
 * (e.g. another decision's situation quoting this block's text).
 * @param {string} raw - Full decisions.md content
 * @param {string} blockRaw - The trimmed block to remove (must start with `### DEC-`)
 * @returns {string} raw with the first matching block removed
 */
function removeBlockByBoundary(raw, blockRaw) {
  // Normalize both to compare header + body without CRLF/LF differences.
  const norm = (s) => s.replace(/\r\n/g, "\n");
  const target = norm(blockRaw).trim();
  const normalized = norm(raw);

  // Split into blocks preserving the section headers.
  const parts = normalized.split(/(?=### DEC-)/);
  for (let i = 0; i < parts.length; i++) {
    if (norm(parts[i]).trim() === target) {
      parts.splice(i, 1);
      return parts.join("");
    }
  }
  // Fallback: substring replace (preserves old behavior if boundary match misses)
  return normalized.replace(target, "");
}

/**
 * Resolve a decision by checking an option and moving it to resolved.
 */
function resolveDecision({ id, option, customText, vaultRoot }) {
  const { raw, pending } = readDecisionsFile(vaultRoot);

  const dec = pending.find((d) => d.id === id);
  if (!dec) return { error: `Pending decision ${id} not found` };

  let newBlock = dec.raw;

  if (option) {
    // Single-letter validation doubles as RegExp escaping: a validated A-Z
    // character cannot inject metacharacters into the pattern below.
    if (!/^[A-Z]$/.test(option)) {
      return { error: `Invalid option '${option}': must be a single letter A-Z` };
    }
    const before = newBlock;
    newBlock = newBlock.replace(
      new RegExp(`- \\[ \\]\\s*\\*\\*${option}\\.`),
      `- [x] **${option}.`
    );
    // An unchanged block means the option letter does not exist in this entry.
    // Bail out before any file write so the entry stays in pending instead of
    // being moved to resolved with the user's choice silently dropped.
    if (newBlock === before) {
      return { error: `Option ${option} not found in decision ${id}` };
    }
  }

  if (customText) {
    const before = newBlock;
    newBlock = literalReplace(
      newBlock,
      /- \[ \] _{10,}.*自定义：写下你的决定\)_/,
      `- [x] __________ ${customText}`
    );
    if (newBlock === before) {
      return { error: `Custom decision line not found in decision ${id}` };
    }
  }

  const date = new Date().toISOString().slice(0, 10);
  const resolvedHeader = "## 已决 (resolved)";
  const resolvedEntry = `\n### ${id} | ✅ ${date}\n${newBlock.replace(/^### .+\n/, "")}`;

  // Remove the pending block by boundary, not substring replace.
  let newRaw = removeBlockByBoundary(raw, dec.raw);
  const hasResolvedHeader = newRaw.includes(resolvedHeader);
  if (hasResolvedHeader) {
    newRaw = literalReplace(newRaw, resolvedHeader, resolvedHeader + resolvedEntry);
  } else {
    newRaw += "\n" + resolvedHeader + resolvedEntry;
  }

  // Remove resolved placeholder if present
  const resolvedPlaceholder = "_(当前无已决条目)_";
  if (newRaw.includes(resolvedPlaceholder)) {
    newRaw = newRaw.replace(resolvedPlaceholder, "");
  }

  const pendingHeader = "## 待决 (pending)";
  const afterPending = newRaw.indexOf(pendingHeader) + pendingHeader.length;
  const nextSection = newRaw.indexOf("\n## ", afterPending);
  const pendingSection = newRaw.slice(afterPending, nextSection > 0 ? nextSection : undefined);
  if (!pendingSection.includes("### DEC-")) {
    newRaw = newRaw.slice(0, afterPending) + "\n\n_(当前无待决条目)_\n" + newRaw.slice(afterPending).trimStart();
  }

  writeDecisionsFile(newRaw, vaultRoot);
  return { status: "resolved", id, option: option || "custom", customText };
}

/**
 * Add a correction block to a resolved decision.
 * Before inserting the new "🔄 修正中" block, the old resolved block is
 * marked "⚠️ 已废止 (date)" instead of being deleted — this preserves the
 * audit trail and prevents the duplicate-block bug where two `### DEC-XXX`
 * headers coexist in the resolved section.
 */
function correctDecision({ id, originalDecision, correctionReason, options, vaultRoot }) {
  const { raw, resolved } = readDecisionsFile(vaultRoot);

  // Find the active (non-superseded) resolved block for this id.
  const dec = resolved.find((d) => d.id === id && !d.isSuperseded);
  if (!dec) return { error: `Resolved decision ${id} not found` };

  const optionsBlock = options
    .map((o) => `- [ ] **${o.label}. ${o.action}** — ${o.consequence}`)
    .join("\n");

  const correctionBlock = `\n### ${id} | 🔄 修正中\n**原决定**: ${originalDecision}\n**修正原因**: ${correctionReason}\n\n${optionsBlock}\n- [ ] __________ _(自定义)_\n`;

  // Mark the old resolved block as superseded (keep history, avoid duplicate id).
  const oldDate = dec.date || "";
  const supersededHeader = oldDate
    ? `### ${id} | ⚠️ 已废止 (${oldDate})`
    : `### ${id} | ⚠️ 已废止`;
  let markedRaw = raw;
  if (dec.raw) {
    // Replace the old block's header line only.
    const oldHeaderRe = new RegExp(`^### ${id} \\| [^\n]*`, "m");
    markedRaw = raw.replace(oldHeaderRe, supersededHeader);
  }

  const resolvedHeader = "## 已决 (resolved)";
  const placeholder = "_(当前无已决条目)_";
  let newRaw;

  if (markedRaw.includes(placeholder)) {
    newRaw = literalReplace(markedRaw, placeholder, correctionBlock.trimStart());
  } else if (markedRaw.includes(resolvedHeader)) {
    newRaw = literalReplace(markedRaw, resolvedHeader, resolvedHeader + correctionBlock);
  } else {
    return { error: "Could not find resolved section" };
  }

  writeDecisionsFile(newRaw, vaultRoot);
  return { status: "correcting", id };
}

/**
 * Finalize a correction: convert a "🔄 修正中" block back to resolved.
 * Checks the chosen option (or custom text) and changes the header to
 * "✅ date", closing the correction loop that correctDecision opened.
 */
function finalizeCorrection({ id, option, customText, vaultRoot }) {
  const { raw, resolved } = readDecisionsFile(vaultRoot);

  // Find the correcting block (isCorrecting) for this id.
  const dec = resolved.find((d) => d.id === id && d.isCorrecting);
  if (!dec) return { error: `Correcting decision ${id} not found` };

  let newBlock = dec.raw;

  if (option) {
    // Same validation/hit-check as resolveDecision: a missing option must
    // error out instead of finalizing with the user's choice dropped.
    if (!/^[A-Z]$/.test(option)) {
      return { error: `Invalid option '${option}': must be a single letter A-Z` };
    }
    const before = newBlock;
    newBlock = newBlock.replace(
      new RegExp(`- \\[ \\]\\s*\\*\\*${option}\\.`),
      `- [x] **${option}.`
    );
    if (newBlock === before) {
      return { error: `Option ${option} not found in decision ${id}` };
    }
  }

  if (customText) {
    const before = newBlock;
    newBlock = literalReplace(
      newBlock,
      /- \[ \] _{10,}.*自定义\)_/,
      `- [x] __________ ${customText}`
    );
    if (newBlock === before) {
      return { error: `Custom decision line not found in decision ${id}` };
    }
  }

  // Change header from "🔄 修正中" to "✅ date".
  const date = new Date().toISOString().slice(0, 10);
  const oldHeaderRe = new RegExp(`^### ${id} \\| 🔄 修正中`, "m");
  if (!oldHeaderRe.test(newBlock)) {
    return { error: `Decision ${id} is not in correcting state` };
  }
  newBlock = newBlock.replace(oldHeaderRe, `### ${id} | ✅ ${date}`);

  // Replace the correcting block in raw by boundary.
  const newRaw = literalReplace(
    removeBlockByBoundary(raw, dec.raw),
    "## 已决 (resolved)",
    "## 已决 (resolved)" + "\n" + newBlock
  );

  writeDecisionsFile(newRaw, vaultRoot);
  return { status: "finalized", id, option: option || "custom", customText };
}

module.exports = {
  listDecisions,
  createDecision,
  resolveDecision,
  correctDecision,
  finalizeCorrection,
};
