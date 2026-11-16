# View notes: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** "Draw on view" makes a view note: a mark of kind `note` holding a picture of the view with ink, labels with
arrows, a comment and reference images. It goes to Claude with the next prompt, Claude resolves it, and it stays on the
board.

**Architecture:**
- A new mark kind in `shared/marks.ts`, stored by `MarkStore` in `marks.json`.
- Its pictures live in `.torno/notes/`, which git ignores, written by main through new IPC calls (`notes:make`,
  `notes:edit`).
- Hooks carry text only, so `Sessions.sendOne` attaches the draft notes' pictures to the prompt's content blocks, as it
  attaches the drawing today. The marks lines in the hook context say the notes' text.
- The old one-shot drawing path (`ViewDrawing` on `chat:send`) goes.

**Tech stack:** Electron, TypeScript, React, three.js, vitest, Playwright (hidden window).

**Spec:** `docs/superpowers/specs/2026-11-16-view-notes-design.md`

## Global Constraints

- Main is the only writer of `marks.json`: one change at a time, written atomically. `MAIN_ONLY_KEYS` are never taken
  from the window or a tool. Main names every file in `.torno/notes/`, and the window never names one.
- Caps per note:
  - at most 20 labels; label text at most 200 characters, one line
  - at most 6 references; reference comment at most 300 characters, one line
  - the overall comment uses the mark `note` field's existing cap
  - today's `drawingOf` caps (`MOST_STROKES_TOLD`, `MOST_REFS_TOLD`, `MOST_CUTS_TOLD`, `MOST_SCANS_TOLD`) apply per note
- File names in `.torno/notes/`: `n-<12 hex>.png` (plain view), `n-<12 hex>.ink.png` (inked), `r-<12 hex>.<png|jpg>`
  (reference). The folder has a `.gitignore` of `*`.
- Images for the agent: long edge at most 2000 px, default 1280. At most 6 pictures in one prompt, in this order: the
  attached view, then each note in mark order, each followed by its references. A picture past the cap is named in the
  text, not attached.
- What the ink lies over is told by ref with the kernel's line, never a coordinate or a pixel. No picture data goes in
  `marks.json`, `.torno/chat/` or the log.
- Claude can only resolve a note (`resolve_mark`). `add_mark` refuses `kind: 'note'`. Claude can't edit or delete a
  person's note.
- UI text in sentence case; numbers and refs in the monospace face; colours from tokens only.
- Tests never open a visible window, never call `page.screenshot()`, never use the clipboard, and never run the real
  `claude`.
- No Claude attribution on commits.
- Read the `.claude/rules/` files whose `paths:` cover what you change (`drawing-on-view.md`, `marks-store.md`,
  `marks-window.md`, `board.md`, `mcp-tools.md`, `chat-pane.md`, `keys.md`) before changing it.

## Review Focus

1. A note sent on one computer and opened on another, where `.torno/notes/` is empty: it shows and sends as data
   ("picture not on this computer"), and the comment and references stay editable. (Tasks 1, 4, 6)
2. A note whose faces are gone after a rebuild: the anchor goes orphaned like a mark's, `under` is still told "of build
   N", and hover lights only refs that still exist. (Tasks 1, 7)
3. Three draft notes with 3 references each: exactly 6 pictures go, in the stated order, and the rest are named.
   (Task 4)
4. The window sends a file name, an id, `by`, `status` or `sentBefore` inside `notes:make`/`notes:edit`: all of it is
   ignored or refused. (Task 2)
5. A chat log written before this change, holding a `drawing` item, still renders. (Task 4)

---

### Task 1: The note mark and its store

**Files:**
- Modify:
  - `app/src/shared/marks.ts`:
    - add `NoteMark` to `Mark`
    - `markAnchors` returns its anchor
    - `isUnchecked` treats it like a pick
  - `app/src/main/marks/file.ts` (the sanitiser)
  - `app/src/main/marks/store.ts`: `addNote` and `editNote`, plus `remove`/`restore` for notes
  - `app/src/main/marks/reanchor.ts`, if notes need a case
  - `app/src/main/marks/describe.ts`: what a note says
- Create: `app/src/main/notes/files.ts`
- Test: `shared/marks.test.ts`, `main/marks/file.test.ts`, `store.test.ts`, `describe.test.ts`, `main/notes/files.test.ts`

**Interfaces (produces):**
- `interface NoteLabel { x: number; y: number; text: string; to?: { x: number; y: number } }`
- `interface NoteReference { file: string; comment: string }`
- `interface NoteMark extends MarkBase`, with:
  - `kind: 'note'`
  - `anchor?: Anchor`
  - `picture: string`
  - `ink: string` (the inked file)
  - `size: { w: number; h: number }`
  - `strokes: Array<{ width: number; points: Array<[number, number]> }>`
  - `inkColour: string`
  - `labels: NoteLabel[]`
  - `under: StrokeUnder[]`: one per stroke, then one per label arrow
  - `references: NoteReference[]`
