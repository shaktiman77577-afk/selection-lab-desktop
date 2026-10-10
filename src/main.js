// src/main.js — Selection Lab desktop (Windows)
//
// App sirf hamari live site (www.selectionlab.in) kholti hai. Saara data,
// lock/unlock aur payment server par hi tay hota hai — app me koi secret ya
// paid content nahi. Isliye app chhed kar bhi kuch nahi milta.
//
// Is file me:
//  - Window, aakhri page aur size yaad rakhna
//  - Suraksha: sandbox, Node band, DevTools band, sirf apni site, debug flags band
//  - Payment popup / bank page ki ijazat (sirf payment ke dauraan)
//  - Google login ka selectionlab:// link
//  - Offline screen, test ke beech window band karne par puchna
//  - Auto-update

const path = require("path");
const { app, BrowserWindow, session, shell, ipcMain, dialog, Menu, screen } = require("electron");

// CI me build ki jaanch: app khulti hai ya nahi (fuses / ASAR integrity sahi hain)
const SMOKE_TEST = process.argv.includes("--sl-smoke-test");

// ── Debug ke raaste band ───────────────────────────────────────────────────
// Fuses --inspect aur ELECTRON_RUN_AS_NODE pehle hi band karte hain. Chromium
// ka --remote-debugging-port fuse se band nahi hota, isliye yahan.
const BLOCKED_SWITCHES = ["remote-debugging-port", "remote-debugging-pipe", "remote-debugging-address", "inspect", "inspect-brk", "js-flags"];
if (app.isPackaged && BLOCKED_SWITCHES.some((s) => app.commandLine.hasSwitch(s))) {
  app.exit(1);
}

const sec = require("./security");
const store = require("./store");
const login = require("./login");
const updater = require("./updater");

const PARTITION = "persist:selectionlab";
const PROTOCOL = "selectionlab";
const STATUS_PAGE = path.join(__dirname, "status.html");
const RESTORE_WITHIN_MS = 12 * 60 * 60 * 1000;

let win = null;
let paymentFlow = false; // payment ke dauraan bank ke page main window me chal sakte hain
let forcedUpdate = false;

// ── Ek hi app chale (deep link isi se aata hai) ────────────────────────────
// Doosri copy khuli to apna argv (selectionlab:// link) pehli copy ko de kar
// turant band — koi window nahi banti.
const IS_PRIMARY = SMOKE_TEST || app.requestSingleInstanceLock();
if (!IS_PRIMARY) {
  app.exit(0);
} else {
  app.on("second-instance", (_e, argv) => {
    const link = login.findDeepLink(argv);
    if (link) login.handleDeepLink(link);
    focusWindow();
  });
}

// Mac ke liye (aage kaam aayega)
app.on("open-url", (e, link) => {
  e.preventDefault();
  login.handleDeepLink(link);
  focusWindow();
});

if (!SMOKE_TEST) {
  if (process.defaultApp && process.argv.length >= 2) {
    app.setAsDefaultProtocolClient(PROTOCOL, process.execPath, [path.resolve(process.argv[1])]);
  } else {
    app.setAsDefaultProtocolClient(PROTOCOL);
  }
}

if (process.platform === "win32") app.setAppUserModelId("in.selectionlab.desktop");

