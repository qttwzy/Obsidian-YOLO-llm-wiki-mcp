"use strict";

const path = require("path");
const { buildStore, updateEntry } = require("../lib/page-store");
const { VAULT_ROOT } = require("../lib/config");

async function handleBuildStore() {
  try {
    const result = await buildStore();
    return result;
  } catch (e) {
    return { error: e.message };
  }
}

async function handleUpdateStore({ filePath }) {
  try {
    const fullPath = path.resolve(VAULT_ROOT, filePath);
    const result = await updateEntry(fullPath);
    return result;
  } catch (e) {
    return { error: e.message };
  }
}

module.exports = { handleBuildStore, handleUpdateStore };
