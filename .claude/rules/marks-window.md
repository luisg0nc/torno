---
paths:
  - "app/src/renderer/ui/Mark*.tsx"
  - "app/src/renderer/ui/markGroups.ts"
  - "app/src/renderer/ui/markGroups.test.ts"
  - "app/src/renderer/ui/markHover.ts"
  - "app/src/renderer/ui/markHover.test.ts"
  - "app/src/renderer/ui/ResolvedSummary.tsx"
  - "app/src/renderer/ui/ChecksSummary.tsx"
  - "app/src/renderer/ui/ChecksSummary.test.ts"
  - "app/src/renderer/ui/NotePopover.tsx"
  - "app/src/renderer/ui/NotePopover.test.ts"
  - "app/src/renderer/ui/notePlacement.ts"
  - "app/src/renderer/ui/notePlacement.test.ts"
  - "app/src/renderer/tools/markChips.ts"
  - "app/src/renderer/tools/markChips.test.ts"
  - "app/src/renderer/tools/pickMarks.ts"
  - "app/src/renderer/viewport/marks/**"
  - "app/src/renderer/styles/marks.css"
  - "app/src/renderer/styles/late.css"
---

# Marks in the window: colours, rows, chips, groups, review

Moved as written from the folder `CLAUDE.md` files; each heading names the folder it came from, and paths are written as they were there (see "Rules by area" in the root `CLAUDE.md`).

## Marks (`app/src/renderer`)

- User marks are drawn in `--user-mark`, agent marks in `--agent-mark`, and
  nothing else in the UI uses those colours. A picture for the agent draws
  every mark alike: no active mark, no selection, no hover, no gizmo. A mark
  on a part that is not drawn is not drawn either, on screen or in a picture.
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
  camera stays as it is in view) and, for a draft of the person's, `actions.openNote`. A drag that starts on a chip
  is the orbit's with Select in hand. With a tool that takes presses (`ChipHost.tool`: not Select, not with the parts stale
  or apart, not with Alt) the camera is held (`Viewport.holdCamera`) from the press; past the click threshold (4 px) the
  tool is handed the press as it was made and every event after it (a tool that does not drag, as Pin, gives the camera
  back at that point), and a click still opens the row. Moves over a chip with no button held are handed to the tool too,
  with no hit, so its preview does not freeze. A press that began beside a chip is the tool's to the end. A failing dimension's chip says by how
  much it misses after its cross, in `--fail` (`40 mm ✗ 2 under`: `labelValue`'s `off`, from `offBy`), on screen
  and in a picture for the agent alike. A spec that hands a tool a press at a point checks first that no chip is
  drawn there (`__tornoTest.chipAt`, `clearOfChips` in `e2e/tools.spec.ts` and `e2e/measure.spec.ts`).
- When the project has checks (`isCheck`: an open dimension with an expected value) a line heads the Marks, outside
  the list's scroll (`ui/ChecksSummary.tsx`): `Checks on r12: 3 pass · 1 fails · 1 not measured`, each count a
  button to the first such check (`goToRow`), in `--ok`, `--fail`, `--warn`, never a mark's colour. The not
  measured count is said only when it lasts (`useLasting`, as the status line's does). The group "Checks"
  (`groupMarks(marks, revision).checks`) holds those checks, drafts too (their row says `to send`), the failing first, then
  those with no value of the build, then those that pass, ahead of the other groups; a dimension with nothing
  expected stays in the group its status gives. An open check lists what it measured on the builds of this run
  (`dimension-history`, `r9 38.6 ✗ · r10 40 ✓`, at most 8, all in its title) and, where worth saying, `fails since
  r12; passed on r11` (`since`); both are main's `history`, never kept by the window.
- The Marks list is grouped by what is to be done (`ui/markGroups.ts`): "To send" (drafts, headed `To send N · with your next prompt`),
  "From the agent" (its own open marks, for the person to read or answer: "Answer in chat" puts the id in the
  prompt), "To review", "With the agent" (the person's sent marks) and the fold "Resolved"; a heading only for a group that has marks, and the heading says
  the status, so a row has no status word but a pinned dimension's `pinned`, which is never cut. "To review" is
  one summary (`ui/ResolvedSummary.tsx`): "The agent resolved N marks.", "Review" walking them (an index held in the
  component over the ids as they were: `Reviewing 1 of 5 · M5`, the mark active and `focusMark`ed, its row with OK,
  `Reopen…` and Skip; Reopen opens the note at its end and writes note and `status: 'draft'` in one `update` when the
  field is left; the end says `Reviewed 5: 4 OK, 1 reopened` for 10 s), and "OK all" (`marks.acknowledge`, no key).
- A row's resolve is a tick in a box (`ResolveIcon`), never the bare tick of a passing check; on a dimension with an
  expected value it asks in the row first (`Confirm`). Delete is immediate and the panel offers `Deleted M3 · Undo` for
  10 s (`marks.restore`), no key.
- A mark's row is one line, its note cut to the room there is, and the active row (`aria-current`) shows its
  note whole, wrapped on a line of its own (`late.css`). Its chip is the id alone (`rowLabel`): `~` and `?` are
  the view's chips' and the pictures' (`labelText`). What the last build did to its mark (`moved:
  check it`, `its part is gone`) is a line of its own under the note (`.mark-anchor`, `late.css`). The Marks list never scrolls sideways (`e2e/reanchor.spec.ts`, with a note longer
  than the column). A dimension opened out leaves its value and verdict to its fields under the first line, so
  that `Add a note` is whole beside the buttons of the row (`marks.css`, `e2e/measure.spec.ts`).
