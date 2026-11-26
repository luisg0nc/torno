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
  - "app/src/main/shelf/checked.ts"
  - "app/src/main/shelf/checked.test.ts"
  - "app/src/main/shelf/add.ts"
  - "app/src/main/shelf/add.test.ts"
---

# What torno writes in a workspace, and `.torno` itself

Moved as written from the folder `CLAUDE.md` files; each heading names the folder it came from, and paths are written as they were there (see "Rules by area" in the root `CLAUDE.md`).

## Global Constraints (root `CLAUDE.md`)

- Never write inside a user workspace except under `<object>/.torno/`; a shelf part's folder `common/parts/<id>/` counts as a project for torno's own files: main may write only its `.torno/` (the checked dates, `checked.json`, through `ownTorno` and `writeOwn` from `main/shelf/checked.ts`, when the person says they measured a size: the file is read through `readCheckedText` (opened without following a link or waiting on a pipe, at most 64 KB, else refused and nothing written), merged, written whole, never ignored by git, and only after every folder down to the part is checked not to be a link). Six exceptions. One: making a new object (`main/objects/create.ts`, the "Create" of the onboarding) writes ONE new folder `<workspace>/<name>/` with torno's template model, `brief.md`, `reference/` (photos, doodles, STEP files and PDFs) and its board (`.torno/board/board.json`, the one thing under `.torno/` it writes), made in a hidden `.<name>.torno-new-<random>` beside it and renamed into place as the last step, so it is whole or not there; it never writes into or replaces a folder that exists (compared without regard to case; the one case is an empty folder of the name, which a crash between the claim and the rename leaves and which is renamed onto, failing should anything be put in it meanwhile), never follows a link, and reads the files it copies as plain files only, size-capped. The only other thing it removes is the hidden `.<name>.torno-new-<12 hex>` folders, real folders more than ten minutes old, swept when a workspace is opened. It writes nothing else in the workspace: the scans are imported and the chat started after, under `.torno/`. Two: an export (an HTML page, a file of the model, a picture of the view, a drawing of its section as SVG or PDF) writes one file, to the path the person chose in the save dialog (`main/export/save.ts`), whole or not at all: through `<path>.<random>.tmp` beside it, which is gone when the write ends (a STEP, STL or 3MF is read back from it by the kernel's worker and checked first, and one that fails is never named); no folder is made for it; the path never comes from the window or from an agent, and no agent has a tool for it. Three: "Keep this as a folder" on the example (`keepExample` in `main/example.ts`, `workspace:keepExample`) writes ONE new folder at the path the person chose in the save dialog, which is not in a workspace but beside any folder they name: all of it is written in a hidden `.<name>.torno-new-<random>` beside it and renamed into place as the last step, so it is whole or not there; it never writes into or replaces a folder or file of that name (compared without regard to case), never follows a link (a link or anything not a plain file or folder is left out; each file is read through a handle opened without following one), is size-capped, and keeps only a copy that torno made and whose marker names it (the path of the copy is main's, never the window's). The path never comes from the window or from an agent, and no agent has a tool for it. Four: Go back (`main/goback.ts`) writes and removes `.py` files of its own project's folder, from the copies in `.torno/history/`, after the person confirms; never `common/` or another project. It writes each file whole or not at all, only files main works out itself (what the window sends is only what the person confirmed, compared with what main would do), never through a link, never a hidden path; it removes only a `.py` of that folder that no build up to the one restored held and a later build did, and it puts back the person's tried Params (`.torno/params.json`, through `paramsfile.ts`). No agent has a tool for it. Five: adding a part by hand (`main/shelf/add.ts`, `shelf:addFiles`): when the person sends a message from the chat box that still names `common/parts/<id>/` after "Ask Claude to put it on the shelf" (or, in a terminal session, when they press that button: it has no box to send from), main copies the files they dropped on the Shelf tab into `common/parts/<id>/`. `<id>` is checked by main with `isPartId` (so the folder is inside `common/parts/`); at most 8 absolute paths, each a plain file (`lstat`, an open without following a link, read through the handle, as `openRegular` of `create.ts`) of a PDF, picture or STEP kind, at most 25 MB (50 MB for a STEP); the name is main's own (`shelfFileName`, as a new project names a reference), never the window's. `common/`, `common/parts/` and the part's folder are made when missing, each existing one first looked at (a link or a file in its place refuses the whole request, nothing is written through it), and the ones made are taken away again when no file went in. Each file is written whole or not at all (a temp file beside it, then a hard link to the name, so a name that is taken is never replaced), never over a file of that name (compared without regard to case, a link included); a file that cannot be copied is refused by name with its reason and the rest are copied. The folder may be there already: more files are added, nothing there is changed. It writes nothing else (no `part.py`, no `.torno`). Claude writes the part's `part.py` itself (it may write `common/`), after asking. Six: renaming a part by hand (`main/rename.ts`, `object:renamePart`, rule `rename-part`) writes the new name into `.py` files of its own project's folder, at the spans the kernel's `part_sites` found by the AST (the kernel reads, never writes): each file is checked to be an own `.py` (`ownFile`), a plain file inside the project by real path (`unfit`), and to hold the bytes the kernel read (its SHA-256) and the old text at every span, then written whole (`writeFileAtomic`). Never `common/` or another project; nothing the window sends but the two names. No agent has a tool for it. The view notes ("Draw on view") add the one folder `<object>/.torno/notes/`, written by main alone (`main/notes/files.ts`: whole or not at all, never a name from the window), with the pictures of the notes, which never go to git. The kernel never writes a file: it gives the bytes. Never run `uv sync` there: always `uv run --no-sync`, and only when `<workspace>/.venv` exists: without it uv would create one, so no kernel is started and builds fail saying to run `uv sync`. torno's own kernel project is not a workspace: "Make it now" on the first screen runs `uv sync` there (`main/readiness.ts`), and nowhere else.

