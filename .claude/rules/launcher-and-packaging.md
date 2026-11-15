---
paths:
  - "scripts/**"
  - "app/src/launcher.test.ts"
  - "app/electron-builder.yml"
  - "app/e2e/packaged.spec.ts"
  - "app/src/main/paths.ts"
  - "app/src/main/menu.ts"
  - "app/src/main/menu.test.ts"
  - "app/src/main/loginPath.ts"
  - "app/src/main/loginPath.test.ts"
  - "app/src/main/sessions/inside.ts"
  - "app/src/main/sessions/inside.test.ts"
  - "app/scripts/**"
  - "app/src/renderer/ui/Logo.tsx"
  - "site/**"
  - "docs/manual.md"
  - "README.md"
  - "app/src/readme.test.ts"
  - "app/src/manualpage.test.ts"
  - "app/src/site.test.ts"
  - ".github/workflows/**"
---

# The launcher, the packaged app, macOS, the site and the manual

Moved as written from the folder `CLAUDE.md` files; each heading names the folder it came from, and paths are written as they were there (see "Rules by area" in the root `CLAUDE.md`).

## The layout (root `CLAUDE.md`)

- `scripts/torno`: the launcher. It rebuilds the app when what a source (or
  `app/scripts`, the build's configuration, the lock) holds is other than the
  hash in `app/out/.built`, which it writes only after a build that succeeded,
  of the sources as they were when it began; or when `out/viewer/viewer.js` is
  missing. Times are not looked at.
  `--print-command` and `--print-desktop` print and start nothing;
  `--install-desktop` and `--uninstall-desktop` write and remove one file,
  `torno.desktop` under the person's data folder, the only thing the script
  writes outside the repository; `TORNO_OZONE` (`wayland` or `x11`) is the one
  way a platform is passed to Electron (`src/launcher.test.ts`). The stamp is hashed with `sha256sum`, or else
  `shasum -a 256`, which a Mac has (the same text, so the same hash; neither on the PATH is an error before any
  build). On macOS (Darwin) `TORNO_OZONE` is checked as ever but then ignored with a line on stderr (none under
  `TORNO_TEST=1`), and the three desktop options write nothing and exit 2.
  The icon is `scripts/torno.svg` (a bench vise holding a part; `torno-16.svg` is its drawing for 16 px); the
  window's `app/resources/icon.png` is made from it with `resvg -w 512 -h 512`, and `ui/Logo.tsx` draws both
  in the window. `src/launcher.test.ts` holds the three to one drawing: change the SVG, render the PNG again.
- The packaged app (`app/electron-builder.yml`; `pnpm dist:mac` makes `torno.app`, `pnpm dist:linux` an AppImage and a tar.gz,
  `pnpm pack:check` the same files as a Linux folder, for checking): the asar holds `out/**` and the dependencies of main
  and preload (renderer-only ones are `devDependencies`, bundled by Vite), node-pty unpacked; `Resources/` holds
  `kernel` (`pyproject.toml`, `uv.lock`, `src/`), `agent-plugin`, `icon.png` and `example` (the project it opens). It
  never writes inside its bundle: the kernel and the import process run with `--frozen` and
  `UV_PROJECT_ENVIRONMENT=<userData>/kernel-env` (`kernelRun` in `main/paths.ts`, `kernelEnv` in
  `main/kernel/client.ts`; not for a workspace with a `pyproject.toml`, whose `.venv` is its own). Signed ad hoc, not
  notarized. `app/e2e/packaged.spec.ts` runs against it when `TORNO_PACKAGED` names the executable.
- The site, torno.luisg.me (`.github/workflows/pages.yml` deploys `site/`): the landing page at `/`
  (`site/index.html`, `site/assets/`; its fonts and pictures copied in by `app/scripts/build-site.mjs`, never kept in
  `site/`; nothing loaded from another host, `src/site.test.ts`) and the manual at
  `/manual/` (`app/scripts/build-manual.mjs`).

## Tests (root `CLAUDE.md`)

`app/src/readme.test.ts` holds `docs/manual.md` to the code: its table of keys is
`cheatSheet()` (`TORNO_README=write pnpm -C app exec vitest run
src/readme.test.ts` writes it anew after a key changes), the tools it names as
`mcp__torno__<name>` are exactly `TOOLS`, its headings are in their order, and
what was never seen on a visible screen is one section. `README.md` is the short introduction for a
newcomer, held only to keep `Requirements` and `Run` (the window and the launcher send readers there) and to link
to headings the manual has; the reference goes in the manual.

## macOS (`app/src/main`)

- **The menu** (`menu.ts` `menuTemplate(platform, actions)`) is pure and `null` but on darwin, where `index.ts`
  builds it; elsewhere `Menu.setApplicationMenu(null)` stays (a lone Alt shows the bar on Linux). On darwin: the app
  menu, `editMenu`, `windowMenu`. Quit is no role: it closes the window (so the "Close torno?" question holds) and
  quits only when there is none; the Dock's Quit and a logout come as `before-quit` and are not held. No Close, no View.
- **PATH** (`loginPath.ts`): on darwin, not under `TORNO_TEST=1`, `applyLoginPath()` asks `$SHELL -ilc` for its PATH
  (5 s, then killed) before the first workspace opens, and sets `process.env.PATH` (`mergedPath`: shell, current, then
  the usual folders that exist). Failure is one stderr line with the shell's path and nothing of its output.
- **Paths from a process are real paths** (`sessions/inside.ts` `isInsideFolder`): whether an edited file is inside the
  object compares real paths (the nearest existing folder for a file not written yet). The example is copied under
  `realpathSync(tmpdir())`. What is stored (`recent`, `config.json`) keeps the path as it was opened.
- `scripts/node-pty-exec.mjs` (the app's `postinstall`) gives node-pty's darwin `spawn-helper` its execute bit.

## The packaged app (`app/e2e`)

`e2e/packaged.spec.ts` is skipped unless `TORNO_PACKAGED` names the executable of a packaged app: `…/torno.app/Contents/MacOS/torno`
(`pnpm dist:mac`) or the Linux folder of `pnpm pack:check` or `pnpm dist:linux`, `app/dist/linux-unpacked/torno-app` (CI runs it under `xvfb-run`).
Only that path differs. It launches it with `executablePath` (the same `TORNO_TEST=1`, its own `TORNO_CONFIG`, the stand-in
agent), builds `hollow` of a temporary copy of the fixtures, and holds that the kernel's environment is under `userData`
and that nothing under the package changed. Never started from `out/`, so it needs no `pnpm build`.
