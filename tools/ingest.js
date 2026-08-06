"use strict";

const fs = require("fs");
const path = require("path");
const { VAULT_ROOT, getWikiDir } = require("../lib/config");

/**
 * Create a wiki page.
 */
const TYPE_DIRS = { entity: "entities", concept: "concepts", synthesis: "synthesis" };

function createPage(root, type, slug, content) {
  const dir = path.join(getWikiDir(root), TYPE_DIRS[type] || `${type}s`);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const pagePath = path.join(dir, `${slug}.md`);
  if (fs.existsSync(pagePath)) {
    return { error: `Page already exists: ${type}s/${slug}.md` };
  }
  fs.writeFileSync(pagePath, content, "utf-8");
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

  // Replace the placeholder row (if present) or append before next section
  const placeholder = `| _(暂无)_ |`;
  if (content.includes(placeholder)) {
    // Find the placeholder in the correct section
    const sectionIdx = content.indexOf(sectionHeader);
    if (sectionIdx >= 0) {
      const sectionContent = content.substring(sectionIdx);
      const placeholderIdx = sectionContent.indexOf(placeholder);
      if (placeholderIdx >= 0) {
        content = content.substring(0, sectionIdx) + sectionContent.replace(placeholder, row);
      }
    }
  } else {
    // Append after section header
    const sectionIdx = content.indexOf(sectionHeader);
    if (sectionIdx >= 0) {
      const afterHeader = content.indexOf("\n", sectionIdx) + 1;
      content = content.slice(0, afterHeader) + "\n" + row + "\n" + content.slice(afterHeader);
    }
  }

  fs.writeFileSync(indexPath, content, "utf-8");
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
  const destDir = path.join(root, "raw", path.basename(inbox));
  if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });
  const destPath = path.join(destDir, path.basename(sourceFile));
  if (fs.existsSync(destPath)) {
    return { error: `Archive already exists: raw/${path.basename(inbox)}/${path.basename(sourceFile)}` };
  }
  try {
    fs.renameSync(srcPath, destPath);
  } catch (e) {
    if (e.code === "EXDEV") {
      // Cross-device link not permitted — copy then remove the original.
      fs.copyFileSync(srcPath, destPath);
      fs.unlinkSync(srcPath);
    } else {
      throw e;
    }
  }
  return { archived: path.relative(root, destPath).replace(/\\/g, "/") };
}

/**
 * Ingest a source file: create wiki page → update index → append log → archive.
 * Best-effort four-step operation. Steps are sequential with no rollback —
 * a failure in a later step leaves earlier side effects in place. Callers
 * should treat a non-error result as fully ingested and an error result as
 * partially ingested (check which files were created).
 * @returns {{ status, page, indexUpdated, logEntry, archived }}
 */
function ingestSource(args) {
  const { vault: vaultParam, sourceFile, inbox, type, title, content, summary, related, concepts } = args;
  const root = vaultParam || VAULT_ROOT;

  // Validate inputs
  if (!sourceFile) return { error: "sourceFile is required" };
  if (!inbox) return { error: "inbox is required" };
  if (!type || !["entity", "concept", "synthesis"].includes(type)) {
    return { error: "type must be entity, concept, or synthesis" };
  }
  if (!title) return { error: "title is required" };
  if (!content) return { error: "content is required" };
  if (!summary) return { error: "summary is required" };

  const srcPath = path.join(root, sourceFile);
  if (!fs.existsSync(srcPath)) {
    return { error: `Source file not found: ${sourceFile}` };
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

  const results = {};

  // Step 1: Create wiki page
  const pageResult = createPage(root, type, slug, pageContent);
  if (pageResult.error) return pageResult;
  results.page = pageResult.pagePath;

  // Step 2: Update index
  const indexResult = updateIndex(root, type, slug, title, summary, "stub");
  if (indexResult.error) return indexResult;
  results.indexUpdated = true;

  // Step 3: Append log
  const logResult = appendLog(root, `${title} | ${sourceFile}`);
  if (logResult.error) return logResult;
  results.logEntry = `ingest | ${title}`;

  // Step 4: Archive source
  const archiveResult = archiveSource(root, sourceFile, inbox);
  if (archiveResult.error) return archiveResult;
  results.archived = archiveResult.archived;

  results.status = "ingested";
  return results;
}

module.exports = { ingestSource };
