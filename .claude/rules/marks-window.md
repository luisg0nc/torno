---
paths:
  - "app/src/renderer/ui/Mark*.tsx"
  - "app/src/renderer/ui/markGroups.ts"
  - "app/src/renderer/ui/markRows.tsx"
  - "app/src/renderer/ui/card/NeedsYou.tsx"
  - "app/src/renderer/ui/markGroups.test.ts"
  - "app/src/renderer/ui/markHover.ts"
  - "app/src/renderer/ui/markHover.test.ts"
  - "app/src/renderer/ui/ResolvedSummary.tsx"
  - "app/src/renderer/ui/NotePopover.tsx"
  - "app/src/renderer/ui/NotePopover.test.ts"
  - "app/src/renderer/ui/notePlacement.ts"
  - "app/src/renderer/ui/notePlacement.test.ts"
  - "app/src/renderer/ui/Review*.tsx"
  - "app/src/renderer/ui/Review*.test.ts"
  - "app/src/renderer/ui/IntentMenu.tsx"
  - "app/src/renderer/ui/review/**"
  - "app/src/renderer/ui/chat/ReviewChip.tsx"
  - "app/src/renderer/state/review.ts"
  - "app/src/renderer/state/review.test.ts"
  - "app/src/shared/reviews.ts"
  - "app/src/main/reviews/**"
  - "app/src/renderer/tools/markChips.ts"
  - "app/src/renderer/tools/markChips.test.ts"
  - "app/src/renderer/tools/pickMarks.ts"
  - "app/src/renderer/viewport/marks/**"
  - "app/src/renderer/styles/marks.css"
  - "app/src/renderer/styles/card-needs.css"
  - "app/src/renderer/styles/card-marks.css"
  - "app/src/renderer/styles/late.css"
---

# Marks in the window: colours, rows, chips, groups, review

Moved as written from the folder `CLAUDE.md` files; each heading names the folder it came from, and paths are written as they were there (see "Rules by area" in the root `CLAUDE.md`).

## Marks (`app/src/renderer`)

- User marks are drawn in `--user-mark`, agent marks in `--agent-mark`, and
  nothing else in the UI uses those colours. A picture for the agent draws
  every mark alike: no active mark, no selection, no hover, no gizmo. A mark
  on a part that is not drawn is not drawn either, on screen or in a picture.
- **What is selected is in the head of the route card** (`ui/card/InHand.tsx`, `ui/card/headKind.ts`, `styles/card-hand.css`; `ui/Selection.tsx` is its logic, `useSelection`, not a bar: nothing of the
  selection floats over the view). `headKind({ refs, sketchOpen, roundOpen, makingSet })` says what the head holds, in the order sketch, review, makeSet, selection, empty; the
  sketch and the review round are the panels `HandView` is given as `children` (`SketchPanel`, `data-head="sketch"`; `RoundPanel`, `data-head="review"`; `HeadPanels` keeps a round that is up mounted but `hidden` while a sketch holds the head, so its Compare and its note being written survive the sketch), with no "In hand" and no refs beside them; a set being named still opens its box under the panel (Ctrl+G on a sketch's strokes). The sketch is in hand while the tool is Draw and a sketch is open (`useSketching.open`), the round while `useReview.panel` names one; neither floats over the view. `headMaxHeight(cardHeight)` is the 60 % cap (`.route-hand`). The pure `HandView` draws "In hand", `2 picked, shift-click adds`, each ref
  (mono 11.5 / 10.5, on `--accent-wash`; `SHOWN_REFS` = 4, then "and N more") and **Insert in prompt**, **Note each** (**Note** for one), **Name a set** and **Clear**. Insert is off without a session or on a stale build, Note on a stale build or
  while the parts are apart or being made, each with its reason in its tip. The camera `note` needs is the view's (`viewHost().camera()`). The head is `role="group"` `aria-label="Selection"`.
- A mark's row and its chip in the view point at each other. The pointer on a row or chip, or the keys' focus in a
  row (on one of its buttons, `:focus-visible` only: a click on a button focuses it too, and is the pointer's; a
  note being typed is not), is the store's
  `hoveredMark` (`hoverMark`/`unhoverMark` of `ui/markHover.ts`, called as they go on and off, never per move; the
  pointer's mark first, else the focus's, and each lets go only of its own): the row has its hover background
  (`data-hovered`), the chip a fainter ring than the active one's (`drawLabels`'s `hovered`), and the faces the
  mark is on are lit by `peek`, as a ref chip of the chat lights them: no agent line, no locked tools.
  A click on a row is `actions.selectMark` (the mark active, its layout shown): the camera moves to the view it was
  placed from only when its label is not in view (`markReveal`, `Viewport.revealMark`, `needsCamera`). "Go to its
  view", the reticle of the row, and a mark's chip in the chat are `actions.focusMark`, which always goes there.