- Caps: `MOST_LABELS = 20`, `MAX_LABEL = 200`, `MOST_NOTE_REFERENCES = 6`, `MAX_REFERENCE_COMMENT = 300`
- `NOTE_PICTURE = /^n-[0-9a-f]{12}\.png$/`, `NOTE_INK = /^n-[0-9a-f]{12}\.ink\.png$/`, `NOTE_REFERENCE = /^r-[0-9a-f]{12}\.(png|jpg)$/`
- `notes/files.ts`:
  - `writeNoteFile(dir, kind: 'plain' | 'ink' | 'reference', bytes, mediaType): Promise<string>`: goes through `ownTorno`,
    writes `.gitignore` `*` the first time, and returns the name
  - `readNoteFile(dir, name): Promise<Buffer | null>`
  - `noteFilesExist(dir, mark): { picture: boolean; ink: boolean; references: boolean[] }`
- `MarkStore.addNote(objectId, note: NewNote): Promise<Mark>`, where `NewNote` is the note without the main-only keys and
  without file names; the file names are passed in by main after writing.
- `MarkStore.editNote(objectId, id, patch: { note?, labels?, strokes?, under?, references?, ink? }): Promise<Mark>`:
  editing a sent note reopens it, as `update` does for marks.
- `describeMark` for a note gives a line such as `M4 · view note · draft: "<comment>" (3 labels, 2 references, drawn on
  build 12)`.

- [ ] **Step 1:** Tests:
  - the sanitiser keeps a valid note and drops one with a bad file name or labels over the caps
  - `addNote` writes the mark; `editNote` of a sent note sets `reopened`
  - `remove` then `restore` gives the same note back
  - `markAnchors(note)` returns its anchor
  - the anchor goes orphaned when its face is gone (reanchor)
  - `writeNoteFile` names files by the patterns above and writes the `.gitignore`
  - `noteFilesExist` on an empty folder gives all false
  - `describeMark` gives the line above
- [ ] **Step 2:** Implement, then run the focused tests: `pnpm -C app exec vitest run src/shared/marks.test.ts
  src/main/marks src/main/notes`.
- [ ] **Step 3:** Run `pnpm test` and typecheck, then commit: "View notes are a kind of mark, with their pictures in
  .torno/notes/".

### Task 2: Making and editing a note through main

**Files:**
- Create: `app/src/main/notes/check.ts`, `app/src/main/notes/ipc.ts`
- Modify:
  - `app/src/shared/bridge.ts` and `app/src/preload/index.ts`: `notes.make`, `notes.edit` and `notes.picture`
  - `app/src/main/ipc.ts`: register them
  - `app/src/main/index.ts`: the sweep of `.torno/notes/` once per project per run, on first open, keeping what this
    run's removed marks still name (follow `board/pictures.ts` `PictureSweep`)
- Test: `main/notes/check.test.ts`, `main/notes/ipc.test.ts`

**Interfaces:**
- Consumes: Task 1; today's `drawingOf` checks in `main/sessions/drawing.ts` (reuse them by import; move them if they
  must be shared)
- Produces:
  - `NoteDraft` (shared/bridge.ts), which the window sends:
    - `objectId`, `revision`, `layout`, `camera`, `caption`, `size`
    - `plain: Uint8Array` and `inked: Uint8Array` (PNGs of `size`)
    - `inkColour`, `strokes`, `labels`, `under`, `comment`
    - `references: Array<{ bytes: Uint8Array; mediaType: 'image/png' | 'image/jpeg'; comment: string }>`
  - `notes.make(draft: NoteDraft): Promise<Mark>`
  - `notes.edit(objectId, id, patch: NoteEdit): Promise<Mark>`, where `NoteEdit` can hold:
    - `comment`, `labels`, `strokes` and `under`, each optional
    - `inked?: Uint8Array`, required when strokes or labels change
    - `keepReferences: number[]`: the indexes of the existing references to keep
    - `addReferences`, in the same shape as on `NoteDraft`
  - `notes.picture(objectId, id, which: 'ink' | 'plain' | number): Promise<Uint8Array | null>`, the bytes of a note's
    picture or reference for the window to show
  - `checkNoteDraft(raw: unknown): NoteDraft | Refusal`
- Inside a draft:
  - PNG and JPEG headers are checked by `checkedImage` against `size`, at most 2000 px and 3.75 MB.
  - Every main-only field and any file name is dropped.
  - Labels, references, strokes and `under` are held to the Global Constraints caps.

