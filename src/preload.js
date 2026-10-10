// src/preload.js
//
// Site aur app ke beech ka chhota pul. sandbox:true hai, isliye yahan Node
// nahi hai aur doosri file require nahi ho sakti — sab kuch isi file me.
//
// Sirf selectionlab.in ke page par chalta hai. Payment/bank page par na cache
// lagta hai, na window.slDesktop milta hai.

const { contextBridge, ipcRenderer, webFrame } = require("electron");

const SITE_ORIGIN = /^https:\/\/(www\.)?selectionlab\.in$/;
const API_BASE = "https://api.selectionlab.online/api";

function argValue(name) {
  const hit = (process.argv || []).find((a) => a.startsWith("--" + name + "="));
  return hit ? hit.slice(name.length + 3) : "";
}

// ── 1) API ka local cache ──────────────────────────────────────────────────
// Tez loading ke liye API ka local cache (sirf desktop app me).
//
// Ye function preload se page ki apni duniya (main world) me chalta hai, site
// ki kisi bhi script se PEHLE, aur window.fetch ko lapet deta hai.
//
// Kya cache hota hai: sirf wo PUBLIC list jinka jawab har student ke liye ek
// jaisa hai (server bhi inhe 60 second cache karta hai) — courses, blog,
// banners, exam updates, exams, app config.
//   - Cache me ho -> turant wahi dikhao (page jhat se khulta hai)
//   - 60 second se purana ho -> peeche se naya le aao (agli baar naya dikhega)
//   - 24 ghante se purana -> pehle internet se lo; net na ho to purana hi sahi
//
// Kya KABHI cache nahi hota: jisme user_id ho, login/payment/submit (POST),
// questions, results, purchase status, admin — yaani kuch bhi paid ya personal.
// Ye sab har baar server se hi aata hai.

function installApiCache(opts) {
  "use strict";
  if (window.__slApiCache) return;
  window.__slApiCache = 1;

  var API = opts.apiBase; // "https://api.selectionlab.online/api"
  var API_PATH = new URL(API).pathname.replace(/\/$/, ""); // "/api"
  var NAME = opts.cacheName; // "sl-api-v1"
  var FRESH_MS = 60 * 1000;
  var MAX_AGE_MS = 24 * 60 * 60 * 1000;
  var RULES = [
    /^\/app-config\/?$/,
    /^\/courses\/?$/,
    /^\/courses\/featured\/?$/,
    /^\/blog\/?$/,
    /^\/blog\/[A-Za-z0-9_-]+\/?$/,
    /^\/banners\/?$/,
    /^\/banners\/featured-series\/?$/,
    /^\/exam-updates\/?$/,
    /^\/exam-updates\/[A-Za-z0-9_-]+\/?$/,
    /^\/exams\/?$/,
    /^\/exams\/categories\/?$/,
    /^\/tier2\/typing\/platform-totals\/?$/,
  ];
  // Query me ye aaye to personal ho sakta hai — cache nahi
  var PERSONAL = ["user_id", "token", "uid"];

  var orig = window.fetch;
  if (typeof orig !== "function" || !window.caches) return;

  var inflight = {};

  function cacheableUrl(input, init) {
    try {
      var method = (init && init.method) || (input && typeof input === "object" && input.method) || "GET";
      if (String(method).toUpperCase() !== "GET") return null;
      if (init && (init.cache === "no-store" || init.cache === "reload")) return null;
      var raw = typeof input === "string" ? input : input && input.url ? input.url : String(input);
      if (raw.indexOf(API + "/") !== 0) return null;
      var u = new URL(raw);
      for (var i = 0; i < PERSONAL.length; i++) if (u.searchParams.has(PERSONAL[i])) return null;
      var path = u.pathname.slice(API_PATH.length); // "/api/courses/" -> "/courses/"
      for (var j = 0; j < RULES.length; j++) if (RULES[j].test(path)) return u.toString();
      return null;
    } catch (e) {
      return null;
    }
  }

  function refresh(key, input, init) {
    if (inflight[key]) return inflight[key];
    var p = orig.call(window, input, init).then(function (res) {
      if (res && res.ok && res.status === 200) {
        var copy = res.clone();
        copy.arrayBuffer().then(function (body) {
          var h = new Headers(copy.headers);
          h.set("x-sl-cached-at", String(Date.now()));
          return caches.open(NAME).then(function (c) {
            return c.put(key, new Response(body, { status: 200, statusText: "OK", headers: h }));
          });
        }).catch(function () {});
      }
      return res;
    });
    inflight[key] = p;
    p.then(clear, clear);
    function clear() { delete inflight[key]; }
    return p;
  }

  window.fetch = function (input, init) {
    var key = cacheableUrl(input, init);
    if (!key) return orig.call(window, input, init);
    return caches.open(NAME).then(function (c) {
      return c.match(key);
    }).then(function (hit) {
      if (hit) {
        var age = Date.now() - Number(hit.headers.get("x-sl-cached-at") || 0);
        if (age < MAX_AGE_MS) {
          if (age > FRESH_MS) refresh(key, input, init).catch(function () {});
          return hit;
        }
      }
      return refresh(key, input, init).catch(function (err) {
        if (hit) return hit; // internet nahi — purana hi dikha do
        throw err;
      });
    }, function () {
      return orig.call(window, input, init);
    });
  };
}

// ── 2) window.slDesktop — site ko pata chale ki wo desktop app me hai ──────

if (SITE_ORIGIN.test(window.location.origin)) {
  const opts = { apiBase: API_BASE, cacheName: "sl-api-v1" };
  try {
    if (typeof contextBridge.executeInMainWorld === "function") {
      contextBridge.executeInMainWorld({ func: installApiCache, args: [opts] });
    } else {
      webFrame.executeJavaScript("(" + installApiCache.toString() + ")(" + JSON.stringify(opts) + ")");
    }
  } catch {}

  contextBridge.exposeInMainWorld("slDesktop", {
    version: argValue("sl-version"),
    platform: process.platform,
    // Google login system browser me. Promise -> { code, verifier } ya error
    googleLogin: () => ipcRenderer.invoke("sl:google-login"),
    cancelGoogleLogin: () => ipcRenderer.invoke("sl:google-cancel"),
  });
}
