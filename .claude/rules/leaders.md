---
paths:
  - "app/src/shared/leader.ts"
  - "app/src/shared/leader.test.ts"
  - "app/src/renderer/ui/LeaderLayer.tsx"
  - "app/src/renderer/state/leaders.ts"
  - "app/src/renderer/state/leaders.test.ts"
  - "app/src/renderer/styles/leaders.css"
  - "app/src/shared/tagPlace.ts"
  - "app/src/shared/tagPlace.test.ts"
  - "app/src/renderer/ui/view/Tag.tsx"
  - "app/src/renderer/ui/view/useTagAt.ts"
  - "app/src/renderer/ui/view/useTagAt.test.ts"
  - "app/src/renderer/ui/notePlacement.ts"
  - "app/src/renderer/styles/tags.css"
---

# Leaders

A leader ties a control or a reading to the thing it is about, as a callout does on a drawing (spec 2026-11-18, section 1).

- **Shape.** A 3 px ring on the subject (`--raise` fill, 1.5 px accent stroke), one straight leg, a 12 px shoulder into the nearest edge of the tag. No curves, no arrowheads; the line is 1 px in `--accent`, always, and never says who made something. `shared/leader.ts` is that geometry (`leaderPath`, `crossesBoxes`): the leg arrives along the axis the subject is farthest from the tag on; null when the subject is under the tag.
- **Owner.** The tool in hand owns the leaders in the view (`setToolLeaders`), all of them at once; its tags are placed from 3D points each time the camera moves, through the overlay's projection, never through React per frame.
- **One borrowed leader** (`borrowLeader`): pointing at a ref outside the view (a chip, an option of an ask, a card row) borrows one while the pointer stays. Its leg stops at the pane's edge (`clip`) at the chip's height, which is ringed (`data-hot`), and never runs through text (`crossesBoxes`). Drawn only when its subject is on screen in the view. Marks have none.
- **One layer.** `LeaderLayer` (mounted in `App.tsx`) is an SVG at the window's size, `pointer-events: none`, `z-index: 12`: over the panes, under the popovers. It draws straight into the DOM from `subscribeLeaders`, not through React.
- **Motion.** A new leader draws out once (0.24 s, `stroke-dashoffset`, after its tag's 0.2 s pop) and one that only moves does not; `prefers-reduced-motion: reduce` turns it off.

## Tags

A tag is a control or a reading that stands beside what it is about, tied by a leader (spec 2026-11-18, section 2, "Tags"). The tools' controls (Section, Measure, Explode, Compare) are tags; a mark's note is not (it has no leader, and takes only the placement).

- **Placement** is `placeTag` in `shared/tagPlace.ts`, pure, in the pixels of the view's pane: it tries the side it had (`prefer`, so a tag does not hop between sides as the camera moves), then above, right, below and left, each clamped inside the view with 60 px clear on the left (`REED_CLEAR`) and `GAP` (24 px) from the subject, and skips a side that would leave it over its subject (or short of room for the leader's shoulder) or meeting a box to avoid. With no subject, or no side that fits, it is `docked`: bottom middle of the view, 56 px above the foot (the hint's place), and its leader is not drawn. `tagSubject` turns a subject that is not in the view (off the edge, behind the camera) into none. A subject seen edge on is the tool's to pass as null: it knows its plane.
- **`placeBeside`** (`ui/notePlacement.ts`, a note beside its mark) is `placeTag` with `around` (the box it clears), `gap`, `rise` and `clearLeft: 0` (its `within` already keeps the reed clear), tried from the side with more room.
- **`<Tag id subject prefer>`** (`ui/view/Tag.tsx`) is placed after every frame of the view (`onPaneDrawn`, `projectToPane` in `viewport/overlay.ts`, bound by `ViewportPane` through `bindPane`), straight on its element, never through React. It clears the elements marked `data-tag-avoid` (the compass, a band: their own tasks set it) and the tags before it in the DOM, so that two tags never chase each other. Docked tags stack upward from the hint.
- **One writer of the leaders.** Tags publish through `publishTag` (`ui/view/useTagAt.ts`), which sets all the tool's leaders at once from the tags that stand beside a subject; nothing else calls `setToolLeaders` for a tag. `useTagAt(id, on)` is the hook for a tool's code: it is told, after each frame and not through React state, where its tag stands, so a rule or a track drawn on the overlay can hang from it.
- **Look** (`tags.css`): `--raise`, a hairline, `--radius-float`, `--float-shadow`, 4 px padding, 12.5 px text; `.tag-control` (26 px), `.tag-value` (mono 12 px on `--surface`), `.tag-sep`, `.tag-reading` (mono 19 px) and `.tag-unit`; `data-problem` makes it the problem tag below (`--fail` on `--fail-wash`). The pop (0.2 s) is on `scale`, since `transform` is the tag's place.
