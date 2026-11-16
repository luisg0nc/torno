---
paths:
  - "app/src/main/sessions/drawing.ts"
  - "app/src/main/sessions/drawing.test.ts"
  - "app/src/shared/drawing.ts"
  - "app/src/shared/drawing.test.ts"
  - "app/src/renderer/ui/drawing/**"
  - "app/src/renderer/state/drawing.ts"
  - "app/src/renderer/state/drawing.test.ts"
  - "app/src/renderer/ui/chat/DrawnOver.tsx"
  - "app/src/main/images.ts"
---

# Draw on view: the drawing the person sends with a prompt

Moved as written from the folder `CLAUDE.md` files; each heading names the folder it came from, and paths are written as they were there (see "Rules by area" in the root `CLAUDE.md`).

## What crosses processes (root `CLAUDE.md`)

- A drawing on the view ("Draw on view" in the chat) is a view note: "Done" makes it through `notes.make` (a draft mark with its
  pictures in `.torno/notes/`), and it goes with the next chat prompt of itself (`Sessions.sendOne`, `notes/prompt.ts`). The
  prompt names what the ink lies over by ref, with the kernel's line, and never a coordinate (the hit points are of the mesh).
  What the ink lies over (the refs and the counts, `DrawnOver`, never a coordinate or a pixel) is text on the prompt's
  item (`notes`, one per note, with its mark id), shown to the person under the prompt, and the transcript and the chat's log may hold it. No
  picture is in the log or in `marks.json`. A log written before notes may hold `drawing` on a user item (the same shape for the
  one-shot drawing that went with a prompt): it is still read and shown, never written.

- A view note is listed with the other marks and is a card on the board (`.claude/rules/marks-window.md`, `board.md`): its row and
  its card show the picture with the ink (`notes.picture`) and the comment; the pointer on the row lights the faces of `under` that the
  build shown still has; a double click on its card, like "Edit" above the box and the "Edit" of its row in the marks list, is `openNote`. The picture is kept in
  `.torno/notes/` of this computer only (git ignores the folder), never in `marks.json`, the chat's log or the board's files. A note with no
  `anchor` (its ink lay over no face) has no chip in the view, in the window or in a picture of it (`project` in `labels.ts` leaves it out), and
  no section takes it away (`cutAway`).

## Agents (`app/src/main`)

- **A drawing on the view** (`sessions/drawing.ts` keeps the pieces the notes reuse: `strokeOf`, `cameraOf`, `strokeLine`,
  `overText`; the one-shot `ViewDrawing`, `drawingOf` and `drawingText` are gone). `chat:send` takes `attachedView` (the bytes of
  the picture "Attach view" showed, checked by `Sessions.sendOne` as any picture for the agent and attached in place of a fresh
  `deps.picture`), `attachView` and `board`; no `drawing`. `Sessions.sendOne` puts in the prompt, in order: the text, the
  board's words and pictures, the attached view, then each draft note of the project (`deps.draftNotes`: status draft, mark
  order) as `notePrompt` words it: `noteText` (the one wording `marks` shares), the picture with the ink, then its
  references, scaled to 1280 (`deps.scalePicture`), within the 6 pictures a prompt carries (what the board and the view hold
  counts): a picture past the room is named in the words of its note (`Not attached: M5 reference 2`), not attached, and a
  note whose pictures are not on this computer goes as words only. The notes the prompt carried are among the marks sent when
  the hook of that prompt is answered (`Session.carried`, by the id of the prompt's `user` item, released by the items
  `transcript.takenItems()` says that hook took up, and joined to `sentMarkIds` for `onDelivered`), whether or not the hook's
  list had room for them and whether or not it had words to say; a draft a prompt that still waits for its hook carries is left
  out of the next prompt (`transcript.awaitsHook`), so no two prompts carry one, and a prompt that never goes (the session
  ends) leaves its notes drafts; the hook's line for a note says where to read it in full. The words of a note are text blocks that begin as
  `describeMark` does (`NOTE_HEAD`): the transcript leaves them out of the item's text and keeps `notes` (`DrawnOver` with `note`,
  the strokes' refs and counts, each ref through `redact`, no kernel line, no box, no camera). The pictures are written nowhere
  but `.torno/notes/`.

## Agents (`app/src/renderer`)

