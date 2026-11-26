---
paths:
  - "app/src/renderer/viewport/picture.ts"
  - "app/src/renderer/viewport/picture.test.ts"
  - "app/src/main/export/**"
  - "app/src/renderer/ui/ExportSheet.tsx"
  - "app/src/renderer/ui/export/**"
  - "app/src/renderer/ui/SavedFile.tsx"
  - "app/src/renderer/state/exportSaved.ts"
  - "app/src/shared/exportdata.ts"
  - "app/src/shared/exportdata.test.ts"
  - "app/src/main/images.ts"
  - "app/e2e/export.spec.ts"
---

# Saving an export: the file, the model, a picture, a section drawing, and the sheet

Moved as written from the folder `CLAUDE.md` files; each heading names the folder it came from, and paths are written as they were there (see "Rules by area" in the root `CLAUDE.md`).

## Global Constraints (root `CLAUDE.md`)

- Images for the agent: long edge at most 2000 px, default 1280. A picture of the view the person saves for themselves (the "Picture" tile of the export dock, `export:savePicture`) is not for the agent and is not held to that: its long edge is at most 4000 px (`MAX_PICTURE_EDGE`), asked only by the window itself (`ImageRequest.person`, never a field of an agent's `look`), and kept nowhere but at the path the person chose.

## Export (`app/src/main`)

- Main is not held while a file is made: deflating is zlib's own, on its threads (`squeeze`), and a scan is
  reduced in turns of the event loop (`clusterScanInTurns`). A reduced scan is kept by folder, scan,
  `meshIdentity` and size until the export is put away, or, once a file was written, until the status line lets go of that file (`export:done`, `forgetExportScans`); packed parts by
  their build's blob.
- Saving (`export:save` in `ipc.ts`): the file is made first, then the save dialog is asked (under test
  `__tornoMain.pickSave`, with `savePicks` and `saveOffered`), opening in `<object>/.torno/exports/`
  (`prepareExports`: made on demand, ignored through `ensureIgnored(dir, ['exports/'])`), and `writeExport`
  writes it whole or not at all: `<path>.<random>.tmp` opened `wx`, written, synced, renamed onto the path, and
  removed if anything fails; the file that was there is never truncated first. No folder is made. A name
  without the format's extension gets it (`exportPath`: `.html`/`.htm`, `.step`/`.stp`, `.stl`, `.3mf`); if that
  file is there already the dialog never asked about it, so torno asks before replacing it (under test
  `__tornoMain.replace`, counted in `replaceAsked`).
- **A file of the model** (`format` `step`, `stl` or `3mf`; `export/model.ts`) is of one object, one layout and
  the parts the sheet names (a group's name stands for its parts, `partsNamed`), in the colours torno draws them
  (`partColors`): STEP the assembly unless asked, a mesh the `print` layout, an STL one part with a solid. The
  window sends names and two numbers, never a path (`exportAsked`). It is made by the kernel's live worker of the
  last good build (`Builds.query` of `export` with `blob`, `KernelClient.query`'s `{ result, blob }`), before
  the dialog is up, of the revision there was when it was asked for (`NEW_BUILD` if another landed while it was
  made, or replaced the worker that made it: `KernelClient.query` asks a cancelled query again of the new worker, but
  never `export`, `export_check` or `try_fillet`, `NOT_RETRIED`, whose answer is of the build that went and which
  would hold up the new build's checks for minutes); `writeExport` is given a `check`, run on the `.tmp` once it is whole and closed and before
  the rename: `checkModelFile` has the same worker read that file back (`export_check`) and throws, with every
  problem it found (`FAILED_CHECK`), when it did not pass, or when another build of the object landed since the
  file was made (`NEW_BUILD`). A write under way is in `exportsUnderWay` until it ends; `will-quit` gives each up
  (`stopExports`: the check is not waited for, nothing is named) and waits, with the stores' writes, until its
  `.tmp` is removed. A file that fails is never named and the `.tmp` is removed. The sheet is told what
  was checked (`ExportSaved.checked`). A 3MF asked to be opened (`ExportRequest.open`, the sheet's tick) is
  handed to the system once it is named (`shell.openPath`; under test the path is put in
  `__tornoMain.openedFiles` and nothing is opened). The plan of such a file weighs nothing (`exportPlan`: each
  object's `layoutParts`, and `ONE_OBJECT` when several are ticked).
- After a save the sheet offers `export:reveal` and `export:openSaved`. Neither takes an argument: they act on
  `savedHere`, the path the last `export:save` wrote, kept in main until `export:done`, and refuse when the
  file is gone. Under test they go through the `revealFile` and `openFile` hooks (`revealedFiles`,
  `openedFiles`) and nothing is shown or opened.

- **A picture of the view** (`export:savePicture`; `FileFormat` `png` in `shared/exportdata.ts`; the export dock's tile "Picture"): the window draws it
  (`pictureForPerson`, the renderer of `look` with `ImageRequest.person`: up to 4000 px, `MAX_PICTURE_EDGE`, and
  without the axes and scale bar when asked) and sends the PNG's bytes and the object's id; main reads the header
  (`checkedPicture`: a PNG, at most 4000 px and 64 MB, else refused), asks where to save (`askWhere`, the same dialog and
  hook as any export, opening in `.torno/exports/`, default name `<name>-r<revision>.png`) and writes through
  `writeExport`. The path is the dialog's alone and no agent has a tool for it; the agent's pictures stay within
  2000 px (`checkedImage`, `pictureSize` without `forPerson`).
- **A drawing of the section on screen** (`export:saveSection`, `export/section.ts`, `export/sectionSvg.ts`; `FileFormat`
  `svg`, or `pdf`): the window sends the object's id and `svg` or `pdf`. Main takes the plane, the layout and the parts that are on from the
  view the window last reported (`latestView`), asks the kernel for the outlines within `SECTION_DEFLECTION`
  (0.01 mm) of the last good build, in full (not the thinned points the `section` tool tells), refuses when there is no
  section on screen (`NO_SECTION`), nothing cut (`NOTHING_CUT`) or a build landed meanwhile (`NEW_BUILD`), and writes
  the SVG through `askWhere` and `writeExport`. A PDF (`export/pdf.ts` `pdfOfSvg`) is that SVG printed by `printToPDF` in a `BrowserWindow` that is never shown (`show: false`, sandboxed, no script, every request but the data URL cancelled) on a page of the drawing's own size in millimetres, made before the dialog is up. Both set `savedHere`, so the sheet's "Show in folder" works for them. `sectionSvg` is pure: the file is in millimetres (its width and height
  in `mm`, the viewBox in the same numbers, so one unit is one millimetre; no scaling), with a scale bar, a title block
  whose numbers are in full (`full`), and the dimension marks of the layout that are not resolved, are measured on the
  build (`measuredValue`) and have both ends within `IN_PLANE_MM` of the plane, with the value and, when set, `expected
  ± tolerance`; the others are listed in `left`. What the build was made from (#62: `identitySaid` of `buildIdentity`,
  sources hash, commit and "with changes") goes in the title block as `Source` through `SectionDeps.identity`.

- **A drawing of a tracing** (`export:saveTracing(objectId, tracingId, 'svg' | 'pdf', { layers, marks, photo })`,
  `export/tracing.ts` `makeTracingDrawing`): the same file as the section's, made by the same pure function,
  `tracingSvg` in `shared/tracingSvg.ts` (shared so that the window's view of a tracing and the file are one picture;
  `sectionSvg` is it with nothing extra, byte for byte what it was). Main takes the tracing from the store, cuts its own
  plane (its axes, layout and parts, `SECTION_DEFLECTION`, no snaps) of the last good build, refuses a tracing that is not
  there (`no tracing T9; tracings: T1`), a layout the build lacks and a build that landed meanwhile (`NEW_BUILD`), and
  writes through `askWhere` (default `<project>-T1-r<revision>.svg`, `tracingExportPath`) and `writeExport`, or `pdfOfSvg`.
  The window sends ids and three ticks, never a path or bytes. "Layers" draws those not hidden, with a legend; "Marks on it"
  the pins, picks and arrows whose `tracing` is this one; "The photo" puts the straightened copy in as a `data:` image (`photoOf`: read by main from the photos folder through `deps.photoBytes`, placed by `photoRect`, at the person's
  fade, hidden or not since the tick is the person's; refused in words for a tracing with no photo, one not lined up or a copy not on this computer) and its `lineupSaid` in the title
  block; the sheet ticks it off by default and warns (`PHOTO_WARNING`), and offers it once the tracing has its copy. The file holds no path, no link but the SVG namespace, and an image only as a `data:` URL of a PNG or JPEG
  (`PHOTO_FILE`). With `forScreen` the function gives the window's elements, with class names and no colour in an attribute.

## Export (`app/src/renderer`)

- "Export…" is a button in the status line for the open object, in the head of the page of objects for every
  object that can be exported, and on each card that has a build of this run, for that object. The export is
  **docked in the session dock, under its header, in place of the conversation** (`ui/ExportSheet.tsx`,
  rendered by `SessionPane` while `exportOf` is set; the conversation's body stays mounted, hidden, so a draft and a terminal
  are as they were). It is no modal: the view is its preview (a 2 px accent frame, the export's `Band`, `useBand` reading
  `exportOf`; `LeftOutTags` puts a dashed `Tag` at each switched-off part that stays out of a page, from `state/exportPreview.ts`).
  The conversation folds to a 40 px band at the dock's foot (`ui/export/ExportFold.tsx`): "Claude Code idle, 1 mark to review" and
  **Back to the chat**, `--warn-wash` with "needs you" and **Answer** when the session asks; both put the export away, and the dock
  shows the ask. Picking another node of the strip exports no other build (ruling 7). `Esc` and Close put it away unless a file is
  being made. `Ctrl+Shift+E` (the row `export` of `shared/keys.ts`, heard everywhere, the terminal included) brings it up: for the open
  object, or from the page of objects for any. There is no agent tool for it.
- Its five tiles (`tilesOf` in `ui/export/exportWords.ts`: **A page** HTML, **CAD** STEP, **Slicer** 3MF STL with a segment inside, **Picture** PNG,
  **Tracing** SVG PDF) choose what is written; the page is the default. Picture and Tracing are of the open project's view
  (`ofView`) and are dimmed, still focusable, with the reason in their title, when it is not. A file of the model is of one object (the
  objects are then radio buttons), one layout (`defaultLayout`: `assembly` for STEP, `print` for a mesh) and the parts ticked (one, by radio, for
  an STL; a part with no solid cannot be ticked for a mesh), each from the plan's `layoutParts`; a mesh has a tolerance and an angle typed
  in, and the action is off while either is out of its range. A 3MF has "Open it once saved", off by default. The window sends names and
  numbers and never a path.
- **What each line weighs.** A page's lines (the page, each project, marks, resolved marks, switched-off parts, each scan) show their
  weight from `ExportPlan.items` at the right, in mono, with a square in the colour of their share; a line that is off has its weight struck
  through and muted, a scan on with 0 bytes says "left out for size". The total, "of 12 MB" and the rule come from `weighRule(items,
  budget)` (`ui/export/weighRule.ts`, pure): the segments are the lines that are on and weigh something, in order, as shares of the
  budget, never more than the budget together; what passes the budget is the overflow's own share (`over`, drawn in `--fail` past the last
  tick), and the ticks are 0, half and the budget. Because the lines that are on add up to `ExportPlan.bytes` exactly, the rule never claims
  more than the total. A refused plan (`refusal`: nothing chosen, or over `EXPORT_MOST`) shows its words and no rule, and the action is off.
  A file of the model, a picture and a tracing have no rule.
- **Saved.** A file that was written closes the export: `keepFile` (`state/exportSaved.ts`) holds it for the status line, where the chip
  (`ui/SavedFile.tsx`) stands in the place of Export… as "✓ name size Show in folder" on the accent wash, with what the read-back
  checked (`ExportSaved.checked`, `ui/export/Checked.tsx`) and, for a page, **Open in browser** in a popover above it: shown once as the file lands (7 s),
  on the pointer or the focus after. It is let go (`letGo`, which sends `export:done`) by the next build, 60 s, a new export or its ×;
  main keeps `savedHere` until then, so the export's own unmount sends `export:done` only when nothing was written.
- **The picture and the tracing** are of the open project as it is on screen: the dock shows no list of projects, `ViewChoices`
  in its place (a picture's long edge, `PICTURE_SIZES` 1280 to 4000, "Marks", "Axes and scale bar"; a tracing starts with its "Drawing of" list and needs
  a section on screen or a tracing, and says so, with the action off, when there is none). The window draws the picture itself (`pictureForPerson` in
  `state/agent.ts`, the code of `look` with `ImageRequest.person`) and hands main its bytes with the object's id
  (`export.savePicture`); the drawing is made in main (`export.saveSection(id, 'svg' | 'pdf')`, no bytes from the window).
  Main asks where to save, so the window names no path. `person` is set only there: a request of the agent's, which comes
  over `view:look`, is held to 2000 px (`connectLook`). Its chip offers "Show in folder", never "Open in browser".
