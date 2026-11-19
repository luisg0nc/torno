# Images for the README

The pictures here are made, not taken: `app/e2e/readme.spec.ts` drives the built app in a hidden window to each
state below and captures it once a launch, with the stand-in agent speaking a scripted turn (the one cosmetic edit,
the words of the person's prompt, is said in the spec), and `app/scripts/readme-images.py` crops, quantizes and
composes the social preview.

The projects on screen are real ones from the author's own workshop, which is not in this repository: an airbox
for a cone filter, fitted to a 3D scan of the engine bay it goes in (`intake`, whose tub wall is `wall: float = 2.8`
in its `airbox.py`), a tilted desk stand for a speaker (`speaker-stand`), and a few more for the page of projects.
`app/e2e/readme-workspace.ts` copies them into a workspace of their own, without the conversations torno kept, and
links the workshop's Python environment, so that they build as at home. The marks in the pictures are put at
points measured on those models; with other projects, change the constants in the spec. To remake the pictures:

```sh
pnpm build
TORNO_README_OBJECTS=~/objects \
TORNO_README_PROJECTS="<airbox folder>=intake,speaker-stand,<other folders of the page, each `folder` or `folder=name`>" \
TORNO_README_SCANS="intake:<the bay scan's id>=battery-tray.ply,intake:<another scan's id>=" \
TORNO_README_SHOTS=$PWD/docs/images/raw pnpm -C app exec playwright test e2e/readme.spec.ts
python3 app/scripts/readme-images.py docs/images/raw docs/images
```

`TORNO_README_SCANS` copies a scan's source beside its project under a plain name, or drops it (`=` with
nothing after), so that no path of the author's machine is on screen. The workspace is made as `/tmp/workshop/parts`
(the page of projects prints its path, so the name is plain on purpose), and a `sign: str = "..."` parameter of a copied
project, the name a part is engraved with, is emptied in the copy, so that no name is on a part in any picture. The
marks of a copied project are cleared for the shots of a sketch, a review and a tracing, which make their own. `docs/images/raw/` (the whole-window
captures) is not committed. The shots below that are not in the README (`objects.png`, `export.png`,
`first-screen.png`, `social-preview.png`) are made all the same, for the manual, for issues, and for the
repository's social preview.

## How to take them

- Run from the repository, not under test: `scripts/torno <a workspace>` on projects of your own whose parts look
  like something real. A part that looks like a real part (a bracket, a lid, a mount) sells it better than a test
  cube, and a scan of where it goes sells it best.
- The window at about 1600 × 1000 points. On a HiDPI screen the picture is twice that, which is right: GitHub
  scales it down.
- The light theme, unless the shot says dark. Nothing personal on screen: no home folder path in the title,
  no account name in the chat, no notifications, no path of a scan's source.
- PNG, cropped to the window (no desktop around it), under 1 MB each (`oxipng -o 4` or `pngquant` if not).
- Alt text is in the README already. If a shot shows something else, change its alt text to match.

## The shots

