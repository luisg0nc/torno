---
paths:
  - "app/src/shared/views.ts"
  - "app/src/shared/views.test.ts"
  - "app/src/main/scenefile.ts"
  - "app/src/main/scenefile.test.ts"
  - "app/src/shared/scenefile.ts"
  - "app/src/main/mcp/viewTools.ts"
  - "app/src/main/mcp/views.ts"
  - "app/src/main/mcp/views.test.ts"
  - "app/src/renderer/ui/ViewsStrip.tsx"
  - "app/src/renderer/state/savedViews.ts"
  - "app/src/renderer/styles/views.css"
  - "app/e2e/views.spec.ts"
---

# Saved views: the file, whose a view is, the agent and the strip

Moved as written from the folder `CLAUDE.md` files; each heading names the folder it came from, and paths are written as they were there (see "Rules by area" in the root `CLAUDE.md`).

## Views (`app/src/shared`)

A saved view is how an object was looked at, kept under a name (`SavedView` in
`shared/views.ts`): the camera, the layout, the names of the parts switched
off, a section or an explode, and how each scan is shown (`visible`,
`opacity`). The views of an object are in its `scene.json` (`views`, in the
order they were saved): 24 at most of the person's (`MAX_VIEWS`: those they
made or kept), and beside them at most 12 proposals of the agent's
(`MAX_PROPOSALS`), which take no place of theirs. The person at 24 is told so
where they ask for one more (the field, or under the strip for "Keep"); the
agent is never told to remove a view.

- **View state only.** Applying a view changes no geometry, no mark and no
  measurement, and starts no build. It holds a section or an explode, never
  both: saving while there is a section keeps the section; `savedViewOf`
  keeps the section of a file that says both; `save_view` given both is
  refused with `VIEW_NOT_BOTH`, which says which to leave out.
- **`hidden` is by name, and of the parts switched off**, not of those on: a
  part the model gains later is in the view, as it is on screen. A view
  names its layout, its hidden parts and its scans; what of that is gone
  when it is applied is passed over and said, never in silence (`viewGone`,
  one rule for the strip, the tools and `state.md`). The chip says `2 parts
  gone`; the reply of `look` and `show` names them after the caption
  (` · passed over, of the view "Hinge side": the part clip, which layout
  assembly no longer has`); an explode kept of a layout that can no longer
  be drawn apart is passed over the same way (`ViewGone.explode`: the chip
  says `not drawn apart`, and such a view is on while its parts are
  together). What a file brings in is held to what can be told and drawn
  (`savedViewOf`): a layout of more than a line is no view, a hidden name of
  more than a line is dropped, a camera beyond ±1e9 mm is none and its zoom
  is kept within 0.001 to 1000. A view whose layout is gone
  stays in the strip, cannot be applied and says why. A file with a broken
  view loses that view only.
- **A name** is trimmed, one line with no control character, 1 to 40
  characters, never `current` or a standard view's (`RESERVED_VIEW_NAMES`),
  and unique in the object whatever the case (`findView`); it is shown as
  written, without what does not show or turns its reading (`cleanViewName`:
  a name of nothing that shows is no name). `viewNameRefusal` is the one rule, for the field, the store,
  main and the window's answer to the agent.

## Views (`app/src/main`)

- **`scene.json` is the window's to write**, and main never writes one of
  its own accord. Main keeps the file of each folder as it last read it or
  was given it to save (`sceneFileNow` in `main/scenefile.ts`), and answers
  `scene`, `look {view}`, `show {view}`, `save_view` and `state.md` from
  that. The window gives the file to main at once when the views change
  (not after the 500 ms of the other edits), so what main tells of them is
  true as soon as a tool is answered. A read of the disk never replaces a
  file given while it was under way, and the first save of a folder main has
  not read is held against the file on the disk. `forgetSceneFiles` when the
  workspace is closed.
