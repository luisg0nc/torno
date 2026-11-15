---
paths:
  - "app/src/renderer/viewport/picture.ts"
  - "app/src/renderer/viewport/picture.test.ts"
  - "app/src/main/export/**"
  - "app/src/renderer/ui/ExportSheet.tsx"
  - "app/src/shared/exportdata.ts"
  - "app/src/shared/exportdata.test.ts"
  - "app/src/main/images.ts"
  - "app/e2e/export.spec.ts"
---

# Saving an export: the file, the model, a picture, a section drawing, and the sheet

Moved as written from the folder `CLAUDE.md` files; each heading names the folder it came from, and paths are written as they were there (see "Rules by area" in the root `CLAUDE.md`).

## Global Constraints (root `CLAUDE.md`)

- Images for the agent: long edge at most 2000 px, default 1280. A picture of the view the person saves for themselves (the "A picture" reader of the export sheet, `export:savePicture`) is not for the agent and is not held to that: its long edge is at most 4000 px (`MAX_PICTURE_EDGE`), asked only by the window itself (`ImageRequest.person`, never a field of an agent's `look`), and kept nowhere but at the path the person chose.

## Export (`app/src/main`)

- Main is not held while a file is made: deflating is zlib's own, on its threads (`squeeze`), and a scan is
  reduced in turns of the event loop (`clusterScanInTurns`). A reduced scan is kept by folder, scan,
  `meshIdentity` and size until the sheet is put away (`export:done`, `forgetExportScans`); packed parts by
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

- **A picture of the view** (`export:savePicture`; `FileFormat` `png` in `shared/exportdata.ts`; the export sheet's reader "A picture"): the window draws it
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

## Export (`app/src/renderer`)

- "Export…" is a button in the status line for the open object, in the head of the page of objects for every
  object that can be exported, and on each card that has a build of this run, for that object. The sheet is
  modal (`aria-modal`, Tab stays in it, nothing behind it takes a click). `Ctrl+Shift+E` (the row `export` of
  `shared/keys.ts`, heard everywhere, the terminal included) brings it up: for the open object, or from the page
  of objects for any. There is no agent tool for it.
- Its format buttons (`HTML page`, `STEP`, `STL`, `3MF`) choose what is written; the HTML page is the default
  and its sheet is as it was. A file of the model is of one object (the objects are then radio buttons), one
  layout (`defaultLayout`: `assembly` for STEP, `print` for a mesh) and the parts ticked (one, by radio, for an
  STL; a part with no solid cannot be ticked for a mesh), each from the plan's `layoutParts`; a mesh has a
  tolerance and an angle typed in, and Export is off while either is out of its range. A 3MF has "Open it once
  saved", off by default. The window sends names and numbers and never a path; once saved, the sheet says where,
  of which build, and what the read-back checked (`ExportSaved.checked`), every number in the monospace face.
- **The sheet is grouped by who will open the file** (`READERS` in `ui/ExportSheet.tsx`, inside the group "Format"): "A page to
  look at" (HTML page), "The CAD file" (STEP, STL, 3MF), and, only where the sheet is of the open project's view
  (`ofView`: an object on show, not the page of projects), "A picture" (PNG) and "A drawing of a section" (SVG, PDF).
  A picture or a drawing is of the open project as it is on screen: the sheet then shows no list of projects, `ViewChoices`
  in its place (a picture's long edge, `PICTURE_SIZES` 1280 to 4000, "Marks", "Axes and scale bar"; a drawing needs a section on
  screen and says so, with Export off, when there is none). The window draws the picture itself (`pictureForPerson` in
  `state/agent.ts`, the code of `look` with `ImageRequest.person`) and hands main its bytes with the object's id
  (`export.savePicture`); the drawing is made in main (`export.saveSection(id, 'svg' | 'pdf')`, no bytes from the window).
  Main asks where to save, so the window names no path. `person` is set only there: a request of the agent's, which comes
  over `view:look`, is held to 2000 px (`connectLook`). Its saved line offers "Show in folder", never "Open in browser".
