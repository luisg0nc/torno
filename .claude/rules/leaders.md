---
paths:
  - "app/src/shared/leader.ts"
  - "app/src/shared/leader.test.ts"
  - "app/src/renderer/ui/LeaderLayer.tsx"
  - "app/src/renderer/state/leaders.ts"
  - "app/src/renderer/state/leaders.test.ts"
  - "app/src/renderer/styles/leaders.css"
---

# Leaders

A leader ties a control or a reading to the thing it is about, as a callout does on a drawing (spec 2026-11-18, section 1).

- **Shape.** A 3 px ring on the subject (`--raise` fill, 1.5 px accent stroke), one straight leg, a 12 px shoulder into the nearest edge of the tag. No curves, no arrowheads; the line is 1 px in `--accent`, always, and never says who made something. `shared/leader.ts` is that geometry (`leaderPath`, `crossesBoxes`): the leg arrives along the axis the subject is farthest from the tag on; null when the subject is under the tag.
- **Owner.** The tool in hand owns the leaders in the view (`setToolLeaders`), all of them at once; its tags are placed from 3D points each time the camera moves, through the overlay's projection, never through React per frame.
- **One borrowed leader** (`borrowLeader`): pointing at a ref outside the view (a chip, an option of an ask, a card row) borrows one while the pointer stays. Its leg stops at the pane's edge (`clip`) at the chip's height, which is ringed (`data-hot`), and never runs through text (`crossesBoxes`). Drawn only when its subject is on screen in the view. Marks have none.
- **One layer.** `LeaderLayer` (mounted in `App.tsx`) is an SVG at the window's size, `pointer-events: none`, `z-index: 12`: over the panes, under the popovers. It draws straight into the DOM from `subscribeLeaders`, not through React.
- **Motion.** A new leader draws out once (0.24 s, `stroke-dashoffset`, after its tag's 0.2 s pop) and one that only moves does not; `prefers-reduced-motion: reduce` turns it off.
