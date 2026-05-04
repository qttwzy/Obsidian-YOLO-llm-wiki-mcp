"use strict";

const fs = require("fs");
const path = require("path");

/**
 * Find the nearest vault root by walking up from a directory.
 * A vault is a directory containing .obsidian/.
 * @param {string} startDir - Directory to start searching from
 * @returns {string|null} Vault root path, or null if not found
 */
function findNearestVault(startDir) {
  let dir = path.resolve(startDir);
  while (true) {
    if (fs.existsSync(path.join(dir, ".obsidian"))) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break; // reached filesystem root
    dir = parent;
  }
  return null;
}

/**
 * Vault root directory. Resolution order:
 * 1. VAULT_ROOT environment variable (absolute path)
 * 2. Current working directory (or nearest parent with .obsidian/)
 * 3. Two levels up from this file (legacy: mcp/ inside vault)
 */
const VAULT_ROOT = process.env.VAULT_ROOT
  ? path.resolve(process.env.VAULT_ROOT)
  : findNearestVault(process.cwd()) || path.resolve(__dirname, "..", "..");

/**
 * Parent directory containing all vaults (dirname of VAULT_ROOT).
 */
const PARENT_DIR = path.dirname(VAULT_ROOT);

/**
 * Scan parentDir for subdirectories containing .obsidian/.
 * Returns Map<name, absPath>.
 * @param {string} [parentDir] - Directory to scan (defaults to PARENT_DIR)
 * @returns {Map<string, string>}
 */
function discoverVaults(parentDir) {
  const dir = parentDir || PARENT_DIR;
  const vaults = new Map();

  try {
    for (const name of fs.readdirSync(dir)) {
      const absPath = path.join(dir, name);
      try {
        const stat = fs.statSync(absPath);
        if (stat.isDirectory() && fs.existsSync(path.join(absPath, ".obsidian"))) {
          vaults.set(name, absPath);
        }
      } catch {
        // skip inaccessible entries
      }
    }
  } catch {
    // parent dir not readable
  }

  return vaults;
}

// Cache vault map at startup
let _vaultMap = null;

function getVaultMap() {
  if (!_vaultMap) {
    _vaultMap = discoverVaults();
  }
  return _vaultMap;
}

/**
 * Resolve a vault parameter to an absolute path.
 * - undefined/empty → VAULT_ROOT (default)
 * - absolute path (starts with / or drive letter) → use directly
 * - name → look up in discovered vaults
 * @param {string} [vault]
 * @returns {string} Absolute vault root path
 */
function resolveVaultRoot(vault) {
  if (!vault) return VAULT_ROOT;

  // Absolute path: use directly
  if (path.isAbsolute(vault)) return vault;

  // Name: look up in discovered vaults
  const map = getVaultMap();
  if (map.has(vault)) return map.get(vault);

  // Fallback: try as subdirectory of parent
  const candidate = path.join(PARENT_DIR, vault);
  if (fs.existsSync(path.join(candidate, ".obsidian"))) return candidate;

  // Last resort: return VAULT_ROOT
  return VAULT_ROOT;
}

/**
 * Get vault name from a vault root path.
 * @param {string} vaultRoot
 * @returns {string} Vault name (basename)
 */
function getVaultName(vaultRoot) {
  return path.basename(vaultRoot);
}

/**
 * Get wiki directory path for a vault.
 * @param {string} [vaultRoot]
 * @returns {string}
 */
function getWikiDir(vaultRoot) {
  return path.join(vaultRoot || VAULT_ROOT, "wiki");
}

/**
 * Assert that a relative filePath stays inside vaultRoot.
 * Returns the resolved absolute path.
 * @param {string} filePath - Relative path (e.g. 'wiki/entities/Foo.md')
 * @param {string} vaultRoot - Vault root directory
 * @returns {string} Resolved absolute path
 * @throws {Error} If path is outside vault root
 */
function assertInsideVault(filePath, vaultRoot) {
  const absPath = path.resolve(vaultRoot, filePath);
  const normalizedRoot = path.resolve(vaultRoot) + path.sep;
  if (!absPath.startsWith(normalizedRoot) && absPath !== path.resolve(vaultRoot)) {
    throw new Error(`Path ${filePath} is outside vault root`);
  }
  return absPath;
}

/**
 * Resolve vault and return both root path and name.
 * @param {string} [vault]
 * @returns {{ vaultRoot: string, vaultName: string }}
 */
function resolveVaultInfo(vault) {
  const vaultRoot = resolveVaultRoot(vault);
  return { vaultRoot, vaultName: getVaultName(vaultRoot) };
}

module.exports = { VAULT_ROOT, PARENT_DIR, discoverVaults, resolveVaultRoot, resolveVaultInfo, getVaultMap, getVaultName, findNearestVault, getWikiDir, assertInsideVault };
