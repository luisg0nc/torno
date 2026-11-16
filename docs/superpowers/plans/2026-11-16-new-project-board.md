# A new project starts as a board: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** "New project" becomes a page of slots (brief, photos, sketches, bought parts, scans, other projects, sizes,
rules, links and PDFs). **Start** makes the project with its board already laid out, then asks Claude.

**Architecture:**
- The draft stays in the window (`state/onboard.ts`) and goes whole to `objects:create`. `create.ts` also copies PDFs and
  writes `.torno/board/board.json` inside the hidden folder, before the rename.
- A new card kind, `size`, lives on every board, for the person and for Claude.
- STEP and PDF files in `reference/` become reference cards too.
- The first prompt says the sizes, rules and links, and is sent with the board counted as already told.

**Tech stack:** Electron, TypeScript, React, vitest, Playwright (hidden window).

**Spec:** `docs/superpowers/specs/2026-11-16-new-project-board-design.md`

## Global Constraints

- Nothing is written in the workspace until Start or "make it without starting Claude". The folder is whole or not
  there: everything, the board included, is made in `.<name>.torno-new-<random>` and renamed in as the last step.
- Main is the only writer of `board.json` and the only giver of `C<n>` ids, `by` and `hidden`.
- Caps:
  - 40 sizes; `what` at most 200 characters, `value` at most 60
  - rules at most 4000 characters
  - 20 links; URL at most 2000 characters, `http`/`https` only; one-line note at most 300 characters
  - 6 PDFs, each at most 25 MB, starting `%PDF-`