- **Whose a view is.** `author` is `user` or `agent`; `proposed` (only ever
  true, only on an agent's) says the person has not kept it yet. Both are
  main's to vouch for, never an argument of a tool (`save_view` has neither
  key, and the wrapper refuses them) and never taken on the window's word
  alone: `saveSceneFile` lets a view be the agent's, or proposed, only when
  main asked the window to keep it for the agent (`proposalAsked`, through
  `proposing`: the name is let go of only when the window has answered, never
  on a timeout, so a view the window keeps late is the agent's proposal
  still) or the file already said so of that view (`owned`); anything else the window
  calls the agent's is the person's, and a kept view is never proposed
  again. A file read from the disk is taken as it is.
- **The agent** lists the views in `scene` (`viewSummary`: `name`, `by`,
  `proposed`, `layout`, `section` or `exploded`, `hidden` as a count,
  `note`), draws one with `look {view: "name"}` and puts one on screen with
  `show {view: "name"}` (`namedView` in `mcp/viewTools.ts`). Any text that
  is neither `current` nor a standard view is a name; one that is no view is
  refused with the names there are. `look` then draws exactly that view
  whatever the screen shows (it passes the view's own section, or null, and
  its own explode, or null: nothing of it is `'current'`), and the caption
  names it in quotes (`viewSaid`). `show` applies it for now, by the rule
  every `show` follows (`showForAgent`): the scene file goes on saying what
  the person had, and the view's chip is the one that is on
  (`actions.viewShown`). What is given beside the name wins, and a section
  or an explode given takes the place of the other (`section: 'current'`
  cuts only when the user has a section). A picture draws the scans the
  view switches on, each as thin as it is on screen, and says so where the
  view has one otherwise (`how thin it has S1 (50 %), which is drawn as thin
  as the user's screen has it`).
- **`save_view` proposes.** Main checks the name, the layout, the parts, the
  plane and the explode; the window (`proposeView` in `state/agent.ts`)
  builds the view from the request and from what is on screen for what the
  request leaves out (the camera is where it is going when `show` has just
  sent it somewhere: `Viewport.cameraGoal`, which the strip's save and
  update use too), keeps it as the agent's and proposed
  (`actions.proposeView`, whatever the view says of itself), and gives the
  scene file to main at once. The tool answers once that file is on the
  disk, and with an error that says so when it could not be written.
  Nothing on screen changes. The agent may
  replace its own proposal of a name, never a view the person made or kept
  (refused, naming theirs). One more proposal than 12 drops the oldest of
  them, and the reply says which.
- `state.md` names the views in a line, with what of each is gone.

## Views (`app/src/renderer`)

- **The person** saves what is on screen (`actions.saveView`, also where the
  agent's `show` has it otherwise: they save what they see), over any view
  of that name ("Replace"), which is theirs from then on; renames, updates
  to what is on screen and deletes (asked twice) from the chip's menu.
  `actions.applyView` is one edit of theirs: the layout first, every part of
  it on but those hidden, the section or none, the layout's explode or
  together, each scan still there as the view has it; `shownByAgent` is
  cleared, and what the view does not set is as the person had it
  (`sceneFileOf`). The caller then moves the camera
  (`viewport.setView(view.camera, true)`).
- **The strip** (`ui/ViewsStrip.tsx`, the last child of `.viewbars`,
  `role="toolbar"`): a chip per view (`button.view-chip[data-view]`), the
  one that is on marked (`aria-pressed`: `activeView`, while the screen
  still shows what it holds, `viewMatches`, and until the camera rests
  somewhere else, `actions.cameraSettled`), and "+ Save view" with one field.
  Six chips at most (`stripChips`: the one that is on, then the proposals,
  then the others as saved, shown in saved order), each name cut at 160 px
  and whole in the tooltip; with more views a chip `18 more` opens the list
  of all of them, a row each with what it holds. The strip is two rows at
  most at the default pane (`views.spec.ts` holds it to that with 26). Its
  menus take the focus, the arrows, Home and End; Escape and every action
  give the focus back to the chip, and never reach the pane's own Escape.
  A proposal is drawn dashed with the word `proposed`, "Keep" and
  "Discard": in no mark's colour, as a view is not a mark. The digits are
  not bound to the saved views: `1` to `4` are the standard views.
