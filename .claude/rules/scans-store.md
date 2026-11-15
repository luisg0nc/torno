---
paths:
  - "app/src/main/scans/**"
  - "app/src/main/look.ts"
  - "app/src/main/look.test.ts"
  - "app/src/shared/scans.ts"
  - "app/src/shared/scans.test.ts"
  - "app/e2e/scan*.spec.ts"
---

# Scans in main: the store, the files, checking alignments, wording

Moved as written from the folder `CLAUDE.md` files; each heading names the folder it came from, and paths are written as they were there (see "Rules by area" in the root `CLAUDE.md`).

## Scans (`app/src/main`)

- The source is only read: referenced by absolute path, size, modification
  time and SHA-256, never copied, moved or written. The scan works from its
  mesh when the source is gone (`sourceState`), and says what to do when the
  mesh is gone too (`meshState`).
- Main is the only writer of `.torno/scans.json` and of `.torno/scans/`
  (`src/main/scans/store.ts`, with a region's mask files in
  `scans/masks.ts` and what an alignment becomes when it is kept, undone,
  held or checked in `scans/alignments.ts`, each a scan made of a scan):
  one change at a time per object, written atomically before it is told. Ids are `S1`, `S2`, … per object, never
  reused, also when `scans.json` is lost and a folder `S<n>` is still there.
  Visibility, opacity and colour mode are view state, in `scene.json`
  (`scans`); what `show` sets of them never reaches that file.
  - A conversion or a re-import writes a new file, `mesh.<n>.bin`, and the
    record names it (`imported.mesh`; absent means `mesh.bin`): the write of
    `scans.json` is the commit, the old file goes after it. Never build a
    mesh's path by hand: `ScanStore.paths()`, after `list()`.
  - What may be deleted under `.torno/scans/` is in `meshfiles.ts` `sweep`:
    a folder only when it holds the `importing` marker of an import that
    never ended, an unnamed mesh only while the named one is there, nothing
    through a link, nothing beside a `scans.json` that was set aside. Nothing
    is written through a link either (`ownFolders`: `.torno`, `.torno/scans`,
    a scan's folder), and nothing else is deleted through one (`linkRefusal`
    in `masks.ts`): not a mask, not a scan's folder when the scan is removed
    (the removal is refused, saying to take the link away, and the scan kept), and the sweep clears nothing
    where `.torno` or `.torno/scans` is one. A re-import that a removal
    overtook takes away the folder it made again, only when it is empty.
  - What `scans.json` says is bounded as it is read (`scans/file.ts`): a
    layout name and a source path are one line, 200 and 4,096 characters at
    most; a mesh whose header gives no box is refused (`parseScanMesh`).
  - `list` and a failed read of a mesh tell the scans anew when a source or
    a mesh is found gone or back (`looked`), so a row never says "aligned"
    of a scan the tools refuse. The window asks for a mesh again when it is
    back, and after a failure only once the scans were told anew
    (`ui/scanMeshes.ts`).
  - Main alone names a mesh or a mask file. The one path the window gives is
    the source of an import, which main checks (`sourceOf` in `scans/source.ts`: absolute, one of
    the five formats, not inside the object's `.torno/`) and only reads.
- After every build and every alignment the alignments are checked
  (`main/scans/alignCheck.ts`): the model points an alignment is tied to
  (ends clicked on a part, a floor laid on a face) are looked for on their
  parts again with the kernel's `nearest`, and each part's `arranged` is
  compared with what it was. What is found is told; nothing is ever
  re-fitted. An alignment not checked against the last build is asked about
  again every 30 s and whenever the scans are listed for a tool, the prompt
  or the window (`keepChecking`, `recheckAlignments`), until it is. "Still
  right" (`alignmentHolds`) holds the alignment against the model as it is
  now (`confirmed.held`).
  - **No check by itself has an object built again.** A check after a build,
    on a timer or at a listing asks with `Builds.query(…, { restore: false
    })` (`checkingAlignments`, and the marks' `retrying`, whose `restore` is
    true only for the run a person's act or a tool asked for); when the
    kernel no longer holds the build it records why (`uncheckedFor`, `the
    kernel no longer holds this build`) and waits for the next `scene`. When
    the model, as it is, does not build either (`NotBuilding`, which
    `Builds.query` throws then, asked to restore or not), that is the reason
    recorded (`NOT_BUILDING`), and it is not tried again. The scans' store is
    looked up at each run of the check, as the marks' is.
  - `Builds.query` restores a build the kernel let go, for a tool or an act
    of the person; but not sources that have just failed to build
    (`Entry.failure`, until a source changes or a rebuild is asked for): it
    then rejects saying there is no build to answer from, and that one comes
    when a source changes or Rebuild is pressed. `BuildState.letGo`
    (`memory`) says the kernel let the object's build go to make room
    (`build.started`'s `retired`, or a `no_build` with `reason: "memory"`);
    `letGoText` words it for the status line and for `scene`.
- **One notion, one wording.** How an alignment stands is `standingOf(scan,
  layout, revision)` in `shared/scans.ts` (`basis`, `rough`, `stale`,
  `unchecked`, `waiting`, `failed`, `note`), for the row, the bar and the
  picture's caption (`scansNote`). What main says of it to the agent is
  `alignmentSaid` in `main/scans/said.ts`, and nothing else in main words an
  alignment: the tools' `alignment`, the doubts that open a reading
  (`first`), its closing sentence (`last`), the `Scans:` line of the prompt,
  `state.md`. A tool reads it again once the kernel has answered (`saidNow`).
- A part torno moved for display is refused by the scan checks
  (`scanSpread`), saying the whole way: a layout that places it as the model
  does and in which the scan is aligned, or `def assembly(p)`, a build, and
  the user aligning the scan in it (an alignment is of one layout); and the
  parts it did not move. A scan not aligned in the layout asked names only
  the layouts that would answer for that part (`notAligned`). So is a part
  that stood elsewhere when the scan was aligned (`scanFrame`). Other parts being spread
  otherwise is a doubt, said first, not a refusal. Refusals are made in main
  before the kernel is asked (`scanFor`).
- What the window says of its scans (`ViewState.scans`) is sanitised in main
  (`scansOf` in `main/look.ts`) before anything is told of it.
- What must never happen: a number of a scan told as exact; a preview told
  or stored as the alignment; a mask applied to another mesh than the one it
  was painted on; a mesh or mask path taken from the window or from a tool's
  arguments; a write outside `.torno/`, or to a scan's source.