## The page of objects (`app/src/main`)

- **`.torno/.gitignore` has one writer**, `src/main/ignored.ts` `ensureIgnored(dir, lines)`: it adds the
  lines that are missing at the end, makes the file when there is none, never removes or rewrites what is
  there, and adds nothing against a line the person negated (`!thumb.png`). The thumbnails ask it for
  `thumb.png` and `thumb.json`, the state file for `state.md`, a conversation put on file for `session.json`,
  a chat's log for `chat/`, an export for `exports/`, a picture for `views/`, the builds' record for `builds.jsonl`, the overrides of
  `Params` for `params.json`, the board's record of what the agent was told for `board/told.json`, the tracings' for `tracings/told.json` and the
  board's pictures for `board/pictures/` (that folder has a `.gitignore` of its own). What is the
  object's travels: `scene.json`, `marks.json`, `sets.json`, `scans.json`, `tracings.json` (the tracings, their layers and the line-up of each photo), `profile.json`, `agent.json`, `board/board.json` (the cards, frames and
  arrows of the board; its pictures stay on the computer). A shelf part's `common/parts/<id>/.torno/checked.json` travels too (the part's own record, `shelf`). The tracings' photos (`tracings/photos/`, with a `.gitignore` of `*`) and `tracings/told.json` stay on the computer: a tracing opened on another one says `the photo is not on this computer` and still tells its line-up (`tracings.md`).
- **`.torno` is named in one module, `src/main/own.ts`** (`FOLDER`), and every write under it goes through
  `ownTorno(dir)` first (`writeOwn` for a file written whole): a link or a file in its place is refused with a
  plain reason, nothing is written, and the person is told once for each object, in the Marks section of the route card
  (`onNotOwn`, wired in `index.ts`). (`.torno/views/`, `.torno/scans/`, `.torno/board/pictures/`, `.torno/notes/` and `.torno/tracings/photos/` each have a `.gitignore` of their own
  inside them, written by whoever makes the folder; `main/notes/files.ts` writes the pictures of the view notes, named
  `n-<12 hex>.png`, `n-<12 hex>.ink.png` and `r-<12 hex>.png|jpg`, by main alone, after `main/notes/check.ts` has checked what the window sent
  (`notes:make`, `notes:edit`); only files torno itself dropped are swept, never "whatever the marks do not name" (a branch switch must never delete
  a picture): main lists a file in the folder's `dropped.json` (`main/dropped.ts`; the same for `.torno/board/pictures/`) when it
  drops it (a note removed, the ink an edit replaced, a reference taken away, what a failed save wrote, a card taken off the
  board, a doodle drawn on again), and the sweep, once per project per run when it is first opened (`main/notes/sweep.ts`,
  `main/board/pictures.ts`), deletes a listed file only if no note or card names it, this run's undo cannot bring it back
  and no `marks.json.corrupt-*` or `.dropped-*` names it, then takes it off the list. An unlisted file is never deleted;
  nothing at all is swept when the marks file could not be read; a file changed in the last minute is left alone. The photos of the tracings are the same: `main/tracings/photos.ts` writes `p-<12 hex>.jpg|png` (a photo, a PNG or JPEG of at most 4000 px and 25 MB, checked by `checkedPhoto` from its header) and `s-<12 hex>.jpg|png` (the copy the window straightened through the line-up) into `.torno/tracings/photos/`, by main alone, through `ownTorno(dir, 'tracings', 'photos')`; `TracingStore` lists a file in that folder's `dropped.json` (`tracings/dropped.ts` `dropPhotos`, in the turn of the change, once `tracings.json` is written) when a swap, a new line-up, a removed photo or a removed tracing lets go of it, or when a change that failed had written it; and `PhotoSweep` (`tracings/sweep.ts`, from `onObjectOpened`) deletes a listed file only if no tracing names it, no tracing removed in this run does and no `tracings.json.corrupt-*` or `.dropped-*` does, it is a plain file older than a minute, and its name has been on the list 30 days (the photos are in no git and every branch of a project shares the folder, so `dropped.json` carries the date each name was listed in `at`, and a name with no date is dated by the sweep that first sees it). `withPhotos` reads `tracings.json` again first when the disk's text is not what main last wrote.)
  - The folders torno keeps under it are held to the same rule by the same function, named after the folder:
    `ownTorno(dir, 'views')`, `ownTorno(dir, 'exports')`, `ownTorno(dir, 'scans', 'S1')` (`ownFolders` and
    `linkRefusal` of the scans are that call), `ownTorno(dir, 'chat')`. It is asked before every write into
    such a folder and before every delete in it (the pictures cleared away past the newest 20, a scan's
    folder, a mask, a sweep): a link or a file in its place is refused, nothing is written or deleted where it
    leads, and the window is told once for each such folder, by itself (`inside` of the listener: the rest of
    the object is kept, and the Marks section does not say that nothing is).
