"use strict";

const fs = require("fs");
const path = require("path");
const { VAULT_ROOT } = require("../lib/config");

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
  fs.writeFileSync(decisionsPath, content, "utf-8");
}

/**
 * Parse decisions.md into structured pending/resolved arrays.
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
  const originalMatch = block.match(/\*\*原决定\*\*:\s*(.+?)(?=\n|$)/);
  const reasonMatch = block.match(/\*\*修正原因\*\*:\s*(.+?)(?=\n|$)/s);

  return {
    id,
    date: dateRaw.replace(/ \| 🔄 修正中/, ""),
    situation,
    options,
    hasCustom,
    customChecked,
    customText,
    raw: block,
    isCorrecting,
    originalDecision: originalMatch ? originalMatch[1].trim() : undefined,
    correctionReason: reasonMatch ? reasonMatch[1].trim() : undefined,
  };
}

/**
 * List all decisions, optionally filtered by status.
 */
function listDecisions({ status, vaultRoot } = {}) {
  const { pending, resolved } = readDecisionsFile(vaultRoot);

  const result = {};
  if (!status || status === "pending") result.pending = pending;
  if (!status || status === "resolved") result.resolved = resolved;

  const pendingCount = pending.length;
  const resolvedCount = resolved.length;

  return { ...result, summary: { pendingCount, resolvedCount } };
}

/**
 * Create a new pending decision entry.
 */
function createDecision({ id, situation, options, vaultRoot }) {
  const { raw, pending } = readDecisionsFile(vaultRoot);

  const existingIds = pending.map((d) => d.id).filter(Boolean);
  if (id && existingIds.includes(id)) {
    return { error: `Decision ${id} already exists` };
  }

  const decId = id || `DEC-${String(pending.length + 1).padStart(3, "0")}`;
  const date = new Date().toISOString().slice(0, 10);

  const optionsBlock = options
    .map((o) => `- [ ] **${o.label}. ${o.action}** — ${o.consequence}`)
    .join("\n");

  const entry = `\n### ${decId} | ${date}\n**情境**: ${situation}\n\n${optionsBlock}\n- [ ] __________ _(自定义：写下你的决定)_\n`;

  const pendingHeader = "## 待决 (pending)";
  const placeholder = "_(当前无待决条目)_";

  let newRaw;
  if (raw.includes(placeholder)) {
    newRaw = raw.replace(placeholder, entry.trimStart());
  } else {
    const pendingIdx = raw.indexOf(pendingHeader);
    const afterHeader = pendingIdx + pendingHeader.length;
    newRaw = raw.slice(0, afterHeader) + entry + raw.slice(afterHeader);
  }

  writeDecisionsFile(newRaw, vaultRoot);
  return { status: "created", id: decId };
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
    const optLetter = option.toUpperCase();
    newBlock = newBlock.replace(
      new RegExp(`- \\[ \\]\\s*\\*\\*${optLetter}\\.`),
      `- [x] **${optLetter}.`
    );
  }

  if (customText) {
    newBlock = newBlock.replace(
      /- \[ \] _{10,}.*自定义：写下你的决定\)_/,
      `- [x] __________ ${customText}`
    );
  }

  const date = new Date().toISOString().slice(0, 10);
  const resolvedHeader = "## 已决 (resolved)";
  const resolvedEntry = `\n### ${id} | ✅ ${date}\n${newBlock.replace(/^### .+\n/, "")}`;

  let newRaw = raw.replace(dec.raw, "");
  const hasResolvedHeader = newRaw.includes(resolvedHeader);
  if (hasResolvedHeader) {
    newRaw = newRaw.replace(resolvedHeader, resolvedHeader + resolvedEntry);
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
 */
function correctDecision({ id, originalDecision, correctionReason, options, vaultRoot }) {
  const { raw, resolved } = readDecisionsFile(vaultRoot);

  const dec = resolved.find((d) => d.id === id);
  if (!dec) return { error: `Resolved decision ${id} not found` };

  const optionsBlock = options
    .map((o) => `- [ ] **${o.label}. ${o.action}** — ${o.consequence}`)
    .join("\n");

  const correctionBlock = `\n### ${id} | 🔄 修正中\n**原决定**: ${originalDecision}\n**修正原因**: ${correctionReason}\n\n${optionsBlock}\n- [ ] __________ _(自定义)_\n`;

  const resolvedHeader = "## 已决 (resolved)";
  const placeholder = "_(当前无已决条目)_";
  let newRaw;

  if (raw.includes(placeholder)) {
    newRaw = raw.replace(placeholder, correctionBlock.trimStart());
  } else if (raw.includes(resolvedHeader)) {
    newRaw = raw.replace(resolvedHeader, resolvedHeader + correctionBlock);
  } else {
    return { error: "Could not find resolved section" };
  }

  writeDecisionsFile(newRaw, vaultRoot);
  return { status: "correcting", id };
}

module.exports = { listDecisions, createDecision, resolveDecision, correctDecision };
