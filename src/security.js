// src/security.js
//
// App kaun si site khol sakti hai, kya bahar browser me jayega — sab yahan.
//
// Niyam:
//  - Main window me sirf selectionlab.in (aur www) khulta hai.
//  - Payment (Razorpay / Cashfree) ke dauraan bank ke page bhi chahiye, isliye
//    payment shuru hote hi ("paymentFlow") thodi der ke liye koi bhi https page
//    chalne dete hain, aur selectionlab.in par wapas aate hi band.
//  - Baaki har link (YouTube, Telegram, WhatsApp...) system browser me.
//  - Hamara preload bridge sirf selectionlab.in ke page ko jawab deta hai.

const SITE_HOSTS = new Set(["www.selectionlab.in", "selectionlab.in"]);
const API_HOST = "api.selectionlab.online";
const HOME_URL = "https://www.selectionlab.in/";

// Payment gateway ke domain (popup ya redirect yahin se shuru hote hain)
const PAYMENT_SUFFIXES = [
  "razorpay.com",
  "cashfree.com",
];

function parse(url) {
  try {
    return new URL(url);
  } catch {
    return null;
  }
}

function hostMatches(host, suffix) {
  return host === suffix || host.endsWith("." + suffix);
}

function isSiteUrl(url) {
  const u = parse(url);
  return !!u && u.protocol === "https:" && SITE_HOSTS.has(u.hostname);
}

function isApiUrl(url) {
  const u = parse(url);
  return !!u && u.protocol === "https:" && u.hostname === API_HOST;
}

function isPaymentUrl(url) {
  const u = parse(url);
  return !!u && u.protocol === "https:" && PAYMENT_SUFFIXES.some((s) => hostMatches(u.hostname, s));
}

/** System browser me kholne layak link — sirf http(s), mailto, tel, whatsapp. */
function isSafeExternal(url) {
  const u = parse(url);
  if (!u) return false;
  return ["https:", "http:", "mailto:", "tel:", "whatsapp:", "tg:"].includes(u.protocol);
}

/** "Install from official" button — sirf apni site ya apni GitHub release */
function isOfficialDownload(url) {
  const u = parse(url);
  if (!u || u.protocol !== "https:") return false;
  if (SITE_HOSTS.has(u.hostname)) return true;
  return u.hostname === "github.com" && u.pathname.toLowerCase().startsWith("/shaktiman77577-afk/selection-lab-desktop/");
}

// Screenshot / screen recording sirf in pages par khula (Oct 2026). Baaki har
// page (course ke andar ka content, mock, descriptive, current affairs, PDF...)
// par window recording / screenshot me kaali ya gayab aati hai.
const SCREENSHOT_OK = [
  /^\/$/,                          // home
  /^\/my-learning(\/|$)/,           // My Learning
  /^\/courses(\/|$)/,               // course list
  /^\/course\/[^/]+\/?$/,            // course ka bahar wala page (details / Buy)
];

/** Is page par screenshot chalega? Apni site: sirf upar wale pages. API (PDF):
 *  kabhi nahi. Baaki (payment / bank page, app ki apni status screen): haan. */
function screenshotAllowed(url) {
  const u = parse(url);
  if (!u) return true;
  if (u.protocol === "https:" && SITE_HOSTS.has(u.hostname)) {
    return SCREENSHOT_OK.some((re) => re.test(u.pathname));
  }
  if (u.protocol === "https:" && u.hostname === API_HOST) return false;
  return true;
}

/** IPC bhejne wala frame hamari site ka hai? (bank/payment page ko bridge nahi) */
function isTrustedSender(event) {
  const frame = event && event.senderFrame;
  if (!frame || frame.parent) return false; // sirf main frame
  return isSiteUrl(frame.url);
}

module.exports = {
  SITE_HOSTS,
  API_HOST,
  HOME_URL,
  isSiteUrl,
  isApiUrl,
  isPaymentUrl,
  isSafeExternal,
  isOfficialDownload,
  isTrustedSender,
  screenshotAllowed,
};
