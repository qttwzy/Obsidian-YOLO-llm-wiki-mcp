"use strict";

const path = require("path");

/**
 * Vault root directory. Resolution order:
 * 1. VAULT_ROOT environment variable (absolute path)
 * 2. Two levels up from this file (legacy: mcp/ inside vault)
 */
const VAULT_ROOT = process.env.VAULT_ROOT
  ? path.resolve(process.env.VAULT_ROOT)
  : path.resolve(__dirname, "..", "..");

module.exports = { VAULT_ROOT };
