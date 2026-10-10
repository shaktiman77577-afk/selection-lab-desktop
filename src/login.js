// src/login.js
//
// Google login system browser me (Google app ke andar wale browser me login
// nahi hone deta — "This browser may not be secure").
//
// Tarika (PKCE — mobile/desktop apps ka standard):
//  1. App ek gupt "verifier" banata hai, uska SHA-256 ("challenge") browser ko
//     deta hai: https://www.selectionlab.in/desktop-login?c=<challenge>&s=<state>
//  2. Bachcha browser me Google se login karta hai. Site server se ek 2 minute
//     ka "code" leti hai jo is challenge se bandha hai, aur
//     selectionlab://auth?code=...&s=... kholti hai — Windows wo link app ko deta hai.
//  3. App code + verifier site ko deta hai; site server se asli login token
//     leti hai. Verifier kabhi app se bahar nahi gaya, isliye code kisi aur ke
//     haath lag bhi jaye to bekaar hai.

const crypto = require("crypto");
const { shell } = require("electron");

const LOGIN_PAGE = "https://www.selectionlab.in/desktop-login";
const TIMEOUT_MS = 10 * 60 * 1000;

let pending = null; // { state, verifier, resolve, reject, timer }

function b64url(buf) {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function finish(err, value) {
  if (!pending) return;
  const p = pending;
  pending = null;
  clearTimeout(p.timer);
  if (err) p.reject(err);
  else p.resolve(value);
}

function start() {
  if (pending) finish(new Error("Login restarted"));
  const verifier = b64url(crypto.randomBytes(32));
  const challenge = b64url(crypto.createHash("sha256").update(verifier).digest());
  const state = b64url(crypto.randomBytes(16));

  const promise = new Promise((resolve, reject) => {
    pending = {
      state,
      verifier,
      resolve,
      reject,
      timer: setTimeout(() => finish(new Error("Login timed out. Please try again.")), TIMEOUT_MS),
    };
  });

  const url = `${LOGIN_PAGE}?c=${encodeURIComponent(challenge)}&s=${encodeURIComponent(state)}`;
  shell.openExternal(url).catch(() => finish(new Error("Could not open your browser")));
  return promise;
}

function cancel() {
  finish(new Error("Login cancelled"));
}

/** selectionlab://auth?code=...&s=... — true agar ye hamare login ka jawab tha */
function handleDeepLink(link) {
  let u;
  try {
    u = new URL(link);
  } catch {
    return false;
  }
  if (u.protocol !== "selectionlab:") return false;
  const kind = (u.hostname || u.pathname.replace(/^\/+/, "")).replace(/\/+$/, "");
  if (kind !== "auth") return false;
  const code = u.searchParams.get("code") || "";
  const state = u.searchParams.get("s") || "";
  if (!pending || !code || code.length > 2048) return false;
  // state milna chahiye — warna koi bahar se app me apna code nahi ghusa sakta
  const a = Buffer.from(state);
  const b = Buffer.from(pending.state);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return false;
  finish(null, { code, verifier: pending.verifier });
  return true;
}

function findDeepLink(argv) {
  return (argv || []).find((a) => typeof a === "string" && a.toLowerCase().startsWith("selectionlab://"));
}

module.exports = { start, cancel, handleDeepLink, findDeepLink };
