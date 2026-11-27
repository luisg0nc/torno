---
paths:
  - "app/src/renderer/ui/onboard/**"
  - "app/src/renderer/ui/ink/**"
  - "app/src/renderer/state/onboard.ts"
  - "app/src/renderer/state/onboard.test.ts"
  - "app/src/renderer/styles/onboard.css"
  - "app/e2e/onboard.spec.ts"
---

# The page of a new object, the draft, the board

Moved as written from the folder `CLAUDE.md` files; each heading names the folder it came from, and paths are written as they were there (see "Rules by area" in the root `CLAUDE.md`).

## A new object (`app/src/renderer`)

- `ui/onboard/NewObject.tsx` is (since Task 39 of the UI redesign) the brief on paper beside a dyed plate: a grid of the paper at the left (`.new-column`, its own scroll, on `--surface`) and `DraftPaneLive` at the right (540 px, `minmax(400px, 540px)`; `--dye`). The paper holds "New project. Nothing is written until you start." and "Discard"; the name as `<folder> / <name>` at 40 px (the folder muted, the input ink, the label "Name" visually hidden; the rule "The folder's name: letters, digits, − and _."); "What are we making?" with the box (`aria-label` "What is it?"); the tiles of what was given (`ReferenceCards` with `tail`: photos, doodles, bought parts, scans, projects; each `.ref-card` is a tile with its name in mono and its note) followed by the dashed `PicTile`s **Sketch it** (`new.sketch`, `S`) and **Drop anything** (photo picker; drops and pastes take every kind); "Also: Bought part, Scan, Other project, Link or PDF" (the first three open their pickers as the old tiles did, the last opens the Links and PDFs card); and `Slot.tsx` cards: **Sizes I know** (`SizesSlot`, "Add a size", always there), **Rules** (`RulesSlot`, always there) and **Links and PDFs** (`LinksSlot` with the PDF cards, there once opened or given). Nothing of the slots' contents or rules changed. The dock is hidden while the page is up (`App.tsx`: `dockOpen && page !== 'new'`; the stored `dockOpen` is untouched and the dock comes back as it was), because the draft pane is the preview. The side is `DraftPane` (`data-plate`): "What Claude gets first", "Written from this page as you add to it.", the prompt (`promptStretches`: the person's words in `--on-dye`, torno's in `--on-dye-muted`, references and "attached: picture N" as outlined chips, the lines under "Sizes the person gave:" in mono), the pictures, and the foot: `.new-will` ("Makes `parts/cable-clip/` with `cable_clip.py` (a placeholder to be replaced), `brief.md` and `reference/`", or what is missing; `Make`), then `children`: what torno lacks (`Readiness` `missing`, on a `--raise` sheet), the model and effort (`SessionChoice`, `--raise` at 12 % over the dye, `--on-dye` text, the label "Claude Code on" hidden visually), **Start: make the project and ask Claude** (`--raise` ground, accent text, 44 px) and "Or make it without starting Claude" (`makeObject(..., start = false)`: everything but `objects.onboard`; the window imports each scan of the draft itself, after the project is open and one after the other through `scans.import`, and one that fails does not stop the rest: the failures are said where a prompt that could not be sent is (`onboarding.hold` with no text, the session pane's note)). `create` takes its deps from `liveMakeDeps`. Drops go by ending (a picture a photo, `.step`/`.stp` a bought part, `.pdf` a PDF,
  a scan format a scan) and a pasted image is taken as a dropped one: a file with a path is a photo copied from it, a screenshot has none and is kept as the bytes the window scaled (`PhotoDraft.pasted`, empty `path`; `CreateRequest.photos[i].png`, which main writes as `photo-<n>.png` with the checks of a doodle's PNG, `checkedPng`), one too heavy to stay a PNG being told to be saved as a file; a dropped file with no path is still refused. `S` (`new.sketch`, not heard in a field) opens the doodle. It is a page in place of the viewport (`store.page`: `'new'`; the view is `covered` and
  inert under it as under the page of objects, and the card is away). No row of the list is
  current (the "New project" button is pressed), and the status line is "New project" and the build123d version alone:
  no Rebuild, revision, parts or Export. The page itself shows `ui/onboard/DraftPane.tsx` (#84):
  the first prompt Claude Code will get, read-only, as main writes it (`objects.previewPrompt`, asked again 300 ms after a
  change; the one `onboardPrompt` that `objects.onboard` sends), the person's own words in `--on-dye` and torno's in `--on-dye-muted`,
  and a thumbnail of each photo and doodle with "attached" or "named only". A live session of the open object goes on behind the page, in the hidden dock.
  All of it reads `store.page`, and nothing under the page changes, so leaving it brings everything back as it was.
  The page is opened from "New project" at the foot of the list, in the head of the page of objects and from the empty folder's
  composer, which hands it the words and the folder name it offered (`openNewObject({ words, name })`). It takes the focus (the name field) when it comes and gives it back to where it was when it goes. Leaving the workspace
  (opening another folder) asks when the draft has something: "A new project is set up here and not made yet".
- **The draft** (`state/onboard.ts`) also holds `sizes` (rows that may be unwhole: `sizeProblem`; Start and `makeObject` refuse one), `rules`, `links` and `pdfs`, with the caps of `shared/size.ts`, `shared/objectName.ts` (`MAX_LINKS`, `linkProblem`) and `MAX_TEXT_CHARS`; the `add*` and `setRules` return the reason they refused, or null.
- **The draft** (`state/onboard.ts`) lives in the window, for the workspace it was begun in, until the object is made
  or the person throws it away; nothing of it is on disk, and it is dropped when the workspace root changes. Caps
  are `MOST_REFERENCES` (shared with main), a photo or scan is refused as a duplicate by path and an object by id.
  A bought part (`steps`: a vendor's STEP file, by path; a dropped `.step`/`.stp`, 50 MB at most) is named in the preview and the prompt by the `reference/` file `stepFiles` gives it (`make.ts` `stepReferences`). A doodle keeps its strokes as vectors as well as its PNG, so that it is opened again to change. `epoch()` goes up
  at each discard: photos being read when the draft was thrown away are not put back. The held first prompt
  (`hold/take/dismiss`) is in the same store.
- **Keys** are rows of `shared/keys.ts`: `new.back` (Esc) in the scope `newobject`, and the board's `board.undo` (Ctrl+Z) in the scope `sheet`. The
  page listens in the capture phase and takes every key not meant for a field, so no tool of the view is handed
  one. In a field Esc leaves the field (the keys go back to the page) when the draft has something, and the page
  when it has not; elsewhere it leaves the page, asking first ("Discard this new project?") when there is something in
  it. A sheet or question asked over the page (the sheet of keys, the closing question) keeps its own keys.
  `export` and `rebuild` keys do nothing on this page.
- **Images are scaled in the window** (`images.ts`): the window decodes (WebP too), scales to a long edge of 1280
  px (a PNG stays PNG, anything else becomes JPEG at 0.85; a PNG already within 1280 px and 3.75 MB goes as is, a
  heavier one goes as a JPEG) and
  hands main the bytes. The header is read before anything is decoded (`headerSize`: PNG, JPEG, WebP): over 50
  megapixels is refused with its reason on the card, and a HEIC is refused with how to get a JPEG (`HEIC_REASON`). Main reads a chosen photo through `objects.readPhoto`, which serves only the paths its
  dialog offered; a dropped file is read by the window (`File.arrayBuffer`, at most 25 MB, checked before it is
  read) and its path comes from `objects.pathOf`. The copy in `reference/` is the original; the scaled picture is
  only the prompt's.
- **The board** (`Doodle.tsx`, a wrapper over `ui/ink/InkPad.tsx`, which the chat's "Draw on view" uses too) is a sheet over the whole window below the title bar (#101): a canvas of 1200 x 800 board pixels, scaled to fit the room, with a grid (`grid`: a CSS background every 40 board pixels in `--hairline`, a doodle's only; the PNG has it too, at 15 % grey, and the first prompt says 1 square = 40 px) and Shift while drawing for a straight line (`board.straight`, `straighten` in `strokes.ts`: the stroke is its first point and the pointer), pointer
  events and canvas only (no React state per move). A thin and a thick pen and an eraser; Undo takes the last
  stroke, Clear all of them; Done gives back the strokes and the PNG, Cancel and Esc leave, asking "Discard this
  doodle?" when the strokes are other than it was opened with, or the photo it is drawn over is (`InkPad`'s `changed`). Its keys (Esc is `sheet.close`, Ctrl+Z `board.undo`)
  are heard in the capture phase before anything else, so that no tool under the board gets them (but an Escape in a menu of the title bar
  is the menu's, see `session-pane`). The PNG is made
  by `strokes.ts` with a white ground and dark ink whatever the theme: what is drawn on screen follows the theme,
  what Claude receives does not (`PNG_GROUND`). A doodle can be drawn over one of the draft's photos
  ("Draw over", `InkPad`'s `background`): the photo is fitted whole on the white ground (`fitBackground`, letterboxed), there is
  no grid, the ink is the PNG's own on screen too, and the PNG is the photo plus the ink at 1200 x 800 (`doodlePng`'s `background`).
  `DoodleDraft.over` is the photo draft's `uid`; removing that photo clears it, sets `onPhoto` and keeps the doodle and its PNG (the photo is still under the ink). `makeObject`
  sends it as the photo's index (`CreateRequest.doodles[i].over`), or `onPhoto: true` when the photo is gone, and the doodle's note for
  the prompt and the preview says "(drawn over reference/photo-N.ext)", or "(drawn over a photo)" with no file named, the words `create`
  puts on its card. Drawing the doodle again drops `onPhoto`: it is the new item's.
- **The model and effort** of the new object's session are chosen beside Create (`ui/onboard/SessionChoice.tsx`,
  "Claude Code on"): "Your default model" and "Your default effort" pass nothing. The models are `chat.models()` (the
  last chat's list, or Claude Code's aliases), the CLI's own `default` row left out as the default is; the efforts
  `effortsOf` the model chosen (the `default` row's for the default), and an effort the model does not take is let
  go. The choice is `onboard.choice`, the person's, kept when a draft is spent or thrown away, and goes to
  `makeObject` and on to `objects.onboard` as `choice` (only when something is chosen).
- Styles are `styles/onboard.css`, on the tokens only; the page and the board are in `e2e/themes.spec.ts` as
  `onboard` and `onboard-board` in both themes.
