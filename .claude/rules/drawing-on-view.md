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
  the hook is answered (`Session.carried`, joined to `sentMarkIds` for `onDelivered`), whether or not the hook's list had room
  for them; the hook's line for a note says where to read it in full. The words of a note are text blocks that begin as
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
  (`underInk`'s `kept`, points within the picture) and what they lie over as a `NoteDraft` through `notes.make` (a rejection stays
  on the board as its problem); the board is put away and the keys are the composer's again. Until the sheet and the waiting row
  of a note are rebuilt (view notes, tasks 5 and 6) nothing of the note is shown above the box: it is a draft mark in the list
  and goes with the next prompt. The sent prompt shows what each note's ink lies over under its pictures (`notes` on the
  user item, `ui/chat/DrawnOver.tsx` from `drawnOver` of `shared/drawing.ts`: the faces, `the cut face of lid`, scans,
  `stroke 1 partly over no part`, `stroke 2 over no part`; the hover lights a face in the view as everywhere); one drawn on an
  earlier build says its faces are of that build; one that was not worked out says so in `--warn`. "Attach view", pressed, shows a
  thumbnail of the view as it is now in a row of its own, with "Remove"; that very picture is the one
  sent (`attachedView` of `chat:send`, kept as bytes beside the thumbnail, shown again if the send fails), not another made as
  the prompt goes. The board is titled "Draw on view", as its button.