- **The chips in the view answer the pointer before the tool in hand** (`tools/markChips.ts`, first in the one
  pointer subscription of `ViewportPane`; an event it takes, no tool is told of). Hit-testing is of the chips as the
  last frame placed and drew them (`OverlayPass.markAt`, `chipAt` of `viewport/marks/labels.ts`), never worked out
  again per move. On a chip the cursor is `pointer`, the mark is `hoverMark`ed as from its row, and the readout says
  `chipSays` (a note in the face of the UI, `Readout.note`, one line cut to its width; a dimension's numbers as a
  ref's). A click opens it whatever tool is in hand (the head ruling of #74): `goToRow` (active, row in view, the
  camera stays as it is in view) and, for a draft of the person's, `actions.openNote`; for a 3D sketch of theirs that is a draft, `editSketch` instead, since its comment is in the sketch panel (a sent one only opens its row; its Edit button opens it). A drag that starts on a chip
  is the orbit's with Select in hand. With a tool that takes presses (`ChipHost.tool`: not Select, not with the parts stale
  or apart, not with Alt) the camera is held (`Viewport.holdCamera`) from the press; past the click threshold (4 px) the
  tool is handed the press as it was made and every event after it (a tool that does not drag, as Pin, gives the camera
  back at that point), and a click still opens the row. Moves over a chip with no button held are handed to the tool too,
  with no hit, so its preview does not freeze. A press that began beside a chip is the tool's to the end. A failing dimension's chip says by how
  much it misses after its cross, in `--fail` (`40 mm ✗ 2 under`: `labelValue`'s `off`, from `offBy`), on screen
  and in a picture for the agent alike. A spec that hands a tool a press at a point checks first that no chip is
  drawn there (`__tornoTest.chipAt`, `clearOfChips` in `e2e/tools.spec.ts` and `e2e/measure.spec.ts`).
- **A view note's row** (`MarkRow`'s `NoteThumb`): beside its number the small picture with its ink (`notes.picture(…, 'ink')`
  through `ui/chat/useNotePicture.ts`, asked again when the note's `ink` file changes; an empty frame that says so when the
  file is not on this computer), then its comment as the row's note. Its status is the heading of its group, as any mark's.
  The pointer on the row lights the faces under its ink and the heads of its arrows, as the chat's chip does (`refInfo`'s
  `noteLights`: each face of `under` once, at most 60, and only those the build shown still has: a part gone, a part switched
  off or a face index past the part's count lights nothing, so a note drawn on an earlier build lights what is left of it;
  none for a note of another layout than the one shown). A click on the row and "Go to" go to the note's camera as any mark's do.
