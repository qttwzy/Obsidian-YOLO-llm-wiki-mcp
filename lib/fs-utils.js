"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

/**
 * Replace a file through a sibling temporary file, so readers see either the
 * old complete contents or the new complete contents rather than a torn write.
 * This does not provide a cross-process read-modify-write transaction.
 * @param {string} filePath
 * @param {string} content
 * @param {BufferEncoding} [encoding="utf-8"]
 */
function atomicWriteFileSync(filePath, content, encoding = "utf-8") {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  const tempPath = path.join(dir, `.${path.basename(filePath)}.${process.pid}.${crypto.randomUUID()}.tmp`);

  try {
    fs.writeFileSync(tempPath, content, encoding);
    fs.renameSync(tempPath, filePath);
  } finally {
    try { fs.unlinkSync(tempPath); } catch { void 0; }
  }
}

/**
 * String.replace that treats `replacement` as literal text.
 * Prevents `$&`, `$``, `$'`, and `$1..$n` interpolation when user text
 * is used as the replacement string.
 */
function literalReplace(str, search, replacement) { return String(str).replace(search, () => replacement); }

module.exports = { atomicWriteFileSync, literalReplace };
