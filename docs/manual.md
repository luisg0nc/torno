# The torno manual

Everything torno does, in the order a first-time user meets it: what it needs, how to start it, a walk-through,
then the reference. The [README](../README.md) is the short introduction.
The same text, with a table of contents at the side, is at [torno.luisg.me/manual](https://torno.luisg.me/manual/).

Torno is a desktop workbench for making CAD parts with an AI coding agent: the
agent writes build123d Python in a terminal inside the window, torno builds the
model every time a file is saved and shows the parts beside the terminal. You
point at the parts to say what you mean, measure them, and hold them to
numbers; the agent is told what you pointed at and has tools to see what you
see.

The window has three parts. On the left, a thin rail of icons and, beside it, the
route card: the project read from top to bottom, in sections you fold, which pushes
the 3D view over. In the
middle, the parts in 3D, with the compass at the top right and the tools down the
left edge. On the right, the terminal the agent runs in. A line at the bottom
says how the last build went.

Torno is not a modeller. It has no sketcher, no feature tree and no way to edit
a solid by hand. The model is the Python file; torno shows it. It uploads
nothing and publishes nothing. The name is Portuguese for a bench vise, which the
logo is: one holding a part. The design is in
[docs/superpowers/specs/2026-10-08-torno-design.md](superpowers/specs/2026-10-08-torno-design.md).

## Requirements

Linux or macOS. Developed on Arch with Wayland (Hyprland). macOS is tested on GitHub's macOS runners and not yet by eye.

- Node.js 22.12 or later (developed with 26) and pnpm 10
- [uv](https://docs.astral.sh/uv/)
- Python 3.11 or 3.12 (uv fetches one if none is installed)
- Claude Code (`claude`) on `PATH`, logged in (see [What Claude Code is
  given](#what-claude-code-is-given))
- A workspace: a folder of projects, each a subfolder with a Python model in
  it. If the workspace has a `pyproject.toml`, its environment must already
  exist and hold build123d (`uv sync` there once, yourself). Torno runs the
  kernel in that environment with `uv run --no-sync` and never changes it. A
  workspace with no `pyproject.toml` is built with the build123d of torno's
  own kernel environment (`kernel/.venv`, which uv makes the first time it is
  needed), which also has `bd_warehouse` (screws, nuts, clearance holes,
  bearings), so a model there can import it. A workspace with its own
  `pyproject.toml` has `bd_warehouse` only if it lists it.
- Importing a scan needs `trimesh` and `pillow`, which uv fetches the first
  time a scan is imported. The checks against a scan use the `scipy` of the
  workspace's environment, which build123d brings.

Torno checks these when it starts, before anything fails, and says so in a block
called "Ready to work" on the first screen, in a workspace with no project and on
the page of a new project (below): a line for Claude Code, for `uv` when it is
missing, and for the kernel's Python environment. When everything is there the
block is one quiet line with a tick ("Claude Code 2.1.4 and build123d 0.13.0 are
ready", the version only once `claude --version` has answered), and a click opens
it. Each line of the open block is a sign (✓ ready, ! to look at, × failed), the
name, and what was found: a version, a path or a reason. It looks for `claude` and `uv` on the `PATH` torno was started
with. It also runs `claude --version` and `claude auth status`, once at start and
within 3 seconds each (nothing written, nothing of your Claude Code settings
read), to say its version and whether you are signed in, and `uv --version`;
under test it only looks on the `PATH` and never runs `claude`. "Check what torno
needs" in the folder menu opens the same lines in a dialog and asks again
("Check again"). The first time, torno's own Python environment is made by uv and
about 900 MB is fetched, so that first run needs the network; until then the
block says "Not made yet", and "Make it now" makes it (`uv sync` on torno's own
kernel project, never on a workspace) with uv's lines shown as it goes, so that
the first build does not have to. A workspace with its own `pyproject.toml` is
only reported on: whether its `.venv` is there. Torno never makes one.

## Install

```sh
git clone https://github.com/luisg0nc/torno.git
cd torno
pnpm install
```

## Run

```sh
scripts/torno ~/projects    # open that folder as the workspace
scripts/torno               # open the workspace opened last, or the first screen
pnpm start [folder]         # the same, from the repository
```

```sh
scripts/torno --print-command [folder]   # the command it would start, one argument a line, the folder first as TORNO_WORKSPACE=…; starts nothing
scripts/torno --print-desktop            # Linux only (macOS: see below). The desktop entry for this copy of torno; writes nothing
scripts/torno --install-desktop          # writes it: ~/.local/share/applications/torno.desktop, and nothing else
scripts/torno --uninstall-desktop        # removes that file
TORNO_OZONE=wayland scripts/torno        # or x11: the platform Electron is told to draw on
```

`scripts/torno` works from any directory, and through a symlink. It installs
the dependencies if `node_modules` is missing, builds the app if it has not
been built since the sources last changed, and starts it. A build that fails
is tried again at the next start. It knows a build by `app/out/.built`, a hash of
what the sources held when its last build that succeeded began: a checkout or a
touch that leaves every source as it was builds nothing, and any change does.
Only the launcher writes it: after a `pnpm build` or a test run of your own on
changed sources, the first start from the launcher builds again (some ten
seconds, written into `app/out`).

With no folder to open, the first screen is two halves. On the left, a field of
layout blue (the dye a machinist paints on steel before scribing) with a bench vise
scribed on it, which draws itself once as the window opens, and "torno" and what it
is under it: "Make CAD parts with an AI agent. It writes the model in build123d;
you point at what to change." (With the system set to reduce motion the vise is
simply there.) On the right: the first time, a sentence on what a folder is, and
"Open folder" (an empty one is fine) and "Open the example"; coming back, "Recent
folders" in place of the sentence, a row for each, with one that is gone struck
through, "Not found" and "Remove". Under the buttons it says what is ready and what
is missing (see Requirements). The top of the window there moves it, as the title
bar does elsewhere, and the window's controls are at the top right. The
example is one small project, an enclosure for a sensor board, made to be
shown: a model with three parts (a body, a lid and a clip), a brief written as a
person would, two marks, a dimension that fails and two saved views. It is
copied to a temporary folder. That copy is
removed when torno quits, with whatever was made in it, and the window says so
on the page of projects for as long as it is open; one that a crash left is
removed at the next start. To keep what you made in it, press "Keep this as a
folder…" there: choose a name in the dialog and torno copies
the whole example, with the marks, the views and the chat, to a new folder of
that name, whole or not at all, and opens it in place of the copy. It never
writes into a folder that exists, so a name that is taken is refused, and the
new folder is added to the folders opened lately. A folder given to `scripts/torno` is added to the
folders opened lately, as one opened from the window is.

Once a folder is open, the title bar across the top of the window names it, as the first crumb
(`parts ▾`), and that crumb opens a menu with the same ways to another: the folders opened lately (one that is not found is
struck and can be removed), "Open folder…" and "Open the example", and "Check what torno needs".

Left alone, Electron chooses whether to draw on Wayland or X11. If the window
does not come up, or comes up wrong, `TORNO_OZONE=wayland` or `TORNO_OZONE=x11`
has the launcher pass `--ozone-platform` for it. Any other value is refused,
`headless` among them: Electron crashes with it here.

On macOS Electron has one platform: `TORNO_OZONE` is checked but then ignored,
with a line on stderr, and `--print-desktop`, `--install-desktop` and
`--uninstall-desktop` write nothing and exit 2 (make `torno.app` with
`pnpm dist:mac` instead). The launcher hashes the sources with `sha256sum` or,
failing that, `shasum -a 256`, which a Mac has.

`--install-desktop` (Linux) writes one file and only when you run it: `torno.desktop`
under `$XDG_DATA_HOME/applications` (`~/.local/share` when that is not set),
after printing the path and the entry. It refuses to run as root. The entry
starts this script, and names its icon, by their whole paths: run it again
after moving the repository. It names no platform: a launcher that should use
one needs `TORNO_OZONE` in the environment it starts programs with. Started
from the entry (`--from-desktop`), what goes wrong is also shown as a desktop
notice (`notify-send`), or, where there is none, written to
`~/.local/state/torno/launcher.log`: nobody reads what a launcher prints.

Only one torno runs at a time. Starting it again brings the window that is
already open to the front and says so on stderr; given a folder, that window
opens it, asking first if a session there is in the middle of its work.

On Linux torno has no menu. The window is closed through the window manager, which
ends torno and the sessions in it. When that would cut something short, torno
asks first, in a dialog over the window ("Close torno?", with "Keep it open" in
focus) that names each project and what would be cut short, as a link to the
project: a session working or waiting for an answer, a prompt written and not
sent, a region painted on a scan and not kept, a scan being imported or an
export being written. With none of that it closes at once. `Ctrl+Q`, `Ctrl+W`, `F11` and
the zoom shortcuts do not exist. For work on torno itself, `pnpm dev` runs the app from
the Vite dev server, where `F5` and `Ctrl+R` reload the window.

On macOS the menu bar is global, so torno has one there: the app menu (About, Hide, Quit), Edit and Window. Copy,
paste, cut, select all and undo (`⌘C`, `⌘V`, `⌘X`, `⌘A`, `⌘Z`) come from the Edit menu, in fields and in the
terminal. `⌘Q` asks first, as closing the window does ("Close torno?" while something would be cut short);
the Dock's Quit and a logout do not ask. There is no Close item, no reload and no zoom. Run from the
repository, the menu bar names the app "Electron" (the bundle of `node_modules/electron`); a packaged app is
"torno". On a Mac, and on Linux, torno asks your login shell for its `PATH` at start, so `uv` and `claude` are found when torno
is started from the Finder, the Dock or a launcher.

On macOS, `pnpm dist:mac` makes `torno.app` in `app/dist/`: `mac-arm64/torno.app` on Apple silicon (and a zip
beside it), `mac/torno.app` on an Intel Mac (`pnpm dist:mac -- --x64`). Copy it to `/Applications` and open it from
the Finder or the Dock. It carries the kernel's source, torno's skills for Claude Code, the icon and the example, and
still needs `uv` and `claude` installed; it finds them through your login shell's `PATH` (above). Its Python environment for
a workspace with no `pyproject.toml` is made at the first build of one, in
`~/Library/Application Support/torno/kernel-env`, and never inside the app. The app is signed ad hoc and not
notarized: one built on your own Mac opens as it is; one that was downloaded (the zip a CI run uploads, say) is
quarantined, so right-click it and choose Open, or run `xattr -dr com.apple.quarantine torno.app`. Updating means
building again.

On Linux, `pnpm dist:linux` makes `torno-<version>.AppImage` and `torno-app-<version>.tar.gz` in `app/dist/` (make the
AppImage executable and run it, or unpack the tar.gz and run `torno-app`). They carry the same files as the Mac app,
are not signed, and need `uv` and `claude` as well (found through your login shell's `PATH`); the kernel's Python
environment is made in `~/.config/torno/kernel-env`, never inside the package. There is no Windows build.
`pnpm pack:check` builds the unpacked folder alone, `app/dist/linux-unpacked`, to check the packaging with
`TORNO_PACKAGED=… pnpm -C app exec playwright test e2e/packaged.spec.ts`.

## Five minutes with torno

This walk-through uses the example that torno carries, in a temporary copy, so
nothing of yours is touched. It needs nothing from the repository, so it works
the same in a packaged app. The example is an enclosure for a sensor board: a
body, a lid and a clip. The lid rattles, which is what you will fix.

1. Start torno with no folder (`scripts/torno`, or open the app): a blue plate
   with a vise drawing itself on it, and at its right the ways in. Press
   "Open the example" on the first screen. The window opens on a page of
   cards with one project, `enclosure`. The copy is removed when torno quits,
   and the window says so under the workspace's name.

2. Click `enclosure`. It is built (a second or two; longer the very first time,
   while uv makes torno's own Python environment, which the status line says:
   "Making torno's Python environment, first time only") and drawn: the body,
   the lid on it and the clip round the front. Drag to turn it, drag with the
   right button to pan, scroll to zoom, `F` to fit. `1` to `4` are the iso,
   front, right and top views. The window says how the pointer moves the view
   once, in a hint at the foot of the view that goes at your first move of the
   camera, and keeps it, with the keys,
   in the sheet of keys (`?`), where the pointer is the first group. Point at a tool in the reed, the slim column of
   round buttons at the left of the view, for what it does; the tool in hand is an accent circle and its name grows out
   to the right with its key and its choices. With a tool in hand a small dark caption by the pointer says what it waits for next.

3. Read what is there. The Marks list has three marks the example came with:
   `M1`, a pin on the lid for a label; `M2`, an arrow at the cable notch, which
   says the notch is too narrow for the plug; and `M3`, a dimension: the gap
   between the lid's lip and the wall, which should be 0.2 mm. Its row says
   `Fails`, because the gap is 0.35 mm. Click a row and the view goes to it.
   The line at the bottom counts it (`1 dimension fails`). Open `brief.md` in
   the project's folder to read what the person who made it asked for.

4. Press `E`. The parts are drawn apart, for looking only. Press `E` again to
   put them together.

5. In the compass at the top right, open "1 more" and click "Lid fit". The camera moves to the lip, the clip
   is hidden and a section is cut through the lid and the body, so that you see
   the gap. "Cable side" looks at the notch from behind. "+ Save view" keeps how
   you are looking under a name of your own.

6. Press `P` and click the top of the body, near a corner. A pin is left there,
   numbered `M4`, and its note opens: type "rounder here" and press Enter. The
   pin is red: it is yours. Press `Esc` to put the Pin tool down.

7. Press `M`, hold the pointer on the outer wall of the body and press `T`: the
   wall under the pointer is measured by the kernel, exactly, `2.4 mm`, and
   stays on the part as a dimension. Type `2.4` under "Should be" and press
   Enter: the row says `Passes`. Enter gave the keys back to the view: press
   `Esc` to put the tool down.

8. Press `X`. A plane cuts the parts in half at once, open towards you; a tag
   appears by the plane. Drag the arrow on the plane, or use the arrow keys,
   to move it. "Off" in the tag takes the cut away, and `Esc` puts the tool down.

9. In the pane on the right, type "make the notch 14 mm wide and the gap 0.2 mm"
   and press Enter. A session starts with your prompt, and your marks go with
   it as text: the face, the point, your note, the measured value and whether
   it passes. From then on they show as sent. The agent can ask torno for a
   picture (`look`), a measurement (`measure`) and a cut (`section`), and it
   edits `enclosure.py`; every save is built and drawn. When it is done, `M3`
   says `Passes`. Then send `/mcp__torno__review`, which has the agent go
   through every open mark against the build.

10. "Export…" at the bottom right (or `Ctrl+Shift+E`) opens the export in the
    session dock; "Export page" writes one HTML file that someone without torno
    can open: it needs nothing else.

11. To keep what you made, press "Keep this as a folder…" on the
    page of projects and choose a name. Otherwise it is removed when torno
    quits. Press `?` for every key, and `W` for the page of projects. Then open
    your own folder with the folder crumb in the title bar.

Torno wrote only in the temporary copy, and in the one folder you chose if you
kept it.

## Projects and builds

A folder is a project when it holds a `.py` file; dotfiles and `__init__.py`
do not count, and folders whose names start with `.` or `_`, and `common`,
`tests` and `out`, are never projects. The model is the one `.py` file that is
not a test (`test_*.py`, `*_test.py`, `conftest.py`). Of several, it is the one
named after the folder, with `-` and `_` taken as the same:
`helmet-stand/helmet_stand.py`. Once a project is open, torno keeps building
the model it chose for as long as that file exists. A folder where no model
can be chosen, or a model with none of the forms below, is listed with the
reason it cannot be built.

The title bar names the folder and, with a project open, the project (`parts ▾ / intake ▾`): the project crumb opens a short
menu with All projects at its head and then each project. At its right it shows the other projects whose session works
(`guitar-wall-stand is working`) or waits (`intake needs you`), two at most and then `+N`; a click opens that project and
its question. The session pane's show and hide button is there too, before the window controls, which torno draws itself
where the system gives none. On the page of projects only the folder shows, and on the page of a new project the second crumb reads
"New project".

The projects of the folder are on the page of projects (the Projects icon at the top of the rail, or "All projects `W`"
in the project crumb's menu), and the crumb's menu lists them too, a dot on a row for a session that works or waits. When
any project's session waits for you, the Projects icon on the rail has its dot and says so ("bracket needs you").

The kernel imports the model file as a module (`if __name__ == "__main__"` does
not run) and takes the first of:

1. `Params()` with `assembly(p)` (layout `assembly`) and `printables(p)` or
   `printable(p)` (layout `print`), each returning a dict of name to part.
2. `Params()` with functions named `make_<part>(p)`, defined in the model file
   and callable with the parameters alone: each one that returns a solid is the
   part `<part>` (layout `main`).
3. build123d shapes in module-level variables (layout `main`).

In the `print` layout a model usually poses every part for the bed at the
origin. When parts of that layout overlap seen from above, torno sets them
side by side along X, 10 mm apart, in the order the model gave them; each
keeps its own Y and Z. The picture, the bounding boxes and `scene` all show
the parts where torno put them, and `scene` says how far each was moved
(`arranged`). The model and what it exports are not changed.

**Checks the model declares.** A model with `Params()` may also define `checks(p)`, a list of declarations
that torno measures after every build, beside the dimensions you place yourself:

```python
def checks(p):
    return [
        {"name": "lid fits the tub", "kind": "clearance", "a": "lid", "b": "tub", "min": p.clearance - 0.05, "max": p.clearance + 0.05},
        {"name": "tub is one body", "kind": "solids", "a": "tub", "equals": 1},
        {"name": "walls", "kind": "thin", "a": "tub", "min": 1.2, "layout": "print"},
        {"name": "fits the bed", "kind": "bed", "size": [256, 256, 256]},
    ]
```

A declaration is data, not a function: torno measures it with the kernel's own queries, so each result says
whether it is exact. `name` and `kind` are required; `a` and `b` are part names or group names (a group stands for its parts;
never a face number, which changes with the model), `layout` is optional (the first layout, `assembly` before `print`,
that has the parts; `print` for the kinds about printing when it has them). The kinds are `clearance` (the least
distance, mm), `overlap` (the volume shared, nothing unless told), `solids` (how many a part has), `volume`
(mm³), `thin` (a wall under `min` mm: found by sampling, so no result is a proof that there is none), `overhang`
(faces facing down steeper than `angle`, 45 unless told), `mesh` (the part's mesh is closed) and `bed` (the layout fits
`size`). What is wanted is `min` and/or `max`, `equals`, or `expected` with `tolerance` or `percent`.
A declaration that is not one fails the build and says what is wrong, as a bad `groups(p)` does. A check that fails
never fails the build, and never holds the agent back when it would stop; it is told with the build
(What the agent is told) and listed in the window under Checks. torno never writes `checks(p)`.
A check that names a reference built from sizes the model's comments call `assumed:` (the reference's own `references(p)` read
them) says so: "pass, against an assumed reference: radiator". It is only as good as that guess, and the build result, `scene`
and the Checks section all say it.

**Names for faces and edges.** A face number (`lid/F12`) changes whenever the topology does. A model with `Params()`
may also define `tags(p, parts)`, which names faces and edges, and a name holds across builds:

```python
def tags(p, parts):
    lid = parts["lid"]
    return {"lid": {"top": lid.faces().sort_by(Axis.Z)[-1], "screw_holes": lid.faces().filter_by(GeomType.CYLINDER)}}
```

It is called once for each layout, with the dict of parts that layout's function returned, and returns part name to
tag name to a face, an edge or a list of them, taken from those very shapes. A tag name is a letter or `_` and then
letters, digits, `_`, `.` or `-`. The ref of a tag is `lid/@top`: it names one face or edge (several, `lid/@screw_holes`,
are taken whole by `highlight` and `ask`; where one face or edge is needed, a tag of several is refused, naming them). `describe`, `measure`, `highlight` and the
dimensions take it, `scene` lists each part's tags with the faces and edges they are now, and the pointer says
`lid/F12 · @top`. A mark you place on a face or an edge that has a tag keeps the tag, and each build looks for it
first: the mark follows the face by its name when the numbers shift, or the face moves. If the build has lost the tag
(or it names several faces now) the mark is found by its point, as any mark is, and keeps the tag for a build that
brings it back. A tag that names nothing the part has (a shape of another part, a face taken before an edit, an empty
list) fails the build and says which. torno never writes `tags(p, parts)`. A tag is the model's; your own names for faces are
[named sets](#named-sets), written `#deck` beside `lid/@top`.

**Bought parts.** A printed part is usually made around something bought: a screw, a bearing, a board. A model says so
with an optional `references(p)` beside `assembly` (name to shape, in the assembly's frame):

```python
def references(p: Params):
    return {"608": Pos(0, 0, 4) * SingleRowDeepGrooveBallBearing(size="M8-22-7", bearing_type="SKT")}
```

A reference is drawn in a neutral grey, listed in Layers with the tag "bought", and picked and measured like a part. It is an
obstacle: `check clearance`, `overlap` and `interference` take it against the parts (never one reference against another), and
`checks(p)` and `groups(p)` may name it. It is not made: it is in no `print` layout, not counted by `check bed`, has no mass, takes no
`thin`, `overhang` or `mesh` check, and is in no STL or 3MF; a STEP holds it only when ticked in the export sheet. Its name is
its own (not a part's, no `/`, not of the form `M<n>`), and a model with only a `print` layout cannot have one. Standard parts come
from `bd_warehouse`, which torno's own kernel environment has (`simple=True` for a screw); a vendor's STEP is read by the
model itself (`import_step`) and returned among the references, as torno reads no file of its own accord. A reference that is a
library's compound of many solids is taken as the solids it holds, in one shape.

**Builds.** Saving a file in the project's folder (dotfiles, `out/`, `cache/`,
`.torno/` and `__pycache__/` are ignored, as are `build/`, `dist/`,
`node_modules/`, `.venv/` and `.git/`) or in the workspace's `common/` starts
a build 300 ms later. So does saving a file that the model imported from another
project (`uses` in `scene` and `state.md`: `box/box.py` for a lid that imports the
box's maker), as far as the last good build found it; torno reads this from what
the model imported and never asks you to declare it. A project that imports one
that imports it back shows the other in `uses` on both cards; Python decides
whether that works. Saving a `.py` file during a build cancels that build
and starts another. Any other file changing during a build may be the model's
own doing, so the build is left to finish and one more follows it. A build
that runs longer than 600 s is stopped; `TORNO_BUILD_TIMEOUT` sets another
limit. The line at the bottom says building with the seconds elapsed, built
with the time it took and the revision (`r3`), or failed. A failed build keeps
the last good parts on screen, a quiet band at the top left of the view says `On show: h40. The build after it failed.`, and its status opens the error with the
traceback.

**History of builds.** Every build that worked is kept under `.torno/history/` (see Files torno writes): a copy of
the Python files it was made from, its parts' numbers, and a small picture. A kept build has an id of its own, `h41`,
which goes on counting across runs of torno; the revision (`r3`) is of one run and is told beside it. The latest 100
are kept, and every one you star. A build that fails the model's own checks is kept too, marked: it is often the one
to compare against. A rebuild of sources the newest kept build was made from is not kept again; that build is then the one on show (after a restart too), so it can be compared with. **Prompts only** (in the session's **More** menu) is
the history as a list, put away again by its **Close**: one row for each prompt of the project, newest first, across
every conversation of it as one thread, with a quiet line where a conversation began. A prompt has one number wherever it is shown (a turn
of the chat, a row, `comparing prompt 14` in the status line), counted from 1 across the project by the time it was said. A row is the number, the
picture of the prompt's last build, what you said cut to a line, and under it the builds it went through (`h40 → h41`), what they came to
in a word (`passes`, `2 failed on the way`, `build failed`, `starred`, `gone back from`) and when. What you built yourself between two prompts
(your saves in your own editor, the Params you tried) is a line between the rows; the prompts a Go back undid are one faded row, openable. **Starred** keeps the
prompts with a starred build, **Hide gone back** leaves out the ones you went back from. Click a row to compare it (below), double-click it, or **Open in chat**, to read it in the chat where it was said.
The chat shows the conversation you are in; **Earlier conversations** above it reads the others of the project, one under another. Where the agent is Claude Code's own terminal there is no chat to read: Prompts only
is a pane over the session, its rows from the history's own labels of each build (a prompt that built nothing is not in it), and a row is compared but not opened; each row that built something has **Go back to before this prompt** (a terminal cannot be asked to undo, so with no copy of that build kept the click says so).

**The builds strip.** On top of the session pane, in the chat, in the terminal and with no session, it is shut until you want it: one line says the build on show and how many are kept, and a click on it opens the strip (a click again shuts it). It opens by itself when a build fails, and stays open while you compare a build or Go back asks. Open, it holds the builds the history keeps, oldest at
the left and the newest at the right. Its head line says "Builds of *name*", how many are kept, and what a pick does now ("Pick one to compare, star or go
back", "A build is running", "h40 is still on show", "Your review is of h41", "Exporting the build on show, h41"). A node is the picture kept with the build, its
id, and a muted line: the prompt it was made for (`prompt 14`), `you saved` in your own colour for a save of yours in your editor, `on show` in the accent for the
build the view draws, or `reviewing` for the build an open round is of; a starred build has a star at the corner of its picture. A build that failed is a hatched node
that says `failed`, over "after h40"; the build that runs is an outlined node with its seconds, over "building". Under the nodes of the prompts you can see in the
chat a bracket says which ones ("prompt 14, in sight below") and follows the chat as you scroll it. The strip scrolls sideways, with the wheel too, and keeps the
build on show in sight; a build that lands slides in. When the session pane is under 640 px high the strip folds to its head line and a row of ticks. A build that
runs while none has landed, a project with no build kept yet and a history of dozens are drawn the same way.

A click on a node opens its menu, standing from the node: **Compare with live** (draws that build over the one on show, as **Compare** on a turn does; it reads
**Stop comparing** while it is on, and the build on show has nothing to compare with), **Star** or **Unstar**, **Pin to board**, **Review this build** (on the build
on show, while no round is open) and **Go back to here**. A double click on a node compares it. **Go back to here** is the same Go back as the one on a turn: it goes
back to before the prompt that came after that build (so the newest build, and one that your own save follows, do not offer it), asks first with the files it
would write and delete and the prompts it undoes, and while it asks the builds and the prompts it would undo are drawn struck through and muted, in the strip and in
the conversation. A failed build's node opens its error instead: see "Build failed" below.

In the status line the last eight builds are a row of ticks after the project's name: the build on show taller and in the accent, a failed one in red, your own saves
in your colour, a running build outlined. The line says how the build on show went: "h41 built in 51 s".
The source a kept build was made from is still under `.torno/history/`, which the agent reads (`history`), and **Go back to before this prompt** and **Star** are in the menu of the dots on the turns of the chat.
What a kept build had then (checks that failed, parts with a defect, how your dimensions stood when it was checked) is as of then, never how the project stands now.
**Compare.** A kept build is drawn against the one on show, with a quiet band at the top left of the view, `Comparing h40 with live h41`: **Before** (the earlier build alone), **Overlay**
(the earlier build translucent, in grey, over the later one), **After** (the later build alone) and **Side by side** (the earlier build in the left half, the later one in
the right, one camera for both); each build alone is drawn solid, in its part colours. The later build is the live one, or, when you compare an older turn while newer builds
have landed, that older build, which stands in for the live one until you go back, and **Back to live**, which `Esc` also does. While a band is on, the switch of Board and Model steps aside. What the turn changed is written on the parts and the marks that changed, as
tags tied to them by a leader (`tub volume 28400 → 26000 mm³`, `M3 now passes`, from the numbers of the builds of the turn; `≈` where a volume is not exact): four at most,
a dimension that changed its verdict first, then the parts whose volume moved most. The rest are in the band's **and N more** (or **What changed**, when there is nothing
left out), a list that also says what the later build changed (its line) and how the checks and your dimensions moved between the two builds. A tag stands only on
what the build on show has, and side by side has none. The tags are only there when the comparing started from a turn of the chat (its **Compare** button), since the numbers are that turn's: a comparing that did not (a row of the prompts, a build in the history) has no tags,
and only the list. The status line says `comparing h40 → h41` (`comparing prompt 14 · h40 → h41` from a turn of the chat).
It is for looking only: nothing is measured, marked or picked from the kept build (side by side, nothing in the view is), a picture for the agent does not
show it, and a section, parts drawn apart or another layout put it away. A live build that lands meanwhile does not end it. A build of this run is drawn from
the meshes held in memory (never on disk, within a budget of 64 MB for the builds before the newest, the oldest let go first); an older one is built again from
its copy of the files, with the values of `Params` that build was made with, in a worker thrown away that keeps and writes nothing, and the status line says `Building h40 to compare…` while it takes: the first time
only waits for one build. A build that failed, or whose copy was not kept or no longer builds, is not drawn: the view says why. The agent reads the same with `history`, and compares any two with `diff`.

**A failed fillet or chamfer.** build123d and OpenCascade say only that a fillet
or a chamfer could not be made, naming neither the edges nor the radius. When a
build fails inside one, the kernel tries it again in parts before it reports the
failure, for 5 s at most (less when the build's own limit is nearer, and it says
when it ran out): each edge alone at the radius asked; if each works alone, the
pairs, those that share a face first; and the largest radius that works for all
of them, and for each edge that fails alone, to 0.001 mm. The error says it
under its message, such as `fillet R6 of 8 edges: each works alone; 4 pairs of
adjacent edges fail (edges 4-5, 4-6, 5-7, 6-7: 12 mm apart, two R6 need more);
the 8 together work up to R5.999`, then a line for each edge of the failures.
The shape being filleted is not a part on screen, so its edges are numbered by
their place in the call, from 0, and their ends are in its own frame (`local`);
one that is exactly an edge of one part of the last good build (its ends, its
length and the points along it) is also named by that ref, as of that build. Nothing is retried in the model. The agent is told the same with
the result of its edit and in `scene`, and can try a fillet on the last good
build with `try_fillet` before it edits the model again.

**A failed boolean.** A cut, a fuse, an intersect or a split that fails (a `StdFail_NotDone`, or `Null TopoDS_Shape
object`) is looked into the same way, within the same 5 s, by looking at its operands: nothing is run again. The error
says which of these it found, such as `cut failed: tool is a face, not a solid`: an operand that is empty, one that is not a
solid, one that is not valid (OpenCascade's check, and what its argument analyzer finds, such as a face that crosses
itself), a tool that ends flush with the face it cuts instead of overshooting it (faces of the two that lie on one
plane facing the same way), faces that lie on each other, shapes further apart than they should be, and shapes that
only touch. Then a line for each operand (its type, whether it is valid, its faces and its box) and for each pair of
faces that lie on each other, with the area they share. The operands are not parts on screen: their faces are numbered
by their place in the operand, from 0 (`tool F5`), and their numbers are in the operand's own frame (`local`). A
distance is OpenCascade's and is told with `≈`; a count of points of one lying inside the other is of points sampled
on its vertices and the middles of its edges, so it can say that none was found, never that none is there.

**The window.** On the left, a rail of icons, no word under them (the name shows in a small tip beside the icon when the pointer is over it or the keyboard is on it): Projects at the top, which shows the page of projects (it is a dark blue tile while that page is up; press it again to go back), a hairline, and then, while a project is open, one icon for each section of the route card: Needs you, Parts, Parameters, Checks, Marks, Scans, Tracings and Print profile. Keys is at the foot, and raises the keyboard.
Beside the rail is the route card, 296 px wide: the project read from top to bottom, a section after another down a line, each with a dot on it. A section's head is its name and one line of what it holds (`10, 2 hidden`); click the head to fold the section to that head, or to open it. A section with nothing in it says "none" and does not open. At first Needs you, Parts, Checks and Marks are open; Parameters, Scans, Tracings and Print profile are folded. A press on an icon of the rail brings its section into sight, and opens it if it was folded; the section in sight is the one the rail shows in the accent's wash. What a folded title used to say shows as a small badge on the icon: what waits for you on Needs you, the parts switched off on Parts, the model's checks that fail plus the dimensions that fail on Checks, the scans not aligned on Scans, the marks to review on Marks. Drag the right edge of the card to make it
wider (`Left` and `Right` with it in focus), double click it for the default width (296 px, and 264 in a window
narrower than 1360 px); the card is never narrower than that, and leaves the view at least 420 px beside the rail and
the session pane. The session pane is 420 px wide (384 in a narrow window), and its left edge is dragged the same way. Which
sections are folded and how wide the card is, and how wide the session pane is, are kept by the window, not in the folder. The card is there only while a project is open: on the page of projects, while a new
project is made and with no project open, the rail holds Projects and Keys alone. The folder's name and its menu are in the title bar.
The
layers (parts) of the open project each have a visibility switch, and for a model of ten parts or twenty they
are also the way to the part: the pointer on a row lights the part in the view, a click on its name selects it (as
a click with Select would, so "Insert in prompt" and "Note" work on it) and a double click brings it into view, the target on
the row shows only that part, and when some parts are switched off the title says `3 hidden · Show all`. A build whose parts replace every part you were looking at (the first model of a new project) shows its parts, even under a name you had switched off, and says none of them is hidden. A part that
is switched off says `hidden` at the right of its row, with its colour faint. The slider for its opacity, the target and the
eye are on the row while the pointer is on it or the keys are, as a group's header (in the sans, since the name is the model's) has
its own. After the name, a small ring holds the number of open marks on the part (in the colour of a failing check when one of
them is one); a click on it lists only those marks in Marks, under a line `Only marks on lid` with a cross that brings the
rest back. That is a view of the list: the agent is told every mark as before. It works the other way too: the pointer on a part
in the view lights its row, and the rows of its marks and of its checks, with the accent wash and a bar at the left, instead of
lines drawn to them. Parameters lists the fields of
the model's `Params` (a model with none says so): each
field's name, its default in the monospace face (four digits at most, the whole value on hover) and
its comment as the model has it, and, for a default the model works out (an expression, not a
number written in), that it is worked out in the model. The model's comments should begin with where a size
comes from (`brief:`, `M3:`, `S1 ≈:`, `ref <file>:`, `object:`, `datasheet <name>:`, `person:`, `derived:` or
`assumed:`), and under the title a line counts the sizes that say `assumed` and those that say nothing, their
names on hover; it is what the model says, not something torno has checked. Trying a value never writes the model. A
field whose default is a number or a flag written in the file (`wall: float = 2`, `lid: bool = True`), or a
`Literal["round", "square"]`, has a control under its name: type a number and press Enter, or let go of a slider
(the model gives one with `field(default=2.0, metadata={"min": 1, "max": 5, "step": 0.2})`), tick the box, or choose
from the list. The project is built again with that value, and the row says `kept by torno, not in the model file yet` with a
"Reset" beside it; "Reset all" and "Ask the agent to bake it in" (which puts a request in the session's prompt,
never sent) are under the title while any value is tried. What you try is kept in `.torno/params.json` and the file
always wins: if the model's default for that field changes, your value is let go of and the row says so, and a value
the model no longer offers is let go of the same way. The agent is told, with every prompt, which values the build
is made with. The model only sees a tried value where it is given `p`: a helper that makes `Params()` itself does not.
With a session running, a click on a row puts `Params.wall` in its prompt at the
cursor, never sent, so you can write "make Params.wall 2.4" around it; with no session the rows say
to start one. Checks lists, as one list, what the model declares in its `checks(p)` (see Projects and builds) and your own
dimension checks (a dimension with an expected value), failing first, then those not run or not measured, then those that
pass; a model with neither has no section, and the head says how many there are and how many fail (`3, 1 fails`). A row has
two lines and a gauge: for a dimension its chip (`M3`) and for the model's check a bar in the agent's colour; the name and, at
its right, a word for how it stands (passes, fails, not measured, not run); under it what was measured and what was wanted
(`2.8 mm, wanted 3 ± 0.05`) and, for a thin wall, that it was found by sampling. The gauge, 64 px wide, draws the wanted band
and the value as a tick, green inside the band and red outside it, with a dashed line from the tick to the near end of the
band; its label says it in words (`2.8, outside 2.95 to 3.05`). A failing row has a red wash. After a build, a tick that moved
slides from where it was, and its row lights once. A dimension's row goes to its mark, and opens out under the row where its
fields are (what it should be, resolve, delete) while it is the active mark. A dimension and a model check on the same thing
stay two rows. A check of a part lights when the pointer is on that part in the view. A check the agent made easier to pass, or removed, since it was first declared is
said under the rows (`walls: min 1.2 → 0.6 mm (since r7)`). A check the model rewrote for parts you renamed (the same kind of check in the same layout, under a new name) is not counted as removed. A model that says which of its parts belong together (an optional
`groups(p)` beside `assembly`, group name to part names) has them listed under a
header each, which folds the group, hides or shows all of it, or, on "Show only",
shows that group alone in the layout; ask the agent to group parts and it edits
`groups(p)`. In the viewport, drag to orbit (about the point of a part under the pointer when the drag starts), drag with the right or
middle button to pan, scroll to zoom, `F` to fit the selection (pressed again, all the parts); a triad in the bottom left corner shows which way X
(red), Y (green) and Z (blue) run in the project's own frame, as the agent's pictures
do, and in the bottom right corner are a scale bar (orthographic) or the step of the grid,
`grid 5 mm` (perspective); the compass at the top right switches view (a cube whose faces are
Top `4`, Front `2` and Right `3`, its corner Iso `1`, and "···" for Back, Left and Bottom; the face of the
view on screen has the accent wash and a padlock, since a drawing on it is a flat profile), projection (Perspective or
Ortho, `O`), layout (`assembly`, `print`: the pill with the layout's name opens the others), Fit `F` and Explode `E`. The folder crumb in the title bar
opens a menu of the folders opened lately (the open one marked "current"),
"Open folder…" and the example; opening another ends the sessions of this one,
so torno asks first, in a dialog that names the projects, if one of them is
working or waiting for an answer. A folder that cannot be opened is said at the top of
the page of projects, which comes up for it, and the workspace stays as it was.

"Rebuild", in the line at the bottom beside how the build stands, builds the
open project again from its sources as they are (`Ctrl+Shift+B` from anywhere).
It is always there, and it is the main button when the last build failed for a
reason outside the model (the build took too long, stopped, or was cancelled) or
was let go to make room: building the same sources again may work. After an error
in the model it stays quiet, since the same sources give the same error. While a
build runs it reads "Building…" and takes no press: that build is of the sources
as they are. The parts on screen are older than that build, so a click cannot pick
them from the first moment; they fade only when it has run for 0.6 s, so a quick
save does not make them blink. A build that fails fades them at once.

When a build lands after another of the same project, the status line says which parts it changed:
"tub changed, lid same", or "no part changed" when a save made no difference to what is drawn. A part counts as
changed when its shape is another or it stands elsewhere or turned. Hover the words for the lines `diff` gives
Claude Code, for example "tub: volume 6280 → 6410 mm³ (+130, +2.1 %), size 40 × 40 × 40 → 40 × 40 × 42 mm"; a
number the kernel cannot give exactly has "≈". For about a second and a half the parts that changed are also shown
as ghosts: their old edges in the muted colour, where they stood, and their new edges in the accent. They go by
themselves, fading once, or at once on any key or click. The parts that did not change are not touched. There is
no ghost while a section is on or the parts are drawn apart, nor in a picture for Claude Code.

"Build failed" opens the error, as a card from the failed node of the builds strip
(from the status line when the session pane is away), and so does a click on that
node: "The build after h40 failed", what happened in words ("Python error in the
model", "The build took too long (timeout)", "The build process stopped
(crash)"), and the end of the error. "Whole error" opens the message, why a fillet or a
chamfer failed, the traceback and what the model printed in the card. It says who is told: Claude Code is told this with your next
prompt, or was told after its own edit, so there is no need to paste it into the
chat. "Ask Claude Code to fix it" puts a short request in the message box, opens
the session pane if it was away, and never sends it: you read it and press Enter.
With no session running it reads "Start a session to fix it" and starts one with
the request waiting in its box. After a failure outside the model "Rebuild" is the
main button of the sheet instead. "Copy" takes the whole error as text. The line
above the box of the chat says "build failed" among what goes with the next prompt.

A part the build says is broken (not valid, inside out, not closed, or with a
mesh that disagrees with its volume) has the word beside its name in the
layers, with every defect it has in its tooltip, and the line at the bottom
counts such parts ("1 part has a defect"). The agent is told the same after its
edit (What the agent is told).

When the project is in a git work tree, the status line and the card say what has changed since the last commit: "3 files changed since `a1b2c3d`", with the files in the tooltip (the `.py` files and the others of the project's folder, and `common/`; not `.torno/`), or "No changes since `a1b2c3d`". It is read when the project is opened, when a build ends, and when the window is focused again. torno only reads: it runs `git status` with `--no-optional-locks`, which leaves the index as it is, gives it five seconds, and never commits, adds or changes anything. Without git, or outside a repository, nothing is said. Commits are the agent's: ask for one in the chat (the Marks section of the route card offers a request, see Marks).

The pointer is told what it is on: a face (`lid/F12`), or an edge within reach
of it (`lid/E3`), with a line from the kernel on what that is, such as
`plane, normal +Z, z = 20, 1180 mm²`; a face or an edge that the model names (`tags(p, parts)`, see Projects and
builds) is told with its name, `lid/F12 · @top`. Hidden parts are never picked. While the
parts on screen are older than the model (a build is running, or the last one
failed) nothing is picked, and the pointer says why.

### Making a new project

"New project" starts one from what you have. It is in the header of the page
of projects. A folder with no project in it has no page of projects: it shows a dyed plate, "Nothing in the vise yet", and
beside it "What are we making?". Say what you want in the box, and add what you have with the chips **Photo**, **Doodle**, **Bought part** and **Scan** (the
pickers of the page below). The foot of the box says where the project goes, "Goes in `parts/cable-clip`", a name torno offers from your words that you can
change, and **Start** makes the project and starts Claude Code with your words as its first prompt; nothing is written before. Under the box,
"open the full new project page" opens the page below with what you typed on it, for sizes and rules, and, where torno runs from its repository,
"open the example" looks around. The way for models you already have (a folder
such as `part/part.py`, and the note on `pyproject.toml` and `uv`) is in a fold, "Already have build123d models?". The page is the brief on paper, with what Claude gets first on a dyed field beside it; the session dock is hidden while it is up, and comes back as it was when you leave. At the left, "New project. Nothing is written until you start." and **Discard**. Then the name, as `parts / cable-clip` at a large size (the folder in grey, the name in ink; "The folder's name: letters, digits, − and _."). Then "What are we making?" and its box ("What is it?": what it is for, what it must fit or hold, how it will be made). Under the box is a row of tiles for what you have given, the photos, doodles, bought parts, scans and projects, each with its name and a note for Claude, then two dashed tiles: **Sketch it** (or press `S`, a doodle) and **Drop anything** (photos, STEP, PDF, scans; the tile opens the photo picker). "Sizes I know" and "Rules" are two cards under them, and "Also: Bought part, Scan, Other project, Link or PDF" are links that add those. "Link or PDF" opens a third card, "Links and PDFs". Files can be dropped anywhere on the page: a picture becomes a
photo, `.step` and `.stp` a bought part, `.pdf` a PDF, and a scan format a scan. An image pasted with `Ctrl+V` is taken as a dropped one is (only a file on the
disk can be: a copied file is, a screenshot has none, and the page says so). At the right, on the dye, "What Claude gets first" ("Written from this page as you add to it.") shows the first prompt as it will be sent (your own words brighter, references as outlined chips, the sizes in the face of numbers). At its foot it says what will be made ("Makes `parts/cable-clip/` with `cable_clip.py`, `brief.md` and `reference/`."), then come the model and effort, **Start: make the project and ask Claude** and "Or make it without starting Claude".
Each kind of what you give is:

- **Photos** ("Drop anything", or dropped on the page): PNG, JPEG or WebP, at most 12, 25 MB each and 50 megapixels
  (a larger picture is refused with a reason on the card, before it is decoded). HEIC, the iPhone's default, is
  not read: set the phone to Most compatible, or export as JPEG. Claude gets each one attached to its first prompt, after a line naming it ("Picture 1: reference/photo-1.jpg"),
  scaled to 1280 px on its long edge; the original is copied to `reference/photo-<n>.<ext>` in the project.
- **Doodles** ("Sketch it", or `S`): up to 6, drawn on a board (below). Claude gets each as a PNG with dark ink on white,
  over a light grid (1 square = 40 px of the board, no scale, and the prompt says so), whichever theme you drew it in, and `reference/` keeps it.
- **Bought parts** ("Bought part" under Also, or dropped): a vendor's STEP file (`.step` or `.stp`) of a screw, a bearing, a
  board, a motor; up to 4, 50 MB each (a larger file is refused, and is never read whole). The file is copied as it is into `reference/` under its own name
  (made safe for a file name; `608zz.step`, or `608zz-2.step` if two have the name), and the prompt names it and tells Claude to read it in the
  model with `import_step` and return it among `references(p)` (see "Bought parts" under the model), not as a part to print. torno reads
  nothing of it itself.
- **Scans** ("Scan" under Also, or dropped): up to 4. They are imported into the project as "Import scan…" does, not
  copied and not aligned; Claude is told each scan's file name and id, and that it is not aligned (you align it in
  torno); `brief.md` keeps the path it came from, with `~` for your home folder.
- **Sizes I know** (the card's "Add a size"): up to 40 rows, each with what it measures (200 characters at most), a value kept as you typed it (60 characters: one number, `a × b` or `a × b × c`, with `Ø` (or `⌀`) or `R` in front, and the unit may be typed after it (`62 mm`) and is said once; anything else is kept as text and Claude is told it is not read as numbers), a unit (`mm`, or `°`), where it came from (`measured`, `from a manual or datasheet` or `a guess`) and a note. A row you have typed nothing in is left out; one that is half done holds "Start" back until it is finished or removed. Claude is told each as given, and asks only for the sizes still missing.
- **Links and PDFs** ("Link or PDF"): up to 20 links (an `http` or `https` address of 2,000 characters at most, with a note of 300) and up to 6 PDFs of 25 MB each ("Add a PDF…", or dropped). torno opens no link and reads no PDF: Claude is told them, and reads them with its own tools if it helps. A PDF is copied into `reference/`.
- **Rules**: free text of up to 4,000 characters (the printer, the material, the least wall), given to Claude as written.
- **Other projects** ("Other project" under Also, a menu of the projects of the workspace): up to 8. Claude is told to look in `../<name>/` and
  gets the project's summary (its parts and box, with whether the kernel says it is exact; "not built in this run"
  if it has not been built) and its thumbnail.

At most 6 pictures go with the prompt, photos and doodles first, then the thumbnails of other projects; a picture
beyond that, or one that fails the checks (PNG or JPEG, 2000 px at most, 3.75 MB, so that it is under 5 MB as
the API takes it; a PNG over that is sent as a JPEG), is named in the prompt as not attached, with the file in `reference/` to read. Notes are kept to a line each and the description to 20,000
characters.

The name is the folder's and its model's: letters, digits, `-` and `_` (no dots), starting with a letter or digit, at
most 64 characters, and not one that is there already (compared without regard to case, and `a-b` is `a_b`). Torno
refuses a name that would stand in for a library (`json`, `typing`, `numpy`, `build123d`, any module of Python's
standard library), since a model's folder leads the import path and its file would be imported in the library's
place; also Python keywords, the workspace's own `common`, `tests`, `out` and `docs`, `tools`, `reference`, and a
name whose model file would be taken for a test (`test_*`, `*_test`). The page says why while you type.

"Start" (or "Or make it without starting Claude") writes one new folder in the workspace and nothing else: `<name>/<module>.py` (a placeholder, a 20 mm
cube, to be replaced), `brief.md` (your words and a line for each reference with its note) and `reference/`, and the project's board with what you gave in frames
(Brief, Photos, Doodles, Sizes, Rules, Links, Bought parts, PDFs); the sizes, rules and links live on the board and in the first prompt, not in `brief.md`. The
`.torno/` folder is made as for any project. It is made in a hidden temporary folder beside it and renamed into
place as the last step, so it is whole or not there, and it never goes into or over a folder that exists (an
empty one of that name is used). A temporary folder a crash left is swept away at the next opening of the
workspace once it is ten minutes old, unless it holds files in `reference/` (your doodles and STEP files may be nowhere else):
such a leftover, a hidden `.<name>.torno-new-<hex>` folder in the workspace, is yours to look at and delete. Then torno opens the project on its board, imports the scans, starts Claude Code in a
chat and sends one prompt with everything. "Or make it without starting Claude" stops after opening the project: no session starts and nothing is sent, but the scans are imported all the same, one after the other (one that fails is named in the pane of the session as not imported, and the others still go in). The prompt asks Claude to list the sizes that decide fit or function and
say where each comes from (your words, a note, a scan, another project, or nowhere), and to ask you for those that come
from nowhere in one round (a card in the chat, at most four questions, each with a typical value among its options;
"build with assumptions" is an answer) before it builds. What it builds without an answer is marked "assumed" in the
model, and its reply lists those. If Claude Code cannot start (the command is not found, or the
trust question stands, or the CLI starts and leaves at once because it is signed out or too old), the project is made
and open anyway: the pane says why and the text of the prompt waits in the message box for you to send. Where
torno already knows Claude Code is not found or not signed in, the page says so above "Start", before the folder is made. The
pictures are not sent then: the text says each is "not attached" and names the file in `reference/` (and the
`.torno/thumb.png` of another project) for Claude to read. If the project was made but the workspace does not list it,
the scans were not imported, and the page says so and where the folder is. While "Starting…" or "Making…" shows, `Esc` and Discard do nothing.

While the page is up the window is about the project being made: the crumb of the title bar reads "New project", the route card gives way, and the status line says "New project" with the build123d version alone. The page shows
the first prompt Claude Code will get, as it will be sent and read-only, filled in as you go:
your own words in ink and what torno adds in grey, and under it a thumbnail of each photo and doodle, with "attached"
or "named only" (only the first 6 pictures go with the prompt). The session pane points to it. A session of the project that was open that is
still running stays as it is, a question waiting in it included, under a note saying whose it is: it goes on, and
the new project gets its own. Discard or `Esc` brings everything back as it was.

Above "Start", "Claude Code on" picks the model and the effort the new project's session starts on. Both start
at "Your default", which passes nothing: Claude Code goes by your own settings. A choice holds for that session
alone (torno starts the CLI with `--model` and `--effort`) and is never written to your settings; the page keeps
it for the next project you make in this window. The models are the ones Claude Code offered in the last chat
(kept in torno's own data), or its aliases, Opus, Sonnet and Haiku, before any chat has run; the efforts (Low,
Medium, High, Extra high, Max) are the ones the chosen model takes, and a model that takes none leaves the effort
off. Both can be changed in the chat afterwards.

The doodle board (the same board as the chat's "Draw on view") has a thin pen, a thick pen and an eraser, "Undo" and `Ctrl+Z`, "Clear", and "Done" and "Cancel". The doodle board fills the window and has a light grid
under the ink; hold `Shift` while drawing for a straight line from where the stroke began. (A drawing on the view has no grid: its ground is the picture.)
`Esc` puts the board away; if strokes were drawn since it was opened it asks "Discard this doodle?" first. A
doodle can be opened again from its card and changed. "Draw over" (when photos are given) puts one of them under the ink,
fitted whole on a white ground, with no grid; on screen the ink is dark with a light edge over a photo (and over a doodle you draw on again), so it shows on a white one and a dark one in both themes; Claude gets the photo with your ink on it, and the note says "drawn over reference/photo-N.ext", and the prompt says it is your ink over that photo and not a drawing on the grid. If you remove that photo
the doodle stays as it was drawn, and still says it is drawn over a photo (with no file named).

What you have entered is a draft, kept while the window lives: you can leave the page, open another project and
come back. `Esc` on the page leaves it, asking first when something is in it; so does leaving the workspace, and so
does closing the window ("A new project is set up here and not made yet"). Nothing of the draft is written until
"Start".

## The agent

Each project has its own session: Claude Code running in the project's folder.
It opens in a chat, a pane of torno's own, or in a terminal when you switch to
it. It keeps running while another project is shown. A session that works or
that waits for your answer (a permission, a question, a plan) says so wherever
you are, not only in its own pane. In the project crumb's menu its row has a dot
after the name: a quiet one while it works, and, in the warning colour with the
words "needs you", while it waits. On the rail, the Projects icon has the dot of any
session of the folder that works or waits, and says which project's waits
("bracket needs you") in its description. Nothing is shown for a session that is idle
or ended. When the session pane is hidden, its button has the same dot for the
open project's session. And when any session of the folder waits for you, the
status line has a button "*bracket* needs you" (with "and N more" if several do,
the first in the list named): it opens that project, shows the pane and takes you
to the card. If the window is not the one in use when a session starts to wait,
its frame flashes (the dock icon bounces on a Mac), once for each question; torno
posts no system notification. "New session" (in the **More** menu of the header, or the button of the pane with no session)
starts one, in place of the session running there, if any; torno asks first if
that one is in the middle of its work. "End" (in **More**) ends the session and starts
none, asking first in the same way. "Resume" continues the last
conversation Claude Code had there. In the chat view the empty pane has the box already: write, press
`Enter`, and a session starts with your prompt. Where a conversation is on file its last turns are shown above the box,
under "Last conversation, 2 days ago", with "Continue" (the default) and "New conversation" beside "Send"; the
buttons "New session" and "Resume" start one with no prompt and leave what you wrote in its box, unsent. If
the folder has Claude Code settings of its own, the question is asked first and your prompt waits in the box. The empty
pane has no "Attach view" or "Draw on view": those are of a session. ``Ctrl+` `` moves between the session and
the viewport; `F6` and `Shift+F6` go round the parts of the window, and `Ctrl+Shift+D` shows or hides the session pane (it does nothing on the page of a new project, where the pane is hidden and its button in the title bar is off). In a terminal `Shift+Enter` is a new line, `Ctrl+Shift+C` and
`Ctrl+Shift+V` copy and paste.

### What goes well, and what does not

What torno and the agent do well, and where you have to help. This comes from how the loop has gone on real
projects, not from a promise.

Goes well:

- Prismatic parts: brackets, enclosures, holders, a lid and a box, hole patterns, a part with a slot or a rib.
- A part whose sizes you measured. Give them in the first prompt, or in the brief, as numbers.
- Changes you can point at: a pin on a face, a dimension with the value it should have.

Needs more from you:

- A shape that has to fit a place you can only scan, such as an engine bay. Import the scan, align it and mark
  regions of it. What is taken from a scan is approximate, and torno says so (see Scans).
- An assembly of more than three or four parts that touch each other. Split it into projects of a few parts, and
  check each pair with `check`.
- A fit that depends on how your printer behaves, such as a clearance or a snap. Print one, measure it, and give the
  agent the number. A clearance the agent assumed is only an assumption.

Does not go well:

- Ergonomic and organic shapes described in words alone. Show a photo, a doodle or a scan, and expect to try several.
- Gears, threads and springs written by hand. Ask for a library part, or for a plain stand-in you replace.
- Sizes read from a photo. The agent will give a number, and it will be a guess. Measure with calipers.

In every case the answer is the same: give a measured number, a scan or a dimension mark, in place of a description.
How to work with the agent is in the README's
[guide](../README.md#working-with-claude-code-in-torno).

### The chat

The chat is your own `claude`, under your own login, started in its headless
mode (JSON on pipes instead of a screen). Torno draws what it says and does;
nothing of Claude Code's settings is read or changed (torno lists the paths and sizes of the instruction files Claude Code reads, never their text). `Enter` sends, `Shift+Enter`
is a new line, and a prompt sent while the agent is at work waits its turn
("Prompt 15 queued", outlined; "Stop" interrupts the turn, and what was queued still runs after it; `Ctrl+C` does the same in the box when nothing is selected there).

- **Suggestions.** While the box is empty, up to three quiet chips above it offer
  the next useful prompt, each only when it applies: "Fix the build" while the
  build has failed, "Review N marks" while marks are open (`/mcp__torno__review`),
  "Check printability" for a model with a `print` layout that no turn has checked
  (`/mcp__torno__printable`, for which you may add your bed after it), and "Explain
  this model" in a conversation not yet begun (`/mcp__torno__explain`). A chip puts
  its words in the box and gives it the keys; nothing is sent until you press
  `Enter`. The prompts of torno are not offered when Claude Code says torno's
  tools are not connected.
- **The prompts.** The conversation is cut into prompts. Each starts with a head: "Prompt 14", the builds it made
  (`h40 → h41`, `h40 → failed`, or `h40 → …` while one runs; "no build" for a question) and a hairline. Then your words in a
  block of ink, Claude's text, and the tools it used as small chips (the ones of torno's own on the blue wash, the one
  running ringed); a run of finished tools is one chip, to open.
- **What torno added.** Under each prompt, a "with" line shows what went
  with it: the marks sent, as chips in their colours, the build (`r12 ok`, or
  `build after r12 failed`), and the selection; "Show text" opens the exact text the agent was given. Above the
  box, "Goes with your next prompt" says what will go. A prompt that carried a review says `review R1 sent`, and one sent
  while a round waits says `R1 is in review, not sent`; the marks of a round that was not sent are not among what goes (see [Reviews](#reviews)).
- **The build an edit started.** When the agent edits the model, the build that
  follows is a slip of its own under the edit's card, on the surface. Its head
  says `Built h41 ok 51 s` (the build as the history names it, `r2` until it
  has it), or `The build after h40 failed` in the fail colour, with the last
  line of the traceback under it in the monospace face on the fail wash and
  "Show error" opening the sheet of that failure while it is the latest build;
  "Show text" is at the right of it. Under the head, each dimension whose
  verdict that build changed has a row (`M3 tub wall 2.8 → 3 mm now passes`,
  `M2 now fails`), and the parts it changed are a table: the part, its volume on
  the build before, on this build, and the change (`+6.3 %`), the biggest
  change first, with `≈` where a number is not exact. The new volumes count up
  from the old ones once, in a moment, and show at once when your system asks
  for less motion. Six parts at most; the rest are "3 more changed", a click
  unfolds them, and "5 parts did not change" says how many stood. "Show text"
  opens the exact text the agent was given. A revision names a build that
  worked: a failure has no number of its own, and is told as the build after
  the one still on show (the first build, when none has worked), in the window
  and in what the agent is told. Once a build has failed, the chip of the build
  still on show opens the same sheet.
- **What the agent pulled from torno.** Every tool of torno's it calls is a card
  of its own, with its input, its result and its pictures as thumbnails that
  open large; the turn ends with a line such as "Pulled from torno: scene, 2
  pictures, measure ×3". Other tools are one line each, opened for their input
  and result; a tool that went well says nothing on its line, and one that is
  running, failed, was denied, cancelled or stopped keeps its word. Once a turn has
  ended, three or more of those lines in a row (the agent's own tools that finished,
  with no picture and no build under them) are one line, `Read 3 files, Grep ×2,
  Bash`, that opens into the lines; the lines of a turn still going on are all
  there, and folding changes nothing in the conversation or its log. The refs in a card's line are chips. A finished `look`, `section` or
  `show` has "See in view" (or "Show again" for `show`): it puts what the agent
  looked at on your screen as your own edit, as a saved view is applied (the layout,
  the parts shown, the cut or the parts apart, the scans, and the camera), so that
  you can turn it, measure in it or save it. A look framed on a place (`focus`) is
  not framed again. A finished `highlight` has "Point again", which lights its refs
  once more, while the window shows the build they were read from and the card was
  seen as it happened. When a card cannot be gone to (another layout, a part or scan
  the build lacks, parts apart under a cut) the line says why, in the tools' words,
  and nothing changes.
- **The agent's task list.** What the agent plans with `TodoWrite`, or with the
  task tools (`TaskCreate`, `TaskUpdate`) Claude Code has behind
  `CLAUDE_CODE_ENABLE_TODO_TOOLS`, is one line above the box while the turn
  runs and has a task left (`2 of 4`, a bar for each task, and what is being done in the words
  of "doing"), and a card in the transcript where the call was, as the list stood
  then. torno reads it from the cards and keeps nothing of it.
- **What the turn did.** The last line of a turn says, from the turn's own
  items, what it did to the project: the files the agent edited ("hollow.py
  edited ×2"), the builds those edits started ("r1 → r3 ok", or "build
  failed"), the marks it resolved and added, and the dimensions whose verdict
  is another than it was ("M3 now passes"). A turn that did none of these says
  only how long it took.
- **See changes.** A turn that edited a `.py` file has "See changes" under its
  account. It opens a sheet over the view's area only (the card and the
  session pane stay as they are), and the turn it is about is lit in the chat
  with an accent bar while the sheet is open. The top half is the view itself,
  with the parts the turn changed written on as tags ("airbox-tub volume ≈
  1,200 → 1,300 mm³", "`M3` now passes", at most four, the rest in a line), and
  at its head "Changes in this turn", "read only" and, when the history has the
  build the prompt began from, the two builds as `h40` and `h41`: pressing the
  first draws that build in the view through Compare, the second puts the live
  build back (closing the sheet does too). The bottom half is the code: a tab for each `.py` file directly
  in the project's folder that the turn changed ("airbox.py +3 −2"), and at the
  right "Changes" or "Whole file": the file at the start of the turn against its
  end as lines removed and added, with their line numbers, or the file as it is now
  (the sheet is read only and runs nothing). Under
  them, the builds of the turn taken together, from the kernel's numbers: a
  part's volume and face count before the turn's first build against its last
  (`≈` where a number is not exact). Escape or Close puts the sheet away. torno reads the files when you send a
  prompt and when the turn ends, and keeps the two texts in memory for the
  last 20 turns of the session: nothing is written to disk, not under `.torno/`
  and not in the chat's log, so a turn of an earlier session, or one more than
  20 turns back, has no changes to show. Only the project's own folder is
  looked at, not `common/`, and a file over 200 KB is said to have changed
  without its text. The button is there when the agent's edit tools changed a
  `.py` file; the sheet then lists every file that differs, a change made by a
  command (`sed`, a script) too.
- **The builds of a turn.** The builds a prompt made are on the builds strip on top of the session pane (see Projects and builds), no
  longer under the turn's account. The turn ends with "Done in 58 s" and what it did, and at its right the buttons of the turn: **See changes**,
  **Compare** (draws the last build over the one the prompt began from, as "Compare" below does; it reads "Comparing" while it is on and puts it
  away again), and the dots, a menu with **Go back to before this prompt**, **Star** (keeps the last build: a starred build is never let go;
  **Unstar** takes it away) and **Pin to board**.
- **Between turns.** What you did yourself shows as one quiet line between the turns: "You saved
  `common/fillets.py` in your editor · `h39`" for a build your own save made, "You set `wall` to `3` · not in the model yet · `h40`" for a
  value you set in Parameters (a value put back reads "You put `wall` back to the file's value"; a build kept before the values were
  kept still reads "You tried `wall`"). Several in a row, with no prompt between, are one line ("You saved 3 times in your editor ·
  `h39` to `h41`"). torno says which build was whose when it keeps the build, so a save made while a turn runs is
  yours, not the agent's.
- **Go back to before this prompt.** On a turn that made builds, while the session is idle. It first says what it
  would do: the files it would write, the files it would delete (a `.py` file of this project first seen in a build after the one it goes back to), the files it leaves as they are (`common/` and other projects' files, which it never changes), the
  files you changed since (a save of yours among the builds it undoes counts: they are overwritten or deleted, and are named), your saves it undoes ("and your saves `h42`"), whether the Params you tried are put
  back as they were, and the prompts it undoes. On "Go back" it puts the project's own `.py` files back as they were
  in the build the prompt began from, from the copies under `.torno/history/`, each whole or not at all; Claude is
  told, with your next prompt and in a note in the chat, what was put back and that it keeps what it learnt. The
  prompts it undid are folded into one faded row ("Prompts 10 to 12 · you went back from these", with "Show"). When
  no copy of that build is kept (it was too large, or has been let go), the confirmation says "Claude will be asked
  to put the files back instead", and "Ask Claude" is today's undo: torno writes a prompt of its own, from the two
  texts of each file it kept for "See changes", with the lines to reverse (`-` is in the file now and goes, `+` comes
  back), sent as yours after a quiet note; the agent edits itself, through its usual permission cards, and torno
  writes nothing then. That request is for the latest turn only; a file over 200 KB or too many lines is named without
  its lines, and a file you saved after the turn is said to have changed. It is a request, not a restore: it can be
  done wrongly. Nothing is kept of a turn of an earlier session for it.
- **Refs are live.** `M4`, `T1` (a tracing: a click opens it in the Tracing view), `lid/F12`, `lid/E3`, `lid/@top` (a name the model
  gives a face or an edge) and `#deck` (a named set of yours) in the agent's text and in
  the cards are chips: hovering one lights it in the view, clicking a mark
  focuses it, clicking a face or an edge selects it (a name of several selects them all; a set selects its faces, edges and parts, and hovering it lights every member, strokes too). A `#name` that no set has is only text. A ref that names nothing
  now (a mark that is gone, a part not shown) says why and does nothing. What is
no ref of this project is only text: an `M3` clearance hole when the project has
no mark `M3`, a build `r9` that has not been made, a part the build does not have.
- **The foot.** Above the box, up to three suggestions (a fix for a failed build is in red). The box holds what goes with the next
  prompt (the marks, a drawing waiting, the view or part of the board, a review's chip, a tag asked for), then your words, then
  a bar with "Attach view", "Draw on view", the key (`Enter`, or `Ctrl C` while Claude works) and "Send", or "Stop" and "Queue".
  On a question of Claude Code's own, the keys `1` to `9` pick or toggle the option of that number (on the first question not yet answered), unless you are typing in a field.
  With a review attached the box says "The review goes as its own prompt. Add words to it here."
- **When it asks.** A permission is a card at the foot of the dock, over the box, with a warm edge on top; the conversation
  keeps a line where it was, and the card once it is answered: "Allow",
  "Allow for this session" (offered when Claude Code suggests a rule; the rule
  holds for this session only and is never written to any settings file) and
  "Deny", with what to do instead if you give it. While a permission or a plan waits, what you
  write in the box is the answer: "Deny and send" (or `Enter` in the box) refuses with it, and
  "Queue" leaves the card as it is. `Enter` on the card itself allows it. A change to a file (`Edit`, `MultiEdit`)
  is shown as lines removed (struck through, with a "−") and lines added (with a
  "+"), the first six of them and "Show all"; the same lines are in its tool card
  when you open it. They are the lines of the edit, not of the file: where in the
  file it lands is not shown (the card says so), and an edit that replaces every
  match says that. A text of more than 400 differing lines is not compared: all
  its old lines are shown removed and all the new ones added. A `Write` shows the first lines of what it will hold. A question of the agent's is a card that
  shows one question at a time ("1 of 3", its options as a list of rows and an "Other" row, Back and Next), then "Review" with every answer and "Send answers"; a plan is shown to be approved or kept
  planning. The session reads "Needs you" while a card is open. "Stop" with a
  card open ends the turn and the card reads "Cancelled: the turn was stopped";
  nothing is run.
- **Subagents.** What a subagent (`Task`) says is not drawn as the agent's own
  words: its card counts the steps it took ("12 steps") and, opened, lists the
  tools it used.
- **"Attach view"** adds a picture of the viewport as you see it to the next
  prompt only. Pressed, it shows a small picture of the view as it is now above
  the box, with "Remove"; the
  picture that goes with the prompt is the one shown, whatever the view does
  meanwhile.
- **"Draw on view"** opens a board over a picture of the view: the very picture
  the agent's `look` makes of it, with the axes, the scale bar and the marks
  numbered. Draw on it as on the doodle board (two pens, an eraser that takes
  away only your ink, "Undo" and `Ctrl+Z`, "Clear"); the ink is magenta, edged
  with a thin line, which no mark is drawn in. The "Label" tool (`T`) places a
  label: click the picture and type a line of at most 200 characters (up to 20
  labels), then drag from the label to point an arrow at something; "Remove arrow"
  and "Remove label" are beside the label while you write in it. Under the picture
  are a comment (one line, 2000 characters) and "Add a reference", which opens a
  dialog for a photo or a picture (or drop one on the list), up to six, each
  scaled to 1280 px and each with a line of its own (300 characters). "Done" keeps the drawing as a view
  note, a draft among the marks, and the box has the keys again, for the prompt
  it goes with. Each note that waits for it is a row above the box: its picture
  with the ink, its comment, what the ink lies over (refs that light their face
  in the view under the pointer), "Edit" and "Remove" ("Undo" brings a removed note back for ten
  seconds); one whose pictures are not on this computer says so, and still goes
  with the prompt in words. Several can wait, and "Draw on view" stays open while
  they do. What the eraser took stays erased when a note is opened again. The sheet says before "Done" when the view moved under it, so what
  the ink lies over could not be worked out; the head of each arrow is looked
  under as the ink is. A note is opened again, from the row above the box or from its row in the
  marks list ("Edit"), on its own plain picture to change
  its ink, labels, comment or references; one whose picture is not on this
  computer opens with its comment and references only. A note goes with your next prompt, whatever you write; once sent
  it is a sent mark like any other. The prompt carries, after the picture "Attach
  view" shows when there is one, each draft note in the order of the marks: its
  words, the picture with your ink, then its reference pictures, up to six
  pictures in all; one past that is named in the words and not attached. The
  words say which build it was drawn on, the camera it was seen from (so that
  Claude Code can `look` from there again), and stroke by stroke the faces of the
  parts, the cut faces of a section ("the cut face of lid") and the scans your
  ink lies over, by ref with the kernel's line for each face (`lid/F12 (plane,
  normal +Z, z = 20, 1180 mm²)`). Where both ends of a stroke lie over a face, the words also give the stroke as a vector: its ends in
  mm on the surface, how long it is and which way it points, with a guess at the end that has the head (the end where the
  stroke turns back on itself, as an arrow's does; else the ends are as drawn). Those numbers are read off the mesh the view draws, so they are close and
  not exact, and a line above the strokes says so. No other coordinate is taken from the drawing. If the
  view moved while you drew (the agent's `show`, a build), they say what lies
  under the ink was not worked out; if the model was built again before you sent
  it, that the refs are of the build you drew on. A note whose pictures are not on
  this computer goes as words only. The prompt, once sent, shows under its
  pictures what each note's ink lies over (`Over tub/F3, tub/F1, the cut face of
  lid · stroke 1 partly over no part · stroke 2 over no part`), the refs as chips
  that light their face in the view when the pointer is on them. The terminal view
  has no "Draw on view". The pictures are kept in the project's `.torno/notes/`,
  never in the chat's log; the line of what the ink lies over, refs only, is text
  in the log like the rest of the prompt. A picture torno let go of (the ink an edit
  replaced, a reference taken away, a removed note's) is listed in `dropped.json`
  beside them and deleted when the project is first opened in a later run, unless a
  note has it again or a file kept aside (`marks.json.corrupt-…`, `marks.json.dropped-…`) names it. A picture
  that is not on that list is never deleted, whatever the notes name: switching
  branch never takes one.
- **What Claude Code says of itself.** torno reads the account the CLI gives at
  the start of a turn and says what a person would miss: a warning when torno's
  tools did not connect, with what the CLI said; a warning when torno's skills
  did not load, with "Restart with the whole prompt" above the box, which ends the session and
  goes on with the same conversation told in the prompt what the skills would say; a quiet
  line, once a session, when the chat is billed to an API key (it says
  what Claude Code names as its source) and when the CLI is older than 2.1.300 or of a
  newer minor than 2.1.x (torno was checked with 2.1.300 and 2.1.301; any other 2.1 is quiet). While the API is being retried the status
  at the top reads "Working, retrying (attempt 3)". A permission the CLI
  refused by itself, with no card to show it, is one warning at the end of the
  turn. When the CLI says a turn could not authenticate (it marks its answer
  `authentication_failed`, as it would should `claude -p` stop reading your
  login), a warning says the chat could not use your login, once a session, with
  "Use the terminal", which runs this project's sessions in Claude Code's own
  terminal, the conversation going on there. A field the CLI does not print is not a warning. Nothing of your settings is read.
- **`/` commands.** Typing `/` offers the commands Claude Code has; `Up` and
  `Down` choose, `Tab` completes, `Esc` closes the list. `/compact` leaves one
  note with the tokens before and after. What you type is sent to Claude Code as
  typed; `/model` is not one of the commands torno has checked in the chat, so
  use the model menu for the model of the session.
- **The model** is chosen in the menu of the model button in the header (`opus-5-5 ▾`),
  which also holds the edits and effort menus. It changes the model of
  this session only; `/model` typed in a terminal session changes your default
  (see below). **The effort** is the menu under it: "Default effort" until you
  choose one (or one was chosen when the project was made), then the level, from
  those the model takes. It too is for this session only, and a note in the chat
  says each change. **The edits menu** under them sets how Claude Code asks
  before it changes something: "Ask before edits", "Accept edits" (edits go
  through without a question; other asks still come to you) or "Plan only". It is
  for this session only too, and your settings are not written. A mode your own
  settings start the session in stands as it is until you choose one. A line under the box shows the rate limit once more than half of
  it is used.

The header of the session pane is one row of 40 px: "Claude Code", the state (a dot and
a word: Starting, Idle, Working with the time it has worked (`0:42`), "Needs you" in the warning colour, Ended),
the model button, **Chat | Terminal**, and **More**. **More** holds End, Resume (once the session has ended), New session,
Prompts only, What Claude Code reads and Hide session; what each does is told below. **Chat | Terminal** switches the same conversation between the
two: the session is ended (torno asks first if it is busy) and started again,
resuming it. With no session it sets what the next one will be; the choice is
kept in `.torno/agent.json`. What the chat showed is kept as text in
`.torno/chat/`, and a resumed conversation shows it under "Earlier in this
conversation"; pictures are never written. A revision counts from 1 in every run of torno, so `r12` of an earlier part of the conversation may name another build now: the chip's tooltip says so there, and in the current run it says what the build was made from ("sources `9f3e1a2b4c5d`, on `a1b2c3d` with changes": a hash of the `.py` files it read, the commit then checked out, and whether files differed from it), also under "Show text" of the build line. `.torno/builds.jsonl` keeps the same for each build. The photos and doodles you gave when
you made the project are shown again from `reference/`, by the name the log
keeps (one you have since deleted says `reference/doodle-1.png is no longer
there`); a picture a tool gave says "Picture of an earlier build, not kept",
and any other "Picture not kept".

### What Claude Code is given

Torno runs Claude Code, and changes nothing of its settings: everything it
gives it is on the command line, in the environment, or in a file of torno's
own that holds no secret. It reads none of its settings either. Of the
instruction files Claude Code reads on its own, it lists the paths and sizes
(next paragraphs) and never their text.

- Torno's tools: `--mcp-config` (the path of a file under torno's own data
  folder that names torno's MCP server), `--allowedTools mcp__torno__*`.
- The session's token: `TORNO_SESSION` in the environment, which Claude Code
  sends in the `X-Torno-Session` header of every request to torno. It is never
  on the command line (see "Limits and exactness").
- Torno's instructions: `--append-system-prompt`, and torno's skills with
  `--plugin-dir`. They give the loop: after an edit, numbers first
  (`measure`, `check`, `section`, `diff`), then one look with the marks drawn.
- Hooks: `--settings`; it posts them to torno, which follows its status by
  them (idle, working, needs input, ended) and adds to its prompts.
- What you marked goes with your next prompt, by itself, and counts as sent
  once the prompt's hook has been answered with it. The marks of a review round that you have not sent are the
  exception: they wait for **Send review** (see [Reviews](#reviews)).
- The instruction files Claude Code reads for the project are listed in the
  session pane, under **More**, **What Claude Code reads** ("Claude Code also
  reads, by default, `~/objects/CLAUDE.md` 7 KB"), for the chat and for the terminal. It is
  what Claude Code loads by default when it starts in the project's folder:
  `CLAUDE.md`, `.claude/CLAUDE.md` and `CLAUDE.local.md` in the folder and in
  every folder above it, `.claude/rules/` there (one entry: the folder, "up to"
  how many `.md` files, their size: a rule that names `paths` in its frontmatter
  loads only when matching files are used, which torno cannot tell without
  reading it), your own `~/.claude/CLAUDE.md` and
  `~/.claude/rules/`, and an organisation's file (`/etc/claude-code/CLAUDE.md`
  on Linux, `/Library/Application Support/ClaudeCode/CLAUDE.md` on a Mac). An
  `AGENTS.md` or `.claude/AGENTS.md` is listed only when none of the first
  three is in the folder or above it, as Claude Code reads it only then. Only
  paths and sizes are looked at, never a file's text, and a link is listed by
  its own name and not followed. A name is a button that shows the file in its
  folder in your file manager. It is a list of what Claude Code reads by
  default: `@path` imports, files of subfolders (which it loads when it works
  there) and the settings that leave files out (`claudeMdExcludes`,
  `--setting-sources`, "Project instructions") are not followed. The first
  prompt of every session, and the first after `/clear` (when Claude Code loads
  the files again), says the same to the agent, with the paths and sizes (a
  "with" line also says how many, without opening it),
  and that what torno's tools say of the build is current: a `CLAUDE.md` that
  names another viewer, report or export step is about another way of working,
  so its advice on how to model stands and its way of seeing the build does not.

`.torno/agent.json` keeps the view, chat or terminal, with `"agent":
"claude"`. A file that names another agent is not followed: Claude Code is
used, in the chat, and the pane says so, with "Use Claude Code" to write the
file anew. One that names Copilot CLI, which torno also ran until 16 October
2026, says that torno no longer supports it. The `.torno/prompt.md` and
`.torno/agent/` such sessions left are neither read nor removed.

Claude Code is also given torno's skills, a plugin that comes with torno
(`app/resources/agent-plugin`) and is loaded for that session only, with
`--plugin-dir`: nothing is installed in your Claude Code. A skill costs a line
until the agent decides to read it. `torno:torno-model` is the model file
contract in full (which file, `Params`, `assembly`, `printables`, `make_<part>`)
with a template; `torno:build123d` the idioms of build123d 0.13, the failures
that leave a valid but wrong part (a boolean that lost volume, an edge taken from
an older shape), the usual OCCT errors (fillets, booleans, `StdFail_NotDone`; of a
failed fillet, to read why and try one with `try_fillet` before editing again), an
API reference of build123d 0.13.0 that the agent searches offline in any
workspace, and the sizes of screw, nut and insert holes and how to use `bd_warehouse`
(which torno's kernel has) and `references(p)` for bought parts; `torno:scans` and `torno:dimensions` what the
instructions would otherwise say of scans and of dimensions; `torno:printing`
the rules of a part for an FDM printer (fits per side, walls as multiples of the
line width, overhangs, holes, orientation and the bed), with typical numbers
that are only assumptions until you give your printer and material (the
`/printable` prompt reads it first). So Claude Code's
instructions are shorter: they keep what torno is, refs, marks, the loop and
the model file in short, and name the skills.

Claude Code is also given a subagent, `torno-reviewer`, on its command line
(`--agents`; nothing is written to `.claude/agents/`). It has only the tools
that read (`scene`, `look`, `marks`, `measure`, `check`, `section`,
`describe`, `diff`, the scan tools, and `Read`). It runs on Sonnet, whatever
model the session uses (`TORNO_REVIEWER_MODEL=inherit` gives it the session's,
or a model name another), and stops after 20 turns. It reads `brief.md`, checks
the current build against what you asked, every open mark and every dimension,
numbers first and at most two pictures, and ends with one line each that begins
HOLDS, FAILS or UNCHECKED, with the number and the ref. It changes nothing. Claude Code is told to call
it after a change of several steps, before saying it is done.

The status follows the hooks Claude Code posts: `UserPromptSubmit`,
`PreToolUse` and `PostToolUse` mean working, `Stop` idle (and so does
`StopFailure`, which ends a turn an error of the API cut short, and is never
held back), `PermissionRequest`
and a `Notification` that asks something needs input. A `Notification` that
only says Claude Code has been waiting at its prompt for a while (or has
signed in) leaves the status as it was. In a terminal, the first time Claude
Code runs in a folder it asks whether you trust the folder; that question is its
own, and it is answered there. Run headless, as the chat runs it, Claude Code
skips that question, so torno asks instead: before the first chat in a project
whose folder, or a folder above it up to your home, has settings Claude Code
would load (`.mcp.json`, `.claude/settings.json`, `.claude/settings.local.json`),
the pane names those files and asks "Start the chat anyway?". "Start the chat"
remembers the folder (its real path, in torno's own data beside the recent folders,
never in the workspace) and does not ask again, whatever those files later say;
"Use the terminal" starts Claude Code in the terminal view, which asks its own
question. Your own `~/.claude` is never one of the settings files looked at for it.

`/model` typed in a terminal session of torno's changes the model of that
session and also your default for every Claude Code session from then on:
Claude Code writes it to `~/.claude/settings.json`, torno's or not. The model
menu of the chat does not; nor does starting torno with
`TORNO_AGENT_CMD="claude --model sonnet"`, which saves nothing.

### What the agent is told

With every prompt, a few lines:

```
[torno] bracket · build ok · r3 (1.2 s) · layout assembly · parts: base, post.
Scans: S1 Bay.glb, aligned in print by 4 pairs (RMS 2.1 mm, worst 3.4 mm), shown at 60 %.
Selected: base/F5 (plane, normal +Z, z = 2.5, 1200 mm²), base/E5 (line, 30 mm)
Marks from the user (drawn in look pictures with these numbers):
M3 pin on the edge lid/E40 between lid/F12 and lid/F40 (line, 40 mm) at (12, 40.5, 20): "this edge is ugly"
M4 thickness 8 mm wall, along the normal, plate/F2 at (30, 0, -10) (expected 10 ± 0.05: FAIL, 2 under)
Dimensions (measured on r3):
M1 distance 6 mm between planes, plate/F2 to plate/F4 (expected 8 ± 0.05: FAIL, 2 under)
1 pinned dimension passes
Open marks: M2 (moved), M6 (unchecked)
```

- The first line is the build: for a failed build it carries the error; for
  a project that is not the one open in the window it says so, and names no
  layout; with the parts drawn apart it says `exploded 40 % along z (display
  only)` after the layout.
- `Scans` is there when the project has scans, and `Selected` when you have
  faces or edges selected and the parts on screen are those of the last build
  (eight refs at most).
- Each mark you left since the last prompt has a line, once: it then shows as
  sent. A mark you changed or put somewhere else is told again, as `(changed)
  M3 …`; one you reopened as `(reopened by the user)`. A dimension that is
  still a draft is told here with its value and verdict.
- `tracings:` is there when the project has tracings: their ids, and what changed in them since the agent was last told (see "Tracings"). A mark on a tracing says `on T1` after its place;
  one put on the photo is `≈` and carries the photo's line-up, and so does an offset.
- `Dimensions` lists, with every prompt, each dimension the agent was sent
  that fails, is not measurable or was not measured on the last build, and how
  many pass. The head names the build the values are of, and says so while a
  newer build is running or has failed, so that a FAIL of the build before is
  not read as a verdict on the edit. A line stays until its dimension passes
  or is resolved.
- `Checks` is there when the model declares checks (`checks(p)`), after the dimensions: how many pass, fail,
  could not be measured or were not run, and each that did not pass with its value and what was wanted
  (`Checks (the model's own, on r3): 2 pass, 1 fails: lid fits the tub (0.12 mm, wanted 0.15 to 0.25 mm)`). It says
  what was measured and never that the part is verified; passes that were found by sampling or are approximate are counted, and so are passes against a reference built from assumed sizes.
- A mark of yours that says what you want or do not want has it after its number (`M8 · don't want · pick on lid/F12 …`),
  and one in a round `[in R1]` at the end. A round that is not sent is left out of every prompt, and one line says so
  (`R1 is in review, not sent (3 marks). Wait until the review is sent: do not resolve its marks.`). `resolve_mark` refuses a draft of such a round until it is sent, and a view note of it does not go with a prompt either. The prompt that carries a sent round has, before its marks,
  `Review of h41 (R1): 3 don't want, 2 want. Answer each item by its id.`, with `Also in it: M4.` for items sent before.
  The system prompt says a review lists what you do not want and want on one build, to answer each item with `resolve_mark`,
  and not to bring back what an earlier review removed (read with `marks` and `review: "all"`).
- `Open marks` are the numbers of the marks still open, each with what the
  last build did to it. After `/clear`, or after the conversation was
  compacted, the first prompt that follows lists your open marks once more.
- The first prompt of a new conversation (a session that was not resumed, or
  after `/clear`, or after a compaction) ends with a line naming the files in `reference/` (twelve at
  most, then how many more), to read when they matter.
- The first prompt of every session, resumed or not, and the first after
  `/clear`, ends with a line naming the instruction files Claude Code reads
  there by default (six at most, with their sizes;
  see "What Claude Code is given") and saying which wins for seeing the build:
  torno's tools. It is under "Show text" in the "with" line. Nothing is said when
  there are none.

When Claude Code has edited the model (a file of the project, of `common/` or one the model imports, whichever way the file was written: its editing tool, or a command in a shell that changed one), the answer to that edit or command says how the
build ended, the same first lines and the dimensions. Between them, of a build
that worked, torno says what the build did to the parts and what is wrong with
them, which it checks at every build from the numbers the kernel worked out of
the shape:

```
[torno] tub · build ok · r8 (0.9 s) · layout assembly · parts: tub, lid.
Changed since r7: tub: volume 28400 → 26100 mm³ (-2300, -8.1 %), faces 14 → 22, solids 1 → 2; 1 part unchanged.
Check: tub is 2 solids (was 1); the face or edge numbers of tub may name others now (describe refs again).
Dimensions (measured on r8):
M4 thickness 2 mm wall, along the normal, tub/F2 at (30, 0, -10) (expected 3 ± 0.05: FAIL, 1 under)
```

- `Changed since` is each part whose volume, size, place, face, edge or solid
  count changed since the last good build, in the words of `diff`, with `≈`
  where either build's number is not exact; the parts that did not change are
  counted. A number that is not exact (a freeform part's volume or box) may
  differ in its last digits from one build to the next: it counts as changed
  only by more than the kernel says each build's is in doubt.
- `Check` names a part that is not valid (OCC's check finds a defect), one with
  a solid inside out, one with no solid, one of more than one solid or of
  another number of them than before, one with an open shell, one whose mesh
  encloses another volume than its own (by more than the mesh explains), a part
  that came or went, the parts whose refs may now name other faces, and a
  dimension that passed on the build before and fails now. With nothing to name
  it says so. A change of volume is told, never judged: torno cannot know
  whether a pocket was meant.
- At most 1,200 characters, cut by whole parts, with what was left out counted
  and the tool to read it with. The first build of a run has only `Check`.
- A part that is not valid, has a solid inside out, came apart into more solids
  or has a mesh that disagrees with it, where the build the turn began with did
  not, holds Claude Code back once when it would stop, if the turn caused that
  build (see below): it is asked
  to mend the model or to say why that is meant. A change of volume alone never
  does.
- The chat shows it under the edit's card (the build slip: the dimensions that
  changed verdict, and the parts that changed as a table of volumes, from the digest's numbers), the whole text behind "Show text",
  and `state.md` carries it under the build. It is not told with a prompt.

When Claude Code would stop, torno holds it back for what the turn itself did:
once for each reason, and twice in a turn at most. Every reason is for a build
the turn caused: one that began after the turn first
changed a source, by an edit of a `.py` of the project or a Bash command after
which one is newer. The first build of a project you have just opened, a save of
yours in your own editor before the agent's first edit, and any build in a turn
that changed no source are told to the agent as ever but never hold it back. It
first waits, up to twenty seconds, for such a build that is still running and
for the dimensions to be measured. Then, by the first that applies:

1. The build is still running. It is asked to read the result with `scene` and
   to look.
2. The build after the one on show failed (`The build after r7 failed: ...`), and
   it is asked to fix it or say it is still broken.
3. A part has a defect the build the turn began with had not (above).
4. A dimension that passed on the build the turn began with fails on the latest:
   `M4 passed on r7 and fails on r9 (6 mm, expected 8 ± 0.05). Fix it, or say
   why it must change.` A dimension that already failed when the turn began
   never holds it back; the agent may rightly stop to ask about it.
5. A build the turn caused ended after its last `look`: `r9 was built during
   this turn, and you have not looked at it since.` This is however the file was
   written, by the agent's editing tool or through Bash. A
   `look` by the reviewer counts. When nothing in the parts changed since the
   turn began (a comment, a rename: every part is the same shape, by the
   kernel's hash of it, in the same place), there is nothing to look at and it
   does not hold. A volume, size and count that stayed as they were do not
   say so: a hole moved is another shape.
   The same reminder is in the answer to the edit itself, where the agent reads it before it
   writes a summary: `Not yet looked at: r9 was built in this turn. Call look before you write
   your summary; ...`. For a small change (no part came or went, no face or edge count changed,
   no new defect) a `measure`, `check` or `features` after the build counts as a look, so a last
   0.2 mm fit confirmed by a number ends the turn without a second summary.

A reason already held is not waited for again: a `Stop` after one that was held for a running build
does not wait again.

A hold for a defect or a dimension that finds the build unlooked says so too, and
counts for both. A hold is said to the agent and changes no status.

The answer waits for the dimensions to be measured on the new build, ten
seconds at most, and ends with what the model printed: `Model printed (last 2 lines):` and the end of it, fifteen
lines and a thousand characters at most, with a note when earlier output was
cut, and nothing when the model printed nothing. It is the output of the
build that ended last, failed or good, and build123d's own warnings are in it.
So a `print()` in the model is how the agent sees a value, since it may not run
the model itself; `scene` gives the same as `output`. `state.md` does not
carry what the model printed.

After a build, the agent is also told which sizes the model's comments say are assumed or have no source
(`Assumed: wall 2, lip 3 (2 of 14 sizes); no source: 1 (fit: no comment)`: each field without a source is named, with why its comment did not count: no comment, no `word:` at its start, or a word that is not a source), only when that set is other than after the build before.

`.torno/state.md` says the same as text, for an agent without torno's tools:
the build, the layouts and parts, where each size of `Params` comes from, the saved views, the scans and every open
mark. Its first line says when it was written: nothing keeps it current once
torno has quit.

### Tools

Torno's MCP server (on `127.0.0.1`, a port of its own choosing, answering only
requests that carry the token of the project's session) gives the
agent of a project these tools for that project. They answer from the last
build that worked, say which revision that is, and say so when a newer build
is running or has failed. Right after a save the tools that read the build wait, up to fifteen seconds, for the build
the save started, and answer of that one. A build that runs longer, or files that are newer than the build with none begun,
is told as stale (`scene` gives `stale: true` and, for files, `staleWhy`), never as current. A tool given a key it does not take is refused,
naming the keys it takes.

The tools that only read (`scene`, `look`, `marks`, `describe`, `measure`, `section`, `check`, `diff`, `history`,
`wait_build`, `try_fillet`, `try_params`, `features`, `scans`, `scan_clash`, `scan_deviation`) say so, and Claude Code may call several at once. The server also tells Claude
Code at the start, in a few lines, what each tool is for. Claude Code's tool search keeps an MCP server's tools out
of the model's sight until it searches for them; eight are loaded from the start because nearly every turn, or the
prompt, uses them: `scene`, `look`, `marks`, `describe`, `measure`, `show`, `resolve_mark` and `features`. The others are found by that search.

| Tool | What it gives |
|---|---|
| `mcp__torno__scene` | The build status and error, how long a running build has run and how long the last five builds took (`recentBuilds`), what the model printed in the last build (`output`), the layouts, every part of one layout (the one you have on screen, or `layout`; the parts of the others are counted) with its size, bounding box, volume and whether it is visible, the model's groups of parts, your named sets (`#deck`, each with its members by ref and how many the last build lost), your camera, section and explode, the saved views, the scans, how many dimensions pass, fail and are not measured, and the checks the model declares with how each stands. It notes when the parts of the print layout were spread along X. With `detail: brief` it answers only what is asked after an edit, in a few hundred tokens: the build (status, revision, `stale` and `staleWhy`, the error), the parts of the layout with size and volume, the dimension counts and only the checks that do not pass, and `leftOut` names the rest. Over 200 parts, or when the list would not fit, a part is its name, size and group only (`partsTruncated`); `describe` gives the rest. |
| `mcp__torno__look` | A picture from the renderer you are looking at, with the marks drawn. With no arguments it is your view, cut by your section or drawn apart as you have it; a picture from any other view (`iso`, a camera, a saved view) draws the parts together unless it gives `explode`. It takes `view` (`iso`, `front`, `back`, `left`, `right`, `top`, `bottom`, the name of a saved view, or a camera), `layout`, `parts`, `size` (long edge, 1280 by default, 2000 at most), `marks` (false leaves them out), `section` (`'current'`, `null`, or a plane), `explode` (0 to 1, or `{amount, axis, scale}`; `null` together), `scans`, `scanColour` and `frame`. With `focus` (a ref such as `lid/F12` or `lid/E3`, a part, a group, a mark such as `M4`, or a box `{min, max}` in mm) and `margin` (a share of the box, 0.3 by default) it frames a detail up close: from the side `view` names (`front`, `iso`, …; without one, the way your camera looks), at the picture's whole resolution, with the parts drawn together. The caption says what was drawn, and, with a focus, what was framed and when the middle of it is hidden behind other parts. Also saved under `.torno/views/`. |
| `mcp__torno__marks` | Your marks and the agent's as data, each with a line of text. It lists the marks that are not resolved, 50 at a time; `status` (`resolved` too), `ids` (`["M4"]`, any status), `limit` (200 at most) and `next` say which. A stroke is given as a summary of its points (count, first, last, box) unless `ids` names it. What was left out is said (`omitted`, `next`). `review` (`R1`, or `all`) gives instead the rounds of your reviews, oldest first: the build each reviewed, its items with want or don't want, what the agent answered and what you judged; an item you did not want and accepted says `removed on purpose; keep it out`. |
| `mcp__torno__describe` | The geometry of a part, a face or an edge (`lid`, `lid/F12`, `lid/E3`, or one the model names, `lid/@top`), of a named set of yours (`#deck`, or `lid/#deck` for the part's share of it: each member with what it is, and what is lost), or of a group of parts by its name: the box of its parts and their volume. Of a face or an edge it also gives a `selector`: a build123d expression on `part`, such as `part.faces().filter_by(Axis.Z).sort_by(Axis.Z)[-1]`, that the kernel evaluated on this build and that gave exactly that shape, as `robust` `by geometry` (a direction, an extreme, a radius, a place) or `by order` (an index into a sort, which the next edit may break), and `selectorFrame`, which says in whose frame it is. |
| `mcp__torno__highlight` | Tints faces or edges in your viewport with a note, to ask "this one?", until you click or a minute passes. A group's name tints all of its parts. |
| `mcp__torno__ask` | Asks you to choose and waits: a block at the foot of the dock, over the box of the chat (over the terminal, for a terminal session), with a card for each answer (the keys `1` to `3` choose the first three), and the refs of an answer light up in your view while the pointer is on its card, with one line from the ref to where it is drawn when it is on screen. If it allows, you may answer with the one face or edge you select in the view instead, or with "None of these". The agent gets back what you chose, as refs. The session shows Needs you meanwhile; the question ends by itself after 10 minutes with "not answered", and when the turn ends. |
| `mcp__torno__show` | Changes your camera, layout, visible parts (a group's name stands for its parts), section, explode and scans to show you something, or puts a saved view on screen by its name; with `focus` and `margin`, as `look` takes them, it puts your camera on a ref, a mark or a box. For now only: what `.torno/scene.json` keeps stays yours. While you hold a button in the viewport it is queued, so that your view does not change under your hand, and made when you let go; the answer says so. |
| `mcp__torno__save_view` | Proposes a saved view: it appears in your strip marked "proposed" until you keep or discard it. Nothing on screen changes. |
| `mcp__torno__add_mark` | Leaves a mark of the agent's, in green: a pin, a pick, an arrow, a shape, or with `kind: 'dimension'` a dimension, measured at once and on every build like yours. A point that is not on the part is refused, saying how far off it is. The agent's marks are plain: it sets no want or don't want and is refused an `intent` that is not a shape's own. |
| `mcp__torno__add_sketch` | Draws a sketch of the agent's own, in green, with a card of it on the board: strokes of points in mm, in space or on planes it names (a main plane `XY`, `XZ` or `YZ` at an offset, a flat face moved along its normal, or an origin and a normal), with a `name`, a `note`, how literally to take it (`take`: `exact`, `rough` or `flow`, a flow sketch with the `diameter` of the route to keep clear) and a `layout`. At most 50 strokes and 2,000 points; a point that is not a number, or is far from the parts, is refused. torno works out what each stroke touches from the last build; the agent's points are told as it gave them, with no snaps. With `sketch` (`M9`) it replaces a sketch of its own, and with `remove` it takes that one away, which you can undo; a sketch of yours it only reads. `add_mark` makes no sketch. The picture of the card shows when the project is on show. |
| `mcp__torno__add_set` | Proposes a named set of the agent's: a `name`, a `comment`, and `refs` (faces, edges, parts, tags, sets and sketch strokes such as `M7/k3`) in the layout on show or the `layout` it names. torno asks the kernel where each face and edge is before it keeps the set, and refuses the call when it cannot. You see the set dashed in the viewport and in Layers until you accept or dismiss it; the agent may use its `#name` in any ref meanwhile. A name in use is refused, and no tool accepts, changes or removes a set. |
| `mcp__torno__resolve_mark` | Resolves a mark with a line on what was done, which you then confirm or reopen. A dimension of yours with an expected value is refused: it is your check, and only you resolve it. If the face it was on has moved since, the answer says so as expected after an edit, and does not ask for a check. |
| `mcp__torno__measure` | An exact number from the geometry. See [Measuring and dimensions](#measuring-and-dimensions). |
| `mcp__torno__section` | The outlines a plane cuts of the parts, with their areas, and a 2D drawing of the cut. See [Section](#section). |
| `mcp__torno__check` | Whether two parts overlap, how far apart they are, whether a part's mesh is closed, and whether it prints: overhangs, thin walls, the fit on a bed. |
| `mcp__torno__diff` | What changed between the last two successful builds (or the two given as `from` and `to`: a revision of this run, or a build kept in the history by its id, `h41`): for each layout the parts added and removed, and for each part its volume (and its change in percent), box size and min corner before and after, with whether each is exact, and its face, edge and solid counts, a hint that refs may name other faces now. The answer to an edit gives the same of each part that changed. `builds` says what each was made from (a hash of the sources, the commit, whether files differed from it, and of a kept build its id and the checks, defects and dimensions it had then, which are as of then), and a note says when the two were made from the same sources. |
| `mcp__torno__history` | The builds kept of the project (see Files torno writes, `history/`), newest first: each with its id (`h41`), when, its revision if it was made in this run, what changed from the build before it in a line that also says what caused it (Claude and the prompt, your own edit, params, a go back) and whether it failed to build (kept as a line with no copies, and the reason), the checks of the model that failed and the parts with a defect (a build that fails its checks is kept all the same), how your dimensions stood when it was checked, and whether you starred it. With `id`, one build, with the paths of the copies of its Python files, to read when going back to it. The agent never restores them itself: only your "Go back" does, and Claude is told when it has. |
| `mcp__torno__wait_build` | Waits for the build that is running, or the one a save has just started, and returns its result: status and revision, how long it took, the error of one that failed, and what the agent is told after an edit (what changed in the parts, the checks, what the model printed). `seconds` is the longest it waits (default 60, at most 600); with the build still running by then it says so (`limitReached`) and how long it has run, and the agent calls again. It is for after any change of the model, a script in a shell too. |
| `mcp__torno__board` | Reads the board of the project as text: each card by its id, its kind and who made it (you, Claude, or torno), with what it says, the frames first with their cards in reading order, then the arrows. A frame by its name or id gives only that frame and its cards; `pictures: true` also sends the pictures of the cards, at most 6, each scaled to 1280 px. Hidden cards are left out. |
| `mcp__torno__add_card` | Leaves a card of Claude's on the board: some text, a size (what it measures, a value, `mm` or `°`, a note; its source is always "from Claude"), or a picture of the view drawn as `look` draws it (at 1280 px, with its camera), in a frame by name (made, and Claude's, when there is none), with an arrow from or to a card and a word. It lands in a free spot, never over a card; in a frame of yours with no room left it goes just below the frame, and Claude is told so. With `card` it changes the text of, or with `remove` takes down, a card of Claude's own, and it refuses any change to a card of yours or one torno made. |
| `mcp__torno__tracings` | Reads the project's tracings as a list (id, name, plane, layout, who made each, how many layers and shapes), or one by `tracing` (`T1`): its plane and how it was made (a face tracing says it follows its face, or that it is lost), the build its outline is of, each part's outline (area as the kernel's, `≈` where it is not exact, loops, bounds and points in mm along the tracing's own `u` and `v`, thinned as `section` thins them and said so), the layers with every shape in mm and who made each, and the photo's line-up in words (main looks for the photo's file: when it is not on this computer, the words say `the photo is not on this computer`, and the line-up is still told). With `picture: true` it also sends a picture of the tracing (its outline on a 10 mm grid, with the layers and, when it has one that you have not hidden, the straightened photo under them at your fade: the one place the photo goes to Claude), at 1280 px or `size` up to 2000, and what maps its pixels to mm (`1 px = 0.212 mm; u = 0 at x = 140, v = 0 at y = 860, v up`), so that Claude can trace in mm what it sees. A photo's numbers are never exact. |
| `mcp__torno__add_tracing` | Lays a tracing of Claude's own, on a main plane (`{"main": "XZ", "offset": 0}`), a flat face of the last build (`{"face": "block/F31"}`) or a plane given by a point and a normal, with a `name` and the `layout` (the one on show by default); torno makes the plane and the number, and the reply says which way `u` and `v` run. With `tracing` and `remove: true` it takes down a tracing of Claude's own; one of yours is refused by your name, and no tool changes one. |
| `mcp__torno__add_layer` | Adds a layer of Claude's to any tracing, yours too: a `name`, one of the eight colours and `shapes` (polylines, circles and labels, in mm along the tracing's `u` and `v`), at most 500 shapes in a layer, 20 layers and 20,000 points in a tracing, every number finite and within ten diagonals of the outline. A layer of Claude's with the same name is replaced and keeps its number; a layer of yours is refused by your name. With `remove: true` it takes down Claude's layer of that name. The reply gives the layer's number. |
| `mcp__torno__expect` | Called before an edit: what it should change, as checks (a part's `volume`, `faces`, `edges` or `size` as a `value` or a `change` with a `tolerance`; a `measure` with the number it `expected`; `unchanged` parts). The next successful build is held against it, and the answer to the edit says in a line how many checks were met and which were not, with the numbers (`≈` where the kernel's is not exact). Kept in memory for that one build, told once, no mark, and it never holds a turn back. A ref to a face of a part whose face count changed is told as moved and not measured. `scene` gives the last verdict. |
| `mcp__torno__try_fillet` | Tries a fillet (or a chamfer, `kind: 'chamfer'`) of `radius` mm of some edges of a part (`part`, `edges` as refs such as `lid/E3`) on the last good build and throws it away: whether it works, and when it does not, the edges that fail alone or in pairs and the largest radius that works, as a failed build's error says it. It changes nothing. |
| `mcp__torno__try_params` | Builds the model with other values of its `Params` (`set`, the fields `scene` lists under `params` as editable: `{"wall": 2.4}`) in a worker of its own and throws it away, then says whether it built (or the model's error), what changed against the last build part by part, and the measurements (`measure`: `bbox`, `volume`, `area`, `mass` or `distance` of whole parts by name) and checks (`check`: as the `check` tool, parts by name) asked for, all worded as those tools word them and said to be of the trial. It changes nothing: not the model, not the values you are trying in the window, not the build on screen; it is made on top of your values, and refused when there is no memory for a second build or while a build runs. To keep a value the agent edits the model. |
| `mcp__torno__features` | The holes, bosses, fillets, chamfers and patterns of a part, found on its geometry (`part`, and `kinds` to ask for some of `hole`, `boss`, `fillet`, `chamfer`, `pattern`): for a hole its diameter, axis, where it opens and the face it opens in, depth, whether it is through or blind (and its bottom), and a counterbore, countersink or rounded mouth; for a boss its diameter and height; for a fillet its radius, sweep and length and whether it rounds an outside edge or an inside corner; for a chamfer its size; for a pattern how many holes or bosses alike there are and whether they lie in a row, a grid or on a circle, with the step; each with the faces it is made of and the faces and edges it joins, as refs `highlight` takes. Diameters, radii, angles and axes are exact, and so are depths between planes and round faces; a depth taken between freeform faces says it is not (`≈`). Holes and bosses need a cylinder, cone or torus that goes all the way round: a slot end is neither a hole nor a fillet. |
| `mcp__torno__scans` | The scans of the project and how each is aligned. |
| `mcp__torno__scan_clash` | What of a scan is inside a part. |
| `mcp__torno__scan_deviation` | How far a part lies from a scan. |

There is no tool that exports, imports or aligns a scan, or writes a file:
those are yours.

### Prompts

The same server offers requests that come up again and again as MCP prompts.
Claude Code lists them as slash commands, and the chat's command menu shows
them when you type `/`:

| Command | What it asks the agent |
|---|---|
| `/mcp__torno__review` | Go through every open mark and every unmet dimension against the current build: measure, look, and resolve the marks that are done. |
| `/mcp__torno__printable` | Check the `print` layout for 3D printing: thin walls, overhangs, closed meshes, holes too narrow to print, and whether it fits your bed, given as an argument (`/mcp__torno__printable 256x256x256`, in mm). |
| `/mcp__torno__explain` | Describe the model for someone new to it: its parts, its `Params` and how the parts relate. |

## Marks

The tools, each with its key (all keys are under [Keys](#keys)). They are the **reed**, at the left of the view: round buttons in three pills (Select, Measure, Section; Pin, Arrow, Draw, Shape, Region of a scan; Align scan), with no letter on a button. The key is in the tip beside a button when you point at it, and in the name of the tool in hand: that tool is a filled accent circle and its **name grows out to the right**, with its key and its few choices (Measure: Distance or Angle, ⌀ or r, and `T` for the wall; Shape: box, cylinder, sphere, plane; Draw: the pens, while a sketch is open; Region: Brush or Box). Select is the tool at rest: pressed, with no name. Its scope grows out when you click it, or press `V` while it is in hand, and stays out while the scope is not Any:

| Key | Tool | What it does |
|---|---|---|
| `V` | Select | Click selects a face or an edge, and a double click its part; the scope that grows out of its button (Any, Face, Edge, Part, Set) says what a click takes; Set takes a whole [named set](#named-sets) at once. Shift-click adds or takes out, `Esc` clears. What is selected is held at the head of the card, under "In hand": each ref with what the kernel says of it (the first four, then "and 2 more"), and **Insert in prompt**, which puts the refs in the session's prompt without sending it, **Note each**, which leaves a mark on each, **Name a set** (`Ctrl+G`) and **Clear**. With nothing selected the head says "Click a face, an edge or a part to hold it here." |
| `P` | Pin | Click a part: a pin there, and its note opens beside it. A pin on an edge is a pin on that edge: the pointer snaps to an edge within reach, and the agent is told which edge it is and the two faces that meet there. |
| `A` | Arrow | Drag from a part: an arrow of that length. With Shift it runs along the surface normal or a principal axis. |
| `D` | Draw | A sketch in 3D: the strokes lie on a plane, or on the surface of the parts, and one sketch holds as many as you want. Press `D` and draw; nothing is written until the first stroke, and then every stroke and every change is kept at once. See [3D sketches](#3d-sketches) below for the planes, the pens, snapping, x-ray, how to take a sketch and its keys. Alt-drag turns the camera with this tool in hand. |
| `S` | Shape | Click places a box, cylinder, sphere or plane (the choice is in its name; the one chosen last is the one its button shows), to add, remove, keep out or refer to. A gizmo moves it (`G`), turns it (`R`) or sizes it (`T`), and its row has the exact numbers. A shape to add reads as what you want (`+`) and one to remove as what you do not want (`−`); see [Reviews](#reviews). |
| `X` | Section | Cuts the parts by a plane. See [Section](#section). |
| `M` | Measure | Measures; `Enter` keeps a dimension. See [Measuring and dimensions](#measuring-and-dimensions). |
| `L`, `B` | Align scan, Region of a scan | See [Scans](#scans). |

`Esc` drops what is being dragged, then puts the tool down for Select. In a
note, `Enter` saves and `Esc` leaves it for later. A note is also kept when
you leave it any other way, such as ``Ctrl+` `` to the terminal: what you
typed goes with the prompt you type next.

Every mark has a number (`M1`, `M2`, never reused), a note, and a row in the
Marks list. Yours are drawn in red, the agent's in green. A mark of yours can also say what you
**want** or **do not want**: the chip carries `+` or `−`, and what you do not want is drawn hatched (see [Reviews](#reviews)). A mark is a **draft**
until it has been carried to the agent (see [The agent](#the-agent)),
then **sent**, then **resolved** by you or by the agent, with a line on what
was done. Clicking a row makes its mark the active one and opens the row; the
camera goes to the view the mark was placed from only when the mark is out of
view, and the reticle at the end of the row ("Go to its view") always goes
there. The pointer on a row, or the keys' focus in it, rings the mark's chip in the view, more faintly than the
active one's, and lights the face it is on, as a mention of it in the chat
does.

A **3D sketch** has a row of its own: its name, how it is taken (`flow ⌀19 mm`), and how many strokes and planes it holds, with
its comment as the row's note. In the view its strokes are lines in its author's colour, a dot where a point snapped, and a
flow sketch with a diameter is also a translucent tube along its strokes; what hides behind a part is drawn dashed when the
stroke was drawn in x-ray, and not drawn otherwise. The pointer on its row lights its strokes, and a click goes to its camera.
"Edit" on the row of one of yours opens it again in Draw; Claude's is never yours to change. A sketch that is open is held back
from your prompts until Done, and the line under the prompt says `M7 is being sketched, not sent`. When a turn ends, its line
says `drew a sketch M9` for each sketch Claude drew. A sketch is also a card on the board, with its name, how it is taken, its
comment and a picture drawn from its camera when you press Done; a sketch Claude drew while the project was not on show gets its
picture when the project is next shown, and until then (and on a computer without the file) the card says the picture is not on
this computer.

A **view note** (see "Draw on view" under [The agent](#the-agent)) has a row like
any other mark's: its number, a small picture of the view with your ink, and
its comment as the row's note. The pointer on it lights the faces under its ink
and the heads of its arrows, those the model as it is built now still has: after a
rebuild that took a face away, the others light and that one does not. A click
on the row and the reticle go to the camera the note was made from (a click only
when the note's number is out of view, as for any mark). A note whose picture is
not on this computer (pictures are not in git) has an empty frame in the place of
the picture and still goes with the prompt in words. The note is also a card on the
board, with the picture and the comment (see [The board](#the-board)).

The chips in the view answer the pointer too. On a chip the pointer is a hand,
the mark's row lights, and its note is read out beside the pointer on one line
(`M1 too thin here`; for a dimension its numbers, `M3 40 mm, expected 42 ±
0.05, 2 under`). A click on a chip makes its mark the active one and brings
its row into view, opened, without moving the camera; for a mark of yours not
yet sent, its note opens beside it to be written (a 3D sketch of yours opens in Draw, where its comment is). A click on a chip is the
chip's whatever tool is in hand: no pin is left under it. A drag that starts on
a chip turns the camera with Select in hand, as anywhere else; with Draw, Arrow, Shape, Region or another
tool that drags, it goes to the tool once it has moved past a click, so a stroke may begin under a chip (and
the camera stays still).

- A mark you change after it was sent (its note, or a shape's place, size,
  kind or intent) is a draft again, and is told once more as `(changed)`.
- At the head of the Marks list, outside its scroll, are **Review this build** and a row for each review round (see
  [Reviews](#reviews)). A draft of a round that has not gone says `in review, not sent`, and its row offers
  **Take out of R1**. Your own rows have a small menu (`±`, `−` or `+`) to say plain, do not want or want of that mark at any time.
- What waits on you is in **Needs you**, at the top of the card, from three sources in this order: the marks the agent
  resolved and you have not judged (each says "to review" at its right), the marks it left for you to read or answer
  (**from Claude**; **Answer in chat** puts the mark's id in the prompt, and **Resolve** says you have seen it), and the
  checks that fail, the model's and your dimensions both, each a line that goes to its row under Checks.
- Your dimension checks (every dimension that has an expected value and is not resolved, sent or not) are under **Checks**, in
  one list with the model's own (see Parameters). The Marks list is grouped by who acts next: **To send** (yours, "with your
  next prompt"), **With the agent** (your sent marks), then **Resolved**, folded. A row is two lines: the chip and the note, then the kind of mark and what is the matter with it in
  muted words (`moved: check it`, `its part is hidden`). The active row shows its note whole and what can be done with
  the mark as words under it (**Go to view**, **Re-place**, **Edit**, **Answer in chat**, **Resolve**, **Reopen**,
  **Delete**); the other rows show them as icons while the pointer is on them.
- A mark the agent resolves does not vanish: Needs you has a row for it, and over the rows says "The agent
  resolved 2 marks." Each row says "Resolved by Claude" with the agent's line, and has **OK**, which
  moves it under "Resolved" in Marks, and **Reopen…**, which opens its note with the cursor at the
  end, so that you can say why, and it is a draft again, with the note, when you
  leave the field (Esc leaves it as it was). **Review** walks them one at a time: the mark becomes the
  active one and the camera goes to its view, the line reads "Reviewing 1 of 2
  · M5", and its row also has **Skip**, which leaves it to review. When
  the last is done the line says how it went ("Reviewed 5: 4 OK, 1 reopened").
  **OK all** says you have seen them all at once.
- The tick on a row resolves the mark (**Resolve: done with it**); on a check
  with an expected value it first asks "Stop checking M3? It is no longer
  measured." (**Resolve** or **Keep checking**). **Delete** takes the mark at
  once, and for ten seconds, or until the next delete, the list says "Deleted
  M3 · **Undo**": Undo puts it back whole, with its number, note and, for a
  region, its triangles. Only the last mark deleted can be put back.
- Once you have seen marks the agent resolved, and files of the project differ from the last commit (see Projects and
  builds), a line under the marks offers **Ask Claude Code to commit**. It puts a request in the message box of the chat
  ("Commit the changes for M4 and M6 of this project with a message saying what changed. Add only this project's
  files."), opens the session pane, and never sends it: you read it first. The agent commits under your
  permission rules; torno itself never commits. Not offered with a terminal session or none.
- A mark on a part that is switched off in the layers is not drawn, in the
  window or in the agent's pictures; its row stays and says "its part is
  hidden".
- After every build each mark is checked against the new geometry. It stays
  at its point; its ref is refreshed to the face now there. When the surface
  has moved away from it the row says "moved: check it", and when its part is
  gone, "its part is gone"; the agent is told the same. Such a pin, pick or
  arrow of yours offers **Re-place**: the next click on a part puts that mark
  there, with its number and note.
- In a `print` layout that torno spread along X, a mark moves with its part
  when a part that grew pushes it along: it stays where you put it on the
  part.
- When a check cannot be made (the kernel did not answer in time), the marks
  it was about keep what the last check found and say "not checked against
  r12", in their rows and wherever the agent reads them. Torno tries again
  after 2, 10 and 30 seconds, and at the next build.


### 3D sketches

With Draw in hand a sketch is open: a drawing in space that tells Claude where something goes, how it runs or what is
meant, in millimetres in the project's own frame. The panel is the head of the card and the pens grow out of Draw's name in
the reed; both are there while the sketch is open.

- **The band.** While a sketch is open a quiet band at the top left of the view says `Sketching M7 on XZ, y = 40` (the sketch's own words are in the card's head).
- **Planes.** A stroke lies on a **plane** or on the **surface** of the parts. A new sketch starts on the plane the view
  faces (XY, XZ or YZ) through the middle of the parts. The plane is a sheet drawn over the parts, with a handle on its
  normal that moves it, and, in the compass at the top right of the view, a cube turned as the camera is (XY, XZ, YZ, with their keys, and "Planes" over it). `Shift+1`, `Shift+2` and `Shift+3`
  take the main planes; `N` takes the plane of the flat face under the pointer; "+ New plane" in the panel makes one from
  a face you click or from a point (across the face there, or along an axis); `U` goes back to the surface. The offset of
  the plane is typed in the panel (`Tab` takes you to its field). Where strokes already lie on a plane, moving it makes a
  plane of its own, so that they stay where they were drawn.
- **Pens.** `B` is the freehand pen, `L` a straight line (press and drag, or click twice), `P` point to point (a click
  for each point, `Enter` ends it), `C` the eraser (a click takes the stroke under the pointer). The
  name of Draw in the reed has a button for each, with its key; the two switches are in the sketch's panel. While a segment is drawn the
  figures type its length and `Enter` fixes it; `Backspace` takes the last point or figure back.
- **Snapping.** The pointer snaps to a vertex, to the centre of a hole or a circle, or to a point on an edge, within 10
  px, and a box beside it says to what. A point on a plane is the snap projected onto it. `Ctrl` held turns snapping off
  for as long as it is held; the **Snap** switch turns it off for good. Claude is told a point is exact only when it is a
  vertex, a circle's centre or a point on a straight or circular edge, which torno checks again against the build; any
  other point is told to a tenth of a millimetre and as approximate.
- **X-ray.** `I`, or the **X-ray** switch, draws the parts see-through, so that strokes can be drawn on what is hidden.
  What lies behind a part is drawn dashed in a stroke that was drawn in x-ray, and not drawn otherwise.
- **How to take it.** **Exact** (follow these points to the millimetre), **Rough** (the shape and the place matter, not
  the points) or **Flow** (a route: follow its path loosely, and keep its diameter clear). `K` goes to the next. A flow
  has a diameter, 500 mm at most, and is drawn as a translucent tube along its strokes.
- **The view's keys.** Fit, `1` to `4`, explode and orthographic work while you sketch. `X` shows or hides the cut the
  view already has, and the sketch stays open; with no cut it does nothing. A new cut is made by picking Section in the
  reed, which ends the sketch as Done.
- **The panel.** It is the head of the route card, above its sections, for as long as the sketch is open; what is selected is not shown there meanwhile and comes back at **Done**. The head grows to fit, up to 60 % of the card, and scrolls inside itself beyond that, so the sections stay under it. It holds the sketch's number and "Sketch", with whether it is a draft (`draft, goes with your next prompt`) or sent, its name, how to take it, a row for each plane
  with a small plane glyph, the plane and how many strokes lie on it, and one for the surface (a click makes it the one strokes go on; the pointer on it
  lights its strokes; the one strokes go on is on the accent wash with a bar), and under the plane that is drawn on, or that has one selected, its strokes by id (`k1`, `k2`: a click selects `M7/k2`, to put it in a [named set](#named-sets); `Ctrl+G` names it in the head, under the panel), the offset (typed here, `Tab`, and also read on a tag tied by a leader to the plane's handle in the view: `XZ plane y 40.0 mm Tab`, which follows the handle as it is dragged), the **Snap** and **X-ray** switches, a comment, **Undo** (`Ctrl+Z`: the last stroke or the last erase) and **Done**. `Esc`
  gives up a stroke under way, then leaves the sketch; what was drawn is kept. A sketch holds 200 strokes, 400 points a
  stroke and 20,000 in all.
- **What Claude gets.** A sketch is a draft until it goes with your next prompt, as words only, never a picture: its
  planes and how each was made, each stroke's pen, plane, length and the faces it touches in the build it was drawn on,
  its points (`exact: centre of plate/E4 (r 4)`, or `approximate`), how to take it, the diameter of a flow, and the camera
  it was drawn from. A sketch that is open waits: it is not sent until Done. Each stroke and plane says which build it was
  drawn on, and Claude is told when the model has been built again since. A stroke has an id, `k1`, `k2` in its sketch, that
  torno gives it and never gives again, even when the stroke is erased: Claude is told `stroke k3`, not a position.
- **Afterwards.** A sketch has a row in the Marks list, a card on the board and its strokes in the view, in your
  colour; **Edit** on its row, a click on its chip while it is a draft, or a double click on its card opens it again in
  Draw. Claude draws sketches of its own with `add_sketch`, in green; it is not yours to change. The stroke marks of
  earlier versions, which Draw no longer makes, are still listed and drawn.

The keys of a sketch are in [Keys](#keys), under "With a tool in hand".

### Reviews

When a build is partly wrong, go over it once, marking what you do not want ("these clamps hold nothing") and what you want
("a handle along the top"), and send it all together. A **round** is one such pass over one build. Claude answers each item,
and after the next build you say OK or Still wrong to each answer.

- **Want and don't want.** Any mark of yours can say one of them, in a round or not: a round **sign** stands before the chip, in the row, in the view and where the
  chat names the mark: an 18 px disc with `−` (don't want, hatched in your colour: stripes with the colour paled 70 % toward white between them, and a solid core that holds the sign) or `+` (want, solid in Claude's green), then the number, `− M8`, in the face of
  numbers (the chip stays square and numbered, so a sign is never taken for who made a mark); a mark that says neither is plain, as before. What you do
  not want is drawn hatched in your colour and dashed where a mark is a line, what you want is drawn solid; while a round is open the chips of the marks that are not in it are drawn dimmed, mixed toward the ground, and each item of the round (up to six) has a small tag at its point in the view with its sign and its note, and no leader; the colour is still
  yours, so a mark of yours never looks like Claude's. A shape to add is a want and a shape to remove is a don't want, and they say
  so in their chips whether or not a round is open; keep-out and reference shapes say neither. The menu on a row of yours changes
  it at any time (a mark already sent becomes a draft again and is told `(changed)`). The agent's marks are always plain, and
  neither `add_mark` nor `add_sketch` takes an intent.
- **Making a round.** **Review this build** (at the head of the Marks list, on the line of the build that is on show in the chat, or the
  key `H`) starts round `R1` on the build you have on show, `h41`, and stars that build in the history so that it is never let
  go while it is reviewed. A band appears at the top left of the view: `Reviewing h41`, a choice **Plain**, **− Don't want**, **+ Want**
  (pens, each with a round sign) for the marks you make next, their count (`3 − · 2 +`, and plain ones when there are any), **Items**, **End** and **Send review**. Any tool
  works while it is open: a pin, an arrow, a pick, a shape, a 3D sketch, a view note, a region of a scan, a dimension; the
  mark gets the choice and joins the round. While a round is open, `-` chooses don't want and `=` (or `+`) want, and pressing the key of the one chosen
  goes back to plain; `H`, `-` and `=` are for the view and are not heard in a field or the terminal. Marks made in another layout than the round's do not join it, and the band says so.
  A build that is running or that failed cannot be reviewed, and there is one open round at a time (a second **Review this
  build** opens the one that is open). Setting want or don't want on a mark that already exists does not put it in a round.
- **Held until you send.** The marks of a round that was not sent go to Claude with no prompt, as a sketch that is open does not:
  each says `in review, not sent` in its row and on the board, and the line under the next prompt says
  `R1 is in review, not sent`. **End** closes the band and keeps them held, and the round can be opened again from its panel
  while it is unsent. **Send as plain marks** (in the panel) lets them go as ordinary drafts, with their signs, and the round is never sent.
- **Sending.** **Send review** puts a chip above the box of the chat, `Review of h41 · 3 − · 2 +`, with **Remove** (the same
  as Send as plain marks). It goes with the next prompt you type, whatever you write. The prompt carries one line before the
  marks, `Review of h41 (R1): 3 don't want, 2 want. Answer each item by its id.`, and the line of each mark says its intent
  (`M8 · don't want · pick on lid/F12 …`). The line under the prompt says `review R1 sent`. In a terminal session the line goes
  in the same way, with the next prompt. Claude is asked to answer each item by its number with `resolve_mark`, and not
  to bring back what an earlier review took out.
- **After the next build.** **Open** on a round's row (or on the head of its frame on the board, or **Items** in the band) opens
  the round's panel in the head of the route card (the selection is not shown there while it is up; a sketch you open meanwhile takes the head, and the panel is there again at **Done**): `Review of h41`, `goes as one prompt` while the round has not gone, then each item, with its sign (`−` or `+`, none for a plain one) in a column of its own, its chip, its note, what it is on (a face, a part, or the strokes of a sketch) in mono, what Claude said when it resolved it, and, for
  an item Claude resolved, **OK** (you accept it, and the row says `OK in h42`) and **Still wrong** (a field for an
  optional note, then **Send back**). An item Claude has not resolved says `Not answered yet`. One you accepted with "OK all" or in
  "To review" says `OK (accepted)`. While the panel is open the reviewed build is drawn faint beside the live one (Compare);
  when it cannot be, the panel says why (the build is no longer kept, it is not the build of this computer, or none has
  been made since). While the round has not gone, the panel's foot says `Comment a stroke by clicking it` and has **Send review**, the band's.
- **Still wrong** opens the item again, with your note added to its note as `Still wrong in h42: …`, and puts it in the
  next round, which torno makes on the build on show (`R2`, held, so that it goes with no prompt of its own). **Start round 2**
  in the panel of a sent round opens that round's band. Items you said OK to stay in the round they were in.
- **On the board.** Each round has a frame of torno's own, `Review of h41 · 3 − · 2 +`, made with its first item, holding the
  cards of its items. A card says its sign, `in review, not sent` while it is held, and `OK in h42` or `Still wrong` once you have
  judged it; a Still wrong card moves into the frame of the next round. You may move or resize a frame or put
  a card elsewhere, and what you did stays; removing a frame hides it (see [The board](#the-board)).
- **What Claude reads.** `marks` lists each mark's intent and round, and with `review` (`R1`, or `all`) the rounds of your
  reviews: the build each reviewed, its items, what the agent answered and what you judged. An item you did not want and accepted says
  `removed on purpose; keep it out`.
- **Where the rounds are.** In `marks.json`, beside the marks: `rounds`, each mark's `intent` and `round`, and `judged`. Only
  torno writes them; they go with the project in git.

The keys of a review are in [Keys](#keys), under "Viewport".

### Named sets

A selection is gone at the next click, and a lasting name for a few faces is otherwise a tag that only Claude can write into
the model. A **named set** is a name of yours for faces, edges, parts and sketch strokes ("deck face", "intake port RH"),
which you and Claude then point at by that name: `#deck`. torno keeps it in `.torno/sets.json` and finds its members again
after every build. The model's own `groups(p)` (groups of parts in the code) are another thing and keep the word group.

- **Making one.** Select faces, edges or parts (and strokes, from the sketch's list) and press `Ctrl+G`, or **Name a set** in the head of the card, where the selection is held. A small box
  opens in the head, under the selection, and asks a name, a comment and one of eight colours (the next one is chosen); `Enter` makes it. With nothing selected the status
  line says what to select. A name is one line of 40 characters at most, starts with a letter and has no `/`, `#` or `@`; two
  names that make the same ref are one name (`Deck` and `deck`), and one in use is refused in the box. The set is written at once; torno
  asks the kernel what each face and edge is a moment later. If the kernel cannot say where a selected face or edge is, nothing is made
  and the status line says so: select it again. A face may be in several sets, and a set may span parts.
- **The Set scope.** With Set chosen in the corner of Select, the pointer on a face lights the whole set in its colour and
  the readout says `#deck` (and `also in #intake`); a click selects all its faces, edges and parts. A face in no set is
  passed over. Strokes are selected from the sketch's list, and are never offered by the pointer.
- **Layers.** Each set is a row, under its part when all its members are of one part, else under the subheading "Named sets": a dashed square in its colour,
  `#deck`, what you wrote of it, what it holds (`2 faces`, `4 faces, 1 stroke`), "Show only" and a menu with Rename, Colour, Add selection, Take away selection, Re-pick, Make it a
  tag and Delete (Undo is offered for ten seconds). The pointer on the row lights the set in the view; its name selects
  the members. A colour is only a colour: none is red or green, which are yours and Claude's.
- **Found again after each build.** A face or an edge keeps the kernel's selector for it (a form torno can rebuild, never
  text it was handed) and its point and normal. After a build the selector is tried first, and the face it gives is accepted
  when it has the same surface and a normal within 10 degrees of the stored one; otherwise the nearest face (or edge) at the
  stored place is taken. A part follows its name, and a stroke its sketch. What none of those finds is **lost**: it is kept with
  its last point, the row says `2 of 5 faces lost`, and Claude is told which are lost, apart from those found. Each set remembers
  which build its refs are of: one made or put back from an older build than the last, or changed while a build was being
  looked through, is found again at once. Until it is, every reply to Claude that uses it says `#deck: not refound against r8
  yet; its refs are of r7`, and uses its refs as they are.
- **Re-pick.** On a set with lost members: Re-pick, then select the faces that take their place and press "Re-pick with N
  selected". The lost members go and the selection is added. It is two presses, and Cancel leaves the set as it was.
- **Refs.** `#deck` names the set wherever its members are, and `lid/#deck` only its members in `lid`. They are told to
  every tool that takes a ref (`describe`, `measure`, `highlight`, `show`, `look`, `add_mark`, `ask`) as the faces, edges and
  parts it has now; lost members are left out and counted. A ref of a set of several is refused where one face is needed, as
  a tag of several is, and naming a set of another layout is refused saying so. The chat shows `#deck` as a chip.
- **Marks on a set.** A pin, pick or arrow placed on a set (`add_mark` with `ref: "#deck"`, or a pick in the Set scope) goes
  on the first of its members and keeps `#deck` as a label, which its row and the agent's text say: `on #deck`. It does not
  follow the set: it is checked as any mark is, and says `no longer a named set` when the set is deleted.
- **Claude's proposals.** Claude can propose a set with `add_set`. It is drawn dashed in the view and in Layers, says
  "Proposed by Claude", and has Accept (it becomes yours) and Dismiss (it is deleted). Claude may use its `#name` meanwhile;
  nothing it can do accepts, changes or removes a set. Claude is told it is `proposed by you, not accepted yet`.
- **Make it a tag.** For a script or another tool that must see the name, "Make it a tag" puts a chip, `Make #deck a tag`, in the
  box of the chat with the text to send: it asks Claude to add a tag of that name for the set's faces and edges in `tags(p,
  parts)`, one in each part the set spans, and lists what it cannot tag (whole parts, strokes, lost members). In a terminal the
  text is put in the prompt without sending it. Nothing is sent by itself, and torno never writes the model; the set stays
  yours until you delete it, and after the build both `lid/@deck` and `#deck` name the faces.
- **Where they are.** In `<project>/.torno/sets.json`, which goes with the project in git and which only torno writes (ids
  `N1`, `N2`, never reused). A file torno cannot read is copied aside (`sets.json.corrupt-…`), and sets or members it had to
  leave out are kept in `sets.json.dropped-…`; delete those files when you no longer need them. Layers says so, with where the
  file was copied aside, until you press Dismiss.

The key is in [Keys](#keys), under "Viewport".

## Measuring and dimensions

Lengths are millimetres, angles degrees, areas mm², volumes mm³ and masses
grams; Z is up.

**The Measure tool** (`M`). Its name in the reed chooses what
two clicks measure (Distance or Angle) and what a double click on a hole, a
cylinder or a circular edge measures (⌀ for the diameter, r for the radius). `T` has no button:
with the pointer on a face it measures the wall there, from that point along
the inward normal to where the part ends. With Shift a click is a bare point,
tied to no face. While the second click is pending the pointer reads out an
estimate from the mesh, marked `≈`. What is measured is never that: torno asks the
kernel, which measures on the exact geometry and says how (`6 mm between
planes`, `axis to axis`, `point to plane`, `minimum`). A distance between two
parallel flat faces is the distance between their planes, between two
cylinders or circles with parallel axes the distance between the axes, and of
anything else the least distance. An angle is between flat faces, straight
edges and the axes of cylinders, cones, tori and circles (`between axes` of two
bores, `axis to plane` of a bore and a face); a face that is flat, or an edge
that is straight, within 1e-6 mm but stored as a spline or an extrusion is
taken too, and its angle is not said to be exact. Before the second click of an
angle the pointer says, in place of the estimate, when an end is taken by its
axis (no estimate from the mesh), only if it is flat or straight (a spline),
or not at all (a sphere); the click is sent all the same. When the kernel
refuses (an angle to a sphere), its reason is read out at the
pointer. `Esc` drops a first click; the tool stays in hand.

**A measurement leaves nothing.** The kernel's value is read out at the pointer
and stands in a tag at the middle of the measured line in the view: the value
large (`6` with `mm` small), then how it was taken and that it is exact
(`between planes, exact`; a distance adds `Δx`, `Δy` and `Δz`, from the kernel's
two points). The line is drawn in ink between those points. The tag stays until the next
measurement, `Esc` with nothing under way, another tool, a new build or another
project. It is no mark, and the agent is not told of it: not with the next
prompt, not in `state.md`, not in a picture. To keep it, press `Enter` or
"Keep as a dimension" in the tag: it becomes a dimension, measured again by
main as it is kept, and the tag says `Kept as M4`. If main refuses, the
reason is a second tag below the first.

**Dimensions.** What you keep of a measurement is a dimension: a mark (`M4`)
with a value, drawn on the part and listed with the marks. Its row, once
clicked, shows the value, how it was taken, and under "Should be" two fields:
what is expected (`=`) and the tolerance (`±`), in mm or degrees. With an
expected value the dimension is a check: it passes when the value is within
the tolerance of it (0.05 mm, or 0.1° for an angle, when you give none) and
fails otherwise, and the row says `Passes` or `Fails: 2 under`. A failing one
is ringed on the part and in the agent's pictures, its chip saying by how much
it misses after the cross (`40 mm ✗ 2 under`), and the line at the bottom
counts those that fail and those with no value.

When the project has checks, they are under Checks, with the model's own, in one list: failing first, then those not measured,
then those that pass, and the head of the section counts them (`3, 1 fails`). A dimension with no expected value is not a
check: it was kept to be read, and stays in the group its status puts it in under Marks.

- Once sent, its row says **pinned**: it is one of the checks the agent is
  told about with every prompt until it passes. Changing what is expected or
  the tolerance makes it a draft again, sent as `(changed)`.
- torno remembers what each dimension measured on the last 20 builds of the run,
  and its open row lists them, newest last: `r9 38.6 ✗ · r10 39.2 ✗ · r11 40 ✓ ·
  r12 41.3 ✗`, with a line above it when a check has changed its mind: `fails
  since r12; passed on r11`. That is the first thing to ask when a check fails:
  did it pass before, and on which build did it stop? The memory is not kept
  between runs (builds are numbered from 1 again), and each verdict is judged
  against what is expected now. The agent is not told this way.
- A **resolved** dimension is no longer measured. A dimension of yours that
  has an expected value is yours alone to resolve.
- After every build, every dimension that is not resolved is measured again
  on the new geometry, once its ends have been checked against it. Until then
  its row shows the old value greyed and says `not measured on r12: this is
  what it was on r11`, with no verdict. In a new run of torno every dimension
  is measured at the first build.
- An end the build moved away from is measured from the face that is under it
  now, and the dimension says `measured from what is under its ends now` (to
  the agent: `[moved since it was placed: check it]`).
- A dimension is **not measurable** when the part of an end is gone, when the
  kernel refuses it on the new geometry (the hole is no longer round), or when
  an end that was put on an **edge** is no longer on that edge: an edge is the
  edge of that number, and its end counts as on it while the edge is within
  0.5 mm of the point, or the nearest point of the part is on that very edge
  and within `max(0.5 mm, 0.5 % of the diagonal of the part's box)`. A face is
  found again under the point, so for a check that must hold across edits,
  click faces, not edges.
- A dimension is not put somewhere else as a pin is: delete it and measure
  again.

**`measure`** (the agent's) takes `kind`, `a`, for a distance or an angle `b`,
for a mass `density`, and `layout`. An end is a ref (`lid/F12`, `lid/E3`, or a
whole part where the kind takes one), the number of a mark (`M3`: what it is
on, only if the last build's check confirmed it; a dimension is refused, with
a line that says to name its end), `{point: [x, y, z]}`, or `{ref, point}`. Each reply is JSON with a `reading`: the
answer in one line.

| `kind` | Of | Reply |
|---|---|---|
| `distance` | `a` and `b` | mm, the two `points` it is between, and `how` |
| `angle` | `a` and `b` | degrees: between the outward normals of two flat faces (0 to 180), or between two straight edges or axes, or a straight edge or axis and a flat face (0 to 90); the axis of a cylinder, cone, torus or circle is taken as a line, and a face flat or an edge straight within 1e-6 mm as a plane or a line, not exact |
| `radius`, `diameter` | a cylindrical, spherical or toroidal face, or a circular edge | mm |
| `thickness` | a face of a solid, at a point of it (the centre of the face when none is given) | mm, along the inward normal to where the part ends; `moved` says how far the point was from the face before it was laid on it |
| `bbox` | a part, a face or an edge | `min`, `max`, `size` |
| `area` | a part or a face | mm² |
| `volume` | a part that is a solid | mm³ |
| `mass` | a part that is a solid | grams, with the `density` used (g/cm³; the material's of the project's print profile when it has one, else 1.24, PLA, and the reply says which) |

**`check`** takes `kind`, `a`, for two parts `b`, and `layout`; `a` and `b`
are names of whole parts. `interference` and `bed` take neither. `overhang`, `thin` and `bed` ask whether it prints:
they are of the `print` layout when the model has one and no other is named.

| `kind` | Reply |
|---|---|
| `overlap` | the `volume` two solid parts share, in mm³, and the box it lies in |
| `clearance` | the least `distance` between two parts and the `points` it is between; 0 when they touch, and when they overlap, which `overlapping: true` then says. With `fit` (`press`, `sliding` or `loose`) and a material in the print profile, the reply also says whether the gap is within that fit's band per side, how far outside it, and whose numbers they are |
| `interference` | no part: every pair of the layout's solid parts at once. The pairs that share volume (`interfering`, each with its `volume` and the box it lies in, largest first), the pairs that only touch (`touching`) and how many are `clear`. Pairs whose boxes are apart are clear without a cut; the others are cut in order of how much their boxes overlap, for 20 s at most, and `sampling` says how many were measured when the time runs out. Not answered in a layout torno spread for display |
| `mesh` | whether the mesh the part is drawn and exported with is closed (`watertight`), its `triangles`, the number of `openEdges` and where up to 20 of them are |
| `overhang` | with `angle` (degrees from vertical; the profile's material's, else 45, when none is given): the `faces` of `a` that face down steeper than that, each a `ref` (`tray/F7`) with its `area` and `steepest` lean, and their whole `area`; faces on the bed are left out. Planes are exact; a curved face is judged by its normals at sampled points and is not |
| `thin` | with `min` (mm; the profile's least wall when none is given): the `faces` of `a` where the wall, measured along the inward normal at sampled points of each face, is under `min`, with the `thinnest` of each and of the part; always approximate, and `sampling` says what was measured |
| `bed` | with `size` ([x, y, z] mm; the profile's printer's bed when none is given), no part: whether the layout's box `fits` the bed, its `size`, and by how much it is `over` along each axis; exact only when every part's box is |

**The print profile** is the printer (bed, nozzle, layer) and the material (density, shrink, the gap per side of a
press, a sliding and a loose fit, least wall, overhang angle) a project is made for. Choose them under "Print profile" in the
route card (its head says what is chosen: `Bambu X1C, PETG`). The printers are yours, kept in torno's settings (`profiles.json`, next to `config.json`; "Add a printer…"
makes one); PLA, PETG and ABS come with typical values, and a material of your own goes in that file (`materials`: `name`,
`density`, and optionally `shrink`, `fits`, `minWall`, `overhang`). A choice is copied into `<project>/.torno/profile.json`,
so the project travels with the numbers it was checked against. With a profile, `check` bed, thin and overhang and
`measure` mass take their values from it when the call gives none, and the reading says "by your profile (Bambu X1C,
PETG)"; a new conversation is told the profile in one line, `state.md` holds it, and the skill `printing` writes
`Params` from it, not from memory. These are your numbers, not measured: a verdict against them is never a claim that
the part prints.

What is exact, what is approximate and what is refused is under
[Limits and exactness](#limits-and-exactness).

## Section

`X` cuts at once when nothing is cut yet: a plane through the middle of the
parts, across the axis you look most along, open towards you (the half taken
away is the one on your side). A **tag** stands on the plane's top edge, tied to it by a
leader: X, Y and Z put the plane across that axis, again open towards you, "From a face" puts it on the
next flat face you click, and the number says where the
plane is, as the agent is told: across an axis its place in the object frame
(`y 44.0 mm`; type a number to move it), else how far along its normal it is from
the middle of the parts (`12 mm along the normal`). "Flip" takes away
the other side and "Off" shows the parts whole again. The `···` menu of the tag has "Middle"
(the plane through the middle of the parts, there while the plane is elsewhere) and "Make a tracing". If the plane leaves
nothing of the parts that are switched on, a second block under the tag says so, in red:
"Everything is on the cut side". What is on the side the
plane's arrow points to is not drawn. Each solid part is closed where it is cut, in its
own colour a step darker, hatched with fine lines in its edge colour (in a picture for the agent too); a part that is not a closed solid (a scan, an open
shell) is cut open. On the ground beside the parts stands the plane's **rule**: a line along the plane's
normal, ticked every 5 mm and labelled every 20 mm, with the plane's handle, a small accent square, on it. Drag the
handle along the rule, or the arrow on the plane, to move it; a drag anywhere
else turns the camera. The rule is drawn over the view, in the frame of the model: it is no part of it, and not in a
picture for the agent. The handle is also a slider for the keyboard (named "Offset along the normal"): the arrow keys move
the plane by 1 mm, with Shift by 0.1 mm, there or with the tool in hand.
On a cut face there is nothing of the model to pick, and the pointer says so;
a mark on what was cut away stays, drawn faint. The tag and the rule stay while there is a
section, whichever tool is in hand, and the section is kept with the project.
The pictures the agent takes are cut the same way.

**`section`** (the agent's) takes `plane`, and optionally `parts`, `layout`,
`size`, `deflection` and `scan`. A plane is `{origin, normal}`, or `{axis: 'x'
| 'y' | 'z', at}`, or `'current'` for your own section. The reply has, for
each part, the outlines the plane cuts of it as closed loops of `[u, v]`
points in mm along the plane's own axes, each loop's `area` (negative round a
hole), the part's `area`, how many loops are `open`, and the extent of the
whole cut. The outlines come from the exact geometry, as polylines within
0.01 mm of it, or within the `deflection` asked for (0.005 to 0.05 mm). A
reply holds at most 1,500 points: beyond that the loops are thinned, and say
so. Areas are the kernel's, of the true outlines, whatever was thinned.
With it comes a 2D drawing of the cut on a millimetre grid, each part in its
colour, with what is up in the world up on the page. To see the cut in 3D the
agent calls `look` with a `section`.

## Scans

A scan is a mesh of the real thing or of where the part goes: an engine bay,
a room, a machine, taken with a phone or a scanner. Torno draws it with the
parts, so that you and the agent can check the model against it. It is good to
a few millimetres at best and shows only what the camera saw. **Nothing taken
from a scan is exact**, and torno never says that it is.

**Importing.** "Import scan…", at the right of the head of the Scans section, or a file dropped on the
view: GLB, glTF, OBJ, PLY or STL, with faces (a point cloud is refused). The
file is only read. Torno keeps its path, size, date and hash, and makes one
mesh of it in millimetres and Z up under `.torno/scans/`, baking a texture
into colours at the vertices. The scan goes on working from that mesh when the
file moves or is deleted (its row then says "source missing" or "source
changed"); when the mesh is gone too, the row offers "Import again". A scan of
more than 2,000,000 triangles is reduced to that many, and its row says from
how many.

**Units.** glTF is read as metres and Y up; the others as millimetres, or
metres when the whole is under 20 units across, with Y up for OBJ and Z up
otherwise. Right after an import in the window, when either was assumed, a
card in the view asks once, under the switch at the top left and tied by a leader to the
scan's corner: `How is S1 read?`. It says the guess, the size the scan would have read so
(`Its size would be 120 × 120 × 0 mm`) and, under it, the size of the parts of the layout shown
(`The parts of assembly: about 40 × 40 × 41 mm`); when the two diagonals are
more than 100 times apart either way, a line in the warning colour says how many
times and names the unit that would bring them near (`About 1,000 times the
parts: is it in millimetres?`). A dial of cells (mm, cm, m, in) holds the longest side of the scan
as each unit would make it: the one it was read in is on the ground, the one chosen on the accent.
Pointing at a unit draws the scan's box at that size, dashed, in the view, with its size. The up axis
follows. The scan is brought into view with the parts once,
right after the import and again after "Read it in metres" (worded for the unit chosen); the views and `F` still frame
the parts only. The scan is drawn in the view meanwhile, as it was read. "Keep mm" says the
guess is right, "Later" puts the question away. Until
it is answered the row has a dot after the name, and its detail says the size and
what was assumed (`120 × 120 × 0 mm, from m, Z up (assumed)`) and asks
`Read as metres, Z up: right?` with "Yes" and the unit and axis under it (not
while the card is up: the row then says "Asked in the view").
Changing either drops the scan's alignments, which torno says before it does it.

**The Scans section.** Each scan (`S1`, `S2`, never reused) has a row of one
line, built like a layer's: its id, its name (whole, with the path of its source,
in the tooltip), how it stands in the layout on screen in one word (its sentence
in the tooltip), an opacity slider when pointed at, and a switch. The arrow at
the end, or a click on the name, opens its detail beneath it, one scan at a time:
its size and how it was read, how it stands in a sentence, what it rests on,
"Frame" (bring it into view: `F` and the views frame the parts only), "Align",
"Rename" (its name in torno: Enter keeps it, Esc leaves it), then the regions
painted on it as chips that go to the mark (`M5 wiring loom`), the unit and up
axis (folded under "How it is read" once the reading has been answered), its
colours, and last "Remove". On a row the state word gives way before the name,
which keeps at least ten characters. A scan drawn solid hides what is
behind it and takes the pointer; one drawn see-through lets you point at the
part behind it. The section cuts a scan open like the parts.

**Aligning** (`L`). A scan is aligned in one layout at a time; in a layout
where it is not, its row says `unaligned` (in the quiet colour until the scan
has been aligned anywhere: it is only the next step) and nothing is checked
against it. The detail of such a scan makes "Align" its main button, and the
card that asks how a new scan is read offers `Next: align S1`, which takes up
the tool on Floor. The Align scan card at the bottom right of the view has three steps, one under the other,
`1 Floor · 2 Pairs · 3 Nudge`, which can follow one another: a number in a circle (done: ink, current:
accent, to come: hairline), the step's name and a line of what it is for; the current one holds its body.
A tick on a step says it has been done for the scan in this layout. The card opens on the first step not done: Floor for a
scan with no alignment that is much larger than the parts (ten times their
diagonal: a room, an engine bay), Pairs for one about their size, Pairs once a
floor is down, Nudge once there are pairs. When a floor or pairs are kept, the
card goes on to the next. Any step can still be chosen, and the card comes back
to the one you chose last for that scan, in this window:

- **Floor.** Click a flat patch of the scan (`[` and `]` change its size), or
  three points with Shift. "Ground" lays it at a height, "On a face" on the
  flat face of the model you click next; "Flip" turns it the other way up. A
  floor says how the scan lies, not where on that floor it is.
- **Pairs.** Click a point on the scan, then the same point on the model, or
  type the model point. The band says which end of which pair it asks for
  (`Tab` switches which is asked first). From three pairs that are not in a
  line the scan is drawn where they put it, with how far each pair is left
  apart and the RMS of all. Nothing is kept until "Apply". When the fit says
  the scan is some 10, 25.4 or 1000 times off, the band says which unit that
  looks like and offers to read the scan as that.
- **Nudge.** Handles to move (`G`) and turn (`R`) the scan, and fields for
  where its origin is and how it is turned.

"Undo" puts back the alignment before the last one, "Clear" takes it away.
What the row then says of the scan is what the agent is told of it:

| Row | Meaning |
|---|---|
| `aligned` | Tied to points of the model and checked against the last build. Its detail says what it rests on: `4 pairs, RMS 2.1 mm` is a fit of pairs and how well they fitted (the RMS is of the points you clicked, not of the scan); `…, then moved by hand` is a fit or a floor moved afterwards. |
| `placed` | Tied to no point of the model: placed by the handles or typed values (`by hand`), laid on the ground (`floor only`), or pairs whose model ends were typed. No build can say whether it still holds, so none is checked. |
| `pending` | Nothing is built in this run yet, or the last build has not been compared with the alignment yet. Torno never builds the model again by itself to make that check. |
| `check` | The model has moved since: a point you clicked on a part is no longer on it, torno spreads a part otherwise, or the scan was imported again from a changed file. Align again, or press "Still right" in the detail. |
| `rough` | Fewer than three pairs, pairs almost in a line, or pairs left more than 5 mm apart. Torno asks before it keeps one. |
| `unaligned` | Not aligned in the layout on screen. |
| `missing` | Its mesh is gone from the disk; the detail offers "Import again". |

After every build torno looks for the model points of each alignment on their
parts again. It tells what it finds; it never moves a scan by itself. A scan
aligned in another layout offers "Use this alignment in *layout*": it is put
where it stands there, as a start, and kept as placed by hand.

**Regions** (`B`). Drag over a scan to paint a part of it. How it paints, Brush or Box (also Shift-drag),
is in the name that grows out of the tool's button; the Region of a scan card at the bottom right of the view
holds the brush's radius (`[`, `]`), "Erase" (`E`, or Ctrl held), "Grow to flat", "Undo" (`Z`), how many triangles
are painted and "Clear". What is seen is what is
painted: the brush takes nothing behind a part, nor of what a section has cut
away. "Keep as a mark" (`Enter`) makes it a mark with a number and a note, such as
"wiring loom, can be pushed aside": it is how you tell the agent what a part of
the scan is. A painting waits until you keep or clear it, whatever tool or
project you go to meanwhile. "Edit" on a region's row takes it in hand again.
Removing a scan leaves its regions as marks that say their scan is gone.

**The scan tools.** The agent cannot import or align a scan: you do. It can
ask about one. Every reply names the revision, the layout and how the scan is
aligned there, has `exact: false`, and a `reading` whose numbers follow a `≈`
and which opens with whatever puts the alignment in doubt. Lengths taken from
a scan are told to 0.1 mm.

- **`scans`** lists them: name, source, triangles, size, unit and up axis and
  whether they were assumed, whether it is on screen, its regions and its
  alignment.
- **`scan_clash`** takes `part`, and optionally `scan`, `margin` (0 to 50 mm,
  5 by default), `ignore` (region marks to leave out) and `layout`. It counts
  the scan's vertices inside the part, in clusters with the deepest point of
  each, and the scan's triangles that cross the part's surface. It gives no
  volume: a scan is an open surface. It reads, for a flat sheet stood 0.8 mm
  inside a plate: `≈ 2,157 scan points inside the part in 1 cluster, deepest
  0.8 mm at (8, 0.8, 58) under stand/F2; 298 scan triangles cross its surface`,
  after `S1 was placed by hand: no fit says how well.`
- **`scan_deviation`** takes `part`, and optionally `faces`, `from` (`part`,
  the default: from points of the part to the scan; `scan`: from the scan's
  vertices to the part), `region`, `within` (0.1 to 200 mm, 50 by default),
  `samples` (100 to 20,000), `scan` and `layout`. It gives the least, median,
  mean and greatest distance and percentiles of the points that have the other
  within `within`, the worst place, and how many had nothing within reach.
- `measure` takes `{scan: "S1", point: [x, y, z]}` or the number of a region
  as an end of a distance (then approximate); `section` with `scan: "S1"` adds
  the lines the plane cuts of the scan; `look` with `scanColour: {part: "tub",
  range: 20}` colours one scan by its distance to a part.

Limits, each said in the reply that meets it: `scan_clash` checks at most
200,000 scan points near the part and tells the 8 largest clusters; both
checks give themselves 10 s, and a count that was cut short is never told as a
no; `scanColour` colours at most 60,000 points; an alignment keeps 64 pairs.
Refused, with the way out: a scan that is not aligned in the layout asked; a
part torno moved for display (see [Limits and exactness](#limits-and-exactness));
a scan whose mesh is gone or that is being imported; a region that no longer
fits its scan's mesh.

## Explode and saved views

**Explode.** `E`, or "Explode" in the compass at the top right, draws the parts of the
layout apart. A track stands beside the parts, graduated from 0 to 100 % with a handle
you drag along it (the slider of the track is also reached by the keys), and a tag at its
top says how far apart they are, "apart, for the view only", where from (from the
centre, or along X, Y or Z), the distance (×0.5 to ×4) and, last, what Explode is: for
display only, or why nothing is drawn apart. The track runs up along Z, or along the
longest side the view shows when Z is seen end on. It is always whole on screen, and the
tag stands beside it, never over it: when you zoom in so far that no place beside the parts
has the whole track in view, it stands at the bottom right of the view instead. It is for display
only: the parts are where they were built, and every pick, ref and number is
of the parts as assembled.

- While the parts are apart nothing is marked, measured or cut: Pin, Arrow,
  Draw, Shape, Measure, Section, Align and Region take no click, and the
  pointer says `The parts are drawn apart: put them together (E, or the slider
  at 0) to mark, measure or cut`. Select still works, and what it picks is the
  true point.
- A mark is drawn with its part. A dimension between two parts is drawn
  dashed between them and keeps its value. Scans and the grid stay where they
  are.
- A section is never drawn exploded. Making a cut puts the parts together;
  while there is a section the tag says `Take the section away to draw the
  parts apart`.
- The camera stays where it is, unless a part drawn apart would leave the
  view: then the parts are framed anew, and
  put together again they are seen from where they were before, if you have
  not moved the camera meanwhile.
- A project of one part has nothing to draw apart, and the button says so; parts
  that share a centre need an axis.
- The agent's `look` and `show` take `explode`; a picture drawn apart says so
  in its caption. Every other tool answers of the parts as built.

**Saved views.** "+ Save view" at the foot of the compass keeps what is on
screen under a name: the camera, the layout, which parts are switched off, the
section or the explode (never both), and how each scan is shown. The compass
stacks the view that is on, ringed, the agent's first proposal, and "+ Save
view" with "*n* more"; "*n* more" opens the list of all of them, with each
view's menu (rename, update to what is on screen, pin to the board, delete). A
click on a pill or a row brings the view back. While a tool with tags is in hand
(Section, Measure, Draw) or the parts are drawn apart, the stack folds to one
pill, "Saved views *n*", which opens the same list and ends it with "+ Save
view"; with Align or Region in hand the saved views are not there. A name is 1
to 40 characters and not that of a standard view. A project keeps 24 views.
Applying a view changes no geometry and no mark and starts no build. What a
view names that is gone (a part, a layout, a scan) is passed over and said on
its pill.

The agent sees the views in `scene`, draws one with `look {"view": "Web
cut"}` whatever is on your screen, puts one on screen with `show`, and
proposes its own with `save_view`: a dashed pill that says "proposed", with
"Keep" and "Discard". A proposal is the agent's until you keep it; it can
replace its own proposals (12 at most) and never a view of yours.

## The board

Each project has a board: a canvas of cards where what the project knows is laid out, framed and put in order, so that
you can point Claude at a frame ("work through Latch") instead of explaining it again. **Board**, **Model** and **Tracing** (below) take the main
area in turn by the switch at its top left and by `Ctrl+Tab` (not while a field has the keys); a project with no tracing goes round
the board and the model only. The window remembers the last choice
for each project; a project opens on the model until its board has a card of yours or Claude's. The model stays
loaded while the board or a tracing is shown, so nothing is built again on the swap, and the rail, the chat and the status line stay as they are.

**What is on it.** These appear by themselves, each in a free spot the first time the board is read after it appears:
`brief.md` (its text, read only, scrolling), each photo or doodle of `reference/` (the picture, and your note on it), each STEP file and PDF of it (a card with its name and what it is, and your note on it), each mark (`M1`, its kind, where it is,
its note and its state; the card of a view note is made larger, in the shape of its picture, so that the drawing reads), each scan and each tracing (`T1`: its name, its plane, how many layers it has, and, drawn on the card, the outline of the last
build with its layers; before a build of this run it says "build to see the outline", and a double click opens it in the Tracing view). Removing one of these hides it: the mark, scan, photo or tracing is untouched, and "Hidden cards"
at the top right shows it again. When the thing itself goes (a mark deleted, a photo removed, a tracing removed) its card goes with it. Claude is told of a tracing's card as `C9 · tracing T1 "Front of the block": XZ at y = 0.0, 3 layers, photo lined up (4.731 px/mm, ≈)`, and it is new to Claude when the name, plane, layers or line-up change. These
you pin, with "Pin to board":

- a **build**, from its node in the builds strip (its menu, "Pin to board"). The card keeps the
  build's picture, id and line, and the build is starred in the history, so it is never pruned; taking the card away leaves
  the star. On another computer, or once the history has let it go, the card says "build not on this computer".
- a **saved view**, from the menu of its chip among the compass's saved views;
- the **Params**, from their section of the route card, with each value and the ones you are trying marked as tried; and the **checks**, from the
  Checks section of the card, each passing or failing. Each is on a board once: pinning it again says so.

Each **review round** (see [Reviews](#reviews)) has a frame of torno's own, `Review of h41 · 3 − · 2 +`, made with its first item and holding
the cards of its items: a mark card says `− M8` or `+ M8`, `in review, not sent` while it waits, and `OK in h42` or `Still wrong` once you
judged it. The head of the frame has **Open**, which opens the round's panel. The name is torno's: the frame follows the round's counts, and neither you
nor Claude can rename it. A card goes into its round's frame when it is first placed, and a Still wrong card goes into the
frame of the next round; a card you put in another frame, or took out, stays where you left it. Remove a round's frame and it is hidden
(it is not made again while the round has items). Claude may add a card into it.

You make **text** cards (a web address in one shows as a link, and a click on it opens it in your browser), **size** cards (below), **picture** cards (dropped on the board, pasted, or chosen with the Picture tool; a photo larger than
Claude is sent is scaled down by the window first), **doodle** cards (drawn with the Doodle tool on the same ink pad as a new project's doodles), named
**frames** and **arrows** between cards, with an optional word on them. A card dropped inside a frame belongs to it, and a frame
dragged takes its cards along. Claude's cards have a green edge; Claude makes text and pictures of the view (below) and
never moves, edits or removes one of yours or one torno made.

**Moving around.** The wheel or two fingers pan; `Ctrl` and the wheel, or a pinch, zoom about the pointer (10 % to 400 %); a
middle or right drag, or `Space` and a drag, pan; `Shift+1` fits every card. A small map in the corner shows the board and
what is on screen: click or drag in it to go there. The tools are in a palette at the foot: Select `V`, Text `N`, Frame `F`,
Arrow `A`, Size `M`, Picture `I`, Doodle `S`. With Select a drag on empty ground draws a box, a click selects a card and `Shift` adds
one. `Delete` removes what is selected (the cards that came by themselves are hidden), and `Ctrl+Z` takes back the last changes
you made here, up to 50. A board holds 2000 cards and a text card 4000 characters.

**Sizes.** A size card holds one size you know: what it measures ("battery tray"), its value as you typed it (`186 × 128`, `Ø62`, `about 60`;
at most 60 characters, never changed to numbers in the file), its unit (`mm` or `°`), where it came from (`measured`, `from a manual or
datasheet`, or `a guess`) and a note of a line. The tool `M` and a click on empty ground open its form; Enter or "Done" keeps it, and when
something is missing the form says what and stays; `Esc`, or leaving the form, keeps a whole size and makes nothing of a half-written one.
The card shows the value and unit large, in the face of numbers, then what it measures and the source. A double click on one of yours opens the form again, and
`Ctrl+Z` takes the change back. Claude's own sizes say "from Claude" and are never yours to change; Claude reads all of them with `board`, as
`battery tray 186 × 128 mm (measured)`, and asks only for the sizes the board does not have. A new project's "Sizes I know" become these cards.

**A double click** does what the card is for:

| Card | Double click |
|---|---|
| Brief | opens `brief.md` in your editor |
| Photo of `reference/` | opens it large (`Esc` puts it away); any other file is shown in its folder |
| Mark | shows the model with the mark selected; the card of a view note opens its sheet over the note (to change it), and shows the model first; the card of one of your 3D sketches opens it again in Draw, from its camera |
| Scan | shows the model with the scan on |
| Build | shows the model and opens Compare with the live build (nothing for a build this computer does not have) |
| View | shows the model with that view on |
| Params, Checks | opens the Params section of the route card |
| Text | edits it (yours only); a click on a web address in it opens the address in your browser |
| Size | opens its form (yours only) |
| STEP file, PDF | shows the file in its folder |
| Picture | opens it large; one Claude drew of the view goes to the model with its camera |
| Doodle | opens the ink pad on its drawing, to draw over it; `Ctrl+Z` takes the new drawing back |
| Frame | renames it (yours only; a round's frame is torno's, and its **Open** shows the round's panel) |
| Arrow | edits its word |

**What Claude is told.** Every prompt carries one line: how many cards the board has, how many are new and what they are, the
names of the frames, and that `board` reads it. It never carries the board. A card is new when it was added or what it says
changed (a text, a caption, a name, a word on an arrow, the values of the Params, the results of the checks), not when it was moved,
resized or put in a frame. The line under each prompt in the chat says it: `board: 12 cards, 2 new`.

**Sending part of the board.** Select cards or frames and press "Send with the next prompt" (or `Ctrl+Enter`), or press "Send the
whole board". A chip appears above the box of the chat, "Latch · 3 cards · 1 arrow", which "Remove" takes off. When you send the
prompt, torno reads those cards as they are then (an edit made after attaching goes too; a card removed meanwhile is left out and the
chip says so) and puts them in the prompt, after your words: the frames by name, then their cards in reading order (left to
right, top to bottom) each by its id with what it says, then the arrows ("C3 → C7: like this"). The pictures go as pictures after
the text, at most 6 and each at most 1280 px on the long edge; past 6 they are named and left for `board` with `pictures: true`.
The text is at most 12 000 characters, and past that it ends with a sentence that says so. The line under your prompt says what
went: `board: Latch, 3 cards, 1 arrow`. An arrow alone is no attachment.

**Refs.** A board card is `C7`, as a mark is `M3`. You and Claude can write it in a message; in the chat it is a chip, and a click on
one the board has shows the board with that card selected. A card that is hidden or not there is only text.

**Claude's tools** (see "Tools"): `board` reads the board as text, and `add_card` leaves a card of Claude's own, optionally in a
frame and with an arrow, for example a plan or a picture of the view.

The board is stored in `<project>/.torno/board/board.json`, which goes with the project in git: the places, frames, arrows and
text. The pictures stay on the computer (`board/pictures/`, ignored), and what Claude was last told stays too (`board/told.json`);
a board cloned without its pictures shows "picture not on this computer" in their place. Only torno writes it, and it writes
nothing outside `.torno/`.

torno does not watch `board.json`. If it was changed outside torno (a `git pull`), torno notices at the next change you or Claude
make to the board: before writing it compares the file with what it last wrote, takes the file as it is then, makes your change
on top of it, and shows you the result. A pull is therefore seen at the next change, not at once. A file torno cannot read, or
with cards that are not whole, is kept beside it (`board.json.corrupt-…`, `board.json.dropped-…`) and the board says so, with
"Dismiss". Undo (`Ctrl+Z`) goes back up to 50 changes made in this window, and brings back what torno took off in this run. The
pictures torno let go of (a removed card's, a doodle drawn on again) are listed in `dropped.json` beside them and deleted when
the project is first opened in a later run, unless a card has them again or a file kept aside names them
(`board.json.corrupt-…`, `board.json.dropped-…`): delete those files when you no longer need them. A picture that is not on
that list is never deleted, whatever the board names: switching branch never takes one.

### The tracing view

A **tracing** lays one plane of the model flat, at true size, on a millimetre grid: the outline is the kernel's exact cut of the
last build, drawn again after every build. **Tracing** in the switch shows it in place of the 3D view (the model stays loaded
under it). The sheet has a faint grid every millimetre once you are zoomed in and a stronger one every 10 mm (every 100 mm when far out), over the whole of what you see however far you move the sheet, the lines
`u = 0` and `v = 0` in the colour of the axis they run along, each part named on its outline, a scale bar at the bottom left and
a title block at the bottom right. Zoom is told as a ratio: `1:1` is one CSS millimetre on the screen for a millimetre of the
model (a screen does not say its true pixel size, so this is the page's own millimetre, not a ruler's). The wheel or two fingers
move the sheet and a drag moves it, `Ctrl` and the wheel (or a pinch) zoom about the pointer, **Fit** or `Shift+1` frames the
outline and what is drawn on it, not a photo that is much larger than they are, **1:1** or `Shift+0` sets true size. The pointer's place on the plane, `u, v` in millimetres, is read out at the bottom left.

The picker at the top right chooses which tracing is shown (`T1 Front of the block`, then the others) and ends with **New
tracing**, which lays one on a main plane (Front, Top or Right, with how far along its normal, typed), on the section on screen
(the Section tag's `···` menu has **Make a tracing** too, which lays the cut flat), or on a face: the view goes to the model, and the next flat face you
select is the tracing's (a face that is not flat is refused, in words). **New tracing** is also in the head of the **Tracings** section of the route card, which opens the same choices (and the first tracing of a project is made there, or from the Section tag). Each tracing has a row in that section (`T1`, its name, and at the right its photo's file), and a click on it opens the tracing in this view; under the open or shown one the section says `Photo lined up by 4 points, 0.42 mm a pixel. Redrawn at each build.` The tracing's panel is in that section, under its row, while this view shows: the section opens and the card scrolls to it when you come to the view, and you may fold it after. The panel says its name (**Rename** and
**Remove** are at its foot; a removed tracing can be put back for a few seconds), its plane, and `redrawn for h57`, the build the
outline was cut on (`of build h57; building…` while a new one runs). "Model outline" is `exact` where the kernel cut the B-rep and
holds each part's area; its parts are ticked, and a tracing draws at least one. Where the layout is shown with its parts spread apart, the panel says so: the
tracing is cut unspread. **Show in 3D** (in the panel and at the foot of the tools) puts the tracing in the model view, as [below](#a-tracing-in-the-3d-view); **Export** opens the export sheet on this tracing's drawing (see
[Export](#export)). The panel's **Photo** says how the photo is lined up, below.

**Layers** lie over the outline: each is a named set of shapes (lines, circles and labels) in one of eight colours (blue, teal,
violet, ochre, plum, slate, sky, olive; never red or green, which are your marks' colour and Claude's). Both you and Claude make
them. The panel lists each with its colour, its name and how many shapes it has, and says `by Claude` on Claude's. The eye hides
or shows any layer. **Add layer** makes one of your own (a name, free in this tracing, and a colour; it offers `Layer 1` and the
first colour not yet used); the cross removes one of yours, and **Undo** puts it back, shapes and all and with the number it had, for a few seconds. You change
and remove only your own layers, and Claude only its own: Claude's you can hide but not change.

The tools are at the left edge of the sheet: **Select** (`V`) moves around the sheet by dragging and selects, **Trace** (`T`) draws into your
layer, **Pin** (`P`) leaves a note on a point and **Ink** (`I`) draws in the plane, **Measure** (`M`) measures between two points and **Should be here** (`O`) drags a shape to where it belongs (all below). With Trace in hand the panel says what it draws: a **Line**
(click its points; `Enter` ends it, or a click on its first point closes it; `Backspace` takes the last point back), a **Circle**
(click its centre, then a point on it) or a **Label** (click, then type it and press `Enter`). Each finished shape is kept at
once, in the layer ringed in the panel (click the ring on another of your layers to draw into that one). The points snap, within
10 pixels, to the exact corners of the cut, the centres of its holes and the model's vertices in the plane (a vertex that is only
projected onto the plane is drawn fainter and says so), and the pointer's hint says which: `corner of the cut`,
`hole centre head/E14 ⌀16`. Hold `Ctrl` to turn snapping off. A free click is kept to a ten thousandth of a millimetre; a snapped
one is the kernel's, in full. A drag with Trace in hand still moves the sheet, and `Esc` gives up the shape under way, then puts
Select back.

**Marks on a tracing.** A pin or ink made here is a mark like any other: it is in the marks list, goes to Claude with your next
prompt, joins the review that is open on its layout (the band's want or don't want applies), and ink is a card on the board as any sketch is. Claude is told which
tracing it is on (`T1`) and lies in that plane within a millionth of a millimetre, which main checks when the mark is made. **Pin**: click
a point, type its note where it is and press `Enter` (`Esc` gives it up; a note left empty makes no pin). On the outline, within the part's
tolerance of a face, the pin is tied to that face as a pin in the 3D view is (its ref and the kernel's line of the face); inside the cut or over
the photo it is a point in the plane, tied to no part. **Ink** is a sketch whose one plane is the tracing's: a freehand stroke (press and
drag), a line (press and drag, or click its two ends) or a point to point line (a click for each point, `Enter` ends it), rough by nature,
snapping as Trace does and not with `Ctrl` held; `I` again takes the next pen, `Backspace` takes a point back and `Ctrl+Z` a stroke. Each stroke is kept at once;
leaving Ink (another tool, another tracing, or the model) keeps the sketch and draws its card from this view at 1280 px. The sketch is told to Claude as any
sketch is, with its plane named as the plane of the tracing. **Select** picks the mark or the shape of a layer under the pointer within 8 pixels (a mark before
a shape, and it is ringed); `Delete` removes the mark if it is yours, and **Undo** puts it back for ten seconds. Claude's marks are not removed here:
it resolves them. When a build moves the plane of a tracing on a face along its normal, every mark on it moves with it by the same distance, in one change of the marks, and
stays in the plane; a pin or ink on a tracing is not put on another part by a click in the 3D view, and the layout's spread does not move it. A tracing that is removed
leaves its marks where they are: they say `on T1 (removed)`, and join the tracing again if it is put back.

**Measure and Should be here** are about a number or a layer, not about the model, so the review's want and don't want do not apply to them: neither carries an
intent, neither joins a round, and neither is ever checked against a build (they are never *drifted*; they stay as you made them). Both go to Claude with your next
prompt like any mark. **Measure** (`M`): click two points; a tag at the middle of the line so far reads the number as you move (large, with `≈` unless both ends are snapped, and how it was taken), and a click snaps as Trace does. When both ends are
snapped to the kernel's points of the build on show (a corner of the cut, a hole centre, a vertex in the plane) the number is exact, is worked out by torno from those
numbers and says `exact on build h41` (the build's id in the history, which is the same in every run of torno; a build the history does not keep is said so). Any other measure is `≈`: it says how it was found, `on the photo, lined up with fit 0.4 mm` when an end is on the photo (a
free click over the photo and off the outline) or `freehand`, and a snapped end that is not within a hundredth of a millimetre of the kernel's point is refused. A measure is made
once and never measured again: after a later build it keeps its value: an exact one still says `exact on build h41`, and an `≈` one says `measured on build h41`. It has no expected value and no verdict. **Should be here**
(`O`): press on a shape of a layer (yours or Claude's) and drag it to where it belongs. The shape stays ghosted where it was, the copy moves in your colour, and a tag tied to the ghost reads
`M15 head bolt 4 should be here · 1.8 mm left, 0.6 mm up` (left and up are along the sheet's `-u` and `+v`; the tag says `M15` once the shape has a mark). It has no button: the mark is a draft, and goes with your next prompt. `Shift` keeps the
drag to the axis it has gone further along, and the arrow keys nudge it a tenth of a millimetre, while you drag and after you let go. Letting go makes the mark, one for each
shape of a layer: dragging the same shape again changes your draft rather than adding another (one Claude has already been told of is left, and a new one is made). A shape's
reference point is a circle's centre and the centroid of a polyline's points (the mean of them, not of its area). The mark keeps a copy of the shape as it was, so it still says
what moved after Claude replaces the layer, and says `layer changed since` once the layer's revision is newer than the mark's. It is never exact: it is where you say a shape belongs,
by eye. Claude is told it as `M12 · offset · head bolt 3: 1.8 mm left, 0.6 mm up on T1 (≈, from the photo)`, then the move in the model's frame, `≈ (−1.8, 0, +0.6) mm in X, Y, Z` (never exact, whatever the photo), the layer, and the photo's line-up (`photo: lined up by 4 points, straightened: 4.731 px/mm at the centre, turned 2.1°, fit 0.4 mm; not exact, and true only in the tracing's plane`). `(≈, from the photo)` is said only when the tracing has a lined-up photo; with none it says what the move is relative to and that it is not exact, `1.8 mm left, 0.6 mm up from the layer's shape on T1 (≈)`. A pin you put on the photo (one that is on no part of the model: a pin on the outline is tied to the face under it) and the ink you draw over it are told `on T1 (≈, from the photo)` with the same line-up. With every prompt Claude also gets one line when the project has tracings, `tracings: T1, T2 (1 changed since you were told: T1's photo was lined up again). Read them with tracings.`, saying what changed since its last prompt (a name, a plane, the layers, a photo, a face that is gone or back, a tracing made or removed; not a fade or what is hidden). With more than eight tracings it names eight and counts the rest. What Claude was told is kept in `tracings/told.json` once the prompt is delivered.

### A photo under a tracing

A tracing keeps one **photo**, under the outline, lined up with it so that what is on the photo can be traced in millimetres. **Add photo** in the
panel (in the Tracings section of the card) takes a picture from the photo dialog, or from the photos in the project's `reference/` (listed under it); dropping a picture on the sheet does
the same. torno turns the picture the way the camera held it, scales it to at most 4000 pixels on its long edge and keeps its own copy in
`.torno/tracings/photos/`, a folder git ignores: a photo stays on this computer, and a tracing opened on another one says `photo not on this
computer`, with its line-up still told. HEIC is not read (set the phone to Most compatible, or export as JPEG).

The view then splits: the photo on the left, the tracing on the right, each with its own pan and zoom (the wheel or a drag moves, `Ctrl` and the
wheel zoom, **Fit** frames). You click the same spots in order, a spot on the photo and then its twin on the tracing, and each pair is numbered `1`,
`2`, … in one colour on both sides. Drag a marker to move its click, and `Backspace` takes the last click away. Clicks on the tracing snap, within 10
pixels, to the exact corners of the cut and the centres of its holes (`Ctrl` held turns that off), and a snapped click is the kernel's point, not yours.
The band shows what the clicks say as you make them, `scale 4.73 px/mm · angle 2.1° · fit 0.4 mm (5 points)`, and **Preview** lays the photo faded over
the tracing as soon as the points are enough. Two points give a scale, a turn and a place; the fit is only told when a point is spare (`no spare point to
check it` with exactly two). **Straighten (4 points)**, off until you ask (`S`), fits a perspective to four points or more, for a photo taken at an
angle. **Done** (`Enter`) sends the clicks: torno fits them again itself and keeps the result; **Cancel** (`Esc`) leaves the line-up as it was.
These buttons are in the band at the top left, `Lining up the photo of T1`. Under it the page says what a line-up is worth: true only in the tracing's plane, since what stands nearer the camera looks bigger. The tracing is shown
here with `v` up whichever way its plane's axes point in the model, as a photo of the plane's front sees it.

The photo's scale, turn and fit are never exact, and the panel says `not exact` beside them. The straightened copy of the photo (the photo warped
into the tracing's millimetres, at its own pixels per millimetre and at most 4000) is what the sheet, the board card, the export and Claude's picture
all place, by its rectangle in millimetres; it is made by the window when a line-up is kept, and made again when this computer has the photo and not the
copy. The Photo section shows the thumbnail, `4.73 px/mm`, `2.1°`, how it was lined up (`5 points, straightened, fit 0.4 mm`), a **Fade** slider (sent
once, when you let go), **Hide** (the line-up stays), **Line up again**, **Swap photo** (the points you clicked on the tracing stay, and only the
photo's are asked for again) and **Remove photo**. Claude never lines a photo up, swaps, fades or removes it.

### A tracing in the 3D view

**Show in 3D** puts a tracing in the model view, in its plane and at true scale: its photo (the straightened copy) as a translucent picture at the
photo's fade times 0.6, the outline of the last build in the ink colour, each layer that is not hidden in its own colour (a label is a small cross at
its place), and a faint sheet, with its edge, a margin past all of it. It is for reading the tracing against the parts, not a surface: nothing of it is
written into the depth of the view, so the parts show through it, and it shows through the parts the plane cuts. It is never cut by a section, as marks are
not, and it is never picked: a click goes through to the parts. The switch is a button in the tracing's panel and one under its tools, pressed while the
tracing is shown. A tracing is drawn in the layout it was made in. Each tracing has a row in the **Tracings** section of the route card, with the eye that shows it
in 3D or puts it away (the eye is lit while it is shown). Its marks are drawn with the marks, whatever is done to the tracing.

Which tracings are shown is how you last looked at the project, and is kept in `scene.json` as `tracingsShown`, with the layers and the section. It is a view, not
a change: it does not go to Claude as one, and no mark, build or file of the model changes with it. A tracing shown is cut again after every build, like the one you
have open. A picture Claude takes with `look` draws the tracings shown on your screen, in the picture's layout, and its caption says so: `· tracing T1 shown in its
plane`. A tracing whose photo is not on this computer is drawn without it.

The marks on a tracing are drawn in 3D as their kinds are, whether the tracing is shown or not: a pin and ink as in any view; a **Measure** as a line with a tick at each end, its
chip at the middle, reading `≈ 41.8 mm`, or `41.8 mm` when it is exact; and a **Should be here** as an arrow from where the shape is to where you say it belongs, in
your colour, its chip at the head.

## The page of projects

`W`, or "All projects" at the top of the list (beside its title once a project is open), shows every project of the folder
on a bench; a workspace of several projects starts there. `/` or a letter
filters by name, the arrows move (left and right along a shelf, up and down to the shelf above or below), `Enter` opens, `Esc` goes back. The head (the folder's name,
how many projects and where, the filter, **True scale / Grid**, **By name / Recently changed**, **Export…** and **New project**) stays at the top as the shelves scroll.

The projects stand on **shelves**, a 2 px line of ink, who needs you first:

- **Needs you** is every project whose session waits on you. Under its shelf each says what it waits on: `Claude asks:` and
  the question (its first 140 characters) in a warning card, **Answer**, which opens the project and brings the question up
  where it is answered, and `waiting 4 min`.
- **Working** stands beside it: a project that builds, or in which Claude Code works.
- **The rest** is on one shelf, the project whose model was saved last first (**Recently changed**, the default) or by name (**By name**); the
  choice is kept for the folder. Needs you and Working stand ahead of either.

The pictures stand side by side, 40 px apart, **at one scale for the whole page** (**True scale**): a part twice as big is
drawn twice as big, and the bar at the right end of each shelf is 50 mm. The scale is as large as the widest shelf allows, never
larger than the picture's own pixels; a shelf that would need it smaller than a quarter goes on to a second line. **Grid**
fits every picture to a box of the same size instead, for when the sizes differ too much to read; the choice is kept for the
folder. In a window 800 px tall or less the bench is drawn at 86 %.

A project is:

- **A picture** of the project's last build as you last looked at it (its
  layout, the parts switched on, its section or explode), without
  marks or scans, made when a build lands in torno and kept in
  `.torno/thumb.png`. No build is ever started for a picture. A picture is at true scale when its layout fits it (about
  240 × 180 mm as the iso view draws it, not drawn apart) and the project has its size; any other is drawn in Grid's look on
  the shelf (a framed box with the picture fitted in it), and a project that was never built in torno, or whose picture
  is gone, is a dashed box that says `Size not known until it builds`. The page never claims a size the kernel did not give.
  The card says when the picture was made, what it leaves out (`cut by its section`), and `A source
  has changed since` when a `.py` file of the object, of `common/` or one it imported from another
  project (`Uses box/box.py` on the card, for a project opened in this run) is newer.
- **Its name**, with `Open` in the accent and a bar of the accent under the picture on the project that is open.
- **How the build stands**, for a project opened in this run: `Built, r6` (the build's number, as the status line says it),
  building, or failed, with the picture of the last build that worked dimmed.
  Otherwise `Model saved 3 h ago`, read from the date of its `.py` files
  (nothing is built for it; the tooltip says `Not opened in this run`).
- **Its size** in millimetres (`150 × 80 × 92 mm`, the kernel's box of the last build the picture is of; `≈` when it is the box of the
  mesh and not of the B-rep), then what is open on it in the same small face: how many marks are open and how many are not sent
  yet; how many dimensions fail and pass. Of a project not opened in this run
  there is no verdict, only `1 dimension failed as of its last run`.
- **What git says**, in a work tree: `3 files changed since a1b2c3d` (the files in its tooltip) or `No changes since a1b2c3d`.
- **The session**, if one runs.

Looking at the page builds nothing, opens nothing and writes nothing.

## Export

"Export…" in the line at the bottom (the open project), in the head of the page
of projects (any of them), on a card, or `Ctrl+Shift+E`, writes **one HTML
file** for someone who has no torno, or a **STEP, STL or 3MF** file of one
project (below), or, of the project on show, a **picture** of the view or a
**drawing of its section** (below). It is made from the last build of this run, so a project must
have been opened first. Nothing is uploaded: the file goes where the save
dialog says, which opens in `.torno/exports/`.

The export opens in the session dock, under the builds strip, in place of the
conversation. The strip stays: the ringed node is the build that will be
exported (the build on show; picking another node does not export it). The
conversation folds to a 40 px band at the dock's foot ("Claude Code idle, 1 mark
to review", and **Back to the chat**); an ask that arrives turns that band to
the warning wash and says it needs you, with **Answer**, which puts the export
away and shows the ask. The view is the preview: a 2 px accent frame goes round
it, a band at its top left says what is being made ("Exporting a page of
hollow r1"), marks shown or hidden follow their line, and a part that is
switched off and stays out of the page has a dashed tag at its place ("lid is
switched off: left out"). **Close** or `Esc` puts the export away.

At the top are five tiles: **A page** (HTML), **CAD** (STEP), **Slicer** (3MF
or STL: a segment inside the tile picks which), **Picture** (PNG) and
**Tracing** (SVG or PDF). Picture and Tracing are of the project on show: when
the export is not (from the page of projects), they are dimmed and say why in
their title.

Below them is one line for each thing that can go, with a switch, what it is and
**what it weighs** at the right (`413 KB`, with a square of the colour of its
share of the rule below); a line that is switched off has its weight struck
through, and a scan the budget left out says "left out for size". Under the
lines stands the total (`1.7 MB`), "of 12 MB", and a rule from 0 to 12 MB, ticked
at 0, 6 and 12, filled with the lines that go in their order. Over 12 MB the
rule runs to the budget and the overflow is drawn in the failure colour past
its end, with the reason in words under it; above 64 MB the action is off and
the refusal is said, and a refused plan shows no rule. A STEP, an STL, a 3MF, a
picture or a tracing has no rule: it says how many parts, or the picture's size.
The foot says "Nothing about this computer goes in the file." and has **Cancel**
and the action (**Export page**, **Export STEP**, and so on). While the file is
made it says so ("Making the file and reading it back…").

When the file is written the export closes and the file lands in the status
line where Export… was, as "✓ `intake.html` 1.7 MB **Show in folder**" on the
accent wash. What was read back ("Checked: STEP read back, 9 parts by name …")
is in a popover above it, which shows once as the file lands and on the pointer
after that; **Open in browser** is in it for a page. The status line keeps the
file until the next build or a minute, and its × lets it go sooner (Export…
is there again).

What is ticked is what is in the file:

| In the file | |
|---|---|
| always | the parts of every layout, in their colours; the explode kept for each layout; the views you saved or kept |
| only when ticked | marks and their notes (drafts go with them, and the sheet says how many); resolved marks; parts that are switched off; each scan, by its own tick, reduced to at most 60,000 triangles |
| never | where anything is on this computer; the model's source; what a model printed; the session with the agent; `state.md`; a view the agent proposed and you did not keep; what was painted on a scan |

The page opens from `file://` with the network off: its script, style and
fonts are inside it, and its policy lets it load and send nothing. It has the
parts with a switch each, the layouts, an explode slider, a section (parts are
drawn open, without cut faces), the saved and the standard views, the marks as
labels and a list with each dimension as torno measured it, and light and
dark. It measures nothing and says so. With several projects, each is unpacked
when it is first shown.

A part costs about 10 bytes a triangle on top of 0.7 MB for the page itself:
a project of one part and 12,000 triangles in two layouts is 1 MB. Over 12 MB
the largest scan is reduced further, then left out, and the sheet says so;
above 64 MB nothing is written. The file is written whole or not at all, and a
name without `.html` gets it. Once it is saved, the status line offers **Show in folder**
and, for a page, **Open in browser**: they act on the file just written, which
torno itself remembers. A project left out because it has no build of this run
is a link in the sheet: it opens the project, and when its build lands the sheet
comes back with it ticked beside the others.

### STEP, STL and 3MF

The tiles **CAD** and **Slicer** write a file of the model instead, of one project:

| Format | What is in it | Layout unless you pick another |
|---|---|---|
| STEP | the exact shape, each part a named body in its colour | `assembly` |
| STL | one part, as triangles | `print` |
| 3MF | a plate: each part a named object in its colour | `print` |

Every file is in millimetres, with the parts where the layout has them: a
plate's parts are where torno set them apart, as on screen. You tick the parts
that go; an STL or a 3MF is of solids alone. A part of several solids is, in a
3MF, one object made of a mesh of each; an STL of solids that touch is refused,
saying to fuse them in the model or export 3MF. Their triangles are made for the
file, not taken from the screen: none further than the tolerance from the
faces (0.01 mm unless you type another, 0.001 to 1 mm), nor turning more than
the angle (5°, 0.5 to 45°). A tolerance that would make more than 500,000
triangles is refused before anything is made: past that the kernel could not
make the file in the time it has.

The kernel makes the file from the last build, and torno writes it beside the
name you chose. Before the file takes that name, the kernel reads it back and
checks it:

- **STEP**: the same parts by name, each with as many solids, a volume within
  a millionth of the model's or twice what the two volumes are in doubt,
  whichever is more, and the same box.
- **STL and 3MF**: each object closed (every edge of two triangles, wound
  one way), no triangle without area, in as many pieces as the part has
  shells, facing out, its box the part's, and its volume within what the
  tolerance can cut off the model's.

A file that fails is not saved, and the export says why. One that passes is
named, and the status line says what was checked: `Checked: 3MF, 2 objects, 184,220
triangles, closed, volume within 0.04 % of the model`. Checked, not printed. A
3MF can be opened once saved in the program your system opens 3MF files with,
your slicer, when "Open it once saved" is ticked.

### A picture of the view, and a tracing

The tiles are by who will open the file: **A page** (the HTML page), **CAD** (STEP), **Slicer** (3MF, STL), and, when the
export is of the project on show, **Picture** (PNG) and **Tracing** (SVG, PDF), which are of the view as it is on screen. Nothing is uploaded, and no agent has a tool for any of them: the save
dialog opens in `.torno/exports/` with a name offered, and the file is written whole or not at all (a name without
the ending gets it).

- **PNG** is the view as it is (the camera, the layout, the parts that are on, the section or the explode, the scans),
  for a forum, a chat or a document (`<name>-r<revision>.png`). It is drawn by the same code as the pictures the agent is
  given. You choose its long edge, 1280, 2000, 3000 or 4000 pixels, whether the marks are in it, and whether the axes and
  the scale bar are. A picture you keep is not for the agent, so the 2000 pixels the agent's pictures stop at do not hold
  for it; `look` is still held to them.
- **SVG**, while a section is on screen, is a drawing of the cut for someone who will make the part
  (`<name>-section-r<revision>.svg`). The outlines are the kernel's, within 0.01 mm, laid flat in the plane's own axes
  at true scale: one unit of the file is one millimetre, so a 40 mm edge is 40 mm long, and the sheet says so (print
  it at 100 %). It has a scale bar, a title block (the project, the layout, the build, the date, the plane's origin
  and normal and the sheet's axes in full, how far the outlines may stray, and what was cut of each part with its
  area, `≈` where the area is not exact), and each dimension that lies in the plane (both ends within 0.01 mm of
  it), not resolved and measured on this build, as a line with the value torno measured and, when you set them,
  what was expected and the tolerance. A dimension that is not in the plane, or not measured on this build, is left
  out.
- **PDF** is that drawing printed on a page of its own size in millimetres (`<name>-section-r<revision>.pdf`), by a
  window torno never shows.
- **A tracing of the project** is drawn the same way, from its own plane, instead of the section on screen: choose
  it in the list "Drawing of", the first row of the Tracing tile (the section on screen, or `T1`, `T2` and so on), and the file is
  `<name>-T1-r<revision>.svg` or `.pdf`. It is drawn from the last good build, and a build that lands while it is
  made is refused. Its title block adds the tracing's ref, name and plane, and each part is named on its outline
  with a thin tab in the part's colour. "Layers" (ticked) draws the layers that are shown, each in its colour, with a
  legend; "Marks on it" (not ticked) draws the pins and arrows made on the tracing; "The photo" (not ticked: a photo may show the real world) puts the
  straightened photo under the outline as an embedded image, at its fade, with its line-up and that it is not exact in the title block. It is there to tick
  once the photo is lined up.

## Keys

`?`, or Keys on the rail, raises a keyboard from the foot of the window, over the view and the card; the rail and the status
line stay, and it comes up in a third of a second (at once with reduced motion). Press `?` or `Esc` again, or press beside it, to put it away.
Along its top are the places keys are heard in, as chips: Everywhere, In the view, With a tool in hand, Sketching, Board, Tracing, Projects
and Session. The keyboard is the US layout, and in the place you chose each key says in a word what it does there. The keys that
pick a tool are on the accent wash with their letter in the accent, and those heard in the view are outlined. Keys with `Ctrl` or
`Shift` held are listed under the keyboard, with the pointer's gestures in the view. Point at a key, or click it, and it is asked about.

At the right is a search, and it answers in sentences: type a key (`E`) or words (`explode`, `wall`) and each place where it is
heard has one, built from the rows of the table below, such as "In the view, E draws the parts apart, or together again." Under a
sentence a muted line says where the key is not heard. The sentence for the place you chose is on the accent wash. A line at the foot
counts the keys; a search that finds nothing says "No key says ...". The pointer has no keys:

<!-- pointer: generated from POINTER in app/src/shared/pointer.ts; `TORNO_README=write pnpm -C app exec vitest run src/readme.test.ts` writes it -->
| Pointer | What it does |
|---|---|
| Drag | Turn the view about the point under the pointer; with Arrow in hand a drag that starts on the part draws instead, and with Draw in hand a drag draws (Alt-drag turns the view) |
| Right drag | Pan the view (a middle drag does too) |
| Scroll | Zoom, towards the pointer |
| Double click | With Measure in hand: measure something round, its diameter or its radius |
<!-- pointer: end -->

Point at a tool of the reed and a tip beside it says, at once, what the tool does and its key. With a
tool in hand (not Select) a small dark caption by the pointer, a little below and to its right (and below the Model/Board switch or a band when the pointer is by them), says what the tool waits for next, and
`Esc`: for Measure `click the first end`, then `click the second end`; for Arrow `press on the part and drag to where it should go`.
For the first ten times you take a tool the caption shows as soon as the pointer is in the view; after that it shows where the pointer
rests for half a second and goes when it moves again (a screen reader is told the words either way). Region of a scan and Align scan,
with no scan in the project, are drawn quieter and say `Import a scan first`.
The hint at the foot of the view, in the middle, tells how the pointer moves the view the first time a project is drawn in this install,
until the camera is first moved; while a sketch is open it says whether snapping is on and that `Ctrl` drops it, and where x-ray is;
and it holds the line of what the agent points at. The window remembers what it has shown in its own storage, never in a workspace.

<!-- keys: generated from cheatSheet() in app/src/shared/keys.ts; `TORNO_README=write pnpm -C app exec vitest run src/readme.test.ts` writes it -->
| Where | Keys | What it does |
|---|---|---|
| Everywhere | `?` | This sheet of keys, outside a field and the terminal |
| Everywhere | `` Ctrl+` `` | To the session, and from it back to the view |
| Everywhere | `F6` | To the next part of the window: projects, view, session, status line |
| Everywhere | `Shift+F6` | To the part before |
| Everywhere | `Ctrl+Shift+D` | Show or hide the session pane |
| Everywhere | `Ctrl+Shift+E` | Export to one HTML file, or to STEP, STL or 3MF: the open project, or from the page of projects any of them |
| Everywhere | `Ctrl+Shift+B` | Rebuild: build the open project again, as the button in the status line does |
| Viewport | `V` | Select: click a face or an edge, double-click for its part; Shift-click adds or takes out. The choice by the selection says what a click takes |
| Viewport | `M` | Measure: two clicks, or a double click on a round thing; nothing is kept unless you keep it |
| Viewport | `X` | Section: cut the parts by a plane |
| Viewport | `P` | Pin: click a point and leave a note |
| Viewport | `A` | Arrow: drag from a point |
| Viewport | `D` | Draw: a sketch in 3D, on planes or on the surface |
| Viewport | `S` | Shape: place a box, a cylinder, a sphere or a plane |
| Viewport | `B` | Region of a scan: paint what something is |
| Viewport | `L` | Align scan: stand a scan where the model is |
| Viewport | `1` `2` `3` `4` | Iso, front, right and top view |
| Viewport | `F` | Fit the selection in view, or the parts; again, the parts |
| Viewport | `O` | Perspective or orthographic |
| Viewport | `E` | Draw the parts apart, or together again |
| Viewport | `W` | All projects of the folder, on one page (there a letter filters them by name) |
| Viewport | `H` | Review this build: start a round, to mark what you do not want and what you want, and send it at once |
| Viewport | `-` | Review: new marks are what you do not want; again, plain |
| Viewport | `=` `+` | Review: new marks are what you want; again, plain |
| Viewport | `Ctrl+G` | Name the selected faces, edges, parts or strokes as a set |
| Viewport | `Esc` | Compare: back to the live build, before any other step back |
| Viewport | `Esc` | Step back: what is under way, then the tool in hand, then the selection |
| With a tool in hand | `T` | Measure: the wall under the pointer |
| With a tool in hand | `Enter` | Measure: keep the last measurement as a dimension |
| With a tool in hand | `Left` `Right` `Up` `Down` | Section: move the plane by 1 mm |
| With a tool in hand | `Shift+Left` `Shift+Right` `Shift+Up` `Shift+Down` | Section: move the plane by 0.1 mm |
| With a tool in hand | `Tab` | Align, pairs: which end is asked for first |
| With a tool in hand | `Backspace` | Align, pairs: take the last end back |
| With a tool in hand | `[` `]` | Align, floor: a smaller or larger patch |
| With a tool in hand | `G` `R` | Align, by hand: move or turn the scan |
| With a tool in hand | `[` `]` | Region: a smaller or larger brush |
| With a tool in hand | `E` | Region: paint or rub out |
| With a tool in hand | `Z` | Region: undo the last stroke |
| With a tool in hand | `Enter` | Region: keep what is painted |
| With a tool in hand | `B` | Sketch: the freehand pen |
| With a tool in hand | `L` | Sketch: the line pen, press and drag or click twice |
| With a tool in hand | `P` | Sketch: the point to point pen, a click for each point |
| With a tool in hand | `C` | Sketch: the eraser, a click takes the stroke under the pointer |
| With a tool in hand | `Shift+1` `Shift+2` `Shift+3` | Sketch: draw on the XY, XZ or YZ plane |
| With a tool in hand | `N` | Sketch: draw on the plane of the face under the pointer |
| With a tool in hand | `U` | Sketch: draw on the surface of the parts |
| With a tool in hand | `Tab` | Sketch: type how far the plane is moved |
| With a tool in hand | `I` | Sketch: draw the parts see-through, or solid again |
| With a tool in hand | `K` | Sketch: how literally it is taken, exact, rough or flow |
| With a tool in hand | `0` `1` `2` `3` `4` `5` `6` `7` `8` `9` `.` | Sketch: type the length of the segment being drawn (with none under way, the figures are the views) |
| With a tool in hand | `Enter` | Sketch: fix the length typed, or end a point to point line |
| With a tool in hand | `Backspace` | Sketch: take the last point or figure back |
| With a tool in hand | `Ctrl+Z` | Sketch: undo the last stroke, or the last erase |
| With a tool in hand | `Ctrl` | Sketch: hold it while drawing to turn snapping off |
| With a tool in hand | `Esc` | Sketch: give up the stroke under way, then leave the sketch (it is kept) |
| With a shape in hand | `G` `R` `T` | Move, rotate or size the shape with its handles |
| Board | `Ctrl+Tab` | The board, the model and a tracing, in turn |
| Board | `Shift+1` | Board: fit all the cards |
| Board | `V` | Board, Select: click a card, drag on empty space for a box; Shift adds |
| Board | `N` | Board, Text: a card for a note |
| Board | `F` | Board, Frame: a named outline round cards |
| Board | `A` | Board, Arrow: draw from one card to another |
| Board | `M` | Board, Size: a card for a size you know |
| Board | `I` | Board, Picture: add a photo from a file |
| Board | `S` | Board, Doodle: draw on a card |
| Board | `Space` | Board: hold it and drag to move around (the wheel moves, Ctrl and the wheel zooms) |
| Board | `Ctrl+Enter` | Board: send the selected cards with the next prompt |
| Board | `Delete` `Backspace` | Board: remove the selected cards and arrows (those that came by themselves are hidden) |
| Board | `Ctrl+Z` | Board: undo the last change you made to cards (up to 50) |
| Board | `Esc` | Board: end what is being written, then put the tool back to Select, then let go of the selection |
| Tracing | `Shift+1` | Tracing: fit the outline |
| Tracing | `Shift+0` | Tracing: show it at true size, 1:1 |
| Tracing | `V` | Tracing, Select: move around the sheet by dragging |
| Tracing | `T` | Tracing, Trace: click the points of a line, the centre and edge of a circle, or the place of a label, into your layer |
| Tracing | `P` | Tracing, Pin: click a point and type its note where it is; Enter keeps it |
| Tracing | `I` | Tracing, Ink: draw in the plane, freehand, a line or point to point; again, the next pen |
| Tracing | `M` | Tracing, Measure: click two points; snapped to the cut's points the number is exact, else it is ≈ and says how it was found |
| Tracing | `O` | Tracing, Should be here: drag a shape of a layer to where it belongs; Shift keeps one axis |
| Tracing | `Left` `Right` `Up` `Down` | Should be here: nudge the shape being dragged, or the one just placed, 0.1 mm |
| Tracing | `Enter` | Trace, Ink: end the line (in Trace a click on its first point closes it) |
| Tracing | `Backspace` | Trace, Ink: take the last point back |
| Tracing | `Ctrl` | Trace, Ink: hold it while clicking or drawing to turn snapping off |
| Tracing | `Esc` | Trace, Pin, Ink, Measure, Should be here: give up what is under way, then put Select back |
| Tracing | `Delete` | Select: remove the mark selected, if it is yours (Undo is offered for ten seconds) |
| Tracing | `Ctrl+Z` | Ink: take the last stroke back |
| Tracing | `S` | Line-up: straighten the photo (4 points or more), or only turn and scale it |
| Tracing | `Backspace` | Line-up: take the last point back |
| Tracing | `Enter` | Line-up: done, when there are points enough |
| Tracing | `Esc` | Line-up: cancel, and leave the line-up as it was |
| Page of projects | `Left` `Right` `Up` `Down` `Home` `End` | Move among the cards |
| Page of projects | `Enter` | Open the card in focus |
| Page of projects | `/` | Filter by name: a letter or a figure does too |
| Page of projects | `Esc` | Clear the filter, then back to the open project |
| Page of projects | `Enter` | In the filter: open the first card |
| Page of projects | `Down` | In the filter: down to the cards |
| New project | `Esc` | Leave the page, asking first when something is in it; on the doodle board, put the board away |
| New project | `S` | Doodle: open the ink pad (not heard in a field) |
| Session | `Shift+Enter` | A new line in the prompt, not a send |
| Session | `Ctrl+Shift+C` | Copy what is selected in the terminal |
| Session | `Ctrl+Shift+V` | Paste into the terminal |
| Session | `Enter` | Chat: send the prompt |
| Session | `Shift+Enter` | Chat: a new line in the prompt, not a send |
| Session | `Up` `Down` | Chat: choose among the / commands offered while one is typed |
| Session | `Tab` | Chat: complete the / command chosen |
| Session | `Ctrl+C` | Chat: stop the turn while Claude Code works, with nothing selected in the box |
| Session | `Enter` | Chat: allow what the card in focus asks (in its reason field, Enter denies) |
| Session | `1` `2` `3` `4` `5` `6` `7` `8` `9` | Ask: the option of that number: answers torno's question (the first three), picks or toggles it on the question Claude Code asks |
| Session | `Esc` | Chat: put away a picture shown large |
| Session | `Left` `Right` | On the edge of the session pane: wider or narrower |
| Session | `Left` `Right` | On the edge of the card by the rail: narrower or wider |
| In a field, a menu or a sheet | `Enter` | Field: keep what was typed |
| In a field, a menu or a sheet | `Esc` | Field: leave it as it was |
| In a field, a menu or a sheet | `Shift+Enter` | Note: a new line |
| In a field, a menu or a sheet | `Down` `Right` | Menu: the next item |
| In a field, a menu or a sheet | `Up` `Left` | Menu: the one before |
| In a field, a menu or a sheet | `Home` `End` | Menu: the first or the last |
| In a field, a menu or a sheet | `Esc` `Tab` | Menu: close it |
| In a field, a menu or a sheet | `Esc` | Sheet or question: put it away |
| In a field, a menu or a sheet | `Ctrl+Z` | Drawing board (a doodle, or a drawing on the view): undo the last stroke |
| In a field, a menu or a sheet | `Shift` | Drawing board: hold Shift while drawing for a straight line from where the stroke began |
| In a field, a menu or a sheet | `T` | Drawing on the view: the label tool, click to place a label and drag from it to point an arrow (not heard in a field) |
| For working on torno | `F12` `Ctrl+Shift+I` | Developer tools |
<!-- keys: end -->

A tool in hand is offered a key before the viewport is. `F12` and
`Ctrl+Shift+I` open the developer tools whenever torno runs from the
repository.

## Files torno writes

Inside a workspace torno writes only under `<project>/.torno/`, with two exceptions. One: "Create" on the page of a new
project (see "Making a new project") writes the new project's folder, `<name>/<module>.py`, `brief.md` and `reference/`.
Those are the project's own, in git like its model, and torno never writes into them again. Two: "Go back to before this prompt"
(see "The chat") writes and deletes `.py` files of the open project's own folder, after you have confirmed what it names, each
whole or not at all; it never writes `common/` or another project's folder. It writes under `.torno/` only when
that is a real folder inside the project: where a link or a file is in its
place (a workspace copied from elsewhere may hold one) torno writes nothing
there, and says so once in the Marks section of the card, until a real folder is put in its
place.

| File | What | In git |
|---|---|---|
| `scene.json` | how you last looked at the project: the layout, the layer visibility, the section, the explode of each layout, how each scan is shown, the saved views (`views`) and the tracings shown in the 3D view (`tracingsShown`) | travels with the project |
| `params.json` | the values you are trying in place of the model's `Params` defaults, with the default the file had; trying a value never writes the model file (a Go back puts the values back as a build had them) | ignored |
| `marks.json` | the marks of the project: yours and the agent's, with their notes, anchors and status; of a dimension also what is expected of it and the value last measured; and the review rounds (the build each reviewed, which marks are in it, and what you judged of each); torno does not watch it: a change from outside (a `git pull`) is taken up at the next change to a mark, which is made on top of it | travels |
| `sets.json` | the named sets of the project (see "Named sets"): each with its name, comment, colour, layout, who made it, and its members: faces and edges with the kernel's selector for each, their point and normal and whether the last build found them, parts, and strokes by id (`M7/k3`) | travels |
| `scans.json` | the scans of the project: where each source file is and its hash, how it was imported, and its alignment in each layout | travels |
| `board/board.json` | the board (see "The board"): its cards with their places, sizes and text, the frames and the arrows; for a card that shows a build, a copy of what it says | travels |
| `board/pictures/` | the pictures and doodles of the board's cards | ignored (`board/pictures/.gitignore`; a picture may show the real world) |
| `board/told.json` | what Claude was last told of each card, so that only what is new is said | ignored |
| `tracings/told.json` | what Claude was last told of each tracing (its name, plane, layers and photo's line-up), so that its line says what changed | ignored |
| `scans/<id>/mesh.bin`, `<mark>.mask` | the scan as torno draws and checks it, and the triangles of each region | the meshes are ignored (`scans/.gitignore`): a clone has the record, and the row offers "Import again" |
| `profile.json` | the printer and material the project is made for (a copy of your choice under "Print profile") | travels with the project |
| `agent.json` | whether Claude Code is shown as a chat or a terminal; without it, in a chat | travels |
| `chat/<conversation>.jsonl` | what a chat session said and did, as text (a turn's line holds the tokens it used, as numbers); no picture data, no address (a picture of `reference/` by its path) | ignored |
| `session.json` | the conversation to resume | ignored |
| `state.md` | the build, the parts, the checks of the model, the views, the scans and the open marks as text | ignored |
| `thumb.png`, `thumb.json` | the card's picture, and what it is of | ignored |
| `builds.jsonl` | a line for each build that worked: its revision, when, the run of torno it was made in (revisions count from 1 in every run), a hash of the sources it was made from, and the commit then checked out and whether files differed from it; the last 500 | ignored |
| `history/` | the builds kept: for each build that worked (not again for sources the newest kept build was made from) a copy of the Python files it was made from, its scene without the meshes, a small picture, and an index of them with an id such as `h41`, which counts on across runs; the latest 100 and every one you star. An entry also says what caused the build (`cause`: `agent`, `person`, `params`, `goback` or `unknown`, which is every entry kept before this was said), the prompt it came out of (`turn`: the conversation and the id of the prompt, with its first 200 characters), the Params you tried (`tried`), `failed` with the line of the error for a build that failed (an entry with no copies, picture or scene), `wentBackTo` for the build after a Go back, and `undone` for a build a later Go back undid. These are written by torno alone. The copies are read back into your files only by "Go back to before this prompt" | ignored |
| `goback.json` | what the next prompt tells Claude after a Go back: the build the files were put back to, and the prompts it undid. Removed when a prompt has carried it | ignored |
| `views/<n>.png` | the pictures and section drawings the agent asked for, the latest 20 | ignored (a picture of a scan may show the real world) |
| `exports/` | where the save dialog of an export opens; empty unless you save there | ignored |

"Ignored" is by `.torno/.gitignore` (or one inside the folder), which torno
adds lines to and never rewrites; a line you negate there (`!state.md`) is
yours, and is not added against. What travels with the project in git is what
is the project's: `scene.json`, `marks.json`, `sets.json`, `scans.json`, `board/board.json`, `profile.json` and `agent.json`.
What changes with every build or session, or is of this machine, is
ignored: `state.md`, `session.json`, `chat/`, the thumbnail, `builds.jsonl`, `history/`, `views/`,
`board/pictures/`, `board/told.json`, `tracings/told.json` and `exports/`. Add `.torno/` to the workspace's `.gitignore` if you
want none of it in git.

Outside the workspace:

- `~/.config/torno/` (on macOS `~/Library/Application Support/torno/`): `config.json` holds the workspace last opened and the
  folders opened lately (eight at most); `models.json` the models Claude Code offered in the last chat, for the page
  of a new project; `profiles.json` your printers and materials (see "Measuring and dimensions"); the rest is Electron's own cache.
- `~/.config/torno/agent/<session>.mcp.json` (on macOS under `~/Library/Application Support/torno/`): the file
  `--mcp-config` names, which tells a session where torno's MCP server is. It holds the placeholder
  `${TORNO_SESSION}`, never the token, and is removed when the session ends (and at the next start after a crash).
- `~/Library/Application Support/torno/kernel-env` on macOS, for the packaged app only: the kernel's Python
  environment, made at the first build of a workspace with no `pyproject.toml`. Never inside `torno.app`.
- `~/.config/torno/compare/` (on macOS under `~/Library/Application Support/torno/`): the copies of an older kept build laid out to build it again for Compare, in a folder of its own for each build, removed when the build is done and swept at the next start after a crash. Never in a workspace.
- The one file an export writes, at the path you choose.
- The one new folder "Keep this as a folder…" makes of the example, at the path you choose.
- `torno.desktop`, only by `scripts/torno --install-desktop`.
- A copy of the example in the system's temporary folder, removed when torno
  quits, or at the next start after a crash (only folders its own marker file
  names).
- `~/.local/state/torno/launcher.log`, only when torno was started from its
  desktop entry, something went wrong and there was no `notify-send` to show it.

The agent's CLI keeps its own records as it always does.

## Limits and exactness

**Exact and approximate.** Every number the tools give is measured by the
kernel on the model's own B-rep, never on the mesh on screen. A reply says
`exact: true` when the value is exact; otherwise the reading starts with `≈`
and says `approximate`, and `how` says why.

- Distances, angles, radii, diameters and thicknesses are exact. An angle to a
  face or an edge that is flat or straight only within 1e-6 mm (a B-spline, a
  surface of extrusion) is not: `how` ends `flat within 1e-6 mm`.
- A volume is exact only of a part all of whose faces are planes, cylinders,
  cones, spheres and tori. Of any other part (a loft, a spline, an offset) it
  is integrated and never said to be exact: `≈`, `volumeExact: false` in
  `scene` and `describe`, `exact: false` in `measure`, with `how` saying
  `of the solid, approximate, good to about N significant digits` (two to
  six: what two integrals that differ agree to, one digit fewer), or, when
  they agree to fewer than two, `of the solid, approximate: in doubt by X %`.
  That is agreement, not proof, and the last digits of a freeform volume may
  differ from one build to the next, within what it says. A mass follows its
  volume (`…; volume approximate, good to about N significant digits`), and
  so does what two parts share (`check overlap`: `of what the two share,
  approximate, …`).
- A solid turned inside out (its faces point inward, which OCC integrates as
  a negative volume and still calls valid) is told for what it is. Each solid
  of a part is measured alone, with its sign: the volume is the sum of their
  sizes, and `reversed` lists the solids that were negative, their numbers
  counted from 0 among the part's solids, in the order faces are numbered
  (`reversed: [2]` in `scene` and `describe`, with `solid 2 reversed` in the
  descriptor; `describe` of a group names the part; `measure volume` and
  `mass` say so in `how`; `check overlap` and `check clearance` name the
  parts). A sound part has no `reversed`. torno never mends the
  shape: the volume of a part with a reversed solid is the material it
  encloses, not a sign that the part is sound, and the model is to be fixed.
  A cavity whose shell faces into it is counted as material, and positive: what
  says it is broken is OCC's check, and the part is told as not valid.
- What a part's own mesh encloses (`meshVolume`) is a sum over the triangles it
  is drawn with, never exact and never a number to rely on: it is told, with
  `≈`, only where it and the volume are further apart than the mesh explains,
  as a sign that one of them is wrong.
- An area is exact for planes, cylinders, cones, spheres and tori, and for a
  curve extruded straight. The area of any other face (a loft, a B-spline
  surface, an offset) is never said to be exact: `how` says `approximate, good
  to about N significant digits`, or `approximate: its integrals differ by
  0.14 %`.
- A bounding box from `measure` is exact when all the faces of what is boxed
  are planes or cylinders and all its edges lines or circles; of anything
  freeform it is approximate and says so. A part has one box, and `scene`,
  `describe`, `state.md` and `measure bbox` tell the same numbers of it, with
  `≈` (`sizeExact: false` in `scene`, `bboxExact: false` in `describe`) where
  it is not exact. The sizes in `scene` are for orientation: `measure` is for
  a number to rely on.
- The areas of a section say for themselves (`areaExact`).
- Nothing taken from a scan is exact.
- The mesh drives only the estimate at the pointer while a measurement is
  pending (`≈`), which the kernel's value replaces.

**What it costs.** The volume and the box of every part are worked out during
each build. On prismatic parts that is nothing: the test models build in a
tenth of a second. On a freeform part it is about a second for the volume and
up to a second for the box: a project of three lofted parts of about 90 faces
each, whose model runs in 10 s, builds in 17 s, 5 s of it for volumes and
boxes. `area` of the whole of such a part takes a second or two on the first
ask (three integrals of every freeform face, to say how many digits agree);
`describe` of the part takes one integral a face and says its area with `≈`.
Both are then kept until the next build. A question the kernel has not answered within
30 s is an error that says so.

**The agent's tools are for its session alone.** The MCP server and the
address the agent's hooks post to listen on `127.0.0.1` alone, check that a
request comes from no web page (`Origin`, `Host`), and answer 404 to any
request without its session's token in the `X-Torno-Session` header: 32
random bytes made when the session starts, which open that session's hooks
and its project's tools, and nothing once the session has ended. The token is
in the agent's environment (`TORNO_SESSION`) and nowhere else: not in the
arguments it is started with, which every user of this machine can read (`ps`),
and not in the file `--mcp-config` names, which holds only the placeholder
`${TORNO_SESSION}` that Claude Code expands. Torno does not log it and writes
it to no file. That keeps out another user of this machine, any program that
only finds the port or reads the agent's command line, and the session of
another project. It does not keep out a program running as you, which can read
the agent's environment, nor a script the agent runs, which inherits it: such
a program can call `show`, `add_mark`, `resolve_mark` and `save_view` of that
project, and post its hooks, while the session lasts.

**Parts that fit together.** `overlap`, `clearance` and a distance between two
parts are of the parts where the layout has them, so fit can only be checked
in a layout that places the parts as assembled (`assembly(p)` in the model).
In a `print` layout that torno spread along X the parts are where torno put
them for display: there these three are refused between two parts, with a
sentence that says why and names the layouts that do place both parts; a
dimension between them is not kept, and one that is there already is not
measurable on such a build; a scan is not checked against a part torno moved.
What is of one part is answered as ever (thickness, diameter, bbox, area,
volume, mass, mesh, a distance within the part, an angle), with `arranged`,
how far torno moved the part. A project with only a print layout can
therefore be measured part by part, but not checked for fit until its model
has an assembly.

**Memory.** The last build of a project stays in memory, in a process of its
own, to answer what is measured and checked of it: half a gigabyte for a small
part, and many gigabytes for a large model. At most four are kept. Before a
build is started the kernel looks at how much memory is free: when there is
less than the last build of that project holds (2 GiB at least) and 2 GiB more,
it lets go the builds of other open projects first, the one least recently
used first, and then that project's own. The line at the bottom then says "The
last build was let go to make room (memory): tools answer when this one
lands". A project whose build was let go is built again when something is
asked of it, never by a check on a timer; and a model that has just failed to
build is not built again until a source changes.

## Troubleshooting

- **Every build fails saying to run `uv sync`.** The workspace has a
  `pyproject.toml` and no `.venv`. Torno never makes one: run `uv sync` in the
  workspace once, then open it again.
- **A build fails.** The last good parts stay on screen, the pointer says
  that picks wait for a build that works, and "Build failed" at the bottom
  opens the error with the traceback. The agent is told the same, after its own
  edit and with your next prompt, and its tools answer from the last build that
  worked, saying so. "Ask Claude Code to fix it" in that sheet puts the request in
  the box for you to send. Save the model again once it is mended: every save is
  built.
- **The chat says "This chat is billed to an API key".** The CLI reported a key
  as the source of its credentials, and names the source (`user`, `project`, `org`,
  `temporary`); a key is billed per token and not to your Claude login. In the
  chat's mode an `ANTHROPIC_API_KEY` in your environment wins over your login, so
  unsetting it where you start torno is one way to use your subscription; a key
  from a helper or a setting of Claude Code is for you to find in its settings.
- **The chat says "Claude Code's chat could not use your login".** The CLI's
  headless mode, which the chat runs (`claude -p`), answered the turn that it
  was not authenticated. `--bare` (or `CLAUDE_CODE_SIMPLE=1`) makes `-p` read no
  login, and Claude Code says `--bare` will become the default for `-p` in a
  future release. "Use the terminal" runs
  `claude` as you run it, under your login; `claude auth status` in a terminal
  says whether you are signed in.
- **The chat says "Claude Code's hooks did not reach torno".** A prompt began
  and the hook that carries your marks and the check of the Stop never came, in
  this session. Torno gives the CLI a secret per session in `TORNO_SESSION`, and
  each hook reads it from the environment; a setting of yours or of your
  organisation that limits which variables hooks may read
  (`httpHookAllowedEnvVars`) makes every hook fail unless it lists
  `TORNO_SESSION`. Add it there, or take the limit off, and start the session
  again. The note changes nothing else; in the terminal view the same fault
  shows only as a status that never moves.
- **A build takes minutes.** It is the model that takes them: see "What it
  costs" above. `TORNO_BUILD_TIMEOUT` raises the limit of 600 s.
- **The agent says to press Rebuild, or a build failed for no reason of the
  model's** (the kernel stopped, a build was let go and the model has since
  failed). "Rebuild" is in the line at the bottom, beside how the build
  stands; `Ctrl+Shift+B` does the same from anywhere.
- **Nothing is kept of a project: no mark, no view, no picture.** Its `.torno`
  is a link or a file; the Marks section of the card says so. Put a real folder in its place.
  A link in the place of `.torno/views`, `.torno/exports`, `.torno/scans` or
  `.torno/chat` stops only what goes there (the agent's pictures, an export,
  the scans, the log of a chat): torno writes nothing through it and deletes
  nothing behind it. Take the link away.
- **The first screen says Claude Code is not found on `PATH`, or not signed
  in.** Install Claude Code and log in (`claude` in a terminal), then reopen torno,
  or press "Check again" in the sheet of the folder menu ("Check what torno needs").
  Torno looks on the `PATH` it was started with, which the line shows, and which a
  desktop launcher may have shorter than your shell's. The page of a new project
  says the same above "Create": the project is made all the same, but Claude Code
  cannot start in it.
- **The first screen says `uv` is not found.** Install it from
  [docs.astral.sh/uv](https://docs.astral.sh/uv/) and reopen torno. Without it no
  build can run: the kernel is started by uv.
- **The first build is slow, or fails offline.** The first time, uv makes torno's
  own Python environment and fetches about 900 MB. The first screen says so
  ("Not made yet"); "Make it now" does it before the first build, and the status
  line says "Making torno's Python environment, first time only" if the build does
  it. Offline it fails with uv's reason, which the kernel's line shows; press
  "Make it now" again, or rebuild, once there is a network.
- **"New session" says the agent's command was not found on PATH.** Torno
  looks for `claude` on the `PATH` it was started with. Started from a desktop launcher, that may
  not be your shell's: start torno from a terminal, or set
  `TORNO_AGENT_CMD`. On macOS and Linux torno asks your login shell for its `PATH` (and adds `~/.local/bin`,
  `/opt/homebrew/bin`, `/usr/local/bin` and `~/.claude/local` where they exist); if that fails it says so on stderr.
- **The window does not come up, or stays blank.** Try
  `TORNO_OZONE=x11 scripts/torno`, then `TORNO_OZONE=wayland`. Torno draws
  with WebGL 2; `F12` opens the developer tools, whose console says when the
  graphics card gave it no context.
- **On Wayland every start prints `'--ozone-platform=wayland' is not
  compatible with Vulkan`.** It is harmless: WebGL goes through ANGLE on
  OpenGL ES, and WebGL, GPU compositing and rasterization are all on with or
  without it. `--disable-features=Vulkan` does not silence it, so torno passes
  nothing for it.
- **An exported page says it cannot draw the parts.** That browser gives the
  page no WebGL 2, took it away, or drew a frame with nothing of the parts in
  it (the page looks at its own view three seconds after it began to unpack
  the parts, and says which): open the file in a current Chrome, Edge, Firefox
  or Safari with hardware acceleration on. `firefox --headless --screenshot`
  takes its picture before the first frame is drawn, so it shows the page
  without its parts: that is the screenshot, not the page.
- **`TORNO_DEBUG=1`** prints the workspace opened at start, the address of
  the MCP server, and the command line and hooks of every session.

## Tests

```sh
pnpm test          # unit tests of the app (vitest), a few seconds
pnpm test:kernel   # the app against the real Python kernel and a stand-in agent (vitest)
pnpm test:e2e      # the built app in a hidden window (Playwright)
(cd kernel && uv run pytest -q)   # the kernel alone (pytest)
```

GitHub Actions runs the suites on Linux (`.github/workflows/ci.yml`, skipped for a change of only the site or the docs) and apart on macOS (`.github/workflows/macos.yml`, on main and weekly, not a required check), with the e2e suite only when asked.

No test opens a window, and none runs a real agent CLI: a stand-in
(`app/test/fake-agent.mjs`) takes its place. Under test Electron keeps its own
files (cache, storage, crash dumps) in a folder of the run in the temporary
folder, removed once it has quit, and nothing in `~/.config/torno` (on macOS `~/Library/Application Support/torno`). The scans in the tests are made
by the test code; none is in the repository. A test holds this file to the
code: its table of keys, and the tools it names.

**The evals: prompts to parts with the real Claude Code.** `app/evals/` measures whether a change to torno makes
the agent build better parts. It is not a test: it runs the real `claude` under your login and spends your
subscription, so no suite and no CI runs it, and it starts only when you ask three times: `TORNO_EVAL=1`, no `CI`,
and `spend my subscription` typed once it has said the model, the cases and the budget.

```sh
pnpm build
TORNO_EVAL=1 pnpm -C app eval                        # every case, 5 times each, sonnet, $2 a run at most
TORNO_EVAL=1 pnpm -C app eval --case t1-box --repeats 1 --label try
pnpm -C app eval --compare app/evals/out/<a>.jsonl app/evals/out/<b>.jsonl   # two reports side by side
```

A case (`app/evals/cases/<id>/case.json`) is a brief, often a start model and marks, the prompts, the answers of the
person it plays (by topic, with a default: "I don't know: choose, and say what you chose"), a turn limit and the
checks. Each run copies the case to a new temporary folder (never a workspace of yours), starts the built app on it in
a hidden window, sends the prompts through the chat with `claude --model <model> --max-budget-usd <budget>
--permission-mode acceptEdits`, allows edits and torno's tools and denies every other request, and answers questions
from the case. Then it scores the model as the agent left it: `app/evals/score.py`, with torno's kernel loader, checks
validity, part names, solids, sizes and ratios, volume, clearance, overlap and holes on the B-rep (each pass or fail
with its number, exact only where the kernel says so), and an `mcp` check calls a torno tool through the project's
MCP address. The person's dimensions in a case's start (`start/.torno/marks.json`, with an expected value) are checks
too, read through `marks`: one passes only with its verdict measured on the last build. A `diff` check holds the last
edit (the two builds `diff` keeps) to the parts the case lets it change: a part with other face, edge or solid counts,
or moved, fails it, and so does a part come or gone; the volume and size checks hold the rest against the start.
`--ablate` takes parts of torno away from the agent, to measure what each is worth: `skills` (no plugin of skills:
the whole system prompt), `reviewer` (no `torno-reviewer` subagent), `stop` (a `Stop` is never held back) and `look`
(the tool answers that it is off) and `digest` (the answer to an edit leaves out what its build changed; `state.md`
keeps it), in a comma list; `--look-size <px>` draws a `look` that names no size at that long edge (256 to 2000) in
place of 1280, and `--holds 1` lets a turn's `Stop` be held back once in place of twice. torno reads them (`TORNO_EVAL_ABLATE`) only when both `TORNO_TEST=1`
and `TORNO_EVAL=1` are set, which only the evals set together: in any other run nothing is taken away or changed. The cases: three of primitives and plates (T1), four printable parts with fillets, bosses and a lid
that fits (T2), two of mating parts (T3), two that leave a dimension out (asking is right), two pairs of the same
edit by a mark and by text alone, and two edits that must change nothing else. The report is one JSON line per run
in `app/evals/out/<date>-<commit>-<label>.jsonl` (ignored by git), with checks passed, the build apart, whether it
asked before it first wrote the model, whether it said done while a check failed, turns, tools by name, pictures,
tokens, cost and time from the CLI's own result, and a Markdown table beside it.

## Environment variables

| Variable | Effect |
|---|---|
| `TORNO_WORKSPACE=<path>` | the workspace to open at start, instead of the one remembered. `scripts/torno <path>` sets it. |
| `TORNO_AGENT_CMD=<cmd>` | the command to run for a session in place of `claude`, split on spaces and given Claude Code's arguments: `TORNO_AGENT_CMD="claude --model sonnet"` |
| `TORNO_BUILD_TIMEOUT=<seconds>` | how long a build may run before it is stopped: 600 by default, a day at most |
| `TORNO_OZONE=wayland` or `x11` | read by `scripts/torno` only, on Linux: the platform Electron is told to draw on. Unset, Electron chooses. On macOS it is ignored, with a line on stderr. |
| `TORNO_CONFIG=<path>` | the config file to use instead of `~/.config/torno/config.json` (on macOS `~/Library/Application Support/torno/config.json`) |
| `TORNO_DEBUG=1` | print to stderr the workspace opened at start, the address of the MCP server, and the command line and hooks of every session |
| `TORNO_OUTSIDE_AGENTS=1` | a spike (#54): open a socket only you can open, in your runtime folder, through which an agent torno did not start reaches one project's tools by `node scripts/torno-mcp.mjs <project folder>` (as a stdio MCP server in its config), after you allow it in the window. Off by default. |
| `TORNO_EVAL=1` | lets `pnpm -C app eval` start, which spends your subscription; it still asks before it starts, and never runs under `CI` |
| `TORNO_EVAL_ABLATE=<list>` | what an eval run takes away from the agent (`skills`, `reviewer`, `stop`, `look`); read only with both `TORNO_TEST=1` and `TORNO_EVAL=1`, and set by `pnpm -C app eval --ablate` |
| `TORNO_EVAL_LOOK_SIZE=<px>`, `TORNO_EVAL_HOLDS=1` or `2` | the size of a `look` that names none, and how many times a `Stop` may be held back, in an eval run; read under the same rule, set by `--look-size` and `--holds` |
| `TORNO_EVAL_AGENT=<cmd>` | the agent of the evals in place of `claude --model … --max-budget-usd … --permission-mode acceptEdits`; the stand-in (`node app/test/fake-agent.mjs`) checks the runner and spends nothing |
| `TORNO_TEST=1` | create the window hidden and never show it; keep Electron's own files in a temporary folder of the run; expose the test hooks; look for `claude` on the `PATH` without running it. For tests only. |

The agent inherits torno's environment without these, and without the variables
a parent Claude Code session exports (`CLAUDECODE`, `CLAUDE_CODE_ENTRYPOINT` and
the like), so torno can be started from inside one. Variables you set yourself,
such as `CLAUDE_CODE_USE_BEDROCK`, are passed on. It is given `TORNO_SESSION`,
its session's token, which no address and no argument holds. A torno started
from inside a session of another torno passes that session's `TORNO_SESSION`,
`TORNO_OBJECT` and `TORNO_SESSION_ID` to nothing it starts: not to the agent,
the kernel, the import of a scan or the checks of what torno needs.

## Not yet verified on a visible screen

Torno was built and tested in a window that is never shown, with a stand-in
for the agent.

**Verified on a real compositor output (Hyprland, NVIDIA; the session was
locked, so not by eye).** On 10 October 2026 torno ran as a real, mapped window
on a Hyprland output, on Wayland and on X11, with the real agents (Copilot CLI too, which
torno has since stopped running); what it drew
was taken from the compositor and looked at afterwards. The first start drew
the parts on the GPU at 60 frames a second on both platforms. Only one torno:
a second start exited and the first opened the folder it was given. There is
no menu, also on Alt. Alt-drag with the old one-stroke Draw tool turned the camera and drew
nothing (sent as events; no binding of the compositor's was in the way).
`hyprctl clients` showed class `torno`. Light and dark were legible in both
themes. A large project's thumbnail was on its card at once and the window did
not stall. `Ctrl+Shift+E` with Claude Code's prompt in focus brought up the
export sheet and nothing reached the CLI; `?` outside a field and the terminal
brought up the sheet of keys. Left alone for five minutes with a large project
open, torno's memory stayed flat and its processes idled near zero. With
Claude Code a pin was told with the next prompt and turned from draft to sent,
and `scene`, `look`, `marks`, `save_view` and `add_mark` ran without a
permission question. What that run found wrong is mended: closing the
window now asks first when something would be cut short, the Marks list no
longer runs out of its column when a mark has moved, "Needs input" is no longer
shown while Claude Code is only idle, a session can be ended from its header,
and tests no longer write into `~/.config/torno`. An exported file showed no
parts in `firefox --headless --screenshot`, which takes its picture before the
first frame; driven in headless Firefox instead, the page drew the parts.

The chat was driven once with the real Claude Code (Haiku, 15 October 2026) in a hidden window on a temporary copy of `intake`: a pin was sent with the prompt and shown under it, a torno `look` came back with its picture and the "Pulled from torno" line, a ref in the reply was a chip, a Write was allowed by the CLI without asking under the person's permission mode (so there was no card), and no `.claude/` folder was written in the project. It was not looked at on a visible screen, so the items listed below stay to check.

What remains is yours to try once. Each says what to try and what should
happen.

On the screen:

- **macOS.** Nobody has run torno on a Mac by eye. Try once: `⌘V` and `⌘Z` in the chat composer and in a note, and `⌘C`/`⌘V` in the terminal view (`spawn-helper` of node-pty must be executable, or every terminal fails with `posix_spawnp failed`); `⌘Q` with a session working asks "Close torno?"; the Dock shows torno's icon when run from the repository; start torno from the Finder or the Dock and a session finds `claude` and a build finds `uv` (the login shell's `PATH`); on a trackpad a two-finger scroll zooms, `⌘`-drag or `⇧`-drag pans (OrbitControls' own), and Ctrl-click is a secondary click.
- **Resizing.** `scripts/torno ~/objects` on Hyprland: drag the window wider and narrower, or retile it: it redraws without flicker. If the window does not come up right, `TORNO_OZONE=x11`, then `TORNO_OZONE=wayland`, and keep the one that works.
- **Focus.** Start torno a second time with another folder: the window that is open comes to the front (on Hyprland only where `focus_on_activate` is on). Start dragging the section's arrow, switch workspace, come back: the plane is where it was before the drag, and the next drag turns the camera.
- **The window's own title bar and controls on Linux.** The window has no frame of the window manager's: at the top, a bar 40 px high in the ground's colour. Start torno on Hyprland and on another desktop (KDE, GNOME) and try once: the bar drags the window, and the three buttons at its right (minimise, maximise or restore, close) each do what they say, also after the window was tiled or maximised by a key; Close with a session working asks "Close torno?" as the window manager's close does; the window cannot be made smaller than 1120 × 700; the bar is legible in light and dark. On Windows and macOS the platform's own controls sit over the bar in the same colours: not tried.
- **Closing.** With a session working, close the window through the window manager: torno asks "Close torno?", "Keep it open" keeps everything as it was, "Close torno" ends torno and the session. With nothing under way it closes at once.
- **A session that needs you, away from its pane.** In two projects, ask Claude Code in one for something that needs a permission, then open the other (and again with the session pane hidden): the first one's row has a dot and "needs you" in the warning colour, the status line has the button "*name* needs you", which opens it and brings you to the card, and a working session's dot is a quiet grey. In a window that is not in front (another window on top, or a workspace switched away) the frame should flash on Linux, and the dock icon bounce once on a Mac: no test shows a window, so only the rule is tested.
- **The rail and the route card.** The icons have no word under them, and each name shows in a tip beside it on hover and on keyboard focus; Keys is at the foot; pressing a section's icon scrolls the card to that section and opens it,
  and the icon of the section in sight is in the accent's wash as you scroll. Click a head to fold and open its section. The badges (what waits for you, parts
  switched off, failing checks, unaligned scans, marks to review) are legible in light and dark and count what the
  section then shows. Drag the card's edge wider and narrower: it moves without lag. Start torno again: the folded
  sections and the card's width are as you left them.
- **Layers of a model with many parts.** Open a project of ten parts or more: the pointer on a layer row lights that
  part in the view in the accent (and nothing else changes), the target shows it alone, `Show all` at the top of the section brings
  the rest back, and the count of marks on a part lists only its marks. The rows must not crowd: name, count, and on
  hover the opacity, the target and the eye, at the width of the card.
- **Parameters.** In a project whose model has a `Params` dataclass with comments and one default that is an
  expression, open the Parameters section: a row for each field in the model's order, the value in the
  monospace face, the comment as written (cut to two lines, whole on hover), "worked out in the model" on the expression's.
  With a real session running, in the chat and then in the terminal view, a click on a row puts `Params.wall` at the
  cursor of the box (or the prompt) and sends nothing, with the dock hidden as well; with no session the rows are
  not clickable. Legible in light and dark. Try a value in a
  number field and with a slider (the field with a `metadata` range, which also has a small gauge at the right of its row: the band from least to most, a tick where the value is), tick a flag and choose from a list: the build
  runs once the slider is let go, not while it moves; the row says it is kept by torno and not in the model file yet, and Reset brings it back.
- **The clipboard in the terminal.** Select text in a session and press `Ctrl+Shift+C`, then `Ctrl+Shift+V`: it is copied and pasted. No test touches the clipboard. "Copy" on the build error sheet likewise.
- **By eye.** On a monitor, in dark and in light: text, marks, part edges and the terminal's colours are legible; the scrollbars are the thin grey ones, also in the list of projects and on the page of projects in the dark theme; a mark that has moved says so on a line under its note. `?` typed in a field on your own keyboard (with its dead keys) is a question mark.
- **The doodle board with a mouse and a pen.** Draw with a mouse, a tablet pen and a touch screen: the line follows the pointer without lag, the eraser takes away what it crosses, `Ctrl+Z` takes the last stroke back, and the PNG Claude gets is dark on white in both themes. Tests drew with synthetic pointer events only. A photo dropped from the file manager on the new project's page is taken too; a test cannot drop a file with a path.
- **The Print profile.** Open the Print profile section of the route card: the Printer and Material lists, "Add a printer…" with its three bed fields, the lines under them in the monospace face; legible in both themes, and its head says what is chosen (`Bambu X1C, PETG`), also while the section is folded.
- **The Scans section.** Import a scan of your own, with "Import scan…" in the section's head, which stays there while the section is folded: the card `How is S1 read?` is in the view under the switch with the size it would have; "Later" leaves a dot on the row. The row is one line at the panel's default width, the name cut with an ellipsis and whole in its tooltip, the word legible in both themes, the dot and a `check` or `rough` word told apart from the rest. Open its detail and another's: one is open at a time, and Frame, Align and Rename are on one line.
- **Drawing on the view with the real Claude Code.** In a chat, "Draw on view", ring a face and draw an arrow to it with a mouse and with a tablet pen, "Done", then a prompt ("make this thicker"): the ink follows the pointer, the eraser takes ink and never the picture, the note is a draft among the marks until the prompt carries it, and the prompt names the faces the ink lies over (and says so, in the warning colour, when it could not be worked out), "Attach view" shows a small picture of the view before it goes, the chat shows the picture and that line with the prompt, and Claude Code's reply speaks of the ringed place and names the face the caption gave. Tests drew with synthetic pointer events and the stand-in agent.
- **The sheet of a view note, by eye.** The labels (the field at the point you click, the arrow dragged from it, the words set in the picture in the face of the window, legible over the ink), the references (the list under the picture, the dialog for a photo, a drop, the line of each, six at most) and the comment, in light and dark, at the size of the window and in a narrow one; and that a label in the sheet sits where it is in the picture that is kept.
- **The sketch panel, the sketches in 3D and their cards, by eye.** The panel in the head of the route card (its rows, the segmented take, the diameter, the offset, the switches, the comment), in light and dark and at the narrow card, with the sections still reachable under it at 1280 x 800; the lines of a sketch at 2.5 px in both mark colours, the dots of its snaps, the tube of a flow sketch at about a quarter of its colour, the dashes of an x-ray stroke behind a part, and the strokes lit by the pointer on a plane's row; a sketch's row at the panel's default width, still one line; and its card with the picture drawn from its camera, and the placeholder.
- **Named sets, by eye and on a large model.** The box that names a set, the rows in Layers, the dashed swatch and dashed lines of Claude's proposal and each of the eight colours, in light and dark and in a narrow column; the hatch of the faces and the colour of the edges in the view; and `Ctrl+G` and Re-pick on a model of hundreds of parts, where a rebuild asks the kernel for every member and the time it takes has not been timed. Nobody has pressed "Make it a tag" with the real Claude Code and read the tag it writes.
- **The notes that wait, and the note rows and cards.** The row above the box for each draft note (its picture with the ink, its comment, what the ink lies over, "Edit" and "Remove" with its "Undo"); the row of a note in the Marks list (the small picture, its comment, the faces lit under the pointer, the empty frame of a note whose picture is not on this computer); and a note's card on the board (the picture in the card's size, the comment and status under it, the double click that opens the sheet): each legible in both themes, and the rows still one line at the panel's default width.
- **Claude Code's own checkpoints for the asked undo (`Part of #131`).** When no copy of the build is kept, "Go back to before this prompt" asks the agent in words. Claude Code can also
  restore the files itself: with `CLAUDE_CODE_ENABLE_SDK_FILE_CHECKPOINTING=true` at start, `claude -p --resume <id>
  --rewind-files <uuid>`, where `<uuid>` is the id torno gives the prompt. This is not built: `--rewind-files` is absent
  from `--help`, and nothing is known of it from a real CLI. Try once by hand, with the CLI's version noted: after a
  turn that edited the model with `Edit` and `Write`, does it restore the file as it was before that prompt, and does
  it list the files with a dry run? Must the live session end first, or does a control request (`rewind_files`) work on
  the running process? What does it do to the conversation, and to a file changed by `Bash` or a subagent, which it
  does not track? Write the answers in issue #131: if the files and the conversation both come out right, the button
  can use it and be exact; if not, the asked undo stays (torno's own restore, from the copies under `.torno/history/`, does not need it).
- **Prompts only.** Send Claude Code a few prompts that edit the model, then open **Prompts only** from **More** in the session pane: one row for each
  prompt, newest first, in the pane of the chat, each with a picture of the project as it was after it, legible in light and dark, its
  number and `h40 → h41` in the face of numbers. A click compares the prompt (a band with Before, Overlay, After and Side by side at the top left of the view, two boxes over the corners,
  `comparing prompt 14 · h40 → h41` in the status line; **Back to the live build** or `Esc` ends it), a double click opens it in the chat. Start a new session, send a prompt, and check
  that its number goes on from the last and that **Earlier conversations** reads the first. With the terminal as the view, the same list is a pane over it. Try it with a real Claude Code, the
  terminal too: after a prompt that edits the model, is its row there with the build it made?
- **A broken part in the layers.** Build a model with a cavity whose shell faces into it, or a part made of a shell
  with a face left out: its layer row says "not valid" (or "not closed") after its name in the colour of a failure,
  with what that means in its tooltip, and the line at the bottom says "1 part has a defect"; legible in light and
  dark, and the row still one line in a narrow column.
- **Why a fillet failed, in the error sheet.** Build a model whose fillet fails (a 20 mm plate with a 12 mm pocket
  through it, its eight vertical edges at R6): the status line says the build failed, and the error sheet shows, under
  the message, a "Why" section with the line and a line for each edge, in the face of numbers, legible in light and
  dark and in a narrow window; Copy takes it with the rest.
- **"Ask Claude Code to fix it" with the real Claude Code.** Break the model in a chat, open "Build failed" and press
  the button: the dock opens if it was hidden, the box holds "Fix the build of *name*: see the error." and nothing is
  sent; Enter sends it, and Claude Code answers from the error it was told (the sheet says whether after its edit or
  with the next prompt). Again in the terminal view: the words are at the CLI's prompt, unsent. With no session, "Start
  a session to fix it" starts one and leaves the words in its box. Tests used the stand-in agent. After a crash or a
  timeout of the build (stop the kernel's process, or lower `TORNO_BUILD_TIMEOUT`) "Rebuild" is the main button in the
  status line and in the sheet; after a Python error it is not.
- **A scan file dropped on the view.** Drag a GLB or STL from the file manager onto the parts: it is imported as "Import scan…" would.
- **The folder dialog.** "Open folder" on the first screen, and "Open folder…" in the menu of the folder button at the top left: the system's folder dialog opens, and the folder chosen is opened.
- **The save dialog of an export.** "Export…", then "Export page": the system's save dialog opens in `.torno/exports/` with a name offered, and the file is written where you say.
- **The save dialog of a picture.** "Export…", the Picture tile, 4000 px, "Export picture": the system's save dialog opens in `.torno/exports/` with `<name>-r<revision>.png` offered, and the PNG opens in an image viewer at 4000 px on its long edge, with the view as it was on screen.
- **A section drawing in other programs.** "Export…", the Tracing tile (SVG) with a section on screen: the SVG opens in a browser, Inkscape and a CAD program, its 40 mm edge measures 40 mm there, and printed at 100 % a ruler agrees with the scale bar.
- **The replace question.** Save an export as `x` where `x.html` exists: torno asks before it replaces that file, and "Cancel" writes nothing.
- **A 3MF opened in a slicer.** Export a 3MF of a plate of two parts or more and open it in PrusaSlicer, Bambu Studio, OrcaSlicer and Cura: each part is an object of its name, in millimetres, where torno set it; it slices with no repair asked for. "Open it once saved" opens it in the slicer the system gives `.3mf` files to. Tests read the file back with lib3mf only.
- **An STL in a slicer, a STEP in a CAD program.** Open an STL of a round part in a slicer: no facets you can see on its holes at 0.01 mm. Open a STEP in FreeCAD and in Fusion or Onshape: the parts are named bodies in their colours, in millimetres, and a volume measured there is the one torno told; a part named with an accent (`tampa ção`) keeps it there, as torno writes names in UTF-8. Tests read it back with OCC only.
- **Torno left on another workspace with a session working.** Give the agent something that takes minutes, or start a long build, and switch to another workspace for ten minutes, watching `ps -o rss -p <pid of the window>`: its memory stays flat and torno idles near zero. Idle with a large project it did; with a session working nobody has watched it.
- **An exported file elsewhere.** Open one from `file://` in Firefox, in Safari and on a phone, with the network off, and look: parts, layouts, the explode slider, the section, a saved view and the marks work. Headless Firefox drew the parts; nobody has looked at it by eye there, or anywhere but in Electron's Chromium.
- **The desktop entry.** `scripts/torno --install-desktop`, then start torno from your launcher: it is listed with its icon, the window comes up and is grouped under the entry (`StartupWMClass=torno`) with torno's icon. Given a folder (`gtk-launch torno ~/objects`) it opens that folder; given two, it refuses. With `claude` only on the `PATH` of a login shell, "New session" says it was not found there: start torno from a terminal, or put the command on the launcher's `PATH`.
- **Build ghosts.** After an edit, the part as it was is drawn faint beside the new one: legible in light and dark, and gone when the next build lands.
- **The section's hatch and plane label.** Cut a part: the cut face is hatched and the plane is named at its edge; both legible in light and dark, and the label clear of the tags and the band.
- **The Marks section's resolve glyph, review walk and undo line.** The glyph on a row, "To review" stepped through one mark at a time, and the line that undoes a delete: each in its place, legible in both themes.
- **The Checks section and its gauges.** One list of the model's checks and your dimension checks: the rows (chip or bar, name, the word of how it stands, value and wanted) and the 64 px gauge read at a glance in both themes, the failing row's wash and a row lit from the view are told apart, and a tick that moved slides once.
- **The empty chat pane and its chips.** With no conversation, the pane's words and the chips under them fit the pane and are legible in both themes.
- **The turn summary and its buttons.** After a turn, the summary line, the buttons "Compare", "See changes", "Go back to before this prompt" and "Star", the sheet of the diff, and the quiet lines for your own saves ("You saved `common/fillets.py` in your editor · `h39`", and several in a row as one) sit well in the chat, in a narrow dock and in both themes.
- **The page of projects.** Its head and the order buttons are legible, and the cards keep their order when the window is narrow.
- **The doodle board's grid.** The grid is faint on the board in light and dark, and is not in the PNG Claude gets.
- **The board of a new project.** Make a project from a page with photos, a doodle, a few sizes, rules, a link and a PDF: it opens on its board, with a frame for each (Brief, Photos, Doodles, Sizes, Rules, Links, PDFs) laid left to right, nothing over anything else, legible in light and dark, and the cards of a frame sit inside it when the board is zoomed out to the whole.
- **Size cards.** With `M` and a click make a size card: the form sits over the place the card will take, the unit and source lists open with the pointer and give the keys back when one is chosen, and the card reads at 100 % and when zoomed out, with the value large in the face of numbers, in both themes. The page of a new project has the same fields in rows.
- **STEP and PDF cards, and a link.** A PDF or a STEP file of `reference/` is a card with its name and kind; a double click shows it in your file manager, and a click on a web address in a text card opens it in your default browser (a test only has a stand-in for the system's opener).
- **The prompt preview of a new project.** The preview of the first prompt reads clearly and matches what is sent.
- **The scans walk-through.** Import, align and check a scan by the steps the Scans section offers: each step is where the eye goes next, in both themes.
- **The export in the dock.** Each of the five tiles (a person's page, CAD, slicer, picture, tracing): the dock is legible in both themes, the rule fills in once and ends at the 12 MB tick, and the file lands in the status line with its read-back above it.
- **The sources line of Parameters.** A field's source word is shown after its comment, in the monospace face, and "no source" is quiet.
- **The rail and its badges.** Press each of the eight icons of the index: the card scrolls to its section and opens it, each icon's tip reads at once on hover and on keyboard focus, Projects pressed on the page of projects is a dyed tile, and the drawn icons are of one weight and distinct at their size, in both themes. The badges (the parts switched off, the checks that fail, the scans not aligned, the marks to review) and the dot of a session that waits read at a glance on the rail, and the rail stays in its place in a narrow window.
- **Compare in all four modes.** Compare a turn, a row and an older build with **Before**, **Overlay**, **After** and **Side by side**: the grey translucent earlier build over the later one, each build alone in its part colours, one camera for both halves, the two boxes over the corners, the band and the status line (`comparing prompt 14 · h40 → h41`) legible in both themes and clear of the compass. Tests drove them in the hidden window and never looked. Compare a turn while newer builds land: the older build is drawn in the live one's place and the view says so; check it reads as the live build, not as a second model. An older build is built again from its copy (tested against the real kernel on small models in a temporary folder): on a real project, how long the wait is, and that `Building h40 to compare…` is shown while it runs.
- **Prompts only and Earlier conversations.** **Prompts only** in More, and **Close** on the list: one row per prompt with its picture, words, builds, result and time, the lines for your saves between the rows, the faded row of prompts gone back from, **Starred** and **Hide gone back**, a click to compare and a double click to open it in the chat; **Earlier conversations** above the chat with a project of dozens of conversations, and the pane over a terminal session. Legible in a narrow dock and in both themes, and quick to open.
- **The builds strip, by eye.** On top of the session pane in the chat, the terminal and with no session: the pictures of the builds (which a test never sees), the 2 px ring on the one on show, the hatch of a failed build, the outline and seconds of the running one, the bracket under the prompts in sight as you scroll the chat, a build sliding in, the fold when the pane is short, and the ticks in the status line, in both themes and in a narrow dock. With forty builds the strip scrolls sideways and the build on show stays in sight.
- **Go back's question.** On a turn after a prompt that edited the model: the list of files to write, to delete, to leave alone and changed since, the Params, and the prompts undone, in the monospace face for names and numbers; then "Go back" puts the files back in your own editor and folder (it was only tried on temporary folders), the note in the chat and the faded row appear, and the next prompt tells Claude. With no copy kept, the sentence about asking Claude instead.
- **The edge of the card.** The line between the route card and the view drags without lag and keeps its place at start.
- **The leaders and the tags, by eye.** Take a tool (`M`, `X`, `P`) and point at the part: the tool's tag pops by the point and its leader, a fine accent line, draws out from the part to the tag in about a quarter of a second, once. Orbit, pan and zoom: the tags follow what they stand on without lagging behind a frame, and none leaves the view or covers the reed, the compass or a band. Point at a ref in the chat and the leader to its place draws the same way. With the system set to reduce motion they appear in place at once.
- **The caption by the pointer.** With a tool in hand, the small caption a little below and to the right of the pointer follows it without lag, says what the tool waits for next, steps aside near the switch or a band, and shows at once for your first ten takes of a tool.
- **The compass and its cube.** At the top right of the view, drag the cube to turn the camera and click a face to take that view: the cube turns as the camera does, the face you are looking along is in the accent's wash, and the saved views fold under it while Section is in hand. Check it at 1280 × 800 and in both themes.
- **A build landing.** Make Claude Code build while the session is in view: the new build's node slides into the builds strip (about 0.7 s), the table's new numbers count up from the old ones, and each gauge tick that moved slides to its place. Nothing keeps moving afterwards, and with reduced motion the numbers show their new value at once.
- **The dyed plate and its vise.** The first screen, an empty folder and the prompt side of a new project are the layout-blue field with the vise scribed on it: its outline draws itself in about a second and a half, then the dimensions and the part come in. Check the lines stay fine at 1x and 2x scale, and that the blue is used nowhere else as a field.
- **The bench at true scale.** On the page of projects, **True scale**: the pictures stand side by side at one scale, a part twice as big drawn twice as big, the scale bar of a shelf at its right end is 50 mm on a ruler held to the screen, and thumbnails sit where they should in light and dark.
- **The keyboard rising.** Press `?`: the keys rise from the foot of the window (about a third of a second), key caps in the monospace face, each key lit as you press it; `Esc` puts it away. While a sketch is open its own keys take over.
- **A review, by eye.** Make a round with a pick and a shape you do not want and a 3D sketch you want, on a high-resolution screen and on an ordinary one, in both themes: the hatch of what you do not want reads as stripes in your colour and not as noise, the dashes of a stroke are clear, `−` and `+` are legible in the chips, the band at the top left and the round's panel in the card's head sit well with Compare drawn beside them, and the panel does not cover what it is about. The panel does not close with `Esc`. The real Claude Code is yet to be seen answering a review item by item.
- **The edges of a field and F6.** A focused field shows its edge in both themes, and F6 moves the focus between the regions in a sensible order.
- **The ask card.** A question from the agent shows its options and the faces they light in the view; legible in both themes.
- **The edits menu.** The menu beside the model shows the three modes and the one in force, in both themes.

With a real agent:

- **Claude Code and the trust question.** In a folder never opened before, with a `.claude/settings.json` that holds a hook (or a `.mcp.json`), either in the project or in a folder above it: "New session" asks "Start the chat anyway?" and starts nothing; "Start the chat" starts it (and the hook runs, as Claude Code's documentation says it does without a question when run non-interactively), and the next session there is not asked; "Use the terminal" shows Claude Code's own trust question. The measuring on 2026-10-15 (Claude Code 2.1.300) only read the documentation for this.
- **The instruction files, with the real Claude Code.** In a project whose workspace folder holds a `CLAUDE.md` (the person's real `~/objects` has one that names `out/viewer/report.json`), the session pane lists it with its size and your own `~/.claude/CLAUDE.md`, in the chat and in the terminal view, and a click on a name shows the file in your file manager (nothing is opened or run); `/memory` in a terminal session lists the same files and no others (an `AGENTS.md` only where no `CLAUDE.md` is above the project). After the first prompt, ask what it reads of the build: the real CLI in `~/objects` no longer reads `out/viewer/report.json` to see the shape but uses `scene`, `look` and `measure`, while it still follows the file's advice on how to model (caliper numbers first, blockouts first). The stand-in agent cannot show what the model chooses.
- **The prompts in the command menu.** In a chat, type `/mcp`: `/mcp__torno__review`, `/mcp__torno__printable` and `/mcp__torno__explain` are offered, and choosing one sends it; the stand-in names none of them, so no test has seen them in Claude Code's own list.
- **A failed or old Claude Code in the chat.** A `claude` that does not know one of the chat's flags, or is signed out: the pane says "Claude Code stopped (exit code 1)" with the last line it wrote, and "It did not start: is `claude` up to date and signed in?". Not yet seen with a real old CLI; the stand-in prints to stderr and exits 1.
- **A chat that could not use the login, with the real CLI.** The stand-in plays it (`FAKE_AGENT_AUTH_ERROR`) in the shape of the Agent SDK's types (an assistant message with `error: "authentication_failed"`, then a `result` with `is_error: true`); no real CLI has been seen to print it. Start torno with `CLAUDE_CODE_SIMPLE=1` (what `--bare` sets) and no `ANTHROPIC_API_KEY`, send a prompt in a chat: the CLI's words, then the warning "Claude Code's chat could not use your login" with "Use the terminal", once. Note what the CLI prints then (`claude -p --bare --output-format stream-json --verbose hello` in a terminal, with no key: the assistant message's `error`, the `result`'s `subtype`, `is_error` and `api_error_status`) and whether a signed-out `claude` (`claude auth logout`) or a login that ran out answers the same way or exits (an exit leaves the chat ended, and its "Use the terminal" still starts the terminal). Then start torno without the variable: "Use the terminal" ends the chat and the same conversation goes on in the terminal.
- **Subagents and thinking.** A turn with a subagent (`Task`; newer versions may call the tool `Agent`) and one with extended thinking: the card counts steps and lists the tools, "Thought for N s" shows after a thought. The number was worked out from a recording; nobody has looked at it with the real CLI.
- **The chat with the real Claude Code.** In a session in chat: a prompt with a pin or two marked (the "with" line shows them and they turn to sent); a command that asks permission, answered "Allow", then another with "Allow for this session" (the next like it is not asked, and `~/.claude/settings.json` and the project's `.claude/` are as they were), then one "Deny"; a question (`AskUserQuestion`) answered with an option and with "Other", and three questions read as three steps ("1 of 3", one at a time, then "Review" and "Send answers"), a question with four options fitting the dock without scrolling; a plan in plan mode approved; "Attach view" (the agent describes what you see); the model menu (the next answer is from that model, and `/model` in the terminal still shows your default); the effort menu (a level chosen is taken, `/effort` in the terminal still shows your default, and `~/.claude/settings.json` is as it was); a new project made with a model and an effort chosen beside "Create" (its first answer is from that model, at that effort); `/compact` (one note, the conversation goes on); "Terminal", then "Chat" again: the same conversation, its earlier part shown.
- **Making a new project with the real Claude Code.** "New project" with a name, a description, two photos from a phone (one large), a doodle, a scan and a reference to another project, each with a note, then "Create": the project is opened, its chat shows the one prompt with the pictures, Claude Code's reply speaks of them and of the notes, the scan is in the Scans list, `reference/` holds the original photos, and nothing else was written in the workspace. The stand-in agent has taken the prompt; the real CLI has not.
- **The board of a new project, with the real Claude Code.** Make a project with sizes and a PDF, and start Claude: its first prompt names the sizes (and its board line says no card is new), it does not ask for a size you gave, it reads the PDF with its own tools, and a size it adds with `add_card` shows on the board as a card that says "from Claude".
- **Asking for the missing sizes, with the real Claude Code.** Make a project whose description gives one size and leaves out the rest (a lid for a box of an unnamed size, screws not named): before the first write of the model, Claude Code asks once, in a card with at most four questions, each with a typical value among its options and "Other" taking "build with assumptions"; it asks nothing about a fillet radius; after the answers it builds, and a size you did not give is a field of `Params` commented "assumed" and listed in its reply. Then ask for a new feature with no key size (a hole for "a screw"): it asks once, not again. The stand-in agent only plays the card; the real model's choice to ask has not been seen, and the eval harness (#121) does not yet measure it.
- **The edits menu with the real Claude Code.** In a chat, choose "Accept edits" and ask for a change: the CLI
  should take the edit without asking, and the menu should show the mode again after the next prompt; then "Plan
  only", then "Ask before edits". torno sends the control request `set_permission_mode` (`mode`), the one the
  Agent SDK documents, answered here only by the stand-in: check that the real CLI answers it in `-p` stream-json,
  that its `init` and `status` report `permissionMode` after it, and that the "Allow for this session" of an Edit
  ask still writes nothing in `.claude/`.
- **Claude Code and torno's skills.** `--plugin-dir` works under `-p` (chat) and in the terminal view: in each, `/skills` (or asking the agent) lists `torno:torno-model`, `torno:build123d`, `torno:scans` and `torno:dimensions`, a model written in an empty project uses `torno-model` and builds with both layouts on the first try, and nothing was written under `~/.claude` or in the project's `.claude/`. The stand-in only shows the flag is passed. Asked how an argument of build123d is written, the agent searches `reference/api-0.13.0.txt` of the `build123d` skill (its `${CLAUDE_SKILL_DIR}` is filled in with the real folder, in the packaged app too) instead of running Python, and `claude plugin validate app/resources/agent-plugin` passes.
- **A failed fillet, with the real Claude Code.** Ask for a fillet that cannot be made as asked (the plate above, all
  its vertical edges at R6): the result of the edit says why under the error, and the agent reads it, calls
  `try_fillet` on the last good build with the edges it names before it edits again, and changes the radius of the
  edges that need it (or the selection) in `Params`, saying so; it does not wrap the fillet in `try`, lower every
  radius, or call `max_fillet()`. The stand-in agent cannot show what the model chooses.
- **What Claude Code says of itself, with the real CLI.** The stand-in plays each case (`FAKE_AGENT_INIT`); the real CLI has not: with `ANTHROPIC_API_KEY` set the chat says it is billed to an API key and names what `apiKeySource` is then (look at the value in a real `init`: `user`, `project`, `org`, `temporary`, or another), with it unset and logged in it says nothing (`none` or `oauth`); in a new session with torno's plugin, `init` lists `torno` among its `plugins` and no warning appears, and `/skills` lists the five skills (what `skills` holds with a `--plugin-dir` plugin is not recorded: the recordings' lists hold no plugin skill at all, so torno judges the skills only when `skills` shows some with a `plugin:` name); a `claude` of another minor than 2.1 (or older than 2.1.300) says so once; with the torno server made to fail the warning carries what the CLI said; a real overload shows "retrying (attempt N)" and it goes with the answer; a command refused by a rule of `settings.json` leaves the warning "Permission denied: …" (and the fields `mcp_server_errors`, `plugin_errors` and `permission_denials` are read as their form is guessed from the documentation). When the CLI moves, record a new stream (`app/test/fixtures/RECORDING.md`) and move the range.
- **The torno-reviewer subagent.** One run with the real CLI, in chat and in the terminal: after a change of several steps Claude Code calls `torno-reviewer`, which uses only its read-only tools, reports with numbers from `measure` and changes nothing; whether the subagent's MCP calls go through `--allowedTools 'mcp__torno__*'` without a permission prompt; and that an invalid `--agents` would have stopped the start (it did not); that the CLI accepts `model` and `maxTurns` in `--agents` (the subagent runs on Sonnet and stops by 20 turns), that `TORNO_REVIEWER_MODEL=inherit` leaves it on the session's model, and that its report ends with the HOLDS, FAILS and UNCHECKED lines. The stand-in only shows the argument is passed.
- **Pictures of a resumed chat, with the real Claude Code.** Make a project with one photo and one doodle and send the first prompt; let Claude Code take one `look`; quit torno. Start it again and open the project (the chat resumes): the photo and the doodle show, and the `look` picture says "Picture of an earlier build, not kept". Ask "Without reading any file, describe the doodle I gave at the start": a right answer confirms that `--resume` gives the model its pictures again. Then `/clear` and ask what references the project has: it names them from the line in `reference/`. The stand-in agent shows only that the window reads the files and the line is sent.
- **The session's token with the real Claude Code.** Start a chat and a terminal session: torno's tools connect (no
  "torno's tools are not connected" warning; `look` answers) and the hooks arrive (the status moves to working and
  back, a pin turns to sent), all with the token in the `X-Torno-Session` header. `ps -eo args` shows the `--mcp-config`
  path and no token. The documentation says `${VAR}` is expanded in the `headers` of a `.mcp.json`, and an http hook
  interpolates `$VAR` for the names in its `allowedEnvVars`; that a file given to `--mcp-config` is expanded the same way
  it only implies. If it is not, Claude Code sends the placeholder, torno answers 404 and the chat warns that the tools
  are not connected; the way out would be a small stdio bridge that reads the token from its environment.
- **The digest of a build with the real Claude Code.** Ask it to raise a boss off a plate until it no longer touches
  it: the answer to its edit says `Changed since rN:` and `Check: plate is 2 solids (was 1)`, the chat shows it under
  the edit's card behind "Show text", and when Claude Code would stop it is held back once and either mends the
  model or says why two solids are meant. Then ask for a pocket: the volume falls in `Changed since`, nothing is
  held, and it reads the line rather than asking for a picture first. Whether it heeds the line is the agent's;
  no test has seen a real CLI read it.
- **The holds of a `Stop` with the real Claude Code.** Have it edit the model and say it is done without a `look`
  (once through its editing tool, once with `cat > model.py` in Bash): the `Stop` is held with the reason about the
  build "built during this turn", the agent looks, and the turn ends. Open a project and ask something that
  changes nothing while its first build runs, then save the file in your editor in the middle of a turn: neither holds it. Pin a dimension, then have it change the model
  so that it fails: it is held once and names it. Let a build run for twenty seconds while it would stop: the `Stop`
  waits, and the hook's 25 s limit is enough (the stand-in cannot tell). Whether the second `Stop` of a turn that was
  held arrives with `stop_hook_active` and is held again for another reason is what the code assumes; the stand-in
  plays it as the documentation says. Whether the hooks of a `torno-reviewer`'s `look` arrive on the session's
  address (so that its look counts) has not been seen.
- **`ask` with the real Claude Code.** (1) Ask it to call `mcp__torno__ask` and leave the card open for six minutes: it
  should still be open and the call not time out, because torno sends a progress notice every 30 s, but only when
  Claude Code sends a progress token with the call, and whether its 5-minute idle limit counts those notices is
  not known. (2) With a card open, press Stop in the chat: the card should go and the session be idle. Claude Code's
  cancel of one call does not reach torno's server, which keeps no sessions, so torno ends the question when the turn
  ends (the `Stop` hook); that was only tried with the stand-in.
- **Claude Code and the newer tools.** Ask it to cut the part, to look at it drawn apart and to check a part against a scan: `section`, `look` with `explode`, `scan_clash` and `scan_deviation` are called without a permission prompt and their replies are used.
- **The evals with the real Claude Code.** `pnpm -C app eval` was run end to end only with the stand-in, on the
  `_smoke` case. Its first real run, the spike of one T1 case and then the baseline of every case five times, is yours:
  whether a chat of minutes holds up in the hidden window, what a run costs, and whether the cases' checks and answers
  are fair to a real agent.
- **What torno says it needs, with the real CLI, a machine without `claude` and one without `uv`.** Tests look for `claude` on the `PATH` and never run it; the stand-in plays `--version` and `auth status`. With the real CLI: the first screen says `claude` is found, its version (`claude --version` prints it first, as `2.1.307 (Claude Code)`) and "signed in" (look at the real output of `claude auth status`: torno reads `loggedIn` and `authMethod` of its JSON, and says nothing of the account where it finds neither); signed out (`claude auth logout`) the line says so and the page of a new project warns above "Create"; a `claude` that hangs or is too old to know `auth status` is said to have not answered, within 3 seconds. On a machine without `claude` on the `PATH` the line says "Not found on PATH", and without `uv` the uv line does and the kernel's is left out. With no `kernel/.venv` (or no `kernel-env` under torno's data folder, packaged), "Not made yet" and "Make it now" run `uv sync` on the network and show its lines, then the line says torno's environment is made; offline the reason is uv's. Started from the Finder or a desktop launcher the `PATH` shown is the one torno has.
- **An agent torno did not start (#54, a spike).** Start torno with `TORNO_OUTSIDE_AGENTS=1 scripts/torno ~/objects`, open a project, and in its folder add the bridge to your own agent (`claude mcp add torno -- node <torno>/scripts/torno-mcp.mjs .`, or the stdio server of Codex, Gemini CLI or opencode). Torno asks in the window before any tool answers; check that `scene` and `look` work, that the server's instructions reach the model, how long a call takes, which tools are worth it outside, and how the agent fares without torno's hooks. Deny, and the agent is told so; quit torno, and it is told how to start it. Whether to keep it, and steps 3 to 5 of #54 (`scripts/torno mcp`, a `news` tool that sends marks, the plugin's `.mcp.json`, a README section), wait for that trial.
- **The board with a hand.** A trackpad's two-finger pan and pinch, a middle-button drag and `Space` and a drag move around the board without drawing a card
  again, and the cards, arrows and the map stay sharp when zoomed to 10 % and to 400 %. Dragging a card and a frame, drawing a box and an arrow, dropping a photo from the
  file manager and pasting one all feel steady with real pointers; tests moved the pointer with synthetic events, dropped files they made themselves and never touched the clipboard.
- **A phone's photo on the board.** A photo of 12 megapixels from a phone, dropped on the board or chosen with the Picture tool, is scaled and becomes a card at once, and the
  card is as sharp as it is wanted at 100 %. Tests dropped a generated picture of 2600 × 1800 pixels. A HEIC photo says why it is not read.
- **The brief in your editor, and a file in its folder.** A double click on the brief card opens `brief.md` in the program the system has for it, and a file of `reference/`
  that is no picture is shown in the file manager. A test stands in for both.
- **Claude reading the board.** The real agent understands the line every prompt carries, reads the board with `board`, and works through an attached frame; its cards
  (a plan, a picture of the view) are green-edged and never over yours. Tests used the stand-in, which says each line it is given.
- **The board by eye, in dark and in light.** The cards, frames, arrows, the green edge of Claude's cards, a build card's picture, the pictures opened large and the palette are legible and quiet
  in both themes, on a board of 200 marks and on one of a dozen cards.
- **A board file that cannot be read, and a pull.** Break `board.json` (conflict markers) and open the project: the board is empty and a notice above the palette says where the old file was kept, with "Dismiss". Pull a change of `board.json` made elsewhere, then add a card: the pulled cards show with it. Tests wrote the file themselves and looked at the notice in a hidden window only.
- **A project of 780 parts.** A board with a few hundred cards of marks opens and pans without a stall. Tests used boards of a handful of cards and a count of how many times the cards are drawn.
