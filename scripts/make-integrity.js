// scripts/make-integrity.js — CI me chalta hai (Electron nahi, saada Node).
//
//   node scripts/make-integrity.js <win-unpacked folder> <version> <out.json>
//
// Folder ki har file ka SHA-256 -> integrity.json. Ye release ke saath GitHub
// par jaata hai; app (src/integrity.js) start par apni files isse milati hai.

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const [dir, version, out] = process.argv.slice(2);
if (!dir || !version || !out) {
  console.error("usage: node scripts/make-integrity.js <dir> <version> <out.json>");
  process.exit(1);
}

function walk(root, rel = "", acc = []) {
  for (const e of fs.readdirSync(path.join(root, rel), { withFileTypes: true })) {
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) walk(root, r, acc);
    else if (e.isFile()) acc.push(r);
  }
  return acc;
}

const files = {};
for (const rel of walk(dir).sort()) {
  files[rel] = crypto.createHash("sha256").update(fs.readFileSync(path.join(dir, rel))).digest("hex");
}

const manifest = { version, generated_at: new Date().toISOString(), files };
fs.writeFileSync(out, JSON.stringify(manifest, null, 1));
console.log(`integrity.json: ${Object.keys(files).length} files, version ${version}`);
