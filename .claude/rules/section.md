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
  - "app/src/renderer/ui/SectionTag.tsx"
  - "app/src/renderer/viewport/sectionRule.ts"
  - "app/src/renderer/viewport/sectionRule.test.ts"
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
  towards the viewer (`towardsViewer`: the half taken away is the one on the camera's side). The tag's X, Y
  and Z and an exported page's cut ask the same rule. What that rounding leaves is no distance: the tag tells a
  plane within 0.005 mm of the middle of the parts as at it, `0` (`sectionOffset`).
  The tag's number is the plane's place as the agent is told it (`placeOf`, `atPlace`): across an axis its
  coordinate in the object frame (`y 44.0 mm`, the letter in its axis colour), else the offset along the normal from
  the middle, said so. The rule's handle stays in offsets; "Middle" is in the tag's `···` menu.
- A number field gives the keys back to the view on Enter and on Escape (`giveKeysBack` in `ui/typing.ts`),
  and keeps what was typed once (`toKeep` in `ui/Field.tsx`).
- The Section tool (`tools/sectionTool.ts`) moves the plane only by a drag
  that starts on its handle (the arrow on the plane, or the square on its rule, below); any other drag turns the camera. The controls are
  a **tag** (`ui/SectionTag.tsx`, a `Tag` of `ui/view/Tag.tsx`, tied to the plane's top edge by `ruleSubject`; `subjectAt` makes it follow the plane during a
  drag). The plane moves in the viewport during a drag and is
  kept in the store once, on release, to the millionth of a millimetre. The
  tag's number and the slider's value follow the plane as it is drawn, through
  `Viewport.onSectionMoved`, never through React.
- **The rule on the ground** replaces the slider. `viewport/sectionRule.ts` holds the pure rules: `ruleTicks(min, max)` (a tick every 5 mm on the
  multiples of 5, a label every 20 mm), `handleAt(offset, min, max)` (0 to 1 along the rule), `ruleAt(box, normal, offset)` (the rule's point at an offset:
  a line along the normal beside the parts, on the ground across a horizontal axis, upright at the +x, -y corner across Z (the near right one); on the +x, +y side, the right of the view from the corner, so that the reed does not cover it, moved from the middle
  of the parts only square to the normal, so that a point of it at an offset lies on the plane that has that offset) and `ruleSubject`. `overlay.ts`
  `drawSectionRule` draws it on the overlay canvas (`OverlayPass.drawRule`, after the frame cues, not while the parts are drawn apart, never in a picture):
  the line, the ticks, the labels in mono 10 px muted, and the handle, a 16 px accent square of radius 4. A rule seen end on (under 24 px) draws its handle only.
  The drag of the handle is the Section tool's (`Viewport.onSectionRuleHandle`, `sectionRuleAt`: the pointer's ray is held against the rule's own line, not the plane's centre).
  `role="slider"` "Offset along the normal" is a `div` that stands over the square (`pointer-events: none`) after every frame, for the keyboard and a screen reader:
  its arrow keys nudge as the tool's do. The caption of the tool in hand is "Drag along the rule, or the plane". The cursor over the handle
  is the resize cursor nearest to the way its arrow points on screen
  (`handleCursor`), and `ns-resize` where the view looks along the normal and
  the drag goes by the pointer's height.
- **Make a tracing of this cut** (`ui/SectionTag.tsx`, "Make a tracing" in the tag's `···` menu): the section on screen laid flat as a tracing, frozen where it was cut (`tracings:make` with
  `{ section: true }`, `main/tracings/planes.ts` `sectionFrame`). Main asks the kernel for the plane's own axes (`section` without a tracing's `axes`) and the tracing keeps that frame, so
  its outline matches the section export of the same plane. It is a tracing of the layout on view, refused when the section is of another; it does not follow the section when the tag moves it
  afterwards, and it never changes the view's section (`tracings.md`). The problem "Everything is on the cut side" is a block under the tag's controls, in `--fail` on `--fail-wash`, `role="status"`; "Make a tracing" is refused in the menu while it stands.
