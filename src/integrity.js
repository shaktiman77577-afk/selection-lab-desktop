// src/integrity.js
//
// App apni files khud jaanchti hai. Kuch badla mila to band ho jaati hai aur
// official app install karne ko kehti hai.
//
// Kaise:
//  - Har official release ke saath GitHub par "integrity.json" hota hai: app
//    folder ki har file ka SHA-256 (build ke waqt CI banata hai,
//    scripts/make-integrity.js). Ye list app ke andar nahi, server par hai.
//  - App khulte hi (peeche-peeche, ~1 second) install folder ki files ka
//    SHA-256 nikaal kar list se milati hai:
//      * list wali koi file badli hui            -> modified
//      * .exe / .dll / app.asar gayab            -> modified
//      * nayi .dll / .exe / .node / .asar ghusi  -> modified (DLL hijack wala mod)
//  - List ek baar mil jaye to userData me rakh lete hain — internet na ho tab
//    bhi jaanch hoti hai.
//  - List mil hi na sake (internet nahi aur pehle kabhi nahi mili, ya ye
//    official release nahi hai) -> jaanch nahi ho sakti, app chalti hai.
//    App.asar ki apni jaanch (Electron fuse) phir bhi lagi rehti hai.
//
// Seema: ye jaanch usi computer par chalti hai, isliye koi expert ise hata
// sakta hai. Ye aam modded / repack copies pakadne ke liye hai. Asli suraksha
// server par hai (paid content, purchase check).

const path = require("path");
const crypto = require("crypto");
const ofs = require("original-fs"); // .asar ko folder nahi, file ki tarah padhna
const { app, net } = require("electron");

const REPO = "shaktiman77577-afk/selection-lab-desktop";

// Installer ye files khud jodta hai — list me nahi hoti
const INSTALLER_EXTRAS = [/^Uninstall [^/]*\.exe$/i, /^uninstallerIcon\.ico$/i, /^resources\/elevate\.exe$/i];
// Nayi file sirf in types ki ho to shak (log/cache file par nahi)
const CODE_EXT = /\.(dll|exe|node|asar|sys|com|scr)$/i;
// Ye gayab ho to bhi shak
const CRITICAL = /(\.(exe|dll|node)$)|(^resources\/app\.asar$)/i;

function manifestUrl(version) {
  return `https://github.com/${REPO}/releases/download/v${version}/integrity.json`;
}

function cacheFile(version) {
  return path.join(app.getPath("userData"), `integrity-${version}.json`);
}

function validManifest(m, version) {
  return (
    m &&
    typeof m === "object" &&
    m.version === version &&
    m.files &&
    typeof m.files === "object" &&
    Object.keys(m.files).length > 10 &&
    Object.values(m.files).every((h) => typeof h === "string" && /^[a-f0-9]{64}$/.test(h))
  );
}

async function getManifest(version) {
  try {
    const res = await net.fetch(manifestUrl(version), { cache: "no-store" });
    if (res.ok) {
      const m = await res.json();
      if (validManifest(m, version)) {
        try {
          ofs.writeFileSync(cacheFile(version), JSON.stringify(m));
        } catch {}
        return m;
      }
    }
  } catch {}
  try {
    const m = JSON.parse(ofs.readFileSync(cacheFile(version), "utf8"));
    if (validManifest(m, version)) return m;
  } catch {}
  return null;
}

function walk(root, rel = "", out = []) {
  let entries;
  try {
    entries = ofs.readdirSync(path.join(root, rel), { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) walk(root, r, out);
    else if (e.isFile()) out.push(r);
  }
  return out;
}

function sha256File(file) {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash("sha256");
    const s = ofs.createReadStream(file, { highWaterMark: 1024 * 1024 });
    s.on("data", (d) => h.update(d));
    s.on("error", reject);
    s.on("end", () => resolve(h.digest("hex")));
  });
}

/** installDir ki files ko manifest se milao. -> { ok, problems: [..] } */
async function verify(installDir, manifest) {
  const problems = [];
  const expected = manifest.files;
  const present = new Set(walk(installDir));
  const ci = (p) => p.toLowerCase();
  const presentLower = new Map([...present].map((p) => [ci(p), p]));

  for (const [rel, hash] of Object.entries(expected)) {
    const actual = presentLower.get(ci(rel));
    if (!actual) {
      if (CRITICAL.test(rel)) problems.push(`missing: ${rel}`);
      continue;
    }
    let got;
    try {
      got = await sha256File(path.join(installDir, actual));
    } catch {
      problems.push(`unreadable: ${rel}`);
      continue;
    }
    if (got !== hash) problems.push(`changed: ${rel}`);
  }

  const known = new Set(Object.keys(expected).map(ci));
  for (const rel of present) {
    if (known.has(ci(rel))) continue;
    if (INSTALLER_EXTRAS.some((re) => re.test(rel))) continue;
    if (CODE_EXT.test(rel)) problems.push(`added: ${rel}`);
  }
  return { ok: problems.length === 0, problems };
}

function installDir() {
  return path.dirname(process.execPath);
}

/** App start par. onModified(problems) tabhi bulta hai jab badlav mila. */
async function run(onModified) {
  if (!app.isPackaged) return { checked: false };
  const manifest = await getManifest(app.getVersion());
  if (!manifest) return { checked: false };
  const result = await verify(installDir(), manifest);
  if (!result.ok) {
    console.error("[integrity] modified:", result.problems.slice(0, 20).join(", "));
    onModified(result.problems);
  }
  return { checked: true, ...result };
}

module.exports = { run, verify, walk, installDir, validManifest, manifestUrl };