- Size units: `mm` (default) or `°`. Sources: `measured`, `from a manual or datasheet`, `a guess`, `from Claude` (the
  last only on Claude's cards), with an optional note.
- Images for the agent: long edge at most 2000 px, default 1280; at most 6 pictures in the first prompt (`MOST_IMAGES`).
- UI text is sentence case; numbers and refs in the monospace face; colours from `styles/tokens.css` only.
- Tests never open a visible window (`TORNO_TEST=1`), never call `page.screenshot()`, never use the clipboard, and
  never run the real `claude` (the stand-in is `app/test/fake-agent.mjs`).
- Commits carry no Claude attribution (Luis's rule, which overrides the repo CLAUDE.md's trailer).
- Read the `.claude/rules/` files whose `paths:` cover a file before you change it: `board.md`,
  `new-object-create.md`, `new-object-onboard.md`, `new-object-page.md`, `keys.md`, `workspace-writes.md`.

## Review Focus

1. A size typed the Portuguese way (`62,5`, `186 x 128`, `Ø62`) parses like `62.5`, `186 × 128` and `Ø 62`. Text that
   doesn't parse (`about 60`) is kept as typed and told as typed. (Task 1)
2. Opening a project made by Start for the first time changes nothing on its board: no duplicate reference, brief or
   frame cards. (Task 3)
3. A link with `javascript:`, `file:` or no scheme is refused at create and is never opened by `board:openLink`. (Tasks 2, 3)
4. A sketch drawn over a photo that is then removed from the draft keeps its PNG, and its caption names no missing
   file. (Task 5)
5. A PDF given as a link, a folder, a file over 25 MB, or a file not starting `%PDF-` is refused before the hidden
   folder is made. (Task 3)

---

### Task 1: The size card kind

**Files:**
- Create: `app/src/shared/size.ts`, `app/src/shared/size.test.ts`
- Modify: `app/src/shared/board.ts` (add `'size'` to `CardKind` and `MADE_KINDS`; `Card.size?: SizeFact`; `PersonChange`
  edit gains `size?: SizeFact`), `app/src/main/board/file.ts` (`sanitiseCard` keeps a valid `size` only on
  `kind: 'size'`), `app/src/main/board/store.ts` (add and edit of size cards, undo as for text),
  `app/src/main/board/text.ts` (the said form), `app/src/main/board/sources.ts` (`CARD_SIZE.size`),
  `app/src/main/mcp/schemas.ts` and `boardTools.ts` (`add_card` takes `size`), plus `e2e/mcp.spec.ts` if the tool's
  schema is listed there
- Test: `size.test.ts`, `main/board/file.test.ts`, `store.test.ts`, `text.test.ts`, `mcp/tools.test.ts`

**Interfaces (produces):**
- `type SizeSource = 'measured' | 'from a manual or datasheet' | 'a guess' | 'from Claude'`
- `interface SizeFact { what: string; value: string; unit: 'mm' | '°'; source: SizeSource; note?: string }`
- `parseSize(value: string): { mark?: 'Ø' | 'R'; numbers: number[] } | null`: one to three numbers joined by `x` or `×`,
  with `,` or `.` for decimals and an optional leading `Ø` or `R`
- `saySize(s: SizeFact): string`, e.g. `battery tray 186 × 128 mm (measured)` or
  `snorkel hole Ø 62 mm (from a manual or datasheet: the manual)`. Unparsed text is said as `about 60 mm (as typed, a guess)`.
- `checkSize(raw: unknown, by: 'person' | 'agent'): SizeFact | string`: returns the fact or the reason it was refused,
  with the caps from Global Constraints. `from Claude` is allowed only for `by: 'agent'`, and is the only source an
  agent may give.
- `MAX_SIZES = 40`, `MAX_SIZE_WHAT = 200`, `MAX_SIZE_VALUE = 60`

- [ ] **Step 1:** Tests in `size.test.ts`:
  - `parseSize('186 × 128')`, `'186x128'` and `'186 x 128'` all give `{ numbers: [186, 128] }`
  - `parseSize('62,5')` gives `{ numbers: [62.5] }`
  - `parseSize('Ø62')` and `'Ø 62'` give `{ mark: 'Ø', numbers: [62] }`
  - `parseSize('about 60')` gives `null`
  - `parseSize('1 x 2 x 3 x 4')` gives `null`
  - `saySize` for both examples above and for an unparsed value
  - `checkSize` refuses `what` of 201 characters, `value` of 61, unit `cm`, `from Claude` for the person, and any source
    other than `from Claude` for the agent

- [ ] **Step 2:** Tests in `file.test.ts`, `store.test.ts` and `text.test.ts`:
  - a `size` field on a text card is dropped by `sanitiseCard`
  - a person's size card added, edited (`{ op: 'edit', id, size }`) and undone
  - the agent cannot edit or remove the person's size card
  - `boardText` says `C<n> · size · by the person: battery tray 186 × 128 mm (measured)`
  - the `board` tool's answer for a size card holds `numbers: [186, 128]`

- [ ] **Step 3:** Test in `mcp/tools.test.ts`: `add_card` with `size: { what, value, unit }` makes a size card, `by:
  'agent'`, with source `from Claude`. With both `size` and `text` it is refused.

- [ ] **Step 4:** Run the focused tests and watch them fail. Implement. Run them again and watch them pass.
  `pnpm -C app exec vitest run src/shared/size.test.ts src/main/board src/main/mcp/tools.test.ts`

- [ ] **Step 5:** Run `pnpm test` and `pnpm -C app typecheck`, then commit: "Sizes are a kind of card: what, a value
  as typed, a unit and where it came from".

### Task 2: Reference cards for STEP and PDF files, and opening a link

**Files:**
- Modify:
  - `app/src/main/sessions/reference.ts`: add `listBoardReferences(dir): string[]`, the image references of
    `listReferences` followed by the plain files of `reference/` ending `.step`, `.stp` or `.pdf`. `listReferences`
    itself and `REFERENCE_FILE` stay as they are, since the chat's pictures use them.
  - `app/src/main/board/follow.ts`: uses `listBoardReferences`.
  - `app/src/main/board/ipc.ts`: `board:open` accepts those files and shows them in their folder; add
    `board:openLink(objectId, cardId)`.
  - `app/src/main/board/text.ts`: a non-image reference is said as `C<n> · reference · by torno / reference/608zz.step
    (a bought part's STEP)` or `(a PDF: read it with your own tools)`, with its caption.
  - `app/src/shared/bridge.ts`, `app/src/preload/index.ts`: add the `openLink` bridge.
  - `app/src/renderer/ui/projectBoard/Cards.tsx`: a file reference card shows its name and kind. A text card with a URL
    shows the URL as a link that calls `openLink`.
- Test: `main/sessions/reference.test.ts` (or the file that holds `listReferences` tests), `main/board/ipc.test.ts`,
  `text.test.ts`, `main/board/follow.test.ts`

**Interfaces (produces):**
- `listBoardReferences(dir: string): string[]`
- `firstLink(text: string): string | null`, in `shared/board.ts`: the first `https?://` URL in the text, up to the next
  whitespace, at most 2000 characters
- bridge `board.openLink(objectId: string, cardId: string): Promise<void>`. Main reads the card from its own store and
  calls `shell.openExternal(firstLink(card.text))`, `http`/`https` only, through an injectable `deps.openExternal`.

- [ ] **Step 1:** Tests:
  - a project with `reference/608zz.step` and `reference/datasheet.pdf` gets two reference cards on reconcile
  - a link named `x.pdf` in `reference/` is not listed
  - `board:open` of the PDF reveals it in its folder
  - `board:openLink` on a text card holding `see https://example.com/a b` opens `https://example.com/a`
  - `board:openLink` on a card holding `javascript:alert(1)` or `file:///etc/passwd` opens nothing and rejects
  - `board:openLink` on an unknown card id rejects
- [ ] **Step 2:** Implement, then run the focused tests.
- [ ] **Step 3:** Run `pnpm test` and typecheck, then commit: "STEP and PDF files in reference/ are cards on the board,
  and a link on a text card opens in the browser".

### Task 3: Create writes the board

**Files:**
- Create: `app/src/main/board/start.ts`, `app/src/main/board/start.test.ts`
- Modify:
  - `app/src/shared/bridge.ts`: `CreateRequest` gains:
    - `sizes: SizeFact[]`
    - `rules: string`
    - `links: Array<{ url: string; note: string }>`
    - `pdfs: Array<{ path: string; note: string }>`
    - `doodles[i].over?: number`, the index into `photos` of the photo it is drawn over
  - `app/src/main/objects/create.ts`:
    - checks the new fields before the hidden folder is made (`over` must index an existing photo)
    - copies PDFs as `reference/<name>.pdf` through `readRegular` with a `%PDF-` check
    - the brief's doodle line says `drawn over reference/photo-<n>.<ext>`
    - writes the board with `startBoard` into the hidden folder: `.torno/board/board.json`, the `.gitignore` files piece
      2's store writes (`.torno/.gitignore` for `told.json`, `board/pictures/.gitignore` of `*`), and nothing else
  - `app/src/shared/objectName.ts`: `MOST_REFERENCES` gains `pdfs: 6`. `stepFiles` is generalised to
    `referenceFiles(names, endings)`, with `stepFiles` kept as a wrapper. Add `MAX_PDF_BYTES = 25 * 1024 * 1024`.
  - `app/src/main/ipc.ts`: `objects:pickPdf`, whose paths go into `Offered`; test hook `__tornoMain.pickPdf`.
  - preload and bridge for `pickPdf`.
- Test: `start.test.ts`, `main/objects/create.test.ts`, `e2e/objects-create.spec.ts`

**Interfaces:**
- Consumes: `SizeFact` and `checkSize` (Task 1); `reconcile` and `Found` (piece 2, `board/sources.ts`); `firstLink`
  (Task 2) for the link check
- Produces: `startBoard(req: { description: string; references: Array<{ file: string; note: string }>; sizes:
  SizeFact[]; rules: string; links: Array<{ url: string; note: string }> }): BoardFile`
  - Frames are made, in this order, only when they hold something: "Brief", "Photos", "Sketches", "Sizes", "Rules",
    "Links", "Bought parts", "PDFs".
  - Frames are laid left to right, wrapping at a width of 3200, using piece 2's card sizes and a 40 gap.
  - The brief and reference cards are `by: 'torno'` with `source` as reconcile names them, and `caption` set to the note.
  - Frames, size cards, the Rules text card and the link text cards (`<url>` then the note on the next line) are
    `by: 'person'`.
  - Ids `C1`, `C2` and so on; `next` above the last.

- [ ] **Step 1:** Tests in `start.test.ts`:
  - frames and cards for a full request, with each card's `frame` set
  - empty parts make no frame
  - `reconcile(startBoard(req), found)` returns `null` (Review Focus 2), where `found` is what `follow.ts` would find in
    the made folder: brief true and the references by file
  - captions equal the notes
- [ ] **Step 2:** Tests in `create.test.ts`:
  - the board file exists in the made folder and is valid for `readBoardFile`
  - the PDF is copied
  - refused before the temp folder: a link to a PDF, a folder, 25 MB + 1, bytes not starting `%PDF-`, 7 PDFs, a
    `javascript:` link, a 21st link, a 41st size, rules of 4001 characters, `over` out of range (Review Focus 3 and 5)
  - a failure while writing the board removes the temp folder
- [ ] **Step 3:** Implement, then run `pnpm -C app exec vitest run src/main/board/start.test.ts src/main/objects`.
- [ ] **Step 4:** Update the e2e test `objects-create.spec.ts`: create with a size and a PDF, then check that
  `board.json` has frames "Sizes" and "PDFs". Run it after `pnpm -C app build`.
- [ ] **Step 5:** Run `pnpm test` and typecheck, then commit: "Making a project writes its board: frames for what the
  person gave, and PDFs into reference/".

### Task 4: The first prompt

**Files:**
- Modify:
  - `app/src/shared/bridge.ts`: `OnboardDraft` and `PromptPreviewDraft` gain `sizes`, `rules`, `links` and `pdfs`
    (`{ file, note }`). `items` notes for a doodle drawn over a photo say so.
  - `app/src/main/onboard.ts`: `onboardPrompt` adds, after the references:
    - "Sizes the person gave:", one `saySize` line each
    - "Rules:", the text
    - "Links (torno does not open links; read one only if it helps):", one per line
    - each PDF as `- reference/<file>: <note>. A PDF; read it with your own tools if it helps.`
  - The numbered steps: step 1 lists the sizes that decide fit or function and marks those the person gave. Step 2
    asks only for sizes with no source.
  - `objects:onboard`: before `Sessions.prompt`, calls `BoardStore.markAllTold(objectId)`.
  - `app/src/main/board/store.ts`: `markAllTold(objectId): Promise<void>` keeps `saysHash` of every card and arrow as
    told, in the board's turn.
  - `app/resources/agent-plugin/skills/torno-model/SKILL.md`, "Before the first model": sizes the person gave, on the
    board or in the prompt, are not asked again.
- Test: `main/onboard.test.ts`, `main/onboard.itest.ts`, `prompt.test.ts` if it holds the skill text, `store.test.ts`

- [ ] **Step 1:** Tests:
  - the prompt text for a draft with two sizes, rules, a link and a PDF holds each line
  - step 2 says it asks only for sizes with no source
  - every tool name the prompt uses is a key of `TOOLS` (the existing test still passes)
  - the itest's first prompt's board line reads `Board: N cards` with no "new"
  - `markAllTold` followed by `boardText` says nothing is new
- [ ] **Step 2:** Implement, then run `pnpm -C app exec vitest run src/main/onboard.test.ts` and `pnpm -C app exec
  vitest run --mode kernel src/main/onboard.itest.ts`.
- [ ] **Step 3:** Run `pnpm test` and typecheck, then commit: "The first prompt says the sizes, rules, links and PDFs
  the person gave, and asks only for the sizes still missing".

### Task 5: A sketch over a photo

**Files:**
- Modify:
  - `app/src/renderer/ui/ink/InkPad.tsx`: an optional `background?: ImageBitmap | HTMLImageElement`, drawn fitted to
    the 1200 × 800 sheet under the ink, with no grid when it is set.
  - `app/src/renderer/ui/ink/strokes.ts`: the PNG export draws the background first, then the ink.
  - `app/src/renderer/ui/onboard/Doodle.tsx`: a "Draw over" choice of the draft's photos.
  - `app/src/renderer/state/onboard.ts`: `DoodleDraft.over?: string`, the id of the photo draft. Removing that photo
    clears `over` and keeps the PNG.
  - `app/src/renderer/ui/onboard/make.ts`: sends `over` as the photo's index in `CreateRequest.doodles`.
- Test: `renderer/ui/ink/strokes.test.ts`, `renderer/state/onboard.test.ts`, `renderer/ui/onboard/make.test.ts`

- [ ] **Step 1:** Tests:
  - the PNG of a sketch with a background has the background's pixel at a spot with no ink, and ink over it
  - removing the photo clears `over` and keeps the doodle (Review Focus 4)
  - `makeObject` sends `over: 1` for a doodle over the second photo
- [ ] **Step 2:** Implement, then run the focused tests.
- [ ] **Step 3:** Run `pnpm test` and typecheck, then commit: "A sketch can be drawn over one of the draft's photos".

### Task 6: The page of slots

**Files:**
- Modify:
  - `app/src/renderer/ui/onboard/NewObject.tsx`: rebuilt as the slots of `New A` on the same store.
  - `app/src/renderer/ui/onboard/ReferenceItems.tsx`
  - `app/src/renderer/ui/onboard/DraftPane.tsx`: the preview sends the new fields.
  - `app/src/renderer/state/onboard.ts`: `Draft` gains `sizes`, `rules`, `links` and `pdfs` (with `Kind` and the caps),
    `draftHas` counts them, and the discard question asks about them.
  - `app/src/renderer/styles/onboard.css`
  - `app/src/shared/keys.ts`: row `new.sketch`, key `S`, scope `newobject`, not heard in a field.
  - `app/src/renderer/ui/onboard/make.ts`: sends the new fields to `create` and `onboard`. "Make it without starting
    Claude" calls everything but `objects.onboard`.
  - `docs/manual.md`: the keys table, rewritten with `TORNO_README=write`.
- Create: `app/src/renderer/ui/onboard/SizesSlot.tsx`, `RulesSlot.tsx`, `LinksSlot.tsx` (the PDFs are listed with the
  links).
- Test: `renderer/state/onboard.test.ts`, `make.test.ts`, `e2e/onboard.spec.ts`, `e2e/themes.spec.ts`

What the page has (the look is the builder's, within the mockup and the tokens):
- Name and Discard at the top.
- "What are we making?" with the description and the photo cards with their notes.
- A row of tiles: Sketch it, Bought parts, Scans, Other projects, Sizes I know, Links and PDFs, Rules. A filled slot
  shows its items; an empty one is a tile.
- Drop anywhere: images become photos, `.step`/`.stp` bought parts, `.pdf` PDFs. Paste an image as a photo.
- The right pane: `DraftPane`, then the model and effort choice, then **Start: make the project and ask Claude** and
  "or make it without starting Claude".

- [ ] **Step 1:** Tests:
  - the draft caps: a 41st size, a 21st link, a 7th PDF and rules over 4000 characters are refused with their reason
  - `draftHas` is true with only a size
  - "make it without starting Claude" never calls `onboard`
- [ ] **Step 2:** Update `e2e/onboard.spec.ts`:
  - fill a size, rules, a link and a PDF (`__tornoMain.pickPdf`)
  - the preview shows the size line
  - Start, then check the project opens on its board with the frames
  - pressing `S` opens the sketch
  - the existing onboard specs still pass
- [ ] **Step 3:** In `themes.spec.ts`, the `onboard` page is still checked in both themes.
- [ ] **Step 4:** Implement, then run the focused tests and the onboard e2e tests (after `pnpm -C app build`).
- [ ] **Step 5:** Run `pnpm test` and typecheck, then commit: "A new project is a page of slots: the brief, photos,
  sketches, parts, scans, projects, sizes, rules, links and PDFs".

### Task 7: Size cards on the board in the window, docs, and all suites

**Files:**
- Modify:
  - `app/src/renderer/ui/projectBoard/Palette.tsx`: a size tool.
  - `Cards.tsx`: the size card shows value and unit in monospace, then what it measures and the source.
  - `Editor.tsx`: edits a size with the fields of `SizeFact` and `maxLength` from the caps.
  - `ops.ts`: undo, as for text.
  - `.claude/rules/board.md`, `new-object-create.md`, `new-object-page.md`, `new-object-onboard.md`,
    `workspace-writes.md` (the first exception now names `.torno/board/` and PDFs).
  - `docs/manual.md`: the new-project section, the Board section on sizes and file cards, and the section on what was
    never seen on a screen.
- Test: `e2e/board.spec.ts`, plus fixing any spec that lists `.torno` contents or the keys

- [ ] **Step 1:** e2e in `board.spec.ts`: add a size card with the palette, edit its value, undo, and check
  `board.json`.
- [ ] **Step 2:** Implement and update the docs. Run `TORNO_README=write pnpm -C app exec vitest run src/readme.test.ts`
  if the keys changed.
- [ ] **Step 3:** Run all four suites and typecheck from the repo root: `pnpm test`, `pnpm test:kernel`, `(cd kernel &&
  uv run pytest -q)` (only if `kernel/.venv` exists), `pnpm test:e2e`, `pnpm -C app typecheck`. Report the counts.
- [ ] **Step 4:** Commit: "Size cards can be made and edited on any board, and the manual and rules say piece 3".