- [ ] **Step 1:** Tests:
  - `checkNoteDraft` refuses a bad PNG, a size mismatch, a 21st label, a 7th reference, a 301-character comment and a
    `#zzzzzz` ink
  - it drops `id`, `by`, `status`, `sentBefore` and any `picture` or `file` field (Review Focus 4)
  - `notes.make` writes plain, ink and reference files and the mark
  - `notes.edit` with an `inked` writes a new ink file, and the old one stays until the sweep
  - `keepReferences` drops the others
  - the sweep keeps the files of a note removed in this run
  - `notes.picture` for a missing file gives null
- [ ] **Step 2:** Implement, then run the focused tests.
- [ ] **Step 3:** Run `pnpm test` and typecheck, then commit: "Notes are made and edited through main, which names and
  keeps their pictures".

### Task 3: What Claude reads of notes

**Files:**
- Modify:
  - `app/src/main/mcp/schemas.ts`: `marks` gains `pictures?: boolean`; `add_mark` refuses `kind: 'note'`
  - `app/src/main/mcp/tools.ts`, or the file that implements `marks`
  - `app/src/main/marks/describe.ts`
  - the hook context that lists marks (follow `buildContextFor`/`context.ts`)
- Test: `main/mcp/tools.test.ts`, `main/context.test.ts`, `e2e/mcp.spec.ts` if it lists the schema

**Interfaces:**
- `noteText(mark: NoteMark, latestRevision: number | undefined): string` (in `main/notes/text.ts`). It holds:
  - the mark's line
  - what the picture is and on which build
  - the ink and its colour
  - the camera as JSON, with how to `look` from it
  - a line per stroke of what it lies over
  - each label as `"<text>"`, and with an arrow `"<text>" → <what its head lies over>`
  - the comment
  - each reference as `reference <n>: <comment>`
  - "built again since" when `latestRevision` is newer
  - with the picture missing, the line "the picture is not on this computer; look through its camera"
- `marks` with `pictures: true` attaches the inked picture of each note it returns, then its references, at most 6 in
  all, naming the rest.

- [ ] **Step 1:** Tests:
  - `noteText` for a full note, for one with missing files, and for one built again since
  - `marks` with `pictures: true` on 3 notes with 3 references each attaches 6 and names the rest
  - `add_mark` with `kind: 'note'` is refused
  - `resolve_mark` on a note resolves it
  - the agent's `update`/delete of a person's note is refused
- [ ] **Step 2:** Implement, then run the focused tests.
- [ ] **Step 3:** Run `pnpm test` and typecheck, then commit: "Claude reads view notes in full, pictures on request,
  and can only resolve them".

### Task 4: Sending notes with a prompt, and the old drawing path removed

**Files:**
- Modify:
  - `app/src/main/sessions/manager.ts`: `sendOne` takes the project's draft notes in mark order and adds `noteText`
    for each, then its inked picture, then its references. The attached view comes first, all within the cap of 6.
  - Remove the `drawing?: ViewDrawing` option and `drawingText` from the send path.
  - `app/src/main/sessions/drawing.ts`: keep only what notes reuse.
  - `app/src/shared/drawing.ts`
  - `app/src/main/sessions/transcript.ts`: the user item gets one `drawnOver`-style line per note, with refs and
    counts only.
  - `app/src/shared/chat.ts`
  - `app/src/main/ipc.ts`: `chat:send`
- Test: `main/sessions/manager.itest.ts`, `main/sessions/transcript.test.ts`, `main/sessions/drawing.test.ts`

**Interfaces:**
- Consumes: Task 1 (`MarkStore.list`, which today marks notes sent through `onDelivered` like any draft mark), Task 3
  (`noteText`), Task 1 (`readNoteFile`)
- Produces: the prompt content order, `[text, attached view?, (noteText, inked, ...references)...]`, and
  `UserItem.notes?: DrawnOver[]`

- [ ] **Step 1:** Tests:
  - with the stand-in agent: a prompt with 2 draft notes carries each `noteText` and its pictures in order, and the
    notes are `sent` after delivery
  - 3 notes with 3 references each: 6 pictures in all, the rest named (Review Focus 3)
  - a note whose files are missing goes as text only (Review Focus 1)
  - a chat log line holding an old `drawing` item still parses and shows its `drawnOver` (Review Focus 5)
  - no picture bytes in `.torno/chat/`
- [ ] **Step 2:** Implement, then run `pnpm -C app exec vitest run --mode kernel src/main/sessions/manager.itest.ts`
  and the unit tests.
- [ ] **Step 3:** Run `pnpm test`, `pnpm test:kernel` and typecheck, then commit: "Draft view notes go with the next
  prompt, pictures and all, in place of the one-shot drawing".

### Task 5: The sheet makes a note

