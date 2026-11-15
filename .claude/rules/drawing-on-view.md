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

- A drawing on the view ("Draw on view" in the chat) goes with one prompt as a picture: the agent's own picture of
  the view with the person's ink on it, after a caption main writes from data the window sends and main checks
  (`shared/drawing.ts`, `main/sessions/drawing.ts`). It names what the ink lies over by ref, with the kernel's line,
  and never a coordinate (the hit points are of the mesh). The picture is kept nowhere: not under `.torno/`, not in the log. What the ink lies over (the refs and the counts, `DrawnOver`,
  never a coordinate or a pixel) is text on the prompt's item, shown to the person before the drawing goes and under
  it after, and the transcript and the chat's log may hold it (the caption's text, refs and descriptors, the camera, is of that kind: text, never the picture).

## Agents (`app/src/main`)

- **A drawing on the view** (`sessions/drawing.ts`). `chat:send` takes `attachedView` (the bytes of the picture "Attach view" showed, checked by `Sessions.sendOne` as any picture for the agent and attached in place of a fresh `deps.picture`) and `drawing` (`ViewDrawing`, `shared/drawing.ts`):
  the window's data, checked field by field by `drawingOf` before anything is sent (a `Refusal` with its reason
  otherwise): one-line names and caption, a build above 0, a camera within ±1e9 mm, the picture a PNG main may attach
  (`checkedImage`, now `main/images.ts`: at most 2000 px and 3.75 MB) of the size it says, the ink `#rrggbb`, at most
  `MOST_STROKES_TOLD` strokes, each within the picture, with at most `MOST_REFS_TOLD` faces (a face as `refOf` names
  it: any one-line part name, faces from `F0`), `MOST_CUTS_TOLD` parts whose section's cut face it lies over (one-line
  names, told as "the cut face of lid": a cut face has no ref) and `MOST_SCANS_TOLD` scans; a descriptor is folded and
  cut to 200.
  `Sessions.sendOne` refuses a drawing of another object than the session's, and puts in the prompt, in order: the
  text, `drawingText` (what the picture is and on which build, the ink and its colour, the camera as JSON with how
  to `look` from it, a line per stroke of what it lies over, and that the model was built again since when it was),
  the picture, then the picture "Attach view" asks for. No line of the caption begins with a word the stand-in agent
  takes for a command. The picture is written nowhere. What the ink lies over goes on the prompt's user item as
  `drawing` (`drawnOver`, `shared/drawing.ts`: the faces once each, the cut faces, the scans, the strokes over no part and those partly over none,
  the build it was drawn on and the latest when that is another; refs and counts only, no kernel line, no box, no
  camera, each ref through `redact`), which the window shows under the picture and the chat's log keeps as text. The
  caption's words are not the item's text.

## Agents (`app/src/renderer`)

- **"Draw on view"** (`ui/drawing/`, `state/drawing.ts`). The ground is the agent's own picture of the view
  (`picture({ view: 'current', size: 1280 })`, the code of `look`), opened on `ui/board/Board.tsx` by `ViewBoard`, over
  the whole window as the export sheet is. The ink is `--drawing-ink` over a casing in `--panel` (`InkLook`), read once
  when the picture is made: the picture is of that theme. "Done" (`finishDrawing` in `make.ts`) composes the PNG
  (`compose.ts`) and, only while the screen is what the picture was made of (`ViewHost.shows()`, registered by
  `ViewportPane`: object, build, layout, camera, canvas size, section, explode, parts and scans shown), picks the view
  along each pen stroke where ink is left (`under.ts`: every 6 board pixels, 48 points a stroke at most): a face
  (`edges: false`), else a section's cut face, by its part (`Viewport.pickedCutOf`, from `pickUnder`'s `cutOf`), else a
  scan, else nothing. `ViewHost.shows()` is `screenShows`: a scan counts by whether it is drawn, how thin, whether its
  mesh has come and where it stands, not by whether its tree is made. A point of the picture is the same fraction of the canvas: one camera,
  one aspect. The faces' descriptors are waited for 3 s. The drawing then waits per session above the composer's box
  ("Edit", "Remove"); the board put away, by Done or Cancel, gives the keys to the composer's box (its own giving back
  finds "Draw on view" disabled once a drawing waits). It is taken by the next send and given back if that fails, counts as an unsent prompt when the
  window is closed (`unsentSessions`), and goes with the workspace (`clearDrafts`). The composer's box takes the pane's
  width; its buttons are a row under it. The drawing's row says what its ink lies over, in live chips
  (`ui/chat/DrawnOver.tsx`, from `drawnOver` of `shared/drawing.ts`: the faces, `the cut face of lid`, scans, `stroke 1 partly over no part`, `stroke 2
  over no part`; the hover lights a face in the view as everywhere): one that was not worked out says so in `--warn` with
  "Draw again" (which drops it and opens a new board); one drawn on an earlier build says its faces are of that build.
  The sent prompt shows the same line under its picture (`drawing` on the user item). "Attach view", pressed, shows a
  thumbnail of the view as it is now in a row of its own beside the drawing's, with "Remove"; that very picture is the one
  sent (`attachedView` of `chat:send`, kept as bytes beside the thumbnail, shown again if the send fails), not another made as
  the prompt goes. The board is titled "Draw on view", as its button.