- **"Draw on view"** (`ui/drawing/`, `state/drawing.ts`). The ground is the agent's own picture of the view
  (`picture({ view: 'current', size: 1280 })`, the code of `look`), opened on `ui/ink/InkPad.tsx` by `ViewBoard`, over
  the whole window as the export sheet is. The ink is `--drawing-ink` over a casing in `--panel` (`InkLook`), read once
  when the picture is made: the picture is of that theme. "Done" (`finishDrawing` in `make.ts`) composes the PNG
  (`compose.ts`) and, only while the screen is what the picture was made of (`ViewHost.shows()`, registered by
  `ViewportPane`: object, build, layout, camera, canvas size, section, explode, parts and scans shown), picks the view
  along each pen stroke where ink is left (`under.ts`: every 6 board pixels, 48 points a stroke at most): a face
  (`edges: false`), else a section's cut face, by its part (`Viewport.pickedCutOf`, from `pickUnder`'s `cutOf`), else a
  scan, else nothing. `ViewHost.shows()` is `screenShows`: a scan counts by whether it is drawn, how thin, whether its
  mesh has come and where it stands, not by whether its tree is made. A point of the picture is the same fraction of the canvas: one camera,
  one aspect. The faces' descriptors are waited for 3 s. It then keeps the plain picture, the inked one, the pen strokes with ink left
  (`underInk`'s `kept`, points within the picture), the labels (`cleanLabels`: one line of at most 200 characters, at most 20, points within the
  picture) and what the ink and the head of each arrow lie over (`under`: a line for each stroke told of, then one for each label with an
  arrow, in label order; `underHeads`), with the first face under the ink as the `anchor` (`ViewHost.under` gives a face's point, normal and part), the comment
  (one line, at most 2000 characters, `MAX_NOTE_COMMENT` = main's `MAX_NOTE`; a reference's comment 300) and the references, as a `NoteDraft` through `notes.make` (a rejection stays on the board as its problem); the
  board is put away and the keys are the composer's again. The sheet (`InkPad` with its `labels`, `aside`, `ready` and `changed`; the doodle uses none of
  them) has a label tool (`T`, `board.label`, not heard in a field): a click places a label and a field to write it in, a drag from it pulls an arrow
  (`Labels.tsx`, an SVG in picture pixels over the canvas; `labelbox.ts` lays a label out from a measure, so that `paintLabels` in `compose.ts` draws
  the very box into the PNG, over the ink); Esc in a field of the sheet (`data-board-field`) is the field's, the next one leaves. References
  (`References.tsx`, `referenceImages.ts`) are added by main's photo dialog (`objects.pickPhotos`/`readPhoto`) or a drop, scaled to 1280 px by `prepareImage`
  and sent as bytes, never a path; a note's own are kept by index and their comments are not changed. The sheet says before Done when the view moved
  under it (`worksOut`, asked again every 400 ms): then `under` is empty and no anchor is sent. `openNote(objectId, markId)` (`make.ts`;
  `drawingActions.openNoteOn` in the state) reopens a note over its plain picture (`notes.picture(…, 'plain')`) with its strokes, labels, comment and references; Done
  sends only what changed through `notes.edit` (`change.ts`), the picture with the ink only when the strokes or labels did, and what the ink lies over is kept
  while the strokes and the heads of the arrows stand where they were, and is none otherwise (it is not worked out for a view that is not the picture's). A note
  whose plain picture is not on this computer opens as a sheet of its comment and references alone (`finishNoteText`). The eraser is kept in a note: its strokes are
  kept as strokes with `erase: true` (`NoteStroke`, `shared/marks.ts`), in the order drawn among the pen strokes (`underInk`'s `kept`: an eraser
  before the first pen stroke kept is left out), composed with `destination-out` as the board does (`paintStrokes`), and reopened as eraser strokes
  (`openNoteOn`); an eraser stroke lies over nothing, so it has no line in `under` and no number among the strokes told of (`penStrokes`; main holds the
  pen strokes and the eraser strokes to their caps, `MOST_NOTE_STROKES` and `MOST_NOTE_ERASES`, apart). A note waits above the box until the prompt carries
  it (`ui/chat/WaitingNotes.tsx`, every draft note of the open project, a row each, "Draw on view" stays enabled): its picture with the ink
  (`notes.picture(…, 'ink')`, or "picture not on this computer"), the comment, what the ink lies over as live chips (`noteDrawnOver` of
  `shared/drawing.ts`, the one the prompt's item uses; the hover lights a face), "Edit" (`openNote`) and "Remove" (`marks.remove`, with "Undo" for
  ten seconds, `marks.restore`); nothing is lost with the window, a note being a mark on disk. The sent prompt shows what each note's ink lies over under its pictures (`notes` on the
  user item, `ui/chat/DrawnOver.tsx` from `drawnOver` of `shared/drawing.ts`: the faces, `the cut face of lid`, scans,
  `stroke 1 partly over no part`, `stroke 2 over no part`; the hover lights a face in the view as everywhere); one drawn on an
  earlier build says its faces are of that build; one that was not worked out says so in `--warn`. "Attach view", pressed, shows a
  thumbnail of the view as it is now in a row of its own, with "Remove"; that very picture is the one
  sent (`attachedView` of `chat:send`, kept as bytes beside the thumbnail, shown again if the send fails), not another made as
  the prompt goes. The board is titled "Draw on view", as its button.
