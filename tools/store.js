"use strict";

const path = require("path");
const { buildStore, updateEntry } = require("../lib/page-store");
const { resolveVaultRoot, assertInsideVault } = require("../lib/config");

/**
 * Full rebuild of page embedding store.
 * @param {string} [vaultRoot]
 */
async function handleBuildStore(vaultRoot) {
  try {
    const result = await buildStore(vaultRoot);
    return result;
  } catch (e) {
    return { error: e.message };
  }
}

/**
 * Update a single page in the store.
 * @param {object} args
 * @param {string} args.filePath - Relative path (e.g., 'wiki/entities/Foo.md')
 * @param {string} [args.vault] - Vault name or path
 */
async function handleUpdateStore({ filePath, vault }) {
  try {
    const vaultRoot = resolveVaultRoot(vault);
    const fullPath = assertInsideVault(filePath, vaultRoot);
    const result = await updateEntry(fullPath, vaultRoot);
    return result;
  } catch (e) {
    return { error: e.message };
  }
}

module.exports = { handleBuildStore, handleUpdateStore };