- **A 3D sketch** (`kind: 'sketch'`): its row is `MarkRow`'s `SketchSummary` (name, take with the diameter of a flow, `countsText`; the words are `shared/sketchText.ts`, one wording for the row, the card, the note's subject and the chip) with an Edit button for the person's own (`editSketch`; Claude's is never edited). It is drawn by `markObjects` (`addSketch`): a `Parts.stroke` line each, 2.5 px, with the casing, its behind pass drawn dashed only when the stroke has `xray` and not drawn otherwise (`userData.hiddenBehind`, shown again by `setDimmed`), a `snap` dot at each snapped point, and for a flow with a diameter a `tube` (`TubeGeometry`, `TUBE_OPACITY` 0.25) along each stroke. The pointer on its row or chip lights its strokes (`setLit`: wider, as the active mark's are), and the row of a plane in the sketch panel lights only that plane's (`MarkLayer.setLitPlane`, `sketchStore.lit`); a picture for the agent lights nothing (`MarkLayer.setLights(false)` in `asPictured`).
  The missing pictures of its card are drawn by `state/sketchPictures.ts` (`MissingPictures`, wired in `ViewportPane`): when a project is shown, each sketch with strokes and no `picture` is drawn from its camera as `look` does, one at a time, each in a turn of its own (a 30 ms timer, never in a frame), not while a sketch is open, and once per run of the project for each sketch; main keeps it (`marks:sketchPicture`).
- A check (`isCheck`: an open dimension with an expected value) is listed under Checks (`ui/card/Checks.tsx`, `checks-and-profile`),
  not under Marks: `groupMarks(marks, revision).checks` holds them, drafts too (their row says `to send`), the failing first, then
  those with no value of the build, then those that pass; a dimension with nothing expected stays in the group its status gives.
  An open check lists what it measured on the builds of this run (`dimension-history`, `r9 38.6 ✗ · r10 40 ✓`, at most 8, all in
  its title) and, where worth saying, `fails since r12; passed on r11` (`since`); both are main's `history`, never kept by the
  window. A `MarkRow` carries `data-lit` (the accent wash and a 2 px bar at its left, `card-marks.css`) while the pointer is on a
  part the mark is on (`useLitRows`, given to the rows by `useMarkRows`).
- **Who acts next** (`ui/markGroups.ts`): `groupMarks` is the rule (its `failing` is the checks that fail on the build on show), and
  `splitMarkGroups(groups)` says where each group goes: `needs` (`toReview`, `fromAgent`, `failingChecks`) to Needs you, `marks`
  (`toSend`, `withAgent`, `resolved`) to Marks. The other checks (`groups.checks`) are the Checks section's. A heading only for a
  group that has marks, in Marks; a row has no status word but a pinned dimension's `pinned`, which is never cut.
- **Needs you** (`ui/card/NeedsYou.tsx`, in the `needs` section): `ResolvedSummary` (the marks to review, a row each, `source`
  `to review`; the line over them says `The agent resolved N marks.` with Review (the walk: an index held in the component over the
  ids as they were, `Reviewing 1 of 5 · M5`, the mark active and `focusMark`ed, its row also with Skip) and OK all
  (`marks.acknowledge`, no key); the end says `Reviewed 5: 4 OK, 1 reopened` for 10 s), then the marks from the agent (`source`
  `from Claude`, the list is named `From the agent`), then one line for each check that fails (`CheckPointer`: a dimension's chip or
  the model's bar in `--agent-mark`, the words, `fails`), which goes to its row (`goToRow`, or the model's row under Checks). A
  row's resolution reads `Resolved by Claude` (in `--agent-mark`, 500) with the agent's line, then OK and `Reopen…`; Reopen opens the
  note at its end and writes note and `status: 'draft'` in one `update` when the field is left. Both sections draw rows with
  `useMarkRows(where)` (`ui/markRows.tsx`), which also holds what main refused and the undo line, said in the section the change was
  made from.
- A row's resolve is a tick in a box (`ResolveIcon`), never the bare tick of a passing check; on a dimension with an
  expected value it asks in the row first (`Confirm`). Delete is immediate and the panel offers `Deleted M3 · Undo` for
  10 s (`marks.restore`), no key.
- A mark's row is two lines (`marks.css`): `.mark-line` (the chip, the note cut to the room there is, the dimension's value, the
  source) and `.mark-meta` (the kind of mark, `.mark-kind`, with `aria-label`, and what the last build did to it: `moved: check it`,
  `its part is gone`, `.mark-anchor`, and the other `.mark-layout` words, muted 11.5 px, wrapping). The active row (`aria-current`)
  shows its note whole, wrapped, and its buttons as words (`.mark-act-word`) in a line of their own under the meta; on the other rows
  the buttons are icons over the end of the first line while the row is pointed at or holds the focus. A mark the agent resolved keeps
  the icons: its OK and `Reopen…` are in its resolution. Its chip is the id alone (`rowLabel`): `~` and `?` are the view's chips' and
  the pictures' (`labelText`). The Marks list never scrolls sideways (`e2e/reanchor.spec.ts`, with a note longer than the column). A
  dimension opened out leaves its value and verdict to its fields under the meta line (`marks.css`, `e2e/measure.spec.ts`).
