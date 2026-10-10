// src/store.js
//
// Chhoti si settings file (userData/settings.json): window ka size/jagah aur
// aakhri khula page. Login token yahan NAHI — wo site ke apne localStorage me
// rehta hai (app ke alag, encrypted profile ke andar).

const fs = require("fs");
const path = require("path");
const { app } = require("electron");

let cache = null;
let file = null;
let timer = null;

function load() {
  if (cache) return cache;
  file = path.join(app.getPath("userData"), "settings.json");
  try {
    cache = JSON.parse(fs.readFileSync(file, "utf8")) || {};
  } catch {
    cache = {};
  }
  return cache;
}

function get(key, fallback) {
  const v = load()[key];
  return v === undefined ? fallback : v;
}

function set(key, value) {
  load()[key] = value;
  // Baar-baar disk par na likhein (resize/move par sau baar aata hai)
  clearTimeout(timer);
  timer = setTimeout(flush, 400);
}

function flush() {
  clearTimeout(timer);
  if (!cache || !file) return;
  try {
    const tmp = file + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(cache));
    fs.renameSync(tmp, file);
  } catch {}
}

module.exports = { get, set, flush };
