---
paths:
  - "app/src/main/marks/**"
  - "app/src/shared/marks.ts"
  - "app/src/shared/tags.ts"
  - "app/src/shared/tags.test.ts"
  - "app/e2e/marks*.spec.ts"
  - "app/e2e/reanchor.spec.ts"
---

# Marks: the store, checking them against a build, their status

Moved as written from the folder `CLAUDE.md` files; each heading names the folder it came from, and paths are written as they were there (see "Rules by area" in the root `CLAUDE.md`).

## What crosses processes (root `CLAUDE.md`)

- A mark is a pin, a pick, an arrow, a stroke, a shape, a dimension or a region
  of a scan, with a note (`app/src/shared/marks.ts`). Ids are `M1`, `M2`, … per object, never reused,
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
