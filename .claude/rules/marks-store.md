---
paths:
  - "app/src/main/marks/**"
  - "app/src/main/sketches/**"
  - "app/src/shared/marks.ts"
  - "app/src/shared/tags.ts"
  - "app/src/shared/tags.test.ts"
  - "app/e2e/marks*.spec.ts"
  - "app/e2e/reanchor.spec.ts"
---

# Marks: the store, checking them against a build, their status

Moved as written from the folder `CLAUDE.md` files; each heading names the folder it came from, and paths are written as they were there (see "Rules by area" in the root `CLAUDE.md`).

## What crosses processes (root `CLAUDE.md`)

- A mark is a pin, a pick, an arrow, a stroke, a shape, a dimension, a region
  of a scan, a sketch or a view note (a picture of the view with ink, labels and references; its pictures are files in
  `.torno/notes/`, never in marks.json; its anchor is optional), with a note (`app/src/shared/marks.ts`). Ids are `M1`, `M2`, … per object, never reused,
  given by main only.
- Main is the only writer of `<object>/.torno/marks.json`
  (`src/main/marks/store.ts`): one change at a time per object, written
  atomically before it is told. The renderer and the MCP tools go through it.
- Coordinates and refs of a mark are in the object frame of the mark's layout.
  A ref is `<part>`, `<part>/F<i>`, `<part>/E<i>`, `<part>/@<tag>` or `M<n>`; to the kernel it
  is sent with the layout in front (`assembly:lid/F12`). A tag is a name the model gives a face or an edge
  (`tags(p, parts)`, read by the loader beside `groups(p)`; `shared/tags.ts`); `@` keeps it apart from the other
  forms, a tag name has no `/` and does not start with `@`, and a tag may name several faces and edges. A mark never
  stores a tag as its `ref`: its anchor keeps the face's or edge's own ref and the tag beside it (`Anchor.tag`),
  which only main sets (`withTag`, on placing and on every check) and which a check follows before the
  nearest-point rule.
- What only main says of a mark (`MAIN_ONLY_KEYS` in `shared/marks.ts`:
  `resolvedBy`, `acknowledged`, `sentBefore`, `reopened`, `checkedRevision`) is never
  taken from the window or from a tool's arguments. A mark the agent resolved
  is under "To review" until the person acknowledges it, one at a time or all at once (`marks.acknowledge`,
  one write).

## Marks (`app/src/main`)