function focusWindow() {
  if (!win || win.isDestroyed()) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

// ── Session: cache, user agent, permissions ────────────────────────────────

function setupSession() {
  const ses = session.fromPartition(PARTITION);

  // "Electron" aur app ka naam hata kar saaf Chrome jaisa UA + hamara nishaan
  const ua = ses
    .getUserAgent()
    .replace(/\sElectron\/\S+/, "")
    .replace(/\sselection-lab-desktop\/\S+/i, "")
    .replace(/\sSelection Lab\/\S+/i, "");
  ses.setUserAgent(`${ua} SelectionLabDesktop/${app.getVersion()}`);

  // Sirf zaroori ijazat, aur sirf apni site ko
  const ALLOWED = new Set(["clipboard-sanitized-write", "fullscreen", "notifications"]);
  ses.setPermissionRequestHandler((_wc, permission, cb, details) => {
    cb(ALLOWED.has(permission) && sec.isSiteUrl(details.requestingUrl || ""));
  });
  ses.setPermissionCheckHandler((_wc, permission, origin) => {
    return ALLOWED.has(permission) && sec.isSiteUrl(origin || "");
  });

  // Pehle se connection khol kar rakho — pehla page jaldi aata hai
  try {
    ses.preconnect({ url: sec.HOME_URL, numSockets: 2 });
    ses.preconnect({ url: `https://${sec.API_HOST}`, numSockets: 2 });
  } catch {}

  return ses;
}

// ── Window ─────────────────────────────────────────────────────────────────

function startUrl() {
  const last = store.get("lastPage");
  if (last && sec.isSiteUrl(last.url) && Date.now() - (last.at || 0) < RESTORE_WITHIN_MS) return last.url;
  return sec.HOME_URL;
}

function rememberPage(url) {
  if (!sec.isSiteUrl(url)) return;
  const p = new URL(url).pathname;
  // Login / test dene wale page dobara seedhe na khulein
  if (/^\/(login|desktop-login|profile-setup|verify|__app)/.test(p)) return;
  if (/\/(attempt|start|play)(\/|$)/.test(p)) return;
  store.set("lastPage", { url, at: Date.now() });
}

// Purana monitor hat gaya ho to window screen ke bahar na khule
function visibleBounds(saved) {
  const def = { width: 1280, height: 800 };
  if (!saved || !saved.width || !saved.height) return def;
  const onScreen = screen.getAllDisplays().some(({ workArea: a }) =>
    saved.x < a.x + a.width - 80 && saved.x + saved.width > a.x + 80 &&
    saved.y < a.y + a.height - 80 && saved.y + saved.height > a.y);
  return onScreen ? saved : { width: saved.width, height: saved.height };
}

function webPrefs(extra) {
  return {
    partition: PARTITION,
    contextIsolation: true,
    sandbox: true,
    nodeIntegration: false,
    nodeIntegrationInSubFrames: false,
    webSecurity: true,
    allowRunningInsecureContent: false,
    webviewTag: false,
    navigateOnDragDrop: false,
    spellcheck: false, // typing test me spelling ki laal line madad na kare
    devTools: !app.isPackaged,
    safeDialogs: true,
    ...extra,
  };
}

function createWindow() {
  const bounds = visibleBounds(store.get("bounds", null));
  win = new BrowserWindow({
    ...bounds,
    minWidth: 900,
    minHeight: 600,
    show: false,
    title: "Selection Lab",
    backgroundColor: "#f6f4ee",
    icon: path.join(__dirname, "logo.png"),
    autoHideMenuBar: true,
    webPreferences: webPrefs({
      preload: path.join(__dirname, "preload.js"),
      additionalArguments: [`--sl-version=${app.getVersion()}`],
    }),
  });
  if (store.get("maximized", false)) win.maximize();
  const zoom = store.get("zoom", 1);

  const wc = win.webContents;
  let shown = false;
  const show = () => {
    if (shown || win.isDestroyed()) return;
    shown = true;
    win.show();
  };
  win.once("ready-to-show", show);
  setTimeout(show, 2500);

  // Window ka size / jagah yaad
  const saveBounds = () => {
    if (win.isDestroyed()) return;
    store.set("maximized", win.isMaximized());
    if (!win.isMaximized() && !win.isMinimized() && !win.isFullScreen()) store.set("bounds", win.getBounds());
  };
  win.on("resize", saveBounds);
  win.on("move", saveBounds);
  win.on("close", () => {
    saveBounds();
    store.flush();
  });
  win.on("closed", () => {
    win = null;
  });

  guardNavigation(wc, { main: true });

  wc.on("did-navigate", (_e, url) => rememberPage(url));
  wc.on("did-navigate-in-page", (_e, url, isMainFrame) => isMainFrame && rememberPage(url));
  wc.on("did-finish-load", () => wc.setZoomFactor(store.get("zoom", zoom)));

  // Internet nahi -> apni offline screen (khud dobara try karti hai)
  wc.on("did-fail-load", (_e, code, _desc, url, isMainFrame) => {
    if (!isMainFrame || code === -3) return; // -3 = navigation cancel, error nahi
    const network = code <= -100 && code > -200; // connection wali galtiyan (-105 DNS, -106 offline, -118 timeout...)
    if (!network) return;
    if (!sec.isSiteUrl(url)) return;
    win.loadFile(STATUS_PAGE, { query: { mode: "offline", u: url } });
  });

  // Test ke beech window band / reload: site "ruko" kahe to puchho
  wc.on("will-prevent-unload", (e) => {
    const choice = dialog.showMessageBoxSync(win, {
      type: "question",
      buttons: ["Leave", "Stay"],
      defaultId: 1,
      cancelId: 1,
      title: "Leave this page?",
      message: "Leave this page?",
      detail: "Your progress on this page may be lost.",
    });
    if (choice === 0) e.preventDefault();
  });

  wc.on("before-input-event", (e, input) => onShortcut(e, input));
  wc.on("context-menu", (_e, params) => showContextMenu(params));

  wc.loadURL(startUrl());
  return win;
}

// ── Navigation suraksha ────────────────────────────────────────────────────

function allowMainFrame(url) {
  if (sec.isSiteUrl(url)) {
    paymentFlow = false;
    return true;
  }
  if (sec.isApiUrl(url)) return true; // PDF wagairah
  if (sec.isPaymentUrl(url)) {
    paymentFlow = true;
    return true;
  }
  // Payment ke dauraan bank ke page (redirect se aate hain)
  if (paymentFlow && url.startsWith("https://")) return true;
  return false;
}

function openOutside(url) {
  if (sec.isSafeExternal(url)) shell.openExternal(url).catch(() => {});
}

function guardNavigation(wc, { main }) {
  const check = (e, url) => {
    if (forcedUpdate && main) {
      e.preventDefault();
      return;
    }
    const ok = main ? allowMainFrame(url) : url.startsWith("https://") || url === "about:blank";
    if (!ok) {
      e.preventDefault();
      if (main) openOutside(url);
    }
  };
  // Naye Electron me url / isMainFrame event par hote hain; purane me argument me
  wc.on("will-navigate", (e, url) => check(e, e.url || url));
  wc.on("will-redirect", (e, url, _inPlace, isMainFrame) => {
    const mainFrame = typeof e.isMainFrame === "boolean" ? e.isMainFrame : isMainFrame;
    if (mainFrame) check(e, e.url || url);
  });

  wc.setWindowOpenHandler(({ url, referrer }) => {
    const from = (referrer && referrer.url) || "";
    // Apni site ka naya tab -> isi window me
    if (sec.isSiteUrl(url)) {
      if (main) wc.loadURL(url);
      else if (win && !win.isDestroyed()) win.loadURL(url);
      return { action: "deny" };
    }
    // PDF / payment popup (Razorpay netbanking wagairah) -> alag chhoti window.
    // about:blank: Razorpay pehle khali popup kholta hai, phir bank ka page.
    // Ye window sandbox me hai, bina preload/bridge ke.
    if (sec.isApiUrl(url) || sec.isPaymentUrl(url) || sec.isPaymentUrl(from) || url === "about:blank") {
      return {
        action: "allow",
        overrideBrowserWindowOptions: {
          width: 900,
          height: 700,
          autoHideMenuBar: true,
          backgroundColor: "#ffffff",
          icon: path.join(__dirname, "logo.png"),
          webPreferences: webPrefs({ preload: undefined }),
        },
      };
    }
    // Baaki sab (YouTube, Telegram, WhatsApp...) system browser me
    openOutside(url);
    return { action: "deny" };
  });
}

// Har nayi window (payment popup) par bhi wahi niyam
app.on("web-contents-created", (_e, contents) => {
  contents.on("will-attach-webview", (e) => e.preventDefault());
  contents.on("did-create-window", (child) => {
    child.setMenuBarVisibility(false);
    guardNavigation(child.webContents, { main: false });
  });
});

// ── Keyboard shortcuts (menu nahi hai, isliye khud) ────────────────────────

function onShortcut(e, input) {
  if (input.type !== "keyDown" || !win) return;
  const wc = win.webContents;
  const ctrl = input.control || input.meta;
  const key = input.key;
  let handled = true;
  if (key === "F5" || (ctrl && key.toLowerCase() === "r")) {
    if (input.shift) wc.reloadIgnoringCache();
    else wc.reload();
  } else if (input.alt && key === "ArrowLeft") {
    if (wc.navigationHistory.canGoBack()) wc.navigationHistory.goBack();
  } else if (input.alt && key === "ArrowRight") {
    if (wc.navigationHistory.canGoForward()) wc.navigationHistory.goForward();
  } else if (key === "F11") {
    win.setFullScreen(!win.isFullScreen());
  } else if (ctrl && (key === "=" || key === "+")) {
    setZoom(wc.getZoomFactor() + 0.1);
  } else if (ctrl && key === "-") {
    setZoom(wc.getZoomFactor() - 0.1);
  } else if (ctrl && key === "0") {
    setZoom(1);
  } else {
    handled = false;
  }
  if (handled) e.preventDefault();
}

function setZoom(z) {
  const f = Math.min(2, Math.max(0.6, Math.round(z * 10) / 10));
  win.webContents.setZoomFactor(f);
  store.set("zoom", f);
}

function showContextMenu(params) {
  const items = [];
  if (params.isEditable) {
    items.push({ role: "cut", enabled: params.editFlags.canCut });
    items.push({ role: "copy", enabled: params.editFlags.canCopy });
    items.push({ role: "paste", enabled: params.editFlags.canPaste });
    items.push({ type: "separator" });
    items.push({ role: "selectAll" });
  } else if (params.selectionText && params.selectionText.trim()) {
    items.push({ role: "copy" });
  }
  if (!items.length) {
    items.push({ label: "Back", enabled: win.webContents.navigationHistory.canGoBack(), click: () => win.webContents.navigationHistory.goBack() });
    items.push({ label: "Reload", click: () => win.webContents.reload() });
  }
  Menu.buildFromTemplate(items).popup({ window: win });
}

// ── Site <-> app (sirf apni site se) ───────────────────────────────────────

ipcMain.handle("sl:google-login", async (event) => {
  if (!sec.isTrustedSender(event)) throw new Error("Not allowed");
  const result = await login.start();
  focusWindow();
  return result;
});

ipcMain.handle("sl:google-cancel", (event) => {
  if (!sec.isTrustedSender(event)) return;
  login.cancel();
});

// ── Start ──────────────────────────────────────────────────────────────────

app.whenReady().then(() => {
  if (!IS_PRIMARY) return;
  if (SMOKE_TEST) {
    // Yahan tak pahunche = ASAR theek, fuses theek, code chal raha hai
    try {
      require("electron-updater");
    } catch (e) {
      console.error("SMOKE_FAIL electron-updater missing", e);
      app.exit(2);
      return;
    }
    console.log("SMOKE_OK", app.getVersion());
    app.exit(0);
    return;
  }

  // Windows par menu bar nahi; Mac ke liye chhota menu (copy/paste wahan menu se chalta hai)
  if (process.platform === "darwin") {
    Menu.setApplicationMenu(Menu.buildFromTemplate([{ role: "appMenu" }, { role: "editMenu" }, { role: "windowMenu" }]));
  } else {
    Menu.setApplicationMenu(null);
  }

  setupSession();
  createWindow();

  updater.init(win, () => {
    forcedUpdate = true;
    if (win && !win.isDestroyed()) win.loadFile(STATUS_PAGE, { query: { mode: "update" } });
  });

  app.on("activate", () => {
    if (!win) createWindow();
  });
});

app.on("window-all-closed", () => {
  store.flush();
  if (process.platform !== "darwin") app.quit();
});
