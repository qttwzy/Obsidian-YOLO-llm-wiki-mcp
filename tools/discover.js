"use strict";

const fs = require("fs");
const path = require("path");
const { VAULT_ROOT, resolveVaultRoot } = require("../lib/config");
const { atomicWriteFileSync } = require("../lib/fs-utils");

function getConfigPath(vaultRoot) {
  return path.join(vaultRoot || VAULT_ROOT, ".source-tracker", "inbox-config.json");
}

function loadConfig(vaultRoot) {
  const p = getConfigPath(vaultRoot);
  if (!fs.existsSync(p)) return { inboxFolders: [] };
  return JSON.parse(fs.readFileSync(p, "utf-8"));
}

function saveConfig(config, vaultRoot) {
  const p = getConfigPath(vaultRoot);
  const dir = path.dirname(p);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  atomicWriteFileSync(p, JSON.stringify(config, null, 2));
}

/**
 * Manage inbox folder configuration.
 * @param {object} args
 * @returns {{ inboxFolders: string[] }}
 */
function handleSetInboxFolders(args) {
  const { vault: vaultParam, action, paths } = args;
  let root;
  try {
    root = resolveVaultRoot(vaultParam);
  } catch (e) {
    return { error: e.message };
  }
  const config = loadConfig(root);

  switch (action) {
    case "set": {
      if (!Array.isArray(paths) || !paths.length) {
        return { error: "set action requires a non-empty paths array" };
      }
      config.inboxFolders = paths.map((p) => p.replace(/\\/g, "/").replace(/\/$/, ""));
      saveConfig(config, root);
      return { inboxFolders: config.inboxFolders };
    }
    case "add": {
      if (!paths || !paths.length) {
        return { error: "add action requires at least one path" };
      }
      for (const p of paths) {
        const normalized = p.replace(/\\/g, "/").replace(/\/$/, "");
        if (!config.inboxFolders.includes(normalized)) {
          config.inboxFolders.push(normalized);
        }
      }
      saveConfig(config, root);
      return { inboxFolders: config.inboxFolders };
    }
    case "remove": {
      if (!paths || !paths.length) {
        return { error: "remove action requires at least one path" };
      }
      const toRemove = new Set(paths.map((p) => p.replace(/\\/g, "/").replace(/\/$/, "")));
      config.inboxFolders = config.inboxFolders.filter((f) => !toRemove.has(f));
      saveConfig(config, root);
      return { inboxFolders: config.inboxFolders };
    }
    case "list":
      return { inboxFolders: config.inboxFolders };
    default:
      return { error: `Unknown action: ${action}. Use set, add, remove, or list.` };
  }
}

/**
 * Scan inbox folders for unprocessed files.
 * A file is "new" if it does not exist under raw/{folderName}/{filename}.
 * @param {string} vaultRoot
 * @returns {{ newFiles: Array<{path, inbox, size, mtime}>, totalNew: number }}
 */
function discoverSources(vaultRoot) {
  let root;
  try {
    root = resolveVaultRoot(vaultRoot);
  } catch (e) {
    return { error: e.message, newFiles: [], totalNew: 0 };
  }
  const config = loadConfig(root);

  if (!config.inboxFolders.length) {
    return { error: "未配置收件箱目录。请先运行 set_inbox_folders。", newFiles: [], totalNew: 0 };
  }

  const newFiles = [];

  for (const inboxRel of config.inboxFolders) {
    const inboxPath = path.join(root, inboxRel);
    const rawInboxPath = path.join(root, "raw", path.basename(inboxRel));

    if (!fs.existsSync(inboxPath)) continue;

    for (const name of fs.readdirSync(inboxPath)) {
      const fp = path.join(inboxPath, name);
      try {
        const stat = fs.statSync(fp);
        if (!stat.isFile()) continue;

        // Check if already archived
        const archivedPath = path.join(rawInboxPath, name);
        if (fs.existsSync(archivedPath)) continue;

        newFiles.push({
          path: path.relative(root, fp).replace(/\\/g, "/"),
          inbox: inboxRel,
          name,
          size: stat.size,
          mtime: stat.mtime.toISOString(),
        });
      } catch {
        // skip inaccessible files
      }
    }
  }

  return { newFiles, totalNew: newFiles.length };
}

module.exports = { handleSetInboxFolders, discoverSources };
