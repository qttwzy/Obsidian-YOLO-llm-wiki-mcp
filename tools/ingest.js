"use strict";

const fs = require("fs");
const path = require("path");
const { getWikiDir, resolveVaultRoot, assertInsideVault } = require("../lib/config");
const { atomicWriteFileSync } = require("../lib/fs-utils");

/**
 * Create a wiki page.
 */
const TYPE_DIRS = { entity: "entities", concept: "concepts", synthesis: "synthesis" };

function isInside(parent, child, allowSame = false) {
  const relative = path.relative(parent, child);
  return (allowSame || relative !== "") &&
    relative !== ".." &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative);
}

function createPage(root, type, slug, content) {
  const dir = path.join(getWikiDir(root), TYPE_DIRS[type] || `${type}s`);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const pagePath = path.join(dir, `${slug}.md`);
  if (fs.existsSync(pagePath)) {
    return { error: `Page already exists: ${type}s/${slug}.md` };
  }
  atomicWriteFileSync(pagePath, content);
  return { pagePath: path.relative(root, pagePath).replace(/\\/g, "/") };
}

/**
 * Append a row to the index table for a given type section.
 */
function updateIndex(root, type, slug, title, summary, status) {
  const indexPath = path.join(root, "index.md");
  if (!fs.existsSync(indexPath)) {
    return { error: "index.md not found. Run init_wiki first." };
  }

  let content = fs.readFileSync(indexPath, "utf-8");
  const sectionLabels = {
    entity: "实体",
    concept: "概念",
    synthesis: "综合",
  };
  const sectionLabel = sectionLabels[type] || type;
  const sectionHeader = `## ${sectionLabel} (${TYPE_DIRS[type] || `${type}s`}/)`;

  const row = `| [[${TYPE_DIRS[type] || `${type}s`}/${slug}]] | ${summary} | ${status || "stub"} |`;
  const sectionIdx = content.indexOf(sectionHeader);
  if (sectionIdx < 0) {
    return { error: `Index section not found: ${sectionHeader}` };
  }

  // Replace the placeholder row (if present) or append after the last table row
  const placeholder = `| _(暂无)_ |`;
  const nextSectionIdx = content.indexOf("\n## ", sectionIdx + sectionHeader.length);
  const sectionEnd = nextSectionIdx >= 0 ? nextSectionIdx : content.length;
  const sectionContent = content.slice(sectionIdx, sectionEnd);
  const placeholderIdx = sectionContent.indexOf(placeholder);
  if (placeholderIdx >= 0) {
    content = content.slice(0, sectionIdx) +
      sectionContent.replace(placeholder, row) +
      content.slice(sectionEnd);
  } else {
    // Append after the LAST table row in this section (bottom-up search from
    // sectionEnd for the previous line starting with "|"). The old behavior
    // inserted right after the section header, so once the placeholder row
    // had been consumed the new row landed ABOVE the table header/separator.
    const lastRowStart = content.lastIndexOf("\n|", sectionEnd - 1);
    if (lastRowStart >= sectionIdx) {
      const lineEnd = content.indexOf("\n", lastRowStart + 1);
      const insertAt = lineEnd >= 0 && lineEnd <= sectionEnd ? lineEnd : sectionEnd;
      content = content.slice(0, insertAt) + "\n" + row + content.slice(insertAt);
    } else {
      // Degenerate section with no table rows at all — append after the header.
      const afterHeader = content.indexOf("\n", sectionIdx) + 1;
      content = content.slice(0, afterHeader) + "\n" + row + "\n" + content.slice(afterHeader);
    }
  }

  // Keep the "— N 页" page count in the section header in sync. Both insertion
  // points above are strictly after the header line, so sectionIdx stays valid.
  const headerLineEnd = content.indexOf("\n", sectionIdx);
  const headerLine = content.slice(
    sectionIdx,
    headerLineEnd >= 0 ? headerLineEnd : content.length
  );
  const countedHeader = headerLine.replace(
    /^(.*? — )(\d+)( 页)$/,
    (m, p1, p2) => `${p1}${Number(p2) + 1} 页`
  );
  if (countedHeader !== headerLine) {
    content = content.slice(0, sectionIdx) + countedHeader + content.slice(sectionIdx + headerLine.length);
  }

  atomicWriteFileSync(indexPath, content);
  return {};
}

/**
 * Append an entry to the operation log.
 */
