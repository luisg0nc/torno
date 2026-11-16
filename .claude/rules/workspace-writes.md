---
paths:
  - "app/src/main/own.ts"
  - "app/src/main/own.test.ts"
  - "app/src/main/ignored.ts"
  - "app/src/main/ignored.test.ts"
  - "app/src/main/atomic.ts"
  - "app/src/main/atomic.test.ts"
  - "app/src/main/workspace.ts"
  - "app/src/main/workspace.test.ts"
  - "app/src/main/objects/create.ts"
  - "app/src/main/objects/create.test.ts"
  - "app/src/main/export/save.ts"
  - "app/src/main/export/save.test.ts"
  - "app/src/main/example.ts"
  - "app/src/main/example.test.ts"
  - "app/src/main/readiness.ts"
  - "app/src/main/readiness.test.ts"
  - "app/src/main/kernel/client.ts"
  - "app/src/main/kernel/client.busy.test.ts"
  - "app/src/main/kernel/client.itest.ts"
  - "app/src/main/kernel/client.test.ts"
  - "app/src/main/paths.ts"
---

# What torno writes in a workspace, and `.torno` itself

Moved as written from the folder `CLAUDE.md` files; each heading names the folder it came from, and paths are written as they were there (see "Rules by area" in the root `CLAUDE.md`).

## Global Constraints (root `CLAUDE.md`)

- Never write inside a user workspace except under `<object>/.torno/`. Four exceptions. One: making a new object (`main/objects/create.ts`, the "Create" of the onboarding) writes ONE new folder `<workspace>/<name>/` with torno's template model, `brief.md`, `reference/` (photos, doodles, STEP files and PDFs) and its board (`.torno/board/board.json`, the one thing under `.torno/` it writes), made in a hidden `.<name>.torno-new-<random>` beside it and renamed into place as the last step, so it is whole or not there; it never writes into or replaces a folder that exists (compared without regard to case; the one case is an empty folder of the name, which a crash between the claim and the rename leaves and which is renamed onto, failing should anything be put in it meanwhile), never follows a link, and reads the files it copies as plain files only, size-capped. The only other thing it removes is the hidden `.<name>.torno-new-<12 hex>` folders, real folders more than ten minutes old, swept when a workspace is opened. It writes nothing else in the workspace: the scans are imported and the chat started after, under `.torno/`. Two: an export (an HTML page, a file of the model, a picture of the view, a drawing of its section as SVG or PDF) writes one file, to the path the person chose in the save dialog (`main/export/save.ts`), whole or not at all: through `<path>.<random>.tmp` beside it, which is gone when the write ends (a STEP, STL or 3MF is read back from it by the kernel's worker and checked first, and one that fails is never named); no folder is made for it; the path never comes from the window or from an agent, and no agent has a tool for it. Three: "Keep this as a folder" on the example (`keepExample` in `main/example.ts`, `workspace:keepExample`) writes ONE new folder at the path the person chose in the save dialog, which is not in a workspace but beside any folder they name: all of it is written in a hidden `.<name>.torno-new-<random>` beside it and renamed into place as the last step, so it is whole or not there; it never writes into or replaces a folder or file of that name (compared without regard to case), never follows a link (a link or anything not a plain file or folder is left out; each file is read through a handle opened without following one), is size-capped, and keeps only a copy that torno made and whose marker names it (the path of the copy is main's, never the window's). The path never comes from the window or from an agent, and no agent has a tool for it. Four: Go back (`main/goback.ts`) writes and removes `.py` files of its own project's folder, from the copies in `.torno/history/`, after the person confirms; never `common/` or another project. It writes each file whole or not at all, only files main works out itself (what the window sends is only what the person confirmed, compared with what main would do), never through a link, never a hidden path; it removes only a `.py` of that folder that no build up to the one restored held and a later build did, and it puts back the person's tried Params (`.torno/params.json`, through `paramsfile.ts`). No agent has a tool for it. The kernel never writes a file: it gives the bytes. Never run `uv sync` there: always `uv run --no-sync`, and only when `<workspace>/.venv` exists: without it uv would create one, so no kernel is started and builds fail saying to run `uv sync`. torno's own kernel project is not a workspace: "Make it now" on the first screen runs `uv sync` there (`main/readiness.ts`), and nowhere else.

## The page of objects (`app/src/main`)

- **`.torno/.gitignore` has one writer**, `src/main/ignored.ts` `ensureIgnored(dir, lines)`: it adds the
  lines that are missing at the end, makes the file when there is none, never removes or rewrites what is
  there, and adds nothing against a line the person negated (`!thumb.png`). The thumbnails ask it for
  `thumb.png` and `thumb.json`, the state file for `state.md`, a conversation put on file for `session.json`,
  a chat's log for `chat/`, an export for `exports/`, a picture for `views/`, the builds' record for `builds.jsonl`, the overrides of
  `Params` for `params.json`, the board's record of what the agent was told for `board/told.json` and the
  board's pictures for `board/pictures/` (that folder has a `.gitignore` of its own). What is the
  object's travels: `scene.json`, `marks.json`, `scans.json`, `profile.json`, `agent.json`, `board/board.json` (the cards, frames and
  arrows of the board; its pictures stay on the computer).
- **`.torno` is named in one module, `src/main/own.ts`** (`FOLDER`), and every write under it goes through
  `ownTorno(dir)` first (`writeOwn` for a file written whole): a link or a file in its place is refused with a
  plain reason, nothing is written, and the person is told once for each object, in the Marks panel
  (`onNotOwn`, wired in `index.ts`). (`.torno/views/`, `.torno/scans/` and `.torno/board/pictures/` each have a `.gitignore` of their own
  inside them, written by whoever makes the folder.)
  - The folders torno keeps under it are held to the same rule by the same function, named after the folder:
    `ownTorno(dir, 'views')`, `ownTorno(dir, 'exports')`, `ownTorno(dir, 'scans', 'S1')` (`ownFolders` and
    `linkRefusal` of the scans are that call), `ownTorno(dir, 'chat')`. It is asked before every write into
    such a folder and before every delete in it (the pictures cleared away past the newest 20, a scan's
    folder, a mask, a sweep): a link or a file in its place is refused, nothing is written or deleted where it
    leads, and the window is told once for each such folder, by itself (`inside` of the listener: the rest of
    the object is kept, and the Marks panel does not say that nothing is).
