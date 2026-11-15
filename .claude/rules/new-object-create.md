---
paths:
  - "app/src/main/objects/**"
  - "app/src/shared/objectName.ts"
  - "app/src/shared/objectName.test.ts"
  - "app/src/shared/pythonModules.ts"
  - "app/src/renderer/ui/onboard/make.ts"
  - "app/src/renderer/ui/onboard/make.test.ts"
  - "app/e2e/objects-create.spec.ts"
---

# Making a new object: the folder, its name, its references

Moved as written from the folder `CLAUDE.md` files; each heading names the folder it came from, and paths are written as they were there (see "Rules by area" in the root `CLAUDE.md`).

## New objects (`app/src/main`)

- `objects/create.ts` (`objects:create`, the one place torno makes a folder in a workspace) makes `<root>/<name>/` from
  `objects/template.py.txt` (the single source of torno's template, imported as raw text; the kernel's
  `tests/test_template.py` builds that same file through the real loader), `brief.md` and `reference/`.
  Everything is made in `.<name>.torno-new-<random>` (dot first: the listing of a workspace never shows it), then the name is
  taken by `mkdir` (fails if it is there) and the temp folder is renamed onto it, the last step; on any failure the temp
  folder is removed. The name rule is `shared/objectName.ts`, the window's and main's alike, compared with every entry of
  the workspace folder without regard to case. The rule refuses more than the kernel does, since torno makes the
  folder: a `.` anywhere (the module name folds it to `_`, which the kernel and `scanWorkspace` do not take for the
  folder's name, so a second `.py` would make the object ambiguous; existing objects with dots are untouched), `common`, `tests`, `out` (the workspace's own) and `docs`, `tools`, `reference` (torno gives them a meaning);
  a Python keyword; a name whose model file would be taken for a test (`test_*`, `*_test`, `conftest`); a folder
  or file of the workspace that is the same module (`a-b` and `a_b`); and a name that would stand in for a library, since
  the loader puts the object's folder first on `sys.path`: those a model or the worker imports and torno's own
  (`SHADOWING_LIBRARIES`: `build123d`, `OCP`, `numpy`, `typing`, `json`, `common`, `torno_kernel`, ...) and every module of
  Python's standard library (`STDLIB_MODULES` in `shared/pythonModules.ts`, generated once from
  `sys.stdlib_module_names` of the kernel's Python 3.12, without the underscore names; the file says how). Both lists
  are compared without regard to case.
- A folder of the name that is empty (a crash between the claim and the rename leaves one) is free: it is renamed onto,
  which fails should anything be put in it meanwhile. One that appears empty while a create works is not taken. When a
  workspace is opened, `sweepStaleNew` removes the hidden `.<name>.torno-new-<12 hex>` folders more than ten minutes old
  (real folders only; a link of that name is left alone; the age, not the run, since another torno may be creating),
  but not one that holds files in `reference/`: its doodles are nowhere else, so it stays (the manual says it can be
  deleted).
- Photos come as paths, copied as `reference/photo-<n>.<ext>` (png, jpg, jpeg, webp; at most 25 MB; `lstat` and an
  `O_NOFOLLOW` open, so no link, folder or pipe; read through the open handle, never more than the size said). Doodles
  come as PNG bytes (signature checked, at most 8 MB). Vendor STEP files (bought parts; `.step`/`.stp`) come as paths too, copied as they are to `reference/<their name>`
  (`stepFiles` in `shared/objectName.ts` names them, window and main alike: the stem made safe, the ending lower case, `-2` for a name taken, in any case), at most 50 MB
  (`MAX_STEP_BYTES`), through the same `readRegular` (no link, folder or pipe). They are listed in the brief after the doodles and
  named in the first prompt as a reference body for `import_step` and `references(p)` (`OnboardDraft.steps`: `reference/<file>` and a note;
  the file is checked as a plain file of `reference/` with a STEP name). torno reads nothing of them. `objects:pickStep` is their dialog
  (`__tornoMain.pickStep`, `stepPicks` count). Scans are not copied (`objects:onboard` imports them) and other objects are named
  by id; the path of a scan is refused if it holds a control character, a line break above all, as it is a line of `brief.md`,
  which writes a path under the home folder with `~`. At most 12 photos, 6 doodles, 4 bought parts (STEP), 4 scans and 8 objects (`MOST_REFERENCES` in `shared/objectName.ts`, held by the window and main alike). `brief.md` is `# name`, the description, and `## References` with a line per item in the
  order photos, doodles, STEP files, scans, objects.
- `objects:create` answers after `rescan`, so the listing has the object; if the workspace was left meanwhile, or it
  does not list the object, it rejects saying the object "was made, but ..." (the window then does not offer the
  draft again). It validates the request (name, caps, every note, every scan and object, the same photo, scan or object given
  twice) before the temp folder is made; the photos are read, and the doodles checked, as they are written, and a
  failure there removes the temp folder. A description is at most 20,000 characters, a note 2,000 (after folding to
  one line). `objects:taken` lists the entries of the root, for the window to check a name against as main does.
- `objects:pickPhotos` is the photo dialog; tests answer it with `__tornoMain.pickPhotos` (`photoPicks` counts).
  Every path it returns goes into `Offered` (`objects/offered.ts`, at most 500, cleared when a workspace is opened or
  closed). `objects:readPhoto` (the window cannot read a file, and the picture for the prompt must be scaled there)
  serves only a path in `Offered`: any other is refused ("That file was not chosen in this window."), however
  plain a picture file it is. The same rules hold as for the copy: absolute, no link, no pipe, `O_NOFOLLOW`, a
  PNG, JPEG or WebP of at most 25 MB (`MAX_PHOTO_BYTES`). A photo dropped on the page is read by the window itself
  (`File.arrayBuffer`); its path for the copy is `objects.pathOf` (`webUtils.getPathForFile`), and `create` still
  checks that path as a plain file. A file with no path is not taken.

## A new object (`app/src/renderer`)

- The name is checked against `objects.taken()` (every entry of the workspace folder, read when the page opens and
  after each create) as well as the objects. While `Creating…` shows, Escape, Cancel and the discard question do
  nothing. A note field is named by its card ("Note for photo desk.png"); numbers in the page's prose are set by
  `numbered`.
- **Create** is `ui/onboard/make.ts` (`makeObject`, tested with fakes, and guarded against a second call while one
  runs). The order is `objects.create`, the list is refreshed, the draft is spent, the object is opened as a click
  opens it, then `objects.onboard` once; the session main started is put into the store. A failure of `create`
  stays on the page with its reason and the draft intact. An error saying the object "was made, but ..." is never
  offered again: the draft is spent and the object opened if the workspace lists it. When `sessionId` is null or
  there is a `problem`, the object is open and `onboarding.hold` keeps the text: the session pane says why
  (`session-held`, with Dismiss) and the first chat's composer starts with the text, not sent. A held prompt that
  was not sent counts among what closing the window asks about (`closingWhy`'s `heldPrompt`), as does the draft.
