# Selection Lab — Windows desktop app

Electron app that opens the live site (https://www.selectionlab.in). All data, locks and payments
stay on the server (api.selectionlab.online), so the app holds no secrets or paid content.

## What it does

- **Fast loading.** The site's JS, CSS, fonts and images stay in the app's disk cache. Public lists
  (courses, blog, banners, exam updates, exams, app config) are cached locally: they show instantly
  and refresh in the background. Anything personal or paid is never cached: requests with `user_id`,
  questions, results, payments, login and admin.
- **Security.** Sandboxed renderer with no Node access and DevTools off in release builds. The main
  window opens only selectionlab.in. Payment and bank pages are allowed only during a payment.
  Other links open in the normal browser. Electron fuses are set (no run-as-Node, no `--inspect`,
  ASAR integrity, app loads only from ASAR), and the app refuses to start with
  `--remote-debugging-port`.
- **Screenshot block.** Windows content protection: screenshots, screen recording and screen
  sharing show nothing on every page except home, My Learning, the course list and a course's
  outside page (details / Buy). PDF windows are protected too. Payment pages are not.
- **Self check.** On every start the app hashes its own install files (SHA-256) and compares them
  with `integrity.json` from this version's GitHub Release. A changed file, a missing exe/dll/asar,
  or an added dll/exe means the app shuts the site and shows "This copy has been changed —
  download the official app". The manifest is cached for offline starts. If it can't be fetched
  (not an official release, or never online), the check is skipped; Electron's ASAR check still applies.
- **Google login** runs in the system browser (PKCE): `/desktop-login` on the site returns to the app
  through `selectionlab://`. Password and OTP login work inside the app.
- **Auto-update** comes from this repo's GitHub Releases. To force an update, set
  `DESKTOP_MIN_VERSION` on Railway (API); older versions show an "Updating" screen and can't be used.
- Offline screen, window size and last page remembered, and an "are you sure?" prompt when closing
  during a test.

## Build

Every push runs `.github/workflows/build-windows.yml` on a Windows runner:
1. Builds `SelectionLab-Setup-x.y.z.exe` and smoke-tests it (the packaged app must start).
2. Makes `integrity.json`, silently installs the app, runs the installed app's self check (must pass),
   then drops a fake dll into the folder (the check must catch it).
3. The installer appears under **Actions → run → Artifacts → SelectionLab-Windows**.

## Release a new version

1. Bump `"version"` in `package.json` (for example `1.0.1`) and commit.
2. Run `git tag v1.0.1 && git push origin v1.0.1`.
3. The workflow builds into a **draft** release, runs all the checks, attaches `integrity.json`, then
   publishes it. Installed apps download the update in the background (only the changed parts) and
   install it on restart. If any check fails, the release stays a draft and reaches no one.

## Local run (developer machine)

```
npm install
npm start
```

## Notes

- The installer is not code-signed yet, so Windows SmartScreen shows "More info → Run anyway" on
  first install. The plan is the Microsoft Store (free signing) or a code-signing certificate later.