- A view note's card on the board is told to the agent as the note's line (`describeMark`, the same as the `marks` tool's first line), never as
  `(note, on <ref>)` of the other marks (`main/board/text.ts` `markText`).
- A view note is made and edited through `notes:make` and `notes:edit` (`main/notes/ipc.ts`): the window sends the pictures
  and what the ink lies over, main checks them (`checkNoteDraft`, `checkNoteEdit`: the caps of a note, the checks of a
  drawing), writes the files, then calls `MarkStore.addNote` / `editNote`. A note keeps up to 2000 strokes
  (`MOST_NOTE_STROKES`), and only the first `MOST_STROKES_TOLD` get a line of what they lie over (`under`), then one per
  label with an arrow. `MarkStore.withNoteFiles` runs the sweep of `.torno/notes/` in the turn of the marks, naming the
  files of the notes it has (`live`) and of those removed in this run (`kept`: `remove` records them; `forget` clears them).
  **Only files torno itself dropped are swept** (`main/dropped.ts`): `remove` of a note, `editNote` (the ink it replaced, the
  references it took away) and a failed `notes:make` / `notes:edit` (what it wrote) list the files in
  `.torno/notes/dropped.json` (`notes/dropped.ts`); the sweep deletes a listed file only if no note names it and this run's
  undo cannot bring it back, then takes it off the list. A file not on the list is never deleted. `add` refuses a note
  (`kind: 'note'`): only `addNote` keeps one, with files main named. `editNote` sets `under` to `[]` when it changes the
  strokes or the labels and does not say it anew.
- A **sketch** (`kind: 'sketch'`, a 3D drawing: planes and strokes, `take` exact, rough or flow, a `diameter` of a flow one) is
  made and changed only through `marks:sketch` (`main/sketches/ipc.ts`): the window sends a `SketchDraft`, main reads it
  (`readSketch`, the one reading the marks file shares: at most 200 strokes, 400 points a stroke and 20 000 in all, a name of
  80 characters on one line, planes orthonormal within 1e-6, set right and refused when worse) and checks it against the
  **last build** (`checkSketch`). A stroke the sketch already had (same by value, the points to 0.011 mm) is taken from what
  main stored, its `touches` and its build with it; only a stroke that is new or changed must be of the last build and have
  its snaps borne out: the ref must exist (`V<i>` a vertex of the part's `points`, `E<i>` an edge), and the point must be
  within 0.01 mm of what the snap data says (the part's `loc` applied; `projected` is that point put on the stroke's plane),
  which main then keeps in its place. A snap to an edge that is neither a line nor a circle, or that says `approx`, is checked
  for its ref alone and is kept as `approx: true`. What each new stroke touches (`touches`, faces by ref) is main's: a `nearest`
  query on up to 8 points along it (`main/sketches/touches.ts`), `[]` when the kernel cannot say. `id`, `author`, `status`,
  `sentBefore`, `picture` and `touches` are never taken from the window. `MarkStore.saveSketch` makes (no `id`) or replaces
  (the person's sketch; `{ author: 'agent' }` replaces only the agent's, adds it as `sent`, and needs no snaps) and sets
  `sentBefore` on a sent one, `reopened` on a resolved one, as `editNote` does; `add` refuses a sketch. Its card's picture
  is the window's PNG (`marks:sketchPicture`), written by `writeNoteFile` as `k-<12 hex>.png` in `.torno/notes/`
  (`SKETCH_PICTURE`) and set by `setSketchPicture`, which lists the one it replaces in `notes/dropped.json`; the notes sweep
  knows a sketch's `picture` as live, and a removed sketch's as kept for an undo. `marks:sketching` only records which
  sketch of an object is open (`openSketch(objectId)`, in memory, forgotten with the workspace). A sketch is checked against a
  build like a stroke is: its `anchor` (the first point on a face) is the anchor, and up to 8 points along each surface stroke
  (up to 8 strokes) are asked about; a stroke on a plane is never judged.
- "OK all" is `MarkStore.acknowledge(objectId, ids)`: every id checked as `update` checks one (resolved, by
  the agent), all of them acknowledged in one change (one atomic write, one `changed`), or none and a refusal
  that names the first that is not the agent's to acknowledge. Only the person asks it (`marks:acknowledge`);
  no MCP tool does.
- A delete is undone by `MarkStore.restore` (`marks:restore`): the store keeps, in memory only, the mark removed
  last of each object, whole (`MAIN_ONLY_KEYS` as main had them), with a region's bits (`removeMark` reads them
  first); restoring puts it back by its number in one change (a region's mask is written first, `restoreMark`),
  only that mark and once, and `forget` clears it.
- After every successful build, and when a mark is added, reopened or put
  somewhere else, the marks are checked against the build
  (`src/main/marks/reanchor.ts`, one `nearest` query per layout). A mark stays
  where it was put on its part; its ref and descriptor are refreshed;
  `anchorState` says `drifted` or `orphaned`. Whatever reports a mark says so:
  the agent is told nothing it cannot rely on.
  - The one way a mark moves: its anchor records how far its part was spread
    for display (`Anchor.arranged`, zeros for a part that was not moved), and
    when a build spreads the part otherwise, everything the mark holds moves
    by the difference before it is judged. An anchor that records none (a
    mark from before) is not moved: the check records it. Main sets
    `arranged` (`asPlaced`), never the window.
  - A tag the model gives a face or an edge (`Part.tags`, from `tags(p, parts)`; `shared/tags.ts`) is kept on the
    anchor of a mark placed on that one (`Anchor.tag`): main says it from the build the ref is of (`withTag`, in
    `asPlaced`, `asReplaced` and `anchorFor`), never taken from the window or a tool. A check looks for it first:
    when the build's part has the tag and it names exactly one face or edge, the anchor is on that (`ref`,
    `edge`, normal, descriptor, `between` refreshed; `nearest` is asked `face` or `edge` of it, so the answer says how
    far the point is), `ok` however far it moved, and its point stays while it is within reach (the part's
    `tolerance` of a face, `EDGE_TOLERANCE_MM` of an edge) and else is set on the nearest point of it. Without the
    tag, or with a tag of several, the nearest-point rule judges it as ever and the tag stays on the anchor for a
    build that gives it back. The tools take `<part>/@<tag>` (`checkRef` gives the face's own ref beside the tag;
    `highlight` and `ask` take a tag of several as its refs; the kernel resolves the tag itself for `describe` and
    `measure`).
  - A check writes what it judged each mark from; `MarkStore.reanchor` passes
    over a mark whose anchors are no longer those (it was put somewhere else
    meanwhile).
  - `checkedRevision` is the build a mark was last checked against. An open
    mark with any other than the last build's is unchecked (`isUnchecked`),
    and every report of it says so. Revisions count from 1 in every run, so
    the store drops what a file says of it when the file is read. A check
    that could not say of every mark is tried again after 2, 10 and 30 s
    (`retrying`), until the workspace is closed; and every 30 s beyond that
    while the kernel only answers that its worker is still busy (`isBusy` in
    `kernel/client.ts`: the check resolves `'busy'`).
  - A pin whose point is on an edge is on that edge (`judgePin`): its anchor
    has `edge` and, when two faces meet there, `between`.
- Status: `draft` until a `UserPromptSubmit` hook has carried the mark to the
  agent of its own object (`src/main/context.ts`; turned `sent` only once the
  answer has left), then `resolved`. Nothing else consumes drafts. A sent
  mark of the person's whose note or shape changes is a draft again
  (`sentBefore`: told as `(changed)`), as is a dimension of the agent's whose
  `expected` or `tolerance` the person changes; and one the person makes a
  draft again after it was resolved says so until it is sent (`reopened`:
  told as `(reopened by the user)`).