function appendLog(root, entry) {
  const logPath = path.join(root, "wiki", "log.md");
  if (!fs.existsSync(logPath)) {
    return { error: "wiki/log.md not found. Run init_wiki first." };
  }

  const today = new Date().toISOString().slice(0, 10);
  const line = `\n## [${today}] ingest | ${entry}\n`;
  fs.appendFileSync(logPath, line, "utf-8");
  return {};
}

/**
 * Move source file to raw/ archive.
 * Uses rename for same-device moves; falls back to copy+unlink on EXDEV
 * (cross-device, common with Docker volumes or symlinked raw/ dirs).
 */
function archiveSource(root, sourceFile, inbox) {
  const srcPath = path.join(root, sourceFile);
  const rawRoot = path.join(root, "raw");
  const destDir = path.join(root, "raw", path.basename(inbox));
  const destPath = path.join(destDir, path.basename(sourceFile));

  const realRoot = fs.realpathSync(root);
  if (fs.existsSync(rawRoot) && !isInside(realRoot, fs.realpathSync(rawRoot))) {
    return { error: "Archive root resolves outside vault root" };
  }
  if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });
  if (!isInside(realRoot, fs.realpathSync(destDir))) {
    return { error: "Archive destination resolves outside vault root" };
  }
  try {
    fs.lstatSync(destPath);
    return { error: `Archive already exists: raw/${path.basename(inbox)}/${path.basename(sourceFile)}` };
  } catch (e) {
    if (e.code !== "ENOENT") throw e;
  }

  try {
    fs.renameSync(srcPath, destPath);
  } catch (e) {
    if (e.code === "EXDEV") {
      // Cross-device link not permitted — copy then remove the original.
      let copied = false;
      try {
        fs.copyFileSync(srcPath, destPath);
        copied = true;
        fs.unlinkSync(srcPath);
      } catch (copyError) {
        if (copied) {
          try {
            fs.unlinkSync(destPath);
          } catch (cleanupError) {
            copyError.message += `; cannot remove partial archive: ${cleanupError.message}`;
          }
        }
        throw copyError;
      }
    } else {
      throw e;
    }
  }
  return { archived: path.relative(root, destPath).replace(/\\/g, "/") };
}

/**
 * Revert completed ingest steps after a later step fails.
 * @param {{ pagePath?: string, indexPath: string, indexBefore: string, indexUpdated: boolean, logPath: string, logBefore: string, logUpdated: boolean }} state
 * @returns {string[]} Rollback errors, if any.
 */
function rollbackIngest(state) {
  const rollbackErrors = [];

  if (state.logUpdated) {
    try { atomicWriteFileSync(state.logPath, state.logBefore); } catch (e) {
      rollbackErrors.push(`log: ${e.message}`);
    }
  }

  if (state.indexUpdated) {
    try { atomicWriteFileSync(state.indexPath, state.indexBefore); } catch (e) {
      rollbackErrors.push(`index: ${e.message}`);
    }
  }

  if (state.pagePath) {
    try { fs.unlinkSync(state.pagePath); } catch (e) {
      if (e.code !== "ENOENT") rollbackErrors.push(`page: ${e.message}`);
    }
  }

  return rollbackErrors;
}

/**
 * Ingest a source file: create wiki page → update index → append log → archive.
 * If a later step fails, restore the page, index, and log to their prior state.
 * @returns {{ status, page, indexUpdated, logEntry, archived }}
 */
