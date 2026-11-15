---
paths:
  - "app/src/renderer/viewport/lights.ts"
  - "app/src/renderer/viewport/ground.ts"
  - "app/src/shared/faceted.ts"
  - "app/src/export/**"
  - "app/scripts/build-viewer.mjs"
  - "app/src/shared/exportdata.ts"
  - "app/src/shared/exportdata.test.ts"
  - "app/src/main/export/html.ts"
  - "app/src/main/export/html.test.ts"
  - "app/src/main/export/build.ts"
  - "app/src/main/export/build.test.ts"
  - "app/src/main/export/decimate.ts"
  - "app/src/main/export/decimate.test.ts"
  - "app/e2e/export.spec.ts"
---

# The exported page: what a file holds, its budget, its policy, its viewer

Moved as written from the folder `CLAUDE.md` files; each heading names the folder it came from, and paths are written as they were there (see "Rules by area" in the root `CLAUDE.md`).

## About this folder (`app/src/export`)

The page an export writes: its style (`page.css`) and its viewer (`viewer/`), which
`app/scripts/build-viewer.mjs` bundles into `out/viewer/viewer.js`. What makes the file is in
`src/main/export` (see also the rule `export-saving`).

## Export (`app/src/export`)

- One HTML file of an object, or of several, for someone who has no torno (`src/main/export`, `src/export`).
  It is made in main from the last good build of this run of each object (`Builds.scene`): nothing is built for
  an export, and an object not built in this run cannot be exported (`NOT_BUILT`).
- What is in a file is what the export sheet (`ui/ExportSheet.tsx`) showed ticked, and nothing else
  (`ExportData` in `shared/exportdata.ts`): the parts of every layout with their colours, the explode kept for
  each layout, the saved views that are the person's (`!view.proposed`, without the agent's `note`), the marks
  and their notes only with "Include marks" (off by default; drafts go with them and the sheet says how many),
  each scan only by its own tick (off by default, under `SCAN_WARNING`). A part switched off in torno is left
  out, with its mesh and the marks that are only on it, unless "Include parts that are switched off" is ticked
  (`ExportRequest.hidden`); a resolved mark is left out unless "Include resolved marks" is
  (`ExportRequest.resolved`). The sheet names what goes with counts, says of an object whose model has failed
  since that the file is of its last good build, and its size follows every tick. Never in it: a path of this machine (the workspace, a scan's `source`, the model's
  file), what a model printed, the session, `state.md`, a view the agent proposed and nobody kept, a region
  painted on a scan, a mark whose part is gone. `build.test.ts` and `e2e/export.spec.ts` hold the file to that
  (no workspace root, no home folder, no user name, no `http://` at all).
- A mesh is packed by `packMesh`: positions and edge points as `u16` in the part's own box (a coordinate comes
  back within half of `span / 65535`), normals as `i8`, indices `u16` or `u32`; deflated (`zlib`, level 9) and
  base64'd, by the part's `hash`, so a shape in two layouts is in the file once. A faceted part (`shared/faceted.ts`)
  has no edges in the file: the page draws its creases. A scan is reduced by `clusterScan` (`decimate.ts`) to
  60,000 triangles and packed by `packScan`.
- The budget (`EXPORT_BUDGET`, 12 MB): over it the largest scan goes to 30,000, then 15,000 triangles, then out
  (`SCAN_TRIANGLES`), the last of each scan said in `dropped`: in the sheet before saving, and in the page under
  "About this file". Parts are never reduced; with the parts alone over it the sheet says so and writes all the same; above
  `EXPORT_MOST` (64 MB) nothing is written. The page with nothing in it is 0.68 MB (the viewer 583 kB, the
  fonts 82 kB as base64); a part costs about 10 bytes a triangle.
- Whatever is keyed by the name of a part or a layout, in main and in the page, is a `Map` or a record with no
  prototype (`record`), and what was read from a file is asked only for its own keys (`own`, both in
  `shared/exportdata.ts`); `explodeOffsets` answers with such a record. A part may be called `constructor`.
- The page (`main/export/html.ts`): its policy is `policyOf(script, style)`: `default-src 'none'`, the one
  script and the one style named by their sha256 (no `unsafe-inline`: no other script, no handler in an
  attribute, no `eval`), `font-src data:`, `base-uri 'none'`, `form-action 'none'`. The viewer sets styles
  through the CSSOM only, never a `style` attribute. Fonts are `font-display: swap`; its data is JSON in a
  script element that is not run, with every `<`, U+2028 and U+2029 escaped; `build-viewer.mjs` refuses a bundle
  that holds `</script`, `<!--`, a dynamic import, `eval`, `innerHTML`, `MeshBVH`, `react` or `ipcRenderer`, or
  is over 650,000 bytes; `export/page.test.ts` holds the viewer's imports to three.js, `shared/*` and
  `lights`, `ground`, `views`, `theme` of the viewport.
- The viewer (`src/export/viewer`: `main`, `model`, `overlay`, `panel`) sets every word of the workspace as
  text (`textContent`), never as markup. It shares its rules with the app: `explodeShown` and `explodeOffsets`
  (never a section and an explode at once: `neverBoth` in `shared/explode.ts` is the one rule for what setting
  one makes of the other, asked by the window's store and by the page), `keepsNothing`, the palette,
  `number`, the viewport's lights, ground and standard views, and the window's rule for the camera when the parts
  go apart and come together (`leavesView`, `cameraBack`: framed anew only to keep a part in sight, and back
  where it was once they are together, if nobody moved it; `keepInView` in `main.ts`). It draws on demand, picks nothing and
  measures nothing: a dimension shows the text torno made of it on the build exported (`shownDimension`: no
  value and no verdict that is not of that build), and the page says so. A cut is by clipping alone, the inside
  in a darker tone, and the page says it draws no cut faces (so the hatch of the window's cut face, `hatchCap`, has nothing to be drawn on: the page never closes a cut, and a hatch over the inside of a clipped shell would read as a cut face it is not); a mark is a label with a dot at its point (a
  dimension has one at each end of its line), put under a label it would cover; a resolved mark is in the list
  and is labelled only when asked. The theme is the system's, light or dark, chosen in the footer line. With
  no WebGL 2 or no `DecompressionStream` it says so in words, alone on the page; a failure to show an object
  is said once and never loops. Each object's meshes are unpacked when it is first shown.
- **The page never shows its controls and an empty view in silence.** Whatever throws while it starts is said
  in place of it (`BROKE`). `WATCH_MS` (3 s) after an object began to be unpacked (again while it still is), and
  whenever the browser takes the context away or gives it back, the page looks at its own canvas
  (`Model.undrawn`: a frame drawn for the asking without the grid, read back whole, against the ground): when
  nothing of the parts is on it, while some part or scan is switched on and nothing cuts, it says why in place of
  the parts (the context taken away, a program the driver refused, a frame with nothing in it). An object that
  could not be shown keeps its own words. `firefox --headless --screenshot` pictures the page before its first
  frame: driven in headless Firefox (WebDriver BiDi) it draws the parts.
- `window.__tornoExport` is the page's own hook, always there: `state()`, `setObject`, `setLayout`, `setPart`,
  `setExplode`, `setSection`, `applyView`, `setMarks`, `setResolved`, `setTheme('system' | 'light' | 'dark')`, `pixel(fx, fy)` (of the parts and scans,
  without the grid and the marks), `ground()` and `undrawn()`. A test opens the file in a second `BrowserWindow` with
  `show: false`, a session of its own that refuses and counts every request but the file itself.
