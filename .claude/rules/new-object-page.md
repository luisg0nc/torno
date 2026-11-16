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

- `ui/onboard/NewObject.tsx` is (since piece 3 of the board redesign) a page of slots: the name and "Discard"; "What are we making?" (the description, the photos with their notes);
  a tile per other kind (`Slot.tsx`: Sketch it, Bought parts, Scans, Other projects, Sizes I know, Links and PDFs, Rules), which is its cards or rows once something is
  in it (`SizesSlot.tsx`, `LinksSlot.tsx` with the PDFs, `RulesSlot.tsx`); and, at the right (under it when the page is narrow, a container query), `DraftPaneLive`, the model and effort, **Start: make the
  project and ask Claude** and "Or make it without starting Claude" (`makeObject(..., start = false)`: everything but `objects.onboard`; the window imports each scan of the draft itself, after the project is open and one after the other through `scans.import`, and one that fails does not stop the rest: the failures are said where a prompt that could not be sent is (`onboarding.hold` with no text, the session pane's note)). Drops go by ending (a picture a photo, `.step`/`.stp` a bought part, `.pdf` a PDF,
  a scan format a scan) and a pasted image is taken as a dropped one: only a file with a path can be a photo, a screenshot has none and is told so. `S` (`new.sketch`, not heard in a field) opens the sketch. It is a page in place of the viewport (`store.page`: `'new'`; the view is `covered` and
  inert under it as under the page of objects, and the rail offers Projects alone). No row of the list is
  current (the "New project" button is pressed), and the status line is "New project" and the build123d version alone:
  no Rebuild, revision, parts or Export. The page itself shows `ui/onboard/DraftPane.tsx` (#84; the session pane only says it is there, `data-draft-note`):
  the first prompt Claude Code will get, read-only, as main writes it (`objects.previewPrompt`, asked again 300 ms after a
  change; the one `onboardPrompt` that `objects.onboard` sends), the person's own words in ink and torno's in the muted face,
  and a thumbnail of each photo and doodle with "attached" or "named only"; unless the open object's session is live, which stays whole (see Agents).
  All of it reads `store.page`, and nothing under the page changes, so leaving it brings everything back as it was.
  The page is opened from "New project" at the foot of the list, in the head of the page of objects and in its empty
  state (`openNewObject`). It takes the focus (the name field) when it comes and gives it back to where it was when it goes. Leaving the workspace
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
- **The board** (`Doodle.tsx`, a wrapper over `ui/ink/InkPad.tsx`, which the chat's "Draw on view" uses too) is a sheet over the whole window (#101): a canvas of 1200 x 800 board pixels, scaled to fit the room, with a grid (`grid`: a CSS background every 40 board pixels in `--hairline`, a doodle's only; the PNG has it too, at 15 % grey, and the first prompt says 1 square = 40 px) and Shift while drawing for a straight line (`board.straight`, `straighten` in `strokes.ts`: the stroke is its first point and the pointer), pointer
  events and canvas only (no React state per move). A thin and a thick pen and an eraser; Undo takes the last
  stroke, Clear all of them; Done gives back the strokes and the PNG, Cancel and Esc leave, asking "Discard this
  doodle?" when the strokes are other than it was opened with. Its keys (Esc is `sheet.close`, Ctrl+Z `board.undo`)
  are heard in the capture phase before anything else, so that no tool under the board gets them. The PNG is made
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
