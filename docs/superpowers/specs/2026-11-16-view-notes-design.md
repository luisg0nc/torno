# View notes (#169, first half; piece 4 of #173)

"Draw on view" today sends one inked picture of the view with the next prompt and keeps nothing. This piece makes it
keep what was drawn: a **view note**, a new kind of mark, holding a picture of the view with the person's ink, typed
labels with arrows, a comment and reference images. It is sent to Claude with the next prompt, resolved by Claude, and
stays on the project's board as a card. 3D sketches, the other half of #169, come later.

## Why

Words and a few photos are a poor way to describe a 3D change. A picture of the view with ink on it says it at once,
but today it is spent on one prompt: it can't be read again, answered, or kept with the project. Luis wants the board
to be the centre of working with Claude, so what the person shows Claude should stay there.

## Goals

- "Draw on view" makes a view note. There is no throwaway kind any more.
- A note holds one picture of the view (with its camera, build and layout), pen strokes, typed labels each with an
  optional arrow, an overall comment, and reference images each with a comment.
- A note is a mark (`M<n>`, `kind: 'note'`): draft until sent, sent in full with the next prompt, resolved by Claude
  with `resolve_mark`, under "To review" until the person accepts it, reopened when edited after it was sent. Everything
  marks already do.
- It is pinned to what the ink lies over: hovering the note lights those faces, and clicking it brings the view back to
  its camera.
- It shows on the board as its mark card, with the inked picture as its thumbnail.
- Claude gets the note in full with the prompt, and can read it again later, picture included.
- Ink, labels, comments, camera and refs travel in git; pictures stay on the person's computer.

## Non-goals (later)

- Several pictures in one note, and Retake (Luis left them out of this build).
- Claude making its own view notes.
- Follow-ups and threads on a note (#168).
- 3D sketches.

## Anti-goals

- A note never changes the model.
- No picture data in `marks.json`, `.torno/chat/` or the log, as today for drawings.
- Nothing the window says about what the ink lies over is told without main's checks (today's `drawingOf` rules hold).

## Constraints

- `<object>/.torno/marks.json` has one writer, main (`main/marks/store.ts`), one change at a time, written atomically.
  `MAIN_ONLY_KEYS` are never taken from the window or a tool.
- Images for the agent: long edge at most 2000 px, default 1280; at most 6 pictures in one prompt. A note's own picture
  counts as one; its references come after it within the cap; the rest are named, not attached.
- What the ink lies over is told by ref with the kernel's line, never a coordinate (`shared/drawing.ts`).
- Tests never open a visible window and never run the real `claude`.

## Approaches

- **A new kind of mark (chosen).** Marks already have the lifecycle, "To review", `resolve_mark`, the check against new
  builds, and a card on the board that appears by itself. A note adds its own data and a pictures folder.
- *A new board card kind with its own status.* Leaves marks untouched but rebuilds the lifecycle and tools. Rejected.
- *Keep "Draw on view" as a one-off beside "New view note".* Two ways to do the same thing. Luis chose one.

## Design

### The mark

`NoteMark extends MarkBase { kind: 'note' }` in `shared/marks.ts`. `MarkBase` already holds `note` (the overall
comment), `layout`, `revision` (the build it was drawn on), `camera` and the status fields. A note adds:

- `picture`: the file name of the plain view picture in `.torno/notes/` (`n-<12 hex>.png`), main's to give.
- `size`: `{ w, h }` of that picture in pixels.
- `strokes`: the pen strokes as vectors in picture pixels (`{ width, points }`), the ink colour as today's.
- `labels`: `{ x, y, text, to?: { x, y } }`: a typed label at a point, with an optional arrow to another point. Text at
  most 200 characters, one line; at most 20 labels.
- `under`: what the ink and the arrows' heads lie over, as today's `StrokeUnder` (faces, cut faces, scans), checked by
  main. The mark's anchor is the first face under the ink, else its part, else none (`anchorState` as marks have it).
- `references`: `{ file, comment }`, at most 6, the files in `.torno/notes/` (`r-<12 hex>.<png|jpg>`), a comment at most
  300 characters, one line.

### Pictures on disk