- **What the person says of a mark: want and don't want** (`markIntent`, `shared/marks.ts`; the person's marks only, Claude's
  is never one, a shape's `add` is want and `remove` don't want). A mark keeps its author's colour and no new colour is
  made: don't want is hatched, want is solid, and both say it in the chip, `− M8` / `+ M8` (`labelText`, `rowLabel`, the sign
  in the face of numbers, `INTENT_CHIP`). The hatch is `viewport/marks/hatch.ts`, stripes cut by the fragment shader from the
  pixel's place on the screen: a don't want shape's fill and a flow's tube (`build`), the faces of a don't want pick (the
  `userDont` layer of `Highlights`, `MarkLayer.pickRefs(...).dont`) and a don't want region on its scan (`KeptRegion.dont`);
  its lines, a stroke's, an arrow's and a sketch's, are dashed (`setDashed`). A person's row has an intent menu
  (`ui/IntentMenu.tsx`: `marks:setIntent`, a shape has no plain), says `in review, not sent` while it is a draft of a round that
  has not gone, and offers "Take out of R1" (`marks:roundOut`).
- **A round and its bar** (`state/review.ts`, `ui/ReviewBar.tsx`). `useReview` is what main last said of the rounds (`marks:changed`,
  `marks.rounds`) with the window's own choice (plain, don't want, want) and the panel that is open. While a round is open the bar
  is the review band at the top left of the view (`Reviewing h41`, the three ways as pens with their keys, `3 − · 2 +`, End, Send review); every place a mark is
  made asks `reviewActions.intentForNew(layout)` (`commitMark`, a new sketch's first send, a note's draft, a region kept) and says
  it in the draft, and main checks it and puts the mark in the round. The round is of one layout: elsewhere the bar says so and
  its choice is off. "Review this build" is in the Marks list (`ui/ReviewSummary.tsx`, which also lists the rounds), on the build
  row of the chat, and `marks.review`; the choice has `review.dont` and `review.want`, the key of the one chosen taking it back to
  plain. All three are scope `window`, and none is `[` or `]`.
- **The follow-up of a round** (`ui/review/RoundPanel.tsx`, rows in `ui/review/rows.ts`). `reviewActions.openPanel(id)` (the "Open" of a round's row,
  the bar's "Items", "Open" on the head of a round's board frame) shows the panel in the head of the route card (`InHand`, `data-head="review"`; an unsent round says `goes as one prompt` and has "Send review", `reviewActions.send`, as the bar has): each item's sign (`RoundRow.sign`, its own 22 px column), chip, `where` (`whereText`: a face's ref, a part, `3 strokes on 2 planes`) in mono,, note and Claude's
  `resolvedNote`, and for one the agent resolved OK (`marks:judge` `ok`) and Still wrong (a field for a note, then "Send back":
  `still-wrong` with it, which moves the item into the next round). `acknowledged` without `judged` reads `OK (accepted)`; an item not
  resolved says `Not answered yet`. With the panel up, `actions.compare(round.build, newest)` shows the reviewed build faint beside the
  live one and `endCompare` ends it when the panel closes (only if it is still that comparing). Compare is off, with the words, when the
  history has no entry of the round's id (`the build is no longer kept`), when that id has other `sources` (`the reviewed build is not
  on this computer`) and when nothing was built since. "Start round N" (`{ carry }`) is offered for a round that was sent while none is
  open; "Open again" (`{ reopen }`) and "Send as plain marks" (`{ plain }`) while it is unsent. The chip in the composer
  (`ui/chat/ReviewChip.tsx`) shows while `sending` names a round, `Review of h41 · 3 − · 2 +`, with Remove (`{ plain }`); main clears
  `sending` when the prompt is delivered, and a refused ask leaves it. The drafts of a round not sent are not in the "Goes with your next
  prompt" line (`goingNext`).