**Files:**
- Modify:
  - `app/src/renderer/ui/drawing/ViewBoard.tsx`, `make.ts`, `compose.ts` and `under.ts`
  - `app/src/renderer/state/drawing.ts`: the one-per-session drawing state is replaced by an "editing note" state
  - `app/src/renderer/ui/ink/InkPad.tsx`: only if a label layer needs a hook in it; the chat's ink pad must not change
    for other uses
  - `app/src/shared/keys.ts`: label tool key `T` in the sheet's scope, not heard in a field
  - `docs/manual.md`: the keys table
- Create: `app/src/renderer/ui/drawing/Labels.tsx`, `References.tsx`
- Test: `renderer/ui/drawing/under.test.ts`, `renderer/state/drawing.test.ts`, `e2e/` (the spec that covers "Draw on
  view" today, likely `chatask.spec.ts` or `drawing`)

What the sheet does:
- It opens over the view as today, on the agent's own picture of the view (the plain picture).
- Pen, eraser, undo and clear work as today.
- The label tool (`T`): click to place a label and type; drag from it to add an arrow.
- A comment field, and "Add a reference" (a dialog through main, or a drop). References are scaled with
  `ui/onboard/images.ts`, each with a comment.
- Done composes the inked PNG (the plain picture, then ink, then labels and arrows) and picks `under` for the strokes,
  as today, plus each arrow's head. Then it calls `notes.make`. Editing calls `notes.edit`, sending `inked` only when
  the strokes or labels changed.
- Reopening a note loads its plain picture through `notes.picture(…, 'plain')`. When that is null, only the comment
  and references are editable (Review Focus 1).

- [ ] **Step 1:** Tests:
  - `under` for a label arrow's head picks the face under it
  - the state: opening a note to edit, then cancel, leaves it as it was
  - e2e: Draw on view, two strokes, a label with an arrow, a comment and one reference, then Done. The note is listed
    as a draft mark M<n> in `marks.json`, with two strokes and one label, and its files are in `.torno/notes/`.
  - e2e: reopen it, change the comment, then Done. If it was sent, it is reopened.
- [ ] **Step 2:** Implement, then run the focused unit tests and the e2e spec (after `pnpm -C app build`).
- [ ] **Step 3:** Run `pnpm test` and typecheck, then commit: "Draw on view makes a view note: ink, labels with arrows,
  a comment and references".

### Task 6: Notes waiting above the composer

**Files:**
- Modify: the composer's waiting row (today the drawing's "Edit/Remove", in `ui/chat/`), which lists every draft note
  of the project with its thumbnail, "Edit" and "Remove"; `app/src/renderer/ui/chat/DrawnOver.tsx`, which shows each
  sent note's line under the user item.
- Test: `e2e/chat.spec.ts` (or the spec that tests the drawing's waiting row)

- [ ] **Step 1:** e2e:
  - two draft notes are listed
  - Remove deletes one, and undo restores it
  - sending a prompt sends both: the row empties, the marks are `sent`, and each user item shows its note's line
  - a note whose files were deleted on disk shows "picture not on this computer"
- [ ] **Step 2:** Implement, then run the spec.
- [ ] **Step 3:** Run `pnpm test` and typecheck, then commit: "Draft notes wait above the composer, and each sent one
  is shown under its prompt".

### Task 7: Notes in the marks list and on the board, docs, and all suites

**Files:**
- Modify:
  - `app/src/renderer/ui/MarkRow.tsx` and `MarksPanel.tsx`: a note shows its thumbnail
  - `markHover.ts`: hovering a note lights the refs of `under` that still exist
  - clicking a note goes to its camera, as a mark does
  - `app/src/renderer/ui/projectBoard/faces.ts` `case 'mark'`: a note's card shows the inked thumbnail and the comment
  - `opens.ts`: double-clicking a note's card opens the sheet on it
  - `.claude/rules/drawing-on-view.md`, `marks-store.md`, `marks-window.md`, `board.md`, `workspace-writes.md` (the
    `.torno/notes/` folder)
  - `docs/manual.md`: "Draw on view" becomes view notes; the "never seen on a screen" section
- Test: `renderer/ui/markHover.test.ts`, `projectBoard/faces.test.ts`, `opens.test.ts`, `e2e/marks.spec.ts`,
  `e2e/board.spec.ts`

- [ ] **Step 1:** Tests:
  - hover over a note whose faces partly vanished lights only those that still exist (Review Focus 2)
  - the board's card for a note has the thumbnail and the comment
  - double-clicking it opens the sheet
  - e2e: a note in the marks panel goes to its camera on click
- [ ] **Step 2:** Implement and update the docs.
- [ ] **Step 3:** Run all four suites and typecheck from the repo root: `pnpm test`, `pnpm test:kernel`, `(cd kernel &&
  uv run --no-sync pytest -q)` (only if `kernel/.venv` exists), `pnpm test:e2e` and `pnpm -C app typecheck`. Report the
  counts.
- [ ] **Step 4:** Commit: "View notes show in the marks list and on the board, and the manual and rules say them".
