---
paths:
  - "app/src/shared/thumbnail.ts"
  - "app/src/shared/thumbnail.test.ts"
  - "app/src/shared/show.ts"
  - "app/src/main/show/**"
  - "app/src/renderer/ui/ShowPage.tsx"
  - "app/src/renderer/ui/cards.ts"
  - "app/src/renderer/ui/cards.test.ts"
  - "app/src/renderer/state/thumbs.ts"
  - "app/src/renderer/state/thumbs.test.ts"
  - "app/src/renderer/viewport/thumbnail.ts"
  - "app/src/renderer/styles/cards.css"
  - "app/e2e/show.spec.ts"
---

# The page of objects: cards, thumbnails, keys on the page

Moved as written from the folder `CLAUDE.md` files; each heading names the folder it came from, and paths are written as they were there (see "Rules by area" in the root `CLAUDE.md`).

## The page of objects (`app/src/shared`)

- **What a thumbnail is.** The rule is `shared/thumbnail.ts` `thumbnailPlan` (pure, no three.js: main can ask
  it too): the object as it was last looked at, as its `scene.json` has it: its layout when the build still
  has it (else `thumbnailLayout`: `assembly`, or the first), the parts switched on in their colours
  (`shared/palette.ts`), cut by the section kept or drawn apart by the one rule `explodeShown`, never both.
  What would leave it empty is passed over (a part thinned to nothing counts as off; every part off: all are
  drawn, whole; a section that keeps nothing, `shared/cut.ts` `keepsNothing`: none). The drawing is
  `viewport/thumbnail.ts` `ThumbnailMaker`: a scene of its own, into a target of the viewport's renderer,
  which is left as it was found; 480 × 360, the standard iso view in perspective, brought near until the
  parts fill the picture. Parts and edges only: no mark, no scan (a scan may show the real world), no grid, no
  gizmo. The ground is clear (alpha 0) and the part palette is the same in both themes, so one file serves
  both. Parts are built with `buildPart(part, blob, { tree: false })` and disposed of after the frame; the PNG
  is `pngOf` (`viewport/picture.ts`) with the alpha kept.

## The page of objects (`app/src/main`)

- **A card is read, never made** (`shared/show.ts` `ObjectCard`, `src/main/show/cards.ts` `cardsOf`). Asking
  for the cards builds nothing, starts no worker, opens no session and loads no scan: of an object opened in
  this run it says what main knows (its build state, its marks from the store), of any other what the files
  under its `.torno/` say. The marks of an object not opened are read with `peekMarks`, which only reads: no
  file is set aside and nothing is written (the store would do both). `show:changed` tells the window, at most
  once in 200 ms, that a card may say something else: a build state, the marks, a session's status, a picture
  kept, the list of objects read again.
- **No verdict of a build that is not of this run.** `dimensions` (failing, not measured, passing) is only of
  an object opened here whose revision is above 0, counted as the status line counts (`unmetDimensions`,
  `standingOf`). Otherwise it is null, and `lastRun` says how many open dimensions the object has and how many
  failed when they were last measured: told as `1 dimension failed as of its last run`, in no colour of a
  verdict, never as a pass. Likewise the build line: of a build of this run it is in ink behind the status
  line's dot (`buildLine`: `standing`); of an object not opened here it is muted and has no dot, and says
  `Model saved N ago` from `sourcesMtimeMs` (the newest `.py` of the object and `common/`, read from the files
  as `behind` is; absent when it has no model), the plain `Not opened in this run` being its tooltip.
- **Main alone keeps it** (`show/cards.ts` `keepThumbnail`, `saveThumbnail`, `thumbnailOnFile`; `ipc.ts` only
  joins them to the open workspace): `<object>/.torno/thumb.png` and `thumb.json` (`at`, `layout`, `parts`,
  `model`, `sourcesMtimeMs`, `bytes`, `hash`, and `cut`, `apart`, `hidden` when the picture is cut, drawn
  apart or leaves parts out). Only for an object opened in this run whose last good revision is the one the
  window names, and only bytes `thumbnailRefusal` passes: a PNG (signature and `IHDR`) of 480 × 360, at most
  `THUMB_MAX_BYTES` (512 KB). Anything else is dropped. Each file is written atomically and the saves of one
  folder go one after the other; the facts say how many bytes the picture has and their SHA-256, and **a
  picture that is not the one its facts are of is no picture**: `cardsOf` drops it by its size (one `stat`),
  `thumbnailOnFile` by its bytes, and the card then says `No picture yet` and nothing of one.
- With 40 objects, none opened: `show.cards()` takes 3 to 8 ms, and the pictures of the first three rows are
  asked for. A thumbnail of a two-part fixture costs about 7 ms; of a generated part of a million triangles
  (23 MB of meshes) 35 to 90 ms of the window's time (7 to build, 21 to 49 to draw, 6 to 35 to read back).

## The page of objects (`app/src/renderer`)

- `ui/ShowPage.tsx`, over the 3D view (`store.page`: `'object' | 'objects'`; the view stays mounted under it,
  `inert` and not painted, and the open object keeps its selection, camera and note). A workspace of several
  objects, or of none, starts on it; one object alone is shown itself. `W` outside a field or "All projects"
  brings it up (not while a button of the pointer is held: a drag in the view is not over); a card, or Escape,
  leaves it, and what had the focus has it again. "All projects" is the first row of the list while no object is
  open, and beside the list's title while one is (`ofObject` in `ui/ObjectList.tsx`), the page up or not: the one
  control, so the focus it had comes back to it.
- **The keys on the page** are one capture-phase listener. Left alone: what is typed in a field or the
  terminal (`TYPING`), any `input` outside the page (a slider of the left column keeps its arrows), and
  whatever is inside a `[role="dialog"]` or `[role="alertdialog"]`. Everything else is the page's and goes no
  further, so no tool under it is handed a key: arrows from card to card (`ui/cards.ts` `stepCard`), Enter
  opens, `/` or a letter filters by name. **Escape goes to what is on top**: a sheet or a confirm that is
  there to be seen (not one of the view put away under the page) gets it first, as if pressed there; then the
  filter is emptied; then the page goes. A sheet opened over the page (the export's) needs one of those two
  roles and nothing more.
- **No build is ever started for a picture.** A thumbnail is made by the window when a build of an object
  opened in this run lands (`state/thumbs.ts` `connectThumbs`): one at a time, in an idle callback, the latest
  build of each object only, one sent again as it was passed over. It subscribes to nothing: the viewport's
  one handler of `object.onScene` (`ViewportPane.tsx`) hands it each message (`landed`), so a build's meshes
  cross the bridge once, and are held only until the picture is drawn. An object not built in this run keeps
  the picture it has on file, or has none and says `No picture yet`.
- **A card says how far its picture can be trusted** (`ui/cards.ts`): when it was made (with the year when
  that is not this one); what it draws otherwise than the object is (`cut by its section`, `parts drawn
  apart`, `1 part left out`); and `A source has changed since` (`thumbOf`: `behind`). The sources of an object
  are what a change in has it built again (`Builds.open`): the `.py` files directly in its folder and in
  `<workspace>/common` (`sourceFolders`, `newestPython`; the kernel does not say which files a model read, so
  there is nothing finer). `sourcesMtimeMs` is the newest of them when the picture was kept, and no later
  than when that build was started, so a source saved during the build is newer than its picture; a card is
  behind when the newest now is newer, when either cannot be said, or when the model is another file. When
  the last build failed the status says so in `--fail`, the picture is dimmed and is said to be `of the last
  build that worked`. A picture is asked of main only once its card is in view or near it
  (IntersectionObserver).