function ingestSource(args) {
  const {
    vault: vaultParam,
    sourceFile: sourceFileParam,
    inbox,
    type,
    title,
    content,
    summary,
    related,
    concepts,
  } = args;
  let root;
  try {
    root = resolveVaultRoot(vaultParam);
  } catch (e) {
    return { error: e.message };
  }

  // Validate inputs
  if (!sourceFileParam) return { error: "sourceFile is required" };
  if (!inbox) return { error: "inbox is required" };
  if (!type || !["entity", "concept", "synthesis"].includes(type)) {
    return { error: "type must be entity, concept, or synthesis" };
  }
  if (!title) return { error: "title is required" };
  if (!content) return { error: "content is required" };
  if (!summary) return { error: "summary is required" };

  // Obsidian paths use forward slashes even when the producer runs on Windows.
  // Normalize them before checking containment so synced vaults behave the same
  // on Windows, macOS, and Linux.
  const sourceFile = sourceFileParam.replace(/\\/g, "/");
  const normalizedInbox = inbox.replace(/\\/g, "/").replace(/\/+$/, "");
  let srcPath;
  let inboxPath;
  try {
    srcPath = assertInsideVault(sourceFile, root);
    inboxPath = assertInsideVault(normalizedInbox, root);
  } catch (e) {
    return { error: e.message };
  }
  if (!fs.existsSync(srcPath)) {
    return { error: `Source file not found: ${sourceFileParam}` };
  }
  if (!isInside(inboxPath, srcPath)) {
    return { error: `Source file ${sourceFileParam} is outside declared inbox ${inbox}` };
  }
  if (!fs.lstatSync(srcPath).isFile()) {
    return { error: `Source path is not a regular file: ${sourceFileParam}` };
  }
  try {
    const realRoot = fs.realpathSync(root);
    const realInbox = fs.realpathSync(inboxPath);
    const realSource = fs.realpathSync(srcPath);
    if (!isInside(realRoot, realInbox, true)) {
      return { error: `Inbox ${inbox} resolves outside vault root` };
    }
    if (!isInside(realInbox, realSource)) {
      return { error: `Source file ${sourceFileParam} resolves outside declared inbox ${inbox}` };
    }
    if (!isInside(realRoot, realSource)) {
      return { error: `Source file ${sourceFileParam} resolves outside vault root` };
    }
  } catch (e) {
    return { error: `Cannot validate source file ${sourceFileParam}: ${e.message}` };
  }

  // Strip chars illegal in filenames on any platform (Windows is most restrictive).
  // Conservative approach keeps slugs consistent across synced vaults.
  let slug = title.replace(/[\\/:*?"<>|\0]/g, "-");
  // Guard against pure-whitespace / all-separator titles that would produce
  // an empty or meaningless slug (e.g. "   " or " /? "). Fall back to a
  // timestamped name so the page is always addressable.
  if (!slug.replace(/[-\s]/g, "")) {
    slug = `untitled-${Date.now()}`;
  }

  // Build full page content with frontmatter if not already present
  let pageContent;
  if (content.startsWith("---")) {
    pageContent = content;
  } else {
    const frontmatter = type === "entity"
      ? `type: entity\nstatus: stub\nsources:\n  - "[[${sourceFile}]]"\n${related ? `related:\n${related.map((r) => `  - "[[${r}]]"`).join("\n")}\n` : ""}${concepts ? `concepts:\n${concepts.map((c) => `  - "[[${c}]]"`).join("\n")}` : ""}`
      : type === "concept"
      ? `type: concept\nstatus: stub\nsources:\n  - "[[${sourceFile}]]"\n${related ? `related_entities:\n${related.map((r) => `  - "[[${r}]]"`).join("\n")}` : ""}`
      : `type: synthesis\nstatus: draft\nsources:\n  - "[[${sourceFile}]]"`;

    pageContent = `---\n${frontmatter}\n---\n\n${content}`;
  }

  const indexPath = path.join(root, "index.md");
  const logPath = path.join(root, "wiki", "log.md");
  let indexBefore;
  let logBefore;
  try {
    indexBefore = fs.readFileSync(indexPath, "utf-8");
    logBefore = fs.readFileSync(logPath, "utf-8");
  } catch (e) {
    return { error: `Cannot prepare ingest transaction: ${e.message}` };
  }

  const state = {
    indexPath,
    indexBefore,
    indexUpdated: false,
    logPath,
    logBefore,
    logUpdated: false,
    pagePath: null,
  };

  try {
    // Step 1: Create wiki page
    const pageResult = createPage(root, type, slug, pageContent);
    if (pageResult.error) return pageResult;
    state.pagePath = path.join(root, pageResult.pagePath);

    // Step 2: Update index
    const indexResult = updateIndex(root, type, slug, title, summary, "stub");
    if (indexResult.error) throw new Error(indexResult.error);
    state.indexUpdated = true;

    // Step 3: Append log
    // Mark before writing so a partially failed append is restored too.
    state.logUpdated = true;
    const logResult = appendLog(root, `${title} | ${sourceFile}`);
    if (logResult.error) throw new Error(logResult.error);

    // Step 4: Archive source
    const archiveResult = archiveSource(root, sourceFile, normalizedInbox);
    if (archiveResult.error) throw new Error(archiveResult.error);

    return {
      status: "ingested",
      page: pageResult.pagePath,
      indexUpdated: true,
      logEntry: `ingest | ${title}`,
      archived: archiveResult.archived,
    };
  } catch (e) {
    const rollbackErrors = rollbackIngest(state);
    const error = `Ingest failed: ${e.message}`;
    return rollbackErrors.length ? { error, rollbackErrors } : { error };
  }
}

module.exports = { ingestSource };