`.torno/notes/` holds the plain view pictures and the reference images, with a `.gitignore` of `*` written by main as
`board/pictures/` is. The inked picture is composed from the plain picture, the strokes and the labels in the window (which has the canvas), and kept beside the plain one as `n-<hex>.ink.png`, also local. The
strokes and labels stay the source: an edit composes and sends a new inked file. Main has no canvas, so it sends the
kept inked file rather than drawing it again (a planning call). Only files torno itself dropped are swept (Luis's
decision, for the notes and for piece 2's board pictures): main lists each file it drops (a note removed, the ink an edit
replaced, a reference taken away, what a failed save wrote; for the board a removed card's picture, a replaced sketch) in
a local `dropped.json` in the git-ignored folder, and once per run when the project is opened the sweep deletes a listed
file only if no mark or card names it and this run's undo cannot bring it back, then takes it off the list. A file that is
not on the list is never deleted: a branch switch must never delete a picture.
On a computer without the picture, the note is drawn and sent as data: its comment, labels, refs and camera, with
"the picture is not on this computer; look through its camera", and the card says so.

### Making and editing a note

"Draw on view" opens today's sheet over the view (`ui/drawing/`, `InkPad`). It gains a label tool (click to place,
type, drag to add an arrow), a comment field and "Add a reference" (a dialog or a drop; the window scales to 1280 px as
the new-project page does). Done makes the note: the window sends the plain picture, the strokes, labels, `under`,
comment and references; main checks them as `drawingOf` does today plus the new caps, writes the files, then the
mark. The note is a draft and waits above the composer as the drawing waits today ("Edit", "Remove").

Opening a note again (from the marks list, its board card, or "Edit" above the composer) reopens the sheet on its plain
picture with its strokes and labels, so it can be changed. Editing a sent note reopens it, as editing a mark does.

### Sending

A draft note goes with the next prompt as marks do. In the prompt it is the mark's lines plus today's `drawingText`
(the build, the ink, the camera with how to `look` from it, a line per stroke of what it lies over), the labels as
text with what each arrow points at, the comment, then the inked picture, then each reference with its comment. The
model built again since the note was drawn is said, as today.

### Claude's tools

- `marks` lists notes as it lists marks, with the comment, the labels and what the ink lies over. A new `pictures:
  true` argument attaches the inked pictures of the notes it returns (within the cap of 6).
- `resolve_mark` resolves a note as any mark.
- `look` with a note's camera is already possible: the note's text gives the camera.

### In the window

- The marks list shows a note with its thumbnail. Hovering it lights the faces under its ink; clicking it brings the
  camera back and selects it.
- On the board, the note's mark card shows the inked thumbnail and the comment. Double-clicking it opens the note.

### Builder's questions, settled (my calls)

- **Checking against new builds.** A note's anchor, which is the first face under the ink, is checked like a pick mark's
  (`markAnchors` returns it, and `anchorState` is set as for marks). `under` is frozen as of the build it was drawn on.
  It is told as "of build N", together with whether the model was built again since, as today. Hovering lights the
  refs of `under` that still exist.
- **Drafts.** A draft note is a draft mark. Several can wait at once, per project, and they are kept in `marks.json`,
  so they survive closing the window. Each goes with the next prompt like any draft mark, with no separate attach step.
  The row above the composer lists the waiting notes with "Edit" and "Remove". Remove deletes the mark, with undo as
  marks have it.
- **The old drawing path.** `ViewDrawing`, `chat:send`'s `drawing` and the one-per-session drawing state go away.
  "Attach view" stays as it is. A sent prompt's user item keeps a `drawing`-style line for each note it carried (refs
  and counts, as `drawnOver` today). Chat logs that already hold `drawing` items still render as they do now.
- **Pictures in one prompt.** The cap is 6 pictures in all. The attached view comes first, then each note in mark
  order, each followed by its references. A picture past the cap is named ("not attached: the note's picture is in
  .torno/notes/; use marks with pictures") and not attached.
- **A note whose picture is not on this computer.** Its comment and references can still be edited. The ink and the
  labels can't, because the sheet needs the picture underneath. The card and the marks list say "picture not on this
  computer".
- **`under` and labels.** `under` is per stroke, as today, plus one entry per label arrow for what its head points at.
  A label's text position is not picked. The caps (`MOST_STROKES_TOLD`, `MOST_REFS_TOLD` and the rest) apply per note.
- **How a note is sent and edited.**
  - There are new IPC calls, `notes:make` and `notes:edit`, which carry the picture bytes. They are checked as
    `drawingOf` checks today, plus the new caps.
  - Main names every file and the window never names one. The plain picture never changes after the note is made.
  - A reference added later gets a new `r-` name.
  - A removed reference or a deleted note leaves its files, listed as dropped, until the sweep of a later run. The sweep
    takes only listed files and keeps what this run's undo can still bring back, as piece 2 does for board pictures.
- **What Claude can do.**
  - Claude can only resolve a note, with `resolve_mark`.
  - `add_mark` refuses `kind: 'note'`.
  - Claude can't edit or delete a person's note, as with the person's marks today.

## What the builder decides

- The look of the label tool and the reference list in the sheet, within the tokens.
- How the inked picture is composed (canvas in the window, `nativeImage` or the same canvas code in main), as long as
  one function's output is what is shown and what is sent.
- The thumbnail size on the card and in the marks list.
- Test layout, following the existing drawing, marks and board tests.
