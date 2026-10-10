// src/updater.js
//
// Auto-update GitHub Releases se (sirf hamari official release).
//
//  - Har start par aur har 6 ghante me naya version dekhta hai, chupchaap
//    download karta hai, phir puchta hai "Restart now?". "Later" dabaya to
//    app band hote waqt install ho jata hai.
//  - Zabardasti update: API (/api/desktop/config) ka min_version is version se
//    bada ho to app chalne nahi deta jab tak update na ho. Purana ya chheda hua
//    version isse band karte hain (Railway env DESKTOP_MIN_VERSION).

const { app, dialog, net, shell } = require("electron");

const CONFIG_URL = "https://api.selectionlab.online/api/desktop/config";
const RELEASES_URL = "https://github.com/shaktiman77577-afk/selection-lab-desktop/releases/latest";
const CHECK_EVERY_MS = 6 * 60 * 60 * 1000;

function cmpVersion(a, b) {
  const pa = String(a || "0").split("-")[0].split(".").map((n) => parseInt(n, 10) || 0);
  const pb = String(b || "0").split("-")[0].split(".").map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) < (pb[i] || 0) ? -1 : 1;
  }
  return 0;
}

async function fetchConfig() {
  try {
    const res = await net.fetch(CONFIG_URL, { cache: "no-store" });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

function blockAndQuit(win, message) {
  dialog.showMessageBoxSync(win, {
    type: "warning",
    title: "Update required",
    message: "Please update Selection Lab",
    detail: message,
    buttons: ["Download update"],
  });
  shell.openExternal(RELEASES_URL);
  app.exit(0);
}

function init(win, onForced) {
  if (!app.isPackaged) return; // dev me update nahi
  let autoUpdater;
  try {
    ({ autoUpdater } = require("electron-updater"));
  } catch (e) {
    console.error("[updater] electron-updater missing", e);
    return;
  }

  let forced = false;
  let asked = false;
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.logger = null;

  autoUpdater.on("update-downloaded", async (info) => {
    if (forced) {
      autoUpdater.quitAndInstall(true, true);
      return;
    }
    if (asked || win.isDestroyed()) return;
    asked = true;
    const { response } = await dialog.showMessageBox(win, {
      type: "info",
      title: "Update ready",
      message: `Selection Lab ${info && info.version ? info.version : ""} is ready to install`,
      detail: "Restart the app to finish updating. If you are in the middle of a test, choose Later — it will update when you close the app.",
      buttons: ["Restart now", "Later"],
      defaultId: 1,
      cancelId: 1,
    });
    if (response === 0) autoUpdater.quitAndInstall(true, true);
  });

  autoUpdater.on("error", (err) => {
    console.error("[updater]", err && err.message);
    if (forced) blockAndQuit(win, "This version is no longer supported. Download and install the latest version to continue.");
  });

  autoUpdater.on("update-not-available", () => {
    if (forced) blockAndQuit(win, "This version is no longer supported. Download and install the latest version to continue.");
  });

  (async () => {
    const cfg = await fetchConfig();
    if (cfg && cfg.min_version && cmpVersion(app.getVersion(), cfg.min_version) < 0) {
      forced = true;
      // Site band — sirf "Updating..." screen, jab tak naya version na aa jaye
      if (onForced) onForced();
    }
    autoUpdater.checkForUpdates().catch(() => {});
  })();

  setInterval(() => autoUpdater.checkForUpdates().catch(() => {}), CHECK_EVERY_MS);
}

module.exports = { init, cmpVersion };