| # | File | What it shows | How to set it up |
|---|---|---|---|
| 1 | `hero.png` | **The whole window, mid-conversation.** The left column (the On h-number block with the build's verdict and the failing check, and the Parameters and Parts tabs), the airbox in the middle sitting in the scan of the engine bay, with a pin on the lid, a dimension that passes and one that fails, the dock on the right with the builds and the conversation: a prompt, the "with" line under it and the agent's answer using `look` and `measure`. The status line at the bottom says built. | Open the airbox with its scan shown, leave a pin and two dimensions, start a session and ask about the wall. Wait for the answer, then take the shot. This one matters most: it's the first thing people see. |
| 2 | `marks.png` | **The Brief page.** The speaker stand, with no engraving on it: the page's Checks ("passes" twice and "fails" once, one row per dimension) and its Marks, the bench at the left. | Steps 4 and 5 of the walk-through in `docs/manual.md`, with a dimension set to fail. The whole window with the dock hidden, the Brief page shown. |
| 3 | `chat.png` | **The agent's view.** The dock only: the builds strip, a prompt, the "with" line opened to show the marks as text, the agent's tool calls (`look`, `measure`) with the picture `look` gave, its edit of `airbox.py` and the build that followed. | After shot 1, open "Show text" on the "with" line. Crop to the dock. |
| 4 | `section.png` | **Section.** The airbox cut across Y with the scan hidden: the filter's pod inside the lid, the tub's ribs and floor, the section's tag and rule drawn over the view. | Open the airbox, hide the scan, press `X`, "Cut across Y". Crop to the view (the dock hidden). |
| 5 | `scan.png` | **A scan.** A part shown in a real scan of where it goes, the scan partly see-through. | Shot 1 is this already: the airbox in its engine bay. A separate shot is not made. |
| 6 | `objects.png` | **The page of projects.** Several cards with their pictures. | Open the page of projects (`W`, or "All projects" in the project crumb's menu) in a workspace of five or more projects, each built once so it has a picture. |
| 7 | `export.png` | **An exported page** open in a browser: the airbox, its scan, the marks, nothing else installed. | "Export…", HTML, marks included, then open the file in a browser. Crop to the browser's page, not its toolbar. |
| 8 | `first-screen.png` | **The first screen**, with "Ready to work" all ready and "Open the example". The whole window. | Start with no workspace remembered: `TORNO_CONFIG=/tmp/torno-fresh.json scripts/torno`, a config file that does not exist yet. |
| 9 | `hero-dark.png` | **Shot 1 in the dark theme.** Optional. With it, the README can show the dark one to readers whose GitHub is dark (`<picture>` with `prefers-color-scheme`). | The same setup as shot 1, the system in dark mode. |
| 12 | `sketch.png` | **A 3D sketch open.** The airbox with a plane 110 mm in front of it and three strokes on the plane (a point to point route, a freehand bend, a straight run), kept as a flow 24 mm across. The sketch's head is in the left column (name, how to take it, the plane and its strokes, the offset, Snap and X-ray, Done), the band at the top left says `Sketching M1 on XZ, y = -110.0` and the pens are over the view. The left column and the view, the dock hidden. | Open the airbox with its scan hidden and no marks, press `D`, `Shift+2`, type the offset, draw with `P`, `B` and `L`, choose Flow and its diameter, name it. Leave it open. |
| 13 | `review.png` | **A review round open.** The airbox with two marks in a round, a pin you do not want (`−`, hatched, "these clips hold nothing") and a pin you want (`+`, green, "a latch goes here"), each with its sign and its note in the view; the band `Reviewing h2` with Plain, Don't want and Want and the count `1 − · 1 +`; the round's panel as the head of the left column with both items. The left column and the view, the dock hidden. | Open the airbox with its scan hidden and no marks, open the Brief page, "Review this build" in its Marks block, press `-`, pin the clips, press `=`, pin the lid, then Items in the band. |
| 14 | `tracing.png` | **The Tracing view.** The XZ plane across the airbox, laid flat: the outline the kernel cut (the tub and the lid, with the walls drawn at true thickness), each part named, the millimetre grid, the `u = 0` axis, the scale bar and the title block; the Tracing panel in the left column. The left column and the view, the dock hidden. | Open the airbox with its scan hidden, make a tracing on XZ (New tracing), switch the view to Tracing, Fit, and zoom out a little. |

## A short recording

Made: `demo.gif` and `demo.mp4`, from eight frames `app/e2e/demo.spec.ts` captures the same way (`TORNO_DEMO=<folder>`
with the same `TORNO_README_*` settings, one launch a frame) and `demo-frames/make.sh` crossfades with ffmpeg; the
hold of each frame is set there. The README shows the GIF. The MP4 is for an issue or a release note, where GitHub
plays it. `loop.svg` is an animated diagram of the loop (CSS animation only, both colour schemes) for wherever a
picture of the loop is wanted without a window; `how-it-works.svg` is the diagram of the pieces (the window, Claude
Code, the model, the kernel) drawn the same way, for "How it works". Both are hand-written SVG with the same
tokens, not Mermaid, so they look like one family on a light page and a dark one.

| # | File | What it shows |
|---|---|---|
| 10 | `demo.mp4` (or `demo.gif`) | **The loop, 20 to 40 seconds.** The airbox in its engine bay; pin the tub wall, "too thin here"; ask the agent to make it 3 mm; it looks and measures, edits `airbox.py`; the parts rebuild; the dimension "tub wall" turns to "Passes". |

GitHub plays an MP4 that is dragged into an issue or a pull request and the link put in the README; a GIF works
anywhere but is large (keep it under 10 MB, 800 px wide, 10–15 fps). Speed up the agent's thinking in the edit.

## The social preview

| # | File | What it shows |
|---|---|---|
| 11 | `social-preview.png` | **1280 × 640**, for Settings → General → Social preview on GitHub: the logo, "torno", the one-line description, and a crop of shot 1. Not used in the README. |
