"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const { atomicWriteFileSync } = require("../lib/fs-utils");

test("atomicWriteFileSync replaces file contents without leaving a temporary file", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "llm-wiki-fs-"));
  const target = path.join(dir, "state.json");
  fs.writeFileSync(target, "before", "utf-8");

  try {
    atomicWriteFileSync(target, "after");

    assert.equal(fs.readFileSync(target, "utf-8"), "after");
    assert.deepEqual(fs.readdirSync(dir), ["state.json"]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
