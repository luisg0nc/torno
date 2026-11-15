---
paths:
  - "app/src/renderer/viewport/Viewport.ts"
  - "app/src/renderer/viewport/picking.ts"
  - "app/src/renderer/viewport/picking.test.ts"
  - "app/src/shared/view.ts"
  - "app/src/shared/cut.ts"
  - "app/src/shared/cut.test.ts"
  - "app/src/renderer/viewport/section.ts"
  - "app/src/renderer/viewport/section.test.ts"
  - "app/src/renderer/tools/sectionTool.ts"
  - "app/src/renderer/ui/SectionBar.tsx"
  - "app/src/renderer/ui/Field.tsx"
  - "app/src/renderer/ui/Field.test.ts"
  - "app/e2e/section.spec.ts"
---

# The section plane, and drawing a cut

Moved as written from the folder `CLAUDE.md` files; each heading names the folder it came from, and paths are written as they were there (see "Rules by area" in the root `CLAUDE.md`).

## Section (`app/src/shared`)

- One plane per object view (`SectionPlane` in `shared/view.ts`: `origin` and
  a unit `normal`, object frame; what is on the side the normal points to is
  not drawn). It is view state: `store.section`, saved in `scene.json`
  (`section`), reported in `ViewState`, drawn in `look` pictures unless they
  ask for another plane or none. The agent's `show` sets it for now, never in
  the saved file. It never changes geometry or marks.
- Numbers shown or told of a section go through `shared/format.ts`.
- A section and an explode are never on together (Explode, below): cutting
  puts the parts of the layout shown together, and nothing is drawn apart
  while the section is there.

## Section (`app/src/renderer`)

- Drawing is `viewport/section.ts`: the parts' materials are clipped, and each
  closed solid (`BuiltPart.solid`) gets its cut face by stencil counting, per
  part, with an outline from the mesh. A part that is no closed solid is cut
  open. What lies in the plane is kept (`KEPT_WITHIN_MM`); a part the plane
  only touches or leaves nothing of is not drawn (`keepsNothing`). Marks,
  grid and gizmo are not cut; a mark anchored in the half taken away is drawn
  dimmed (`MarkLayer.setSection`). The cut face is hatched: a 45 degree line about 6 px apart in the part's edge
  colour (`hatchCap`, a shader patch of the cap's material, in screen space so it reads at any zoom; the gap is
  6 px times the pixel ratio on the screen, 6 px in a picture's target). Pictures draw the same scene, so they have it.
- Picking sees what is drawn (`pickUnder`): on a cut face nothing is hit and
  the pointer says so.
- Taken in hand with nothing cut (`X`), the Section tool cuts at once: `newCut` (`shared/cut.ts`) puts the
  plane through the middle of the parts (to 0.01 mm), across the axis the camera looks most along, open
  towards the viewer (`towardsViewer`: the half taken away is the one on the camera's side). The bar's X, Y
  and Z and an exported page's cut ask the same rule. What that rounding leaves is no distance: the bar tells a
  plane within 0.005 mm of the middle of the parts as at it, `0` (`sectionOffset`).
  The bar's number is the plane's place as the agent is told it (`placeOf`, `atPlace`): across an axis its
  coordinate in the object frame (`y = 20`, the letter in its axis colour), else the offset along the normal from
  the middle, said so. The slider stays in offsets, with a tick at the middle and a "Middle" button.
- A number field gives the keys back to the view on Enter and on Escape (`giveKeysBack` in `ui/typing.ts`),
  and keeps what was typed once (`toKeep` in `ui/Field.tsx`).
- The Section tool (`tools/sectionTool.ts`) moves the plane only by a drag
  that starts on its handle; any other drag turns the camera. The bar is
  `ui/SectionBar.tsx`. The plane moves in the viewport during a drag and is
  kept in the store once, on release, to the millionth of a millimetre. The
  bar's number and slider follow the plane as it is drawn, through
  `Viewport.onSectionMoved`, never through React. The cursor over the handle
  is the resize cursor nearest to the way its arrow points on screen
  (`handleCursor`), and `ns-resize` where the view looks along the normal and
  the drag goes by the pointer's height.
