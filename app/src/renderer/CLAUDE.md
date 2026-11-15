# torno: the window (`app/src/renderer`)

The UI (`ui/`), the three.js viewport (`viewport/`), the tools that point at it (`tools/`), the store
(`state/`) and the stylesheets (`styles/`: `tokens.css`, and `app.css`, which is nothing but the list of
the stylesheets by area in the order of the cascade; `styles.test.ts` holds it to that).

What binds every part of torno is in the `CLAUDE.md` at the root of the repository: read that first. Here
is the detail of this folder, under the headings it has there. Paths are from `app/`.

## Marks

- User marks are drawn in `--user-mark`, agent marks in `--agent-mark`, and
  nothing else in the UI uses those colours. A picture for the agent draws
  every mark alike: no active mark, no selection, no hover, no gizmo. A mark
  on a part that is not drawn is not drawn either, on screen or in a picture.
- Tools and keys: every key torno listens to is a row of `shared/keys.ts`
  (`KEYS`: its keys, what it does, the group the sheet lists it in, and the
  scope it is listened to in). A handler asks `pressed(e, id)` or
  `which(e, id)` and never names a key; a button or a tooltip takes its key
  from `hint(id)`; the palette's tools, the view bar's views and the gizmo's
  ways are `TOOL_KEYS`, `VIEW_KEYS` and `GIZMO_KEYS`; the sheet of keys (`?`,
  `ui/KeySheet.tsx`) is `cheatSheet()`. A tool's key is shown on its
  palette button and in its tooltip, and on the sheet of keys; nowhere else. The empty Marks section names no key: it
  says what a mark is and that it goes with the next prompt. A new key is added there first:
  `keys.test.ts` reads the sources of the window, the preload and
  `main/devkeys.ts` and fails for any read of `.key`, `.code`, `.keyCode` or
  `.which` outside `shared/keys.ts` (a handler hands the press whole to
  `pressed` or `which`; main through `pressOf`), for a key of the keyboard
  named in a source, for a key or a chord written out in a text, for two rows
  of one scope with the same key, for a key of the shape in hand that the
  viewport has too (`keyClashes`), and for a key heard while typing (scope
  `global`) that a field or the terminal would take (`typed`). The scan is by
  source text: what else in the window is called a key (a part's, a light's,
  a row's) is read through a receiver listed in the test (`NOT_A_PRESS`; a one-letter name only in the
  files `SHORT_NAMES` lists), a key taken apart (`({ key }) =>`, `const { key } = e`) is a read too, and
  its fixtures hold every spelling of a bypass it is to catch.
  `Ctrl+Shift+B` is "Rebuild" (`rebuild`, heard everywhere; while a build runs the button reads
  "Building…" and neither it nor the key nor `Builds.rebuild` starts one over; the button is in
  the status line, `ui/BuildStatus.tsx`); main's sentences name it by
  `REBUILD_HOW` in `shared/build.ts`. The button is the primary one (`data-primary`) only when `rebuildHelps`
  says building again may help: a failure outside the model (`crash`, `timeout`, `cancelled`) or a build let go
  for memory with nothing failed since; after an error in the model the same sources give the same error and it
  stays quiet. The build error sheet (`ui/BuildErrorSheet.tsx`) says what failed in words (`kindWords`, with
  the build as the chat's line names it: `Build after r2 failed`, `First build failed`, never the kernel's word
  alone) and who is told (`toldLine`: after the session's edit, found by the chat's build line that is still the
  latest, or with the next prompt, or no session). Its one primary button is "Ask Claude Code to fix it"
  (`fixPrompt`), which opens the dock, puts the text in the box of the chat (`insertIntoComposer`) or at the
  prompt of a terminal (`session.insert`, a paste, never Enter) and never sends; with no session it reads "Start a
  session to fix it" and asks the session pane to start one (`fixRequest` in the store), which leaves the text in
  the new chat's box (`holdDraft`) or types it at a terminal's prompt once its status is idle. After a failure
  outside the model "Rebuild" is the sheet's primary button and the ask is quiet; Copy is always quiet. The
  Composer's "Goes with your next prompt:" has a "build failed" chip while the build has failed. A tool in hand is offered a key before the viewport is, so the
  Region tool's `E` stays its own and explode's is the viewport's. Shift with
  a key is that key unless Shift with it has a row of its own in that scope.
  A slider is no field to type in (`ui/typing.ts`): the keys work with one in
  focus. After a click or an action the next letter is the view's (`e2e/focus.spec.ts` walks a session of
  work pressing `P` after each step): a field, a list being chosen in with the keys, and the session pane keep
  the keys (`TYPING`); what the pointer took up gives them back once done with: a choice made in a list
  (`pointerChoice`, `chosen`), the session pane's edge once dragged, as Enter and Escape do in a field
  (`giveKeysBack`). The exported page's own keys (`src/export/viewer`) are not in the
  table: it is another program. The palette's tools are `TOOL_KEYS` in the order of their groups (`group`:
  `inspect` Select, Measure, Section; `mark` Pin, Arrow, Draw, Shape, Region; `scan` Align), drawn as one
  `role="group"` each (`TOOL_GROUPS` in `state/tools.ts`, its `aria-label` the group's name) with a
  `toolbox-rule` between them; the sheet of keys and the manual's table follow that order. The Measure tool is
  `tools/measureTool.ts`; what its clicks measure is chosen in the strip `MeasureChoice` of
  `ui/ToolPalette.tsx`, and a dimension's expectation is typed in
  `ui/DimensionFields.tsx`. **A measurement is no mark**: the tool asks main (`ctx.measure`, `geometry.measure`)
  and nothing is committed; the kernel's value replaces the `≈` estimate at the pointer, and the last
  measurement is held in `state/measured.ts` (`Held`: its ends, kind, layout, build, camera, value and `how`),
  which changes once per measurement. The strip shows it (`Last: …`, only for the object and build on show)
  until the next first end, Escape with nothing under way or the tool put down. It is kept as a dimension only
  by `measure.keep` (Enter) or the strip's "Keep as a dimension", both `keepHeld`, which commits the same
  anchors through `commitMark` (main measures it again); the strip then says `Kept as M7`. The kernel's two points (`Held.points`) draw it in the view until then: a `held` draft (`Draft.held`, the value text) in `--ink`, not faint, with its value at the middle (`viewport/heldValue.ts`); a distance's strip adds `Δx Δy Δz` (`componentsOf`). A readout is not a
  mark and is never drawn in a mark's colour. In Angle, before the second click, an end the kernel takes by its axis, only if
  flat or straight, or never (`angleTaking`, by the descriptor's type, the kernel's rule) is said at the pointer
  in place of the `≈` estimate; it is a hint, never a gate: the click is sent whatever it says. A tool is a `Tool`
  (`src/renderer/tools/Tool.ts`) and gets every pointer event the chips of the marks do not take from the one
  subscription in `ui/ViewportPane.tsx`. Nothing of a pointer move goes
  through React or the store.
- **Learning the tools and the pointer without the manual** (`ui/ToolPalette.tsx`, `ui/ToolHint.tsx`,
  `state/step.ts`, `shared/pointer.ts`). The palette has no `title`: each button has torno's own tip beside it (`ToolTip`,
  at once on the pointer and on the keys' focus, `:focus-visible` only; any key puts it away; it takes no pointer
  and is `aria-hidden`, the button holding the same words as its `aria-description`): the name, the key cap from
  `hint`, what the tool does (`doesOf`, the `does` of `TOOL_KEYS` without its name) and, below, what else is worth
  knowing now (`noteOf`: a scan's tool with no scan says `Import a scan first`, a painting that waits on a scan, the
  shape the Shape tool places). A scan's tool (`SCAN_TOOLS`: Region, Align) with no scan in the object, once main has
  said so (`scansKnown`), is drawn quieter (`data-quiet`, the icon in `--muted`) and stays enabled: its click and its tip
  say why. The key letters are 11 px. The Keys button has the same tip.
  With a tool other than Select in hand one line at the foot of the view (`ToolHint`, `aria-live="polite"`, no
  animation, no pointer) says what the tool waits for next: `next` of the tool's row in `TOOL_KEYS`, with
  Measure's `then` once the first end is clicked (`stepStore.stage`, set by `measureTool` through `setFirst`, once
  per click, never per move), Pin's `click the part where M3 should be` while a mark is being put elsewhere, and
  `import a scan first` for a scan's tool with no scan (`stepFor`, `hintLine`). The line names no key of a tool: only
  `Esc` (`hint('escape')`), which steps back. The first time an object is drawn in this install the same line, with no
  tool in hand, says how the pointer moves the view (`pointerLine()`, and `?` from `hint('keys')`); a tool's step takes
  its place while it is in hand, and the hint goes at the first move of the camera the person makes with the pointer
  (a drag or the wheel: `Viewport.onNavigated`, not a view key, Fit or a click that moves nothing), remembered in
  the window's `localStorage` under `torno.pointerHint` (`pointerHintDue`, `rememberPointerHint`: a storage that is
  not there or refuses shows it again; never in a workspace). The line stands on `--bar-floor` and, while it is
  there (`:has(.tool-hint)`), lifts every bar at the foot of the view by a row (`--hint-lift`, 40 px) so that none meets it
  (`styles/layout.css`, held by `viewport/overlay.test.ts`). The sheet of keys starts with a group "Pointer"
  (`POINTER` in `shared/pointer.ts`: drag, right drag, scroll, double click with Measure; "In the view": with Arrow or
  Draw in hand a drag that starts on the part draws instead; the others' own press is in their step lines): gestures, no row of `KEYS`, searched with them and counted
  after them (the count line gives the keys, then `, N of the pointer`); the manual's table of them is held to it (`readme.test.ts`).
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

## What a build changed

- When a build lands over another of the same object, `actions.applyScene` keeps the one before as `before`, and the
  status line (`ui/BuildStatus.tsx`, `state/landing.ts`) says which parts of the layout shown changed
  (`landing`, `landingText` of `shared/diff.ts`: `tub changed, lid same`), with the `diff` lines in its title; the
  one rule of what a part's change is is `partChanged` (another mesh, or another `loc`). Nothing of it for a first
  build, a build running or a failed one.
- The ghosts (`viewport/ghosts.ts`, `Viewport.setScene`): of each part that changed, its old edges in `--muted`
  (seen through the part) where it stood, and its new edges in the accent, for `GHOST_HOLD_MS` and then one fade of
  `GHOST_FADE_MS`, by `invalidate()` steps and by a clock of their own (never endless, never waiting on a frame).
  Any key or a press on the canvas, another layout, a section or an explode ends them at once; none is made with a
  section or an explode on, for a part switched off, or of another layout, and they are hidden for a picture
  (`hideGizmo` in the host of `PictureMaker`). Not a mark, in no mark colour. `__tornoTest.ghosts()` and
  `holdGhosts()` are for tests.
- The parts fade for a build only once it has run `FADE_AFTER_MS` (`fadeIn` of `shared/build.ts`, applied by
  `ViewportPane`); a failed build fades them at once; the pick lock does not wait.

## History of builds

- **Prompts only** is the history of the project, in the session pane (`ui/chat/PromptsOnly.tsx`; the old `HistorySheet` is gone). **History**
  in the status line (`BuildStatus`, `status-history`) and the chat head's `Chat | Prompts only` toggle (`ChatPane`, the group `Show`) are
  the one flag `store.promptsOpen` (`actions.setPromptsOpen`, which also shows the dock; of the open object, so another one starts at the chat).
  In the chat it is drawn over the transcript (`.prompts`, absolute inside `.chat-scroll`), which keeps its scroll and is `inert` meanwhile; where
  the chat is not (a terminal session, or no session yet) `SessionPane` draws `PromptsPane` over the session area (`.session-prompts`, with Close).
  Rows are `promptLines` (`ui/chat/promptsView.ts`, pure and held by its test): the project's prompts (`chat.prompts` through `usePrompts`, asked
  again when a prompt is sent or a build kept) joined to the history's entries by `turn.prompt`, newest first, with `savesBetween` lines between
  rows, a `began` line where a conversation's run starts (`current`: the conversation of the open chat), the prompts of `goneBack` folded into one
  openable row, `Starred` (a build of the prompt is starred) and `Hide gone back`. A row: number, `useThumb` of its last build, the text cut to a line,
  `<from> → <to>` (where it started from, its last drawable build), `resultWord` (`gone back from`, `build failed`, `<n> failed on the way`,
  `<n> checks fail`, `starred`, `passes`; nothing for a prompt that built nothing) and `ago`. A click is `actions.compare(from, to, number)` (a second
  click `endCompare`; `aria-disabled` with the reason when there is nothing to compare or a section or an explode is on), a double click or the row's
  "Open in chat" is `ChatPane.openInChat`: it puts Prompts only away, reads the earlier conversations first when the prompt is of another, and scrolls
  `.chat-group[data-id=<user item id>]` into view. A terminal's prompt (`t-` ids) is never opened. The chat's **Earlier conversations (n)** button (at the
  top of the transcript, shown for the project's other conversations that have a chat log) reads them (`chat.conversation`, read-only, no history joined)
  and draws each above the current one under `ChatEarlier`.
- **One number for a prompt.** `listPrompts` (`main/sessions/prompts.ts`) numbers every sent prompt of every conversation from 1 by time; the window's
  `numbersOf(rows, items)` (`historyJoin.ts`) is that map by prompt id, plus the prompts of the open transcript the list does not have yet (queued or just
  sent), numbered on from its last; `ChatItems` takes it as `numbers`, and turn cards, Go back's confirmation, Prompts only and `comparing prompt <n>` all use it.
- The window's own reading of the history (`useHistory`, `history.list`, again at `history:changed`) writes nothing. The source of a kept build
  and "Ask the agent to go back to this build" were the sheet's and are gone with it (`history.source` stays for tools that read it); Go back is on the turns.
- **Compare: a kept build against the live one** (`state/compare.ts`, `ui/CompareBar.tsx`, `viewport/earlier.ts` `Earlier`, `Viewport.setEarlier`
  and `setCompareMode`). `store.compare` is `{ from, to, mode, prompt? }` (history ids, `from` the earlier; `building` and `refused` are said of
  `from`'s drawing), set by `actions.compare(from, to, prompt?)` (a row of Prompts only, a turn of the chat),
  changed by `compareMode` (`before`, `overlay`, `after`, `side`) and ended by `endCompare` ("Back to the live build" in the bar, `Esc`: the row
  `compare.end`, scope `compare`, which `ViewportPane`'s key handler asks before the tool in hand and the viewport's `escape`). `ViewportPane`
  asks main for `from`'s scene and meshes (`history.ghost`: held in memory for a build of this run, else built again from its copy in a worker thrown
  away; a `refused` sentence, shown in the view, when it cannot be) and draws its parts of the layout shown (`EARLIER_SURFACE_OPACITY`, in `--muted`, with
  edges). Which build is the "after" is `to`: when it is not the build on show (`isLive`: this run, the revision shown; a past turn compared while newer
  builds have landed) `ViewportPane` asks main for it as it does for `from` and `Viewport.setLater` draws it in the live build's place for the whole
  of the comparing (the live meshes, marks, ghosts and scans are left out of the frame by `renderScene`, never disposed; a live build landing updates
  them unseen; `clearLater` has them back; asked again at every revision). Overlay: `from` translucent in `--muted` over `to`. Before, After and the two halves
  of Side by side draw their build opaque in the normal part colours (`colorsOfParts` of its own scene; edges their darker tint): `from` alone, `to` alone
  (the live build itself when it is `to`), the two in the left and right halves, with the scissor test and one camera framed for half the width, a line down the middle
  (`OverlayPass.split`), no marks, chips or cues, and no pick (`Viewport.pick` is null whenever what is drawn is not the live build: a point of the canvas is on neither
  as the camera has it, nor a chip of a mark made on another build). The status line says `comparing prompt 14 · h40 → h41` (`compareStatus`), or
  `Building h40 to compare…` once the wait passes 300 ms. The boxes over the view are the history entries' (`useHistory`): "What changed" is the later
  build's `line`, "Checks and marks" is `checksMoved` of both entries' `dimensions` and `failing`. For display only: no bounds tree, a ray finds nothing, it is
  hidden for a picture (`hideGizmo`), and nothing is measured, marked or written from it. A live build landing does not end it; another object, another layout, a
  section or an explode does. It is not the ghosts of a build that landed (`ghosts.ts`, a moment, edges only). `__tornoTest.earlier()` and `compare()` are for tests.

## Layers

- `ui/Layers.tsx`: a reference (`Part.role`, a bought part) has the neutral swatch (`colorsOfParts`) and the tag "bought"
  (`.layer-bought`), and is otherwise a row like any (it can be picked, hidden, made translucent).
- `ui/Layers.tsx`: the groups of the layout (`groupsIn`) come first, a header each (`li.layer-group`,
  `data-group`): a fold chevron (`aria-expanded`, `Fold flat` / `Unfold flat`), the name and the count in the
  monospace face, "Show only" (on hover, as the opacity slider; `actions.soloLayers`) and an eye whose
  `aria-pressed` is `true`, `false` or `mixed` (`groupVisibility`; `actions.setLayers` over the group, one edit).
  Its parts follow, indented, with `data-in-group`; a folded group draws none (`actions.setFolded`, kept in the
  scene file as `folded`, and dropped for a group the model no longer has). The parts in no group come last. A
  model without groups draws the list as it always was (`e2e/groups.spec.ts`).
- A part's row is also the way to the part (#94, `ui/Layers.tsx`): the pointer or the keys' focus on it is `peek([name])`
  (no highlight of the agent's, no locked tools; a row that goes while it is lit takes the light away), its name is a
  button that selects the part as a ref (`setSelection([name])`) and, double clicked, brings it into view
  (`actions.framePart`, `Viewport.framePart`: where it is drawn, the camera not turned), the target is "Show only"
  (`soloLayers(layout, [name])`) and the title says `N hidden · Show all` while a part of the layout is off. After the
  name, a muted count of the open marks on the part in the layout shown (`ui/layerMarks.ts` `marksByPart`; `--fail` when
  one is a check that fails on the build); a click lists only the marks on that part in the Marks panel
  (`store.marksOnPart`, the window's alone and dropped with the object; a chip `Only marks on lid` with a cross
  above the list; `goToRow` clears it). It filters what the list shows and nothing else: the agent is told every mark.
- A part whose build says its shape is broken (`partDefects` of `shared/sanity.ts`: not valid, inside out, not
  closed, mesh disagrees) has its first defect in a word after its name (`.layer-defect`, `--fail`, `+N` for the
  others) and every one in the row's title; the status line counts the layout's broken parts after its parts
  (`.status-defects`, `defectsSaid` in its title). Of the build on show alone: whether a defect is new is for the
  agent's digest (`main/sanity.ts`) to say.

## Parameters

- `ui/ParamsPanel.tsx`: the fields of the model's `Params` as the kernel read them at the last build (`Scene.params`,
  as main sends the scene, unchanged), read only; torno never writes the model. A model with none (or a kernel that does
  not read them) has no section. A row (`paramRow` in `ui/paramRows.ts`, pure) is the name and the default in the
  monospace face (`shared/format.ts`, four digits at most, a list or a dict by its items, a bool as Python writes it;
  the whole value in the value's `title` where it differs, with the type as written in the row's), the comment (`doc`)
  as written, its numbers in the monospace face (`numbered`), cut to two lines (whole in the row's title), and, for a default that is not a literal, "worked out in the
  model" (its value too when the kernel has one). No unit is taken from a comment.
- A click on a row puts `Params.<name>` at the cursor of the open object's session by `insertIntoSession`
  (`ui/insertIntoSession.ts`, also the selection's "Insert" and the build error sheet's ask: the box of the chat,
  `insertIntoComposer`, else a paste at the terminal's prompt, never sent; it says whether it went in), and shows the
  dock first (`later`: a box in a hidden dock takes no focus), as the selection's "Insert" does; the box puts its cursor
  after the text once it is given the keys (`unfocused` in `Composer`: a hidden box loses the one it was given). `Params.x` names no geometry, so it is plain text in the
  prompt: `refsIn` and `RefChip` do not see it. A row's accessible name stays `Params.<name>`; its `aria-description` holds
  the row's title (type, value whole, comment) and then what a click does. With no session running a row is text, not a
  button, and the description says to start one (`e2e/params.spec.ts`, which writes its own `Params` into its copy of a
  fixture).
- **Trying a value.** A field the kernel says is `editable` (`Param.editable`: `float`, `int`, `bool`, `choice`)
  has a control under its name (`ParamControl`): a number field, plus a slider when the model gives `min` and `max`
  in the field's `metadata`; a checkbox; a select. A number is taken on Enter or when the field is left, a slider when
  it is let go of (`onPointerUp`, `onKeyUp`): a build runs then, never while it moves. It asks main
  (`object.setParam`, `object.resetParams`; a refusal is said under the title) and the control starts again from
  `Param.value`, the value the last build used (keyed by it), so the window holds no override of its own. A row built
  with a value other than the default (`tried`) says `differs from the file` with a "Reset"; the default stays on
  the line. `Scene.overrides.dropped` is shown on its row (`param-note`). "Ask the agent to bake it in"
  (`bakeText`) puts a request in the session's box like a row's click does, never sent; "Reset all" resets every field.

## Checks

- `ui/ChecksPanel.tsx` (its own component, beside the marks, not in them): the checks the model declares in its
  `checks(p)` as the kernel measured them at the last build (`Scene.checks`, `Scene.checkNotes`), read only, under
  Parameters, in the Params panel (a section of it, never folded), with a title that says how many fail (`2 · 1 fails`, `checksSaid`). A row
  (`checkRow` in `ui/checkRows.ts`, pure, words from `shared/modelChecks.ts`) is the model's own name, how it stands
  in a word (`pass`, `fails`, `not measured`, `not run`: never colour alone), what was measured and what was wanted in
  the monospace face, and, for a thin wall or an approximate value, that it was found by sampling; its title is the
  kernel's `how`. A bar in `--agent-mark` marks them as the model's own. They are not marks: no check resolves,
  replaces or silences a person's dimension. Under the rows, what the agent made easier to pass or removed since it was
  first declared (`checkNotes`, `since r7`). A model with no checks, or a kernel that does not read them, has no section
  (`e2e/checks.spec.ts`).

## Print profile

- `ui/PrintProfile.tsx`, under Checks in the Params panel: a section (its title says
  `Bambu X1C, PETG` or `none`) with two lists, Printer and Material, and "Add a printer…" (name, bed X Y Z, nozzle),
  through `window.torno.profile` (`profile:*` channels). A choice is copied into the object's `.torno/profile.json` by
  main; the printers are the person's, in torno's settings. The numbers shown are the person's, set in the monospace
  face, with the line that they are not measured. Materials of the person's own are added in `profiles.json` (no form).

## Section

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

## Explode

- `E` on a layout of one part opens no bar: the button says why for a moment. The parts of a group of the model
  move as one body (`Part.group`, `explodeOffsets` in `shared/explode.ts`; `e2e/groups.spec.ts`).
  One rule for the camera when the parts are drawn apart, by whatever path (`E`, an axis or scale button, the
  slider let go, a layout, the agent's `show`, a saved view applied), in the window and in an exported page:
  the camera stays, and is framed anew only when a part would leave the view (`leavesView` in
  `shared/explode.ts`; `Viewport.keepApartInView`, asked by `ViewBar` once the explode bar is laid out, and by
  `ViewsStrip` after a view's camera); together again, it goes back to where it was before that, if nobody
  moved it meanwhile (`cameraBack`; a view key, Fit, Ortho or Frame make the camera the person's). In the
  window the view is what the bars over its top leave (`Viewport.setCoveredTop`, measured by `ViewBar`): a
  view key, Fit, a scan's Frame and that rule frame the parts below them (`fitBelow` in `viewport/views.ts`);
  a picture for the agent has no bars. Fit, Ortho and Frame act on where the camera is going when it is on its
  way (`cameraGoal`): a view key and then `F` at once is that view, fitted. While the parts are apart no shape
  is in hand (`connectShapeEdit`).
- **Exploded is display only.** `Part.loc`, `Part.bbox`, every anchor, every
  `points` of a dimension and everything the kernel is asked are of the parts
  as built. `Viewport.setExplode` moves each part's group (`placePart`, the
  one place a group is put; `viewport/explode.ts` holds the offsets as drawn
  and as they will be once a move has ended, `PartsApart`), and nothing else:
  the scans and the grid stay. The slider moves the parts as it is dragged
  and the store keeps the amount once, on release (`actions.setExplode`);
  `E` and the agent's `show` go there over 220 ms, a step a frame, with no
  state in React.
- **A pick is of the part as built.** `Viewport.pick` takes the display
  offset of the part hit away from the point (`asBuilt`). Selecting,
  hovering, "Insert" and the readout at the pointer work exploded.
  `Viewport.project(point, part)` says where a point of a part is drawn;
  `bounds()`, `partBoxes()` and `sectionBox()` are of the parts as built,
  while `fit` and the named views frame them where they are drawn.
- **Nothing is marked, moved or measured from the window while the parts
  are drawn apart.** Pin, Arrow, Draw, Shape, Measure, Section, Align and
  Region are handed no pointer event and no key (`routePointer`,
  `ToolContext.exploded`), and the pointer says `EXPLODED_TOOLS`. The gate
  reads the store **and the screen** (`explodeNow(s) !== null ||
  viewport.exploded()`): the parts are still apart for a moment after the
  store says together, and under a slider being dragged before it says
  apart, and a pointer's ray is of the screen. What a tool had under way is
  dropped once when the parts go apart. "Note" on the selection, "Re-place"
  and a region's "Edit" are disabled with the same words, the gizmo holds
  nothing (a shape's or a scan's), and the points of an alignment and the
  brush ring are not drawn.
- **Marks are drawn moved with their part** (`viewport/marks/apart.ts`
  `markOffset`, `MarkLayer.setOffsets`): the mark's objects and its label,
  never the mark. A mark whose ends are on parts that moved differently
  (`'split'`: a dimension between two parts, an arrow whose head is at
  another part than its foot, by the parts' boxes) is drawn between them
  where they are drawn, dimmed and dashed (`spanning`, `setDashed`): the
  line is as long as the parts are apart, which measures nothing. Its row
  says `spans parts drawn apart`, the caption of a picture and of `show`
  names it (`spanningMarks`, `explodedNote`), and a dimension's value stays
  the kernel's, of the parts as built. A mark on no part, and a region, do
  not move.
- **A section is never drawn exploded (D2).** While there is a section
  nothing is drawn apart (the rule above). `actions.setExplode` answers
  `Take the section away to draw the parts apart` to an amount above 0;
  `actions.setSection` with a plane sets the `amount` of the layout shown to
  0, as if by hand. Another layout keeps its own, in the file too, and is
  drawn together while the section is there, apart again when it is gone.
  `sceneFileOf` never writes a section with an amount above 0 for the layout
  the file opens to. `look` and `show` refuse the two together
  (`NOT_EXPLODED_AND_CUT`), in main and again in the window. A picture that
  is cut by a plane of its own while the screen is exploded is drawn of the
  parts together; so is one that colours a scan by its distance to a part
  (`scanColour`), and its caption says so. Scans are not moved: a caption
  that draws both says `scans are where they are`, and so does the bar.
- The control is `ui/ExplodeControl.tsx`: `ExplodeToggle`, one button in the
  view bar (pressed while the parts are apart or its bar is open, with the
  amount beside the word; pressed while apart it puts them together), and
  `ExplodeBar` under the view bar (`.viewbars` stacks them): the slider with
  the amount beside it, `From centre X Y Z`, `×0.5 ×1 ×2 ×4`, and a line
  with `role="status"` that says it is for display only, or why nothing is
  drawn apart. The bar is the notice that the parts are not where they are
  drawn. The view bar is one row at 1440 × 900 for an object with two
  layouts (`explode.spec.ts` holds it to that); in a narrower pane it wraps
  rather than run under the panels. `window.__tornoTest.exploded()` says
  whether the viewport draws the parts apart, or is on its way there or back.

## Views

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
- **A focus** (`FocusBox`, `focusCamera` in `viewport/views.ts`): a picture for the agent, or `show`, is framed on
  a box and its margin by `fitCamera`, looking the way a standard view does (orthographic, as a picture of one is),
  or the way the camera on screen or the agent's own camera looks, with its projection kept. A picture says
  `framed on the focus` and which parts stand between the camera and the middle of the box (`hiddenBehind` in
  `viewport/focus.ts`: a line cast at the meshes of the parts drawn, both faces, what a cut takes away left out,
  the box's own surface not in the way). Parts are drawn together unless the picture says otherwise; `show`
  refuses a focus while the screen is exploded. All of it is synchronous once started, like the rest of a picture.
- **The frame in the view** (`drawFrameCues` in `viewport/overlay.ts`, drawn by `OverlayPass` with every frame on the
  canvas the labels are on, never through React): the axis triad bottom left, its arms about 32 px (`SCREEN_UNIT`)
  in `--axis-x`, `-y`, `-z`, and bottom right the scale bar in an orthographic view or, in perspective, where no one
  scale holds, the grid's step as `grid 5 mm` (`groundOf`'s `step`; the grid lies on the ground in the object frame, so
  its step is a true length in any projection). It is of the camera and the object frame only, so it stays while the
  parts are apart. A picture for the agent has the same triad and bar, and in perspective its note `perspective, no
  scale bar`, as before. The scale bar is 100 px at most on screen. The strip of the Measure tool stands above the
  triad, and the bars at the bottom of the view (the section's, the selection's, the Align and Region tools', the
  agent's line) keep `BAR_SIDE` in from each side, clear of the triad and of the scale; where the view is narrower than
  the widest of them needs (`NARROW_BELOW`, `data-narrow` on `.viewport-pane`, set by `ViewportPane` as the view is
  resized) they stand above the triad (`--bar-lift`) instead, and above the strip of the Measure tool while it is in hand (the strip is also above the triad, at the left, and the two never meet),
  the bars that stack there (the selection's, the section's, the agent's line, the step line, the Region tool's) 60 px in
  from each side (`--stack-side` of `[data-narrow]`), clear of the palette of tools, which a short view's stacked bars
  would reach; the Align tool's bar, which stands alone and whose rows need the width, keeps `--space-3`. In a wide view the bottom row stands below the strip, beside the triad, and a bar raised a row up (the
  section's over the selection or the agent's line, the agent's line over the selection) stands at `--strip-top` at the
  least while the strip is there, above it. `TRIAD_CLEAR`, `BAR_SIDE` and `NARROW_BELOW` are in
  `viewport/overlay.ts`, and `--triad-clear`, `--bar-side` in `styles/layout.css` are held to them by `overlay.test.ts`;
  `e2e/section.spec.ts` reads the bar's box against the corners, the palette and the strip, and the strip's against the
  selection's, at seven sizes, with a selection and without.
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

## The first screen

- With no folder open the window is `ui/Welcome.tsx`. On a first run (no recent folder): a line of what torno is,
  a three-row tree of the folder of objects, an object and its model, "Open folder" with a note that an empty
  folder is fine, and, where torno runs from its repository, a quiet "Open the example". Coming back: the recent
  folders first, no tree. One footer: torno writes only into `.torno`, and the new folder of a project you make. Its head is the logo (`ui/Logo.tsx`) over the name: the vise in `--ink`, the part in `--accent`. The
  same logo is in `--muted` over an empty view or page, and plain (one colour) where a picture is missing.
- For as long as the example is the open folder, the note under the folder's name (`EXAMPLE_NOTE`) has a link-button,
  "Keep this as a folder…" (`KEEP` in `App.tsx`, through `leave`, so that it asks first as opening a folder does):
  main shows the save dialog and copies (`workspace.keepExample`); the folder it made is opened in place of the copy.
- With a folder open, the folder button at the top of the Projects panel is a menu
  (`ui/FolderMenu.tsx`): the recent folders, "Open folder…", "Open the
  example". A folder torno is started with (`TORNO_WORKSPACE`) is added to the
  recent ones; the workspace to open next stays the one chosen in the window. The open folder's row is marked
  with a check and the word "current" in the muted face. A folder that cannot be opened (one gone since the menu
  was read, one main refuses) leaves the workspace as it is and is said under the folder's name, a `role="alert"`
  line with `openProblem`'s text, until the next action (`goTo` in `App.tsx` returns the problem).
- **The window's own questions are dialogs over the whole window, not strips of a panel.** Closing torno and
  opening another folder while something would be cut short ask in `ui/WorkspaceQuestion.tsx`, a centred
  `alertdialog` (modal: nothing behind it takes a click or a key, Tab goes round within it, "Keep it open" /
  "Stay here" in focus, Escape presses it, even with the focus elsewhere). Its keys are heard before any other
  listener's (`keyGate`, added to the window when the module is read, before the window's own keys and the view's):
  while it stands no key reaches anything behind it, wherever the focus is, and a press on its backdrop leaves the
  focus in it. It stands over the sheet of what torno needs, which shares its layer (`data-question`). It lists a line for each thing with the
  object it is of, as a link that goes to that object (or to the page of a new one) and puts the question away
  (`closingWhy`, `leavingWhy` in `closing.ts` return those items). `ui/Confirm.tsx` stays the strip for a question
  about one panel (a scan, a mark, the session).
- **What torno needs** is one block, "Ready to work" (`ui/Readiness.tsx`; its words are `ui/readyLines.ts`, pure and held by
  `readyLines.test.ts`; its state is `store.ready`, asked of main once and told on each change, `useReadyFeed`). A line each
  for Claude Code, uv (only when missing), a folder's own environment (only with a `pyproject.toml`) and the kernel; a dot
  in `--ok`, `--warn` or `--fail` (a wait is `--muted`), the label in the muted face, versions, paths and commands in
  the monospace face, and a note in the muted face under it. When every line is ready it folds to one quiet line ("Claude
  Code and build123d 0.13.0 are ready") that a click opens; a kernel that is only starting, its environment there, does
  not keep it open. Nothing is claimed until main has said. It is under the tagline of the first screen, in the empty
  workspace below "New project" and the example, on the page of a new object above Create in the `missing` form (only the lines that
  say something is amiss, none when none does, and for Claude Code a failure adds that the object will be made but the agent
  cannot start in it), and in the sheet of the folder menu ("Check what torno needs", a dialog over the window asked afresh,
  with "Check again"). "Make it now" is on the kernel's line when torno's own environment is not made, no workspace's kernel is
  starting and uv is there, and "Try again" when it failed. The status line says "Making torno's Python environment, first
  time only" in place of `Building N s` while the kernel is starting over an environment that was not made.
- A workspace with no object leads with making one (`ui/EmptyWorkspace.tsx`, in `ui/ShowPage.tsx`): "Make your first
  project" and a line on what it takes, "New project" (primary), under it "or open the example to look around" (only
  where `hasExample`), the readiness block, a line on scope (printed parts and small assemblies), and a fold,
  "Already have build123d models?", closed, which holds the folder rule (`part/part.py`) and, for a folder without a
  `pyproject.toml`, that its models are built with torno's own build123d. torno runs no `uv` command there: the note
  names them for the person to run. The session pane in that state says that Claude Code works there, one session per object.

## Light and dark

- The tokens (`app/src/renderer/styles/tokens.css`) are held to their
  contrasts by `shared/contrast.test.ts`, which reads the file: whatever is
  read as text is 4.5:1 on the ground it stands on (`--ink` 7:1; `--muted`,
  `--accent`, `--ok`, `--warn`, `--fail` on `--surface` and `--panel`; the
  accent on its wash; the sixteen terminal colours on the panel, but the dark
  theme's black); what is only drawn is 3:1 (the two mark colours on the
  surface); a hairline is between 1.15 and 2; the edge of an input or a text area is `--field-edge`, 3:1 on both (WCAG 1.4.11). A token is changed there first.
- A verdict (`--ok`, `--fail`) is no mark's colour to the eye, in both
  themes: 1.5:1 at least from the mark colour of its hue (`--agent-mark`,
  `--user-mark`), darker in light and lighter in dark. A verdict is read, a
  mark is drawn. Muted words and the verdicts are 4.5:1 on `--accent-wash`
  too. The dark `--warn` is an ochre, not an amber.
- An edit drawn as a diff has its own two washes, no red and no green (`--diff-removed-wash`, a grey between the panel and
  the hairline; `--diff-added-wash`, the value of `--accent-wash`): `--ink` 7:1 and `--muted` 4.5:1 on both, the blue 60° of hue
  at least from both marks and both verdicts (`contrast.test.ts`).
- A mark's lines (a pin's leader, an arrow's shaft, a stroke, a dimension's
  lines, a shape's outline) are drawn over a casing in `--panel`, 2 px wider
  (`MarkColours.casing`, `Parts.cased` in `viewport/marks/markObjects.ts`; in
  an exported page `.mark-casing` under `.mark-line`, as SVG over the
  canvas). The line is 3:1 on its casing; the casing is 3:1 on every part
  colour in dark and 2:1 in light, where no panel-coloured casing can do more
  against pastel parts.
- The person's ink on a picture of the view is `--drawing-ink`, magenta in both themes: 3:1 on its casing and on the
  ground, 30° of hue at least from either mark colour, and no axis's, the accent's or `--deviation-near`
  (`contrast.test.ts`). `ui/drawing/make.ts` writes the light values out for where the stylesheet cannot be read.
- What the system draws follows the theme: `color-scheme` is one scheme at a time, said outright in
  `tokens.css` (never `light dark`, which left the native light scrollbars in the dark theme), and every
  scroller of the window has the thin bar in `--scroll-thumb` (`late.css`). `e2e/themes.spec.ts` holds both.
- No text is dimmed by `opacity`, and nothing animates without end
  (`styles/styles.test.ts` reads the stylesheets): the dot of a session at
  work is still, and a build's beats with the count of its seconds
  (`data-beat`, set by `BuildStatus` once a second). The axes (`--axis-x`, `-y`, `-z`) are the gizmo's and the triad's, in the view and in a
  picture, and are neither mark colour.
- The light values are written out where no stylesheet is read
  (`viewport/theme.ts` `LIGHT_THEME`, `viewport/sectionDrawing.ts` `SHEET`,
  `viewport/overlay.ts` `AXIS_COLOURS`, `SURFACE` in `src/main/index.ts`,
  `src/export/page.css`): the same test, and `export/page.test.ts`, hold them
  to the tokens.

## The page of objects

- `ui/ShowPage.tsx`, over the 3D view (`store.page`: `'object' | 'objects'`; the view stays mounted under it,
  `inert` and not painted, and the open object keeps its selection, camera and note). A workspace of several
  objects, or of none, starts on it; one object alone is shown itself. `W` outside a field or "All projects"
  brings it up (not while a button of the pointer is held: a drag in the view is not over); a card, or Escape,
  leaves it, and what had the focus has it again. "All projects" is the first row of the list while no object is
  open, and beside the list's title while one is (`ofObject` in `ui/ObjectList.tsx`), the page up or not: the one
  control, so the focus it had comes back to it.
- **The rail and its panel** (`ui/Rail.tsx`, `ui/PanelHost.tsx`, `styles/rail.css`, `styles/panels.css`, `state/column.ts`).
  The left of the window is `aside[data-region="left"]` (`aria-label="Panels"`), the F6 region `left`, holding the rail
  (56 px, `--rail-w`, `RAIL_W`) and, beside it, the one panel that is open (`.panel-host`, `--panel-w`): five icons with a
  word under each, Projects, Layers, Params, Scans and Marks (`RailPanel`), buttons with `aria-pressed`. A press opens
  that panel and pushes the view over (`--left-w` on the shell is the rail and the panel together, or the rail alone
  with none open: `data-panel` on the shell), a press on the open one closes it, another switches
  (`actions.openPanel`; pressed with the pointer, the keys go back to the view). Tab and Ctrl+Tab are not bound: the
  rail's buttons are in the page's own order. The rail offers what the page allows (`panelsFor`): all five for an open
  project, Projects and Marks on the page of projects, Projects alone for a new project or with none open; a kept panel it
  does not offer is not shown (`shownPanel`), except that where Projects is the only one it stands in, so that a
  workspace with no project open shows its list. A badge on the icon is what the folded titles said: the parts switched
  off (Layers), the model's checks that fail (Params), the scans not aligned (Scans), the marks to review (Marks)
  (`ui/railBadges.ts`: the text, and the same in words as the button's `aria-description`; the number is in the
  monospace face and the badge is `aria-hidden`). The Projects icon carries the dot of any project's session that works or waits
  (`switcherSign`), its description naming which. Projects is the workspace's: the folder's name and menu, the example's
  note, a folder that would not open, then the list; Params is Parameters, then Checks and Print profile; the sections
  of a panel do not fold, and the panel scrolls as a whole except Marks, which keeps its title and line of checks in
  place and scrolls its list. Which panel is open and the panel's width are the window's (`store.column`: `{ open, width }`,
  in `localStorage` under `torno.column`, read and written in try/catch; a value of the old shape, folded sections and a
  marks height, reads as Marks open at its width), never the workspace's. The panel's right edge (`ui/LeftEdge.tsx`,
  `role="separator"`, `left.resize` Left/Right) makes it wider than its default 248 px (`LEFT_DEFAULT`), up to
  `PANEL_MAX` and what leaves the viewport `VIEWPORT_MIN` beside the rail and the dock (`clampLeft`); its drag writes
  `--panel-w` on the shell, a double click puts the default back, and the dock's own limit reads the left's width
  now (`e2e/boot.spec.ts`). Opening a project from the list leaves the panel as it is.
- **The list of projects** is whole, one row for each, in the Projects panel (a project that cannot be built is muted,
  its reason the title; "All projects" is beside the title while a project is open and the first row otherwise). There
  is no switcher: the rail's Projects icon says that a session of another project waits.
- **The keys on the page** are one capture-phase listener. Left alone: what is typed in a field or the
  terminal (`TYPING`), any `input` outside the page (a slider of the left column keeps its arrows), and
  whatever is inside a `[role="dialog"]` or `[role="alertdialog"]`. Everything else is the page's and goes no
  further, so no tool under it is handed a key: arrows from card to card (`ui/cards.ts` `stepCard`), Enter
  opens, `/` or a letter filters by name. **Escape goes to what is on top**: a sheet or a confirm that is
  there to be seen (not one of the view put away under the page) gets it first, as if pressed there; then the
  filter is emptied; then the page goes. A sheet opened over the page (the export's) needs one of those two
  roles and nothing more.
- **No build is ever started for a picture.** A thumbnail is made by the window when a build of an object
  opened in this run lands (`state/thumbs.ts` `connectThumbs`): one at a time, in an idle callback, the latest
  build of each object only, one sent again as it was passed over. It subscribes to nothing: the viewport's
  one handler of `object.onScene` (`ViewportPane.tsx`) hands it each message (`landed`), so a build's meshes
  cross the bridge once, and are held only until the picture is drawn. An object not built in this run keeps
  the picture it has on file, or has none and says `No picture yet`.
- **A card says how far its picture can be trusted** (`ui/cards.ts`): when it was made (with the year when
  that is not this one); what it draws otherwise than the object is (`cut by its section`, `parts drawn
  apart`, `1 part left out`); and `A source has changed since` (`thumbOf`: `behind`). The sources of an object
  are what a change in has it built again (`Builds.open`): the `.py` files directly in its folder and in
  `<workspace>/common` (`sourceFolders`, `newestPython`; the kernel does not say which files a model read, so
  there is nothing finer). `sourcesMtimeMs` is the newest of them when the picture was kept, and no later
  than when that build was started, so a source saved during the build is newer than its picture; a card is
  behind when the newest now is newer, when either cannot be said, or when the model is another file. When
  the last build failed the status says so in `--fail`, the picture is dimmed and is said to be `of the last
  build that worked`. A picture is asked of main only once its card is in view or near it
  (IntersectionObserver).

## A new object

- `ui/onboard/NewObject.tsx` is a page in place of the viewport (`store.page`: `'new'`; the view is `covered` and
  inert under it as under the page of objects, and the rail offers Projects alone). No row of the list is
  current (the "New project" button is pressed), and the status line is "New project" and the build123d version alone:
  no Rebuild, revision, parts or Export. The session pane shows `ui/onboard/DraftPane.tsx` (#84):
  the first prompt Claude Code will get, read-only, as main writes it (`objects.previewPrompt`, asked again 300 ms after a
  change; the one `onboardPrompt` that `objects.onboard` sends), the person's own words in ink and torno's in the muted face,
  and a thumbnail of each photo and doodle with "attached" or "named only"; unless the open object's session is live, which stays whole (see Agents).
  All of it reads `store.page`, and nothing under the page changes, so leaving it brings everything back as it was.
  The page is opened from "New project" at the foot of the list, in the head of the page of objects and in its empty
  state (`openNewObject`). It takes the focus (the name field) when it comes and gives it back to where it was when it goes. Leaving the workspace
  (opening another folder) asks when the draft has something: "A new project is set up here and not made yet".
- **The draft** (`state/onboard.ts`) lives in the window, for the workspace it was begun in, until the object is made
  or the person throws it away; nothing of it is on disk, and it is dropped when the workspace root changes. Caps
  are `MOST_REFERENCES` (shared with main), a photo or scan is refused as a duplicate by path and an object by id.
  A bought part (`steps`: a vendor's STEP file, by path; a dropped `.step`/`.stp`, 50 MB at most) is named in the preview and the prompt by the `reference/` file `stepFiles` gives it (`make.ts` `stepReferences`). A doodle keeps its strokes as vectors as well as its PNG, so that it is opened again to change. `epoch()` goes up
  at each discard: photos being read when the draft was thrown away are not put back. The held first prompt
  (`hold/take/dismiss`) is in the same store.
- **Keys** are rows of `shared/keys.ts`: `new.back` (Esc) in the scope `newobject`, and the board's `board.undo` (Ctrl+Z) in the scope `sheet`. The
  page listens in the capture phase and takes every key not meant for a field, so no tool of the view is handed
  one. In a field Esc leaves the field (the keys go back to the page) when the draft has something, and the page
  when it has not; elsewhere it leaves the page, asking first ("Discard this new project?") when there is something in
  it. A sheet or question asked over the page (the sheet of keys, the closing question) keeps its own keys.
  `export` and `rebuild` keys do nothing on this page.
- **Images are scaled in the window** (`images.ts`): the window decodes (WebP too), scales to a long edge of 1280
  px (a PNG stays PNG, anything else becomes JPEG at 0.85; a PNG already within 1280 px and 3.75 MB goes as is, a
  heavier one goes as a JPEG) and
  hands main the bytes. The header is read before anything is decoded (`headerSize`: PNG, JPEG, WebP): over 50
  megapixels is refused with its reason on the card, and a HEIC is refused with how to get a JPEG (`HEIC_REASON`). Main reads a chosen photo through `objects.readPhoto`, which serves only the paths its
  dialog offered; a dropped file is read by the window (`File.arrayBuffer`, at most 25 MB, checked before it is
  read) and its path comes from `objects.pathOf`. The copy in `reference/` is the original; the scaled picture is
  only the prompt's.
- **The board** (`Doodle.tsx`, a wrapper over `ui/board/Board.tsx`, which the chat's "Draw on view" uses too) is a sheet over the whole window (#101): a canvas of 1200 x 800 board pixels, scaled to fit the room, with a grid (`grid`: a CSS background every 40 board pixels in `--hairline`, a doodle's only; the PNG has it too, at 15 % grey, and the first prompt says 1 square = 40 px) and Shift while drawing for a straight line (`board.straight`, `straighten` in `strokes.ts`: the stroke is its first point and the pointer), pointer
  events and canvas only (no React state per move). A thin and a thick pen and an eraser; Undo takes the last
  stroke, Clear all of them; Done gives back the strokes and the PNG, Cancel and Esc leave, asking "Discard this
  doodle?" when the strokes are other than it was opened with. Its keys (Esc is `sheet.close`, Ctrl+Z `board.undo`)
  are heard in the capture phase before anything else, so that no tool under the board gets them. The PNG is made
  by `strokes.ts` with a white ground and dark ink whatever the theme: what is drawn on screen follows the theme,
  what Claude receives does not (`PNG_GROUND`).
- The name is checked against `objects.taken()` (every entry of the workspace folder, read when the page opens and
  after each create) as well as the objects. While `Creating…` shows, Escape, Cancel and the discard question do
  nothing. A note field is named by its card ("Note for photo desk.png"); numbers in the page's prose are set by
  `numbered`.
- **Create** is `ui/onboard/make.ts` (`makeObject`, tested with fakes, and guarded against a second call while one
  runs). The order is `objects.create`, the list is refreshed, the draft is spent, the object is opened as a click
  opens it, then `objects.onboard` once; the session main started is put into the store. A failure of `create`
  stays on the page with its reason and the draft intact. An error saying the object "was made, but ..." is never
  offered again: the draft is spent and the object opened if the workspace lists it. When `sessionId` is null or
  there is a `problem`, the object is open and `onboarding.hold` keeps the text: the session pane says why
  (`session-held`, with Dismiss) and the first chat's composer starts with the text, not sent. A held prompt that
  was not sent counts among what closing the window asks about (`closingWhy`'s `heldPrompt`), as does the draft.
- **The model and effort** of the new object's session are chosen beside Create (`ui/onboard/SessionChoice.tsx`,
  "Claude Code on"): "Your default model" and "Your default effort" pass nothing. The models are `chat.models()` (the
  last chat's list, or Claude Code's aliases), the CLI's own `default` row left out as the default is; the efforts
  `effortsOf` the model chosen (the `default` row's for the default), and an effort the model does not take is let
  go. The choice is `onboard.choice`, the person's, kept when a draft is spent or thrown away, and goes to
  `makeObject` and on to `objects.onboard` as `choice` (only when something is chosen).
- Styles are `styles/onboard.css`, on the tokens only; the page and the board are in `e2e/themes.spec.ts` as
  `onboard` and `onboard-board` in both themes.

## Scans

- In the window a scan's bounds tree is built in a worker
  (`viewport/scanBvh.worker.ts`), indirect, so triangle numbers hold; a scan
  is drawn before it can be pointed at. A scan drawn at 95 % or more blocks
  the pick of a part behind it, and the pointer says so (`hiddenByScan`); a
  thinner one does not. Seen through, a scan lays its depth down first
  (`depthOnly`), so only its nearest layer is blended. Nothing of a brush
  stroke or of a drag of the gizmo goes through React or the store. A picture
  coloured by distance is refused past 60,000 points or 1.5 s
  (`scanDeviation.ts`): it is worked out on the window's thread. It is lit,
  seen through beyond the range, and what is inside the part is drawn over
  it (`ScanLayer.colourFor`): its caption says the colours are approximate.
  A named view frames the parts; `look`'s `frame: 'all'` and "Frame" on a
  scan's row take the scans in, and a caption says when a scan reaches
  beyond the picture (`beyondNote`), when spread parts are not where a scan
  drawn has them (`spreadBesideScans`), and which scans have no mesh. The
  camera reaches for a scan no further than `SCAN_REACH` (200) times the
  sphere round the parts (`reaching`); a scan drawn of which some is outside
  the sphere the camera is then given is cut by the far plane, and says so
  (`beyondReach`, each scan against that one sphere: `ScanLayerState.clipped`,
  the line "Not all in view" in its row's detail from `store.scansClipped`, which
  the viewport sets with every view it reports, and `reaches beyond the
  view: not all of it is drawn` in a picture's caption).
- A scan's row (`ScanRow` in `ui/ScansPanel.tsx`) is one line, as a layer's: id, name (`.row-name`, whole with
  its source in the `title`), a dot while how it was read is a guess, its state in one word, the opacity on
  hover, the eye, and the arrow that opens its detail beneath it (`.scan-detail`; one open at a time, the
  `open` of `ScansPanel`). Everything else is in the detail: how it was read, the state's sentence (with the
  basis, `.scan-basis`), Frame, Align, Rename (main's `scans.rename`), the fields. The word and its sentence
  come from `ui/scanState.ts` (`scanState`): `aligned`, `placed`, `pending`, `check`, `rough`, `unaligned`,
  `missing`. `placed` is an alignment tied to no point of the model (`tiedPoints` 0), which no build checks:
  it never reads as `aligned`. How a scan this window just imported is read, when its unit or up axis was
  assumed, is asked once by `ui/ScanReadSheet.tsx` at the top of the section, shown for `store.scanAsking`
  (set by `importScan`, cleared by Keep, Apply, Later or another object), with the size from `sizeAs`
  (`shared/scans.ts`), the size of the parts of the layout shown (`boxSize`, worded "about"), and, past
  `UNIT_DOUBT` (100) times either way, a `--warn` line naming the unit `sizeAgainst` finds nearest. While it is up,
  the scan's detail does not ask the same (no "right? Yes", no "Read as" fields). A scan just imported is framed
  with the parts once (`importScan`, `actions.frameScan`; the viewport waits for the mesh if it is not drawn yet),
  and again after Apply; `F` and the named views still frame the parts only. `unaligned` is `--muted` for a scan
  never aligned in any layout (`data-never`), `--warn` otherwise.
- The align bar is `ui/AlignBar.tsx`, its three bodies `ui/align/`. Its three ways are numbered steps
  (`1 Floor · 2 Pairs · 3 Nudge`) with a tick (`--ok`) for each in `stepsDone` of the alignment in the layout shown
  and one line of what the step is for. `state/align.ts` `firstStep` picks where the tool opens (`beginAlign`, from
  `alignScan` in `ui/scanDrop.ts`: the Align button, "Next: align S1" on the read sheet, the bar's scan select): Floor for
  a scan `muchLarger` than the parts (`SURROUNDINGS`, 10 times the diagonal) with nothing done, else Pairs, Nudge once
  there are pairs; it comes back to what was chosen last for that scan (`chooseAlignMode`); a floor or pairs kept
  moves it on (`advanceAlign`). A tick is a step, not a state: the row still says `placed` for a floor only.
  (`FloorBody`, `PairsBody`, `NudgeBody`, and `format.ts` for what they
  share); the field one number is typed in is `ui/Field.tsx`, the Region
  bar's too, and what was typed is read by `ui/typed.ts`.
- Refs and numbers in a sentence are set in the monospace face by
  `ui/numbered.tsx`, a ref whole. `.torno/views/` ignores itself for git.
- A scan and a picture coloured by distance use tokens of their own
  (`--scan-plain`, `--deviation-*`); a region is a mark and is tinted in its
  author's mark colour.

## Agents

- The agent's terminal (`ui/SessionPane.tsx`) has its inset in the pane in the terminal's ground: the panel's,
  or the one the agent paints the edges of its screen in, when it paints one. Most of the left column and the
  bottom row decides (`ui/termGround.ts` `edgeGround`, after every write parsed); the terminal's own ground and
  the inset then take it, so that the agent's screen fills the pane (`window.__tornoTerm.ground()`; the
  stand-in's `ground r g b`).
- A session away from its pane is told where the eye is (`ui/sessionSign.ts` the rule, `ui/SessionDot.tsx` the dot,
  still, 6 px, the status line's `.status-dot`). Only `working` and `needs_input` have a sign: `working` is a
  `--muted` dot with no words; `needs_input` is `--warn`, a larger dot on the dock's toggle and the words "needs you"
  on a row, never colour alone: the state is the element's `aria-description` and its `title`, and never part of its
  accessible name, which stays the object's name (a row) or `Show session` / `Hide session` (the toggle), so that a test
  and a person's tools find a row by its name whatever its session does: the row's description is `session needs you`
  (`is working`), the hidden dock's toggle's is `Claude Code needs you`. The status line's button (`.status-needs`,
  in a `role="status"` that is always there) names the first object of the list whose session waits, with "and N
  more"; it opens that object, shows the dock (`dockOpen` and `actions.setDockOpen` are in the store, not in
  `App.tsx`) and `focusAsk` takes the focus to the open card or the terminal once the pane is of that object. The
  toggle's dot is of the open object's session and only while the dock is hidden. The rail's Projects icon
  carries the dot of any object of the list whose session works or waits (`switcherSign`: a waiting one first); its
  description says each (`session is working; bracket needs you`), "needs you" alone for the open object's; the rows of the
  Projects panel have their own dots.
- On the New object page the pane is of the object being made (`drafting` in `SessionPane`): no status, no End,
  New session or Resume, no view switch, no held prompt, and `DraftPane` in the body; `.session-term` stays laid out.
  A live session (any status but `exited`) of the object that was open stays as it is, with the note
  `.session-aside` above it ("This is the session of …"); an ended one counts as none.
- **The pane with no session, in the chat view** (`ui/chat/StartChat.tsx`, in `SessionPane` when `choice.view` is `chat`)
  has the box at its foot (`data-start-composer`, not `data-chat-composer`: that is the live chat's): Enter starts a
  session and sends the prompt to it (`startWith`, the prompt held in `pending` until the session exists, so that the
  trust question keeps it; a failed send puts it in the new chat's box, and a terminal view types it at the prompt,
  `fixRequest`, never sent). With a conversation on file (`resumable`) it shows the end of that conversation read-only
  under "Last conversation, 2 days ago" (`chat.lastConversation`: main reads `.torno/chat/`, the words and the turns of
  the last eight items, no tools, writes nothing; `ago.ts`), and "Continue" (resume, the default) / "New conversation"
  beside "Send". "New session" and "Resume" stay as plain buttons: they start with no prompt, and what was written
  waits unsent in the new chat's box (`holdDraft`). A terminal view keeps the old empty state. No "Attach view" or
  "Draw on view" here: a drawing is of a session.
- The session header names Claude Code, the one agent there is; under it, "Chat · Terminal" chooses the view.
  When `.torno/agent.json` could not be followed (`note` of `session:current`) the pane says why, with "Use
  Claude Code", which writes the file anew and is disabled while a session runs.

- **The chat pane** (`ui/chat/`, `state/chat.ts`; a Claude Code session whose `view` is chat has no `.xterm`). The
  window draws what main's transcript says: `placed` and `drawn` in `state/chat.ts` reproduce main's order
  (an item keeps its place; a queued prompt is drawn after all the others; sent, it goes to the end), and items
  and metas are merged by `seq` with the history, so none is drawn twice or lost. Each `context` item is drawn
  under its prompt, as chips from its fields (marks, build, selection, and how many instruction files it named), never from its text. One made for a tool's
  card (`forTool`: the build an edit of the model started) is a build line under that card (`BuildLine`), drawn from
  its fields alone: `Built r2 · ok · 1.2 s`, or `Build after r2 failed: <the last line of the traceback>` in `--fail` (a revision names a build that worked, as
  `main/builds.ts` counts them: a failure has no number of its own and is the build after the one on show, `failedAfter`
  of `shared/build.ts`, which the Stop hook says too; the prompt's "torno added" line says it alike), or, of a build
  still running when the edit's answer could wait no longer (main writes that line once and never again), "Still
  building when Claude Code was answered", in the past so that it stays true, "Show
  error" while that failure is still the latest build, the dimensions whose verdict it changed (`digest.dimensions`,
  from `verdictChanges`, never worked out again here) as chips with `now passes` / `now fails`, and the parts it
  changed (`digest.parts[].text`, four at most, the rest counted), then "Show text". The sheet of a failed build is
  `errorOpen` in the store (`actions.setErrorOpen`): the status line, the viewport's "Show error" and the chat open
  it. An `Edit` or a `MultiEdit` is drawn as a diff (`ui/chat/Diff.tsx`, from the tool's own input by `ui/chat/lineDiff.ts`, never
  from the person's files), in the permission card (six lines removed and added, then "Show all") and, in place of the JSON, in the
  opened tool card (twelve): each line has a `−` or a `+` in the gutter, a removed one is struck through (`<del>`), an added one is
  `<ins>`; the washes behind them (`--diff-removed-wash`, a grey step of the hairline on the panel, and `--diff-added-wash`,
  the accent's wash) only group, and are neither mark colours nor verdicts (`contrast.test.ts`). The diff is of `old_string`
  against `new_string` alone, so its context lines and "N unchanged lines" are of the edit and have no place in the file: a
  caption on every diff says "Lines of the edit, not of the file: where it lands is not shown". An edit with `replace_all`
  says "Replaces every match in the file" (`Hunk.everywhere`), a card never understating a change. The cap of 400 lines is
  of what differs once the lines both texts share at their ends are left out; beyond it the text is not compared, and says
  "Too long to compare": every old line of it is shown removed and every new one added, so a large deletion is never out of
  sight. A `Write` keeps the first lines of what it holds, there being no old text to compare with. A tool card reads "denied" (the person refused its ask) or "cancelled" (its ask ended with the turn stopped) in the muted colour; "failed", in the fail colour, only for an error the person did not cause. Nothing is per frame
  in React, and there is no endless animation in it: a working indication is still, toggled once a second by
  `useBeat`, and only while something streams or runs (`styles.test.ts` fails for an endless one). The window holds
  at most `MAX_ITEMS` (2,000) as main does, dropping the oldest, and says once, at the top, "Earlier items are not
  shown"; a session no pane shows takes in no picture data, also from a history that was on its way.
  The chat that ended before the window was loaded is shown from main's transcript (`session:current`'s `ended`).
  Beside the model menu (`chat/ModelMenu.tsx`) the effort menu (`chat/EffortMenu.tsx`, `EFFORT_LABEL`): "Default
  effort" until one is set (`meta.effort`), then the levels the model takes (`effortsOf`; none for a model that takes
  none, and then no menu), `chat.setEffort` for the session only; a refusal takes the choice back and is said beside it.
  What the CLI says of itself comes as notes and as meta: the header's status word gains ", retrying (attempt 3)"
  while `meta.retrying` is set and the session works (the status itself is still the hooks'), and while
  `meta.pluginLoaded` is false a line above the box offers "Restart with the whole prompt" (disabled while the agent
  works), which starts the session again, resumed, with `session.start(…, { skills: false })`. A note with `action:
  'terminal'` (the chat could not use the login) has "Use the terminal" beside it (`ChatOffer` of `chat/offers.ts`,
  given by `ChatPane` to the session's own items only, never to "Earlier in this conversation"; disabled on the view
  switch's condition), `offerTerminal` of `SessionPane`: asked about first while the session is busy, as a view picked
  is; otherwise, and after that question, `applyView('terminal', true)`, which ends a live session, writes the view and
  starts a terminal session resuming the conversation whether the chat was live or had ended, and also when the
  choice already was the terminal. A note's `action` other than `terminal` is dropped when a log is read (`readLog`).
- **A build's chip says what it was made from** (#62). A context item carries `identity` (`BuildIdentity`, main's, from `builds.jsonl`'s
  record of this run); the `r12` chip's title gets `made from sources …, on a1b2c3d with changes` (`RefChip`'s `of`, `identitySaid`),
  and a build line's "Show text" has it in a line. Under "Earlier in this conversation" (`ChatEarlier`) the title says that a
  revision counts from 1 in every run and may name another build now. The status line and the card say what has changed since
  the last commit (`useGit`, `GitText`): read, never written.
- **The end of a turn** (`ui/chat/TurnEnd.tsx`; the rule is `ui/chat/turnSummary.ts`, pure). Its first quiet line is
  "Done in 42 s" and then what the turn did, said from the turn's own items and nothing else (`turnSummary` over
  `itemsOfTurn`, the items after the turn before it): the files the agent's `Edit`, `Write` and `MultiEdit` changed (only
  those that finished: a denied one is not counted), the builds their edits started (`r1 → r3 ok`, `build failed`,
  `r3 ok after 1 failed build`: the first revision is the build on show when the prompt was sent), the marks it resolved
  and added (`resolve_mark`'s `id`; `add_mark`'s from its answer), and the dimensions whose verdict at the end is another
  than at the start (the first `was` and the last `now` of the digests, `verdictChanges`' own). What it pulled from torno
  is a line of its own. Under them a row of buttons for the turn (`TurnActions`): "See changes" (only when an edit
  changed a `.py`), which opens `ChangesSheet` over the transcript as a picture is shown large (a dialog in the host
  `.chat-scroll`, `chat.close` puts it away, Tab goes round within it, the focus goes back to the button): per file main
  kept (`chat.changes`, in memory, the last 20 turns; none is "No change ... is kept for this turn"), "Changes" (the
  file before against after, `Diff` with `ofEdit` false, so without the caption that is true only of an edit's lines)
  or "Whole file" (read only, the monospace face, no refs searched), and, below, the builds taken together
  (`netParts`: a part's volume and faces from the first digest's `before` to the last's `after`, `≈` unless exact). The builds of the turn's prompt are
  joined to it (`ui/chat/historyJoin.ts` `joinTurns`: the turn answers the `user` item before it, and the history's
  entries whose `turn.prompt` is that item's id are its; `ChatPane` reads them with `useHistory`, `ChatItems` joins) and
  drawn as a strip under the account (`TurnBuilds.tsx`: the build the prompt began from, dashed, its builds, a failed
  one marked `failed`, at most five pictures and `+n`; `turnFacts`: the parts changed, the checks that flipped, the
  builds that failed on the way). The buttons: "Compare" (`actions.compare(from, to, prompt number)`, "Comparing" while
  it is on, off while a section or an explode is), "See changes", "Go back to before this prompt" (`GoBack.tsx`) and
  "Star" (`history.star` on the last build). Go back reads `history.goBackPlan` and asks once with `Confirm`, listing
  what is written, deleted, left alone, changed since, the Params and the prompts undone (`planLines`), then calls
  `history.goBack` with what it was shown; it is off while the session works (`ChatIdle`). A plan with `fallback: 'undo'`
  says "Claude will be asked to put the files back instead." and its "Ask Claude" is `chat.undo`, offered only on the
  last turn of a live idle chat (`UndoableTurn`, which `ChatPane` gives its id to while no prompt of the person's
  follows); a refusal of main is said beside the button. Between turns, a build the person made (`cause` person or
  params) is a line (`SaveLine.tsx`; `savesBetween` takes them between two prompts' times, several in a row with no
  other build between are one run, `saveWords`); the prompts a Go back undid (`goneBack`: every build of the prompt is
  `undone`) are one faded row with "Show" (`rowsOf` in `Items.tsx`, which also places the lines), faded by the muted
  face, never by opacity. Prompt numbers are the project's (`numbersOf`, above). All of it is drawn from main's own labels: the window works out no cause.
  A further action for a turn is one more button in `TurnActions`, given the turn's `item` and `account`.
- **The agent's question** (`ask`; `state/asks.ts` follows main's list, `ui/QuestionCard.tsx` draws it): a card with
  the question, a button for each answer (its label, its refs in the monospace face), and "None of these". The pointer
  or the keys' focus on a button lights its refs by `peek`, as a ref chip does, and only when the layout shown is the
  question's. With `pick` the card offers "Answer with `lid/F12`" while exactly one face or edge is selected in the
  view (selecting is the Select tool's, unchanged), else says to select one. It stands above the box of the chat
  (`where="chat"`) and, where the chat is not in sight (a terminal session, or the dock put away), over the foot of the
  view (`where="view"`), never both. It answers once (the buttons go off) and goes when main takes the question down.
- Refs are chips (`RefChip`, `refs.ts` `refInfo`): hover lights the ref through `peek` in `state/agent.ts`, which
  is not an agent highlight (no agent line, no locked tools) and is drawn in the accent on a layer of its own
  (`point` in `viewport/highlight.ts`, `Viewport.setPointed`), never in a mark's colour, whoever made the mark it is
  of; what the agent points at keeps its own layer and colour meanwhile; click focuses a mark or selects a face or edge (the
  chip of the build on show, once the build after it has failed, opens the sheet of that failure; an older build
  is an inert chip), and
  a click with the pointer gives the keys back to the view (`giveKeysBack`), as every action on the view does. A
  ref that names nothing now is an inert span with the reason as its title. A ref in prose that names nothing the
  object has is not a chip at all (`RefInfo.plain`: a mark it has not, `M3` the screw; a build above the current or
  `r0`; a part the build has in no layout); a part in another layout, or a face it lacks, is an inert chip with
  its reason. Code is never searched for refs. Numbers in the person's prompt and in a card's questions and
  options are set in the monospace face like the rest.
- Keys of the chat are rows of `shared/keys.ts` in the scopes `composer` and `picture`: `chat.send` Enter,
  `chat.newline` Shift+Enter, `chat.command` Up/Down and `chat.complete` Tab (while `/` commands are offered),
  `chat.close` Esc (a picture shown large; the focus returns to its thumbnail), `chat.stop` Ctrl+C (composer, only while the session
  works and nothing in the box is selected: with a selection it is a copy) and `chat.allow` Enter (scope `ask`: on the card itself
  in focus, not its buttons or its field, where Enter refuses; not on a question). While a permission or a plan is open
  (`openAsk` in `Composer`) the box's placeholder is "Answer the card above, or say what to do instead", its primary button
  is "Deny and send" (`chat.answer` with `allow: false` and the text as the message; Enter in the box does the same) and "Queue"
  is the secondary; a question (`AskUserQuestion`) changes nothing in the box. Escape in the box gives the keys
  back, except while the list of `/` commands is open: it closes the list. A card takes focus once per request, and
  only when the composer is empty and not focused. An unsent prompt in a chat that is not over is among what closing
  the window asks about (`closingWhy`'s `unsent`). "Attach view" is sent in order: main waits for the picture
  before taking the next prompt, so one sent meanwhile cannot overtake it.
- **Suggestions** (`ui/chat/Suggestions.tsx`, the rule pure in `ui/chat/suggest.ts`): while the box is empty and the
  session live, at most three chips above it (`MOST_SUGGESTIONS`), in this order and each only when it applies: "Fix the
  build" (`fixPrompt`, the build failed), "Review N marks" (marks not resolved; `/mcp__torno__review `), "Check
  printability" (the layouts have `print` and the conversation, `earlier` too, holds no `check` of kind thin, overhang,
  mesh or bed and no `/mcp__torno__printable` prompt), "Explain this model" (no prompt of the person yet). The three
  commands are not offered when `meta.tornoConnected` is false. A chip fills the box, cursor after, keys the box's, and
  never sends. The build error sheet's "Ask Claude Code to fix it" already does the same with `fixPrompt`.
- **The instruction files Claude Code reads** are one quiet line under the view's row in `SessionPane`
  (`.session-reads`, `role="note"`, shown for both views and with no session, not while a new object is being made;
  `session.instructions`, asked again when a session starts): "Claude Code also reads, by default" and, for each file, its name
  (`shared/instructions.ts` `named`, the home folder as `~`, a rules folder with its slash; a button that shows it in its
  folder by `session.revealInstruction` with the row's index, never a path) and what it weighs (`weighed`: sizes through
  `shared/format.ts` `bytes`, `a link, not followed`, `up to 3 files, 2.1 KB` for a rules folder: at most that many load), in the monospace face; its title says what the list
  is (`READS_TITLE`: by default, paths and sizes only, never read or changed). It is no question and nothing of it is stored:
  there is no "seen" state, and it is there each time the pane is of an object that has some (`e2e/instructions.spec.ts`; the
  capture `instructions` of `themes.spec.ts`).
- The chat is refused, with a question, for a folder that has Claude Code settings of its own and has not been let
  (`SessionPane`: `trusting`; main's refusal is `trustQuestion` of `shared/agents.ts`): "Start the chat" asks main
  to remember the folder and starts again, "Use the terminal" chooses that view and starts it.
- The agent's text is drawn by torno's own `markdown.tsx`: React text nodes, never raw HTML, a link shows its URL
  and is not an `<a>`. A picture without its data (`ui/chat/gone.ts` `goneText`): a reference of the person's
  (`ChatImage.file`, `reference/doodle-1.png`) is shown from that file, asked of main once through `chat.reference`
  and scaled by `ui/onboard/images.ts`, as an object URL (`state/chat.ts` `referenceUrl`: 40 at most, revoked when
  let go of, when its session is released or dropped), its file name as the thumbnail's title, the frame empty
  while it comes; one main has no plain file for says `reference/doodle-1.png is no longer there`, the path in the
  monospace face. A tool's picture says "Picture of an earlier build, not kept"; any other "Picture not kept".
- **A tool card goes to what it showed** (`ui/chat/ToolCard.tsx`). The line is a row (`.chat-tool-row`) whose toggle
  (`.chat-tool-line`, `aria-expanded`) covers it, so that the refs of a torno card's label are live chips (a button inside
  a button is no HTML) and the action is a button beside the state. A finished `look`, `section` or `show` has "See in
  view" (`show`: "Show again"): `seeInView` in `state/agent.ts` reads the card's input once more against the window as it is
  now (`replayOf` in `state/seeAgain.ts`, pure: a saved view it names is that view but for what is given beside it; a cut
  given leaves the parts together; an explode under a cut, a layout, scan or saved view the build lacks are refused in the
  tools' words, and a `focus` is not framed again, it being worked out in main) and applies it as the person's own edit
  (`actions.applyLook`, which `applyView` is the saved-view case of: `shownByAgent` cleared, no `activeView`) and then
  moves the camera. A finished `highlight` has "Point again" (`pointAgain`) only for a card that was seen as it
  happened (`noteTool` in the chat's `onItem` keeps the object and build on show then: a ref names whatever that face is
  in the build it was read from), and only while the window shows that build. A refusal is a line under the card.
- **A turn's tool lines fold, and the agent's list is kept in sight** (`ui/chat/fold.ts`, `tasks.ts`, `Tasks.tsx`; drawing
  only: the items, `MAX_ITEMS` and the log are as main made them). `ChatItems` draws `foldRuns` of what it has: a run of
  `FOLD_AT` (3) tools or more that are the agent's own, `done`, with no picture and nothing under them (no build line), and
  not a task tool, which lies before the last `turn` item, is one line (`ToolFold`, `foldLabel`: `Read 3 files, Grep ×2,
  Bash`, opening into the lines); thoughts that are over between its tools are part of it, any other item ends it, and a
  turn still going on folds nothing. A card's `done` is not written (`data-state` has it); the other states keep their word.
  The agent's list is read from the cards (`tasksNow`, `listsAt`): `TodoWrite` is the list whole, `TaskCreate` adds one
  (numbered as its result says, else in order) and `TaskUpdate` changes or removes one; a call that did not end `done` writes
  nothing. `TasksBar` is above the box while the session works and a task is left; `TasksCard` is the list as it stood at a
  `TodoWrite`, or under the last of a run of task tools. Which of the two the real CLI uses is for a hand check.
- **"Draw on view"** (`ui/drawing/`, `state/drawing.ts`). The ground is the agent's own picture of the view
  (`picture({ view: 'current', size: 1280 })`, the code of `look`), opened on `ui/board/Board.tsx` by `ViewBoard`, over
  the whole window as the export sheet is. The ink is `--drawing-ink` over a casing in `--panel` (`InkLook`), read once
  when the picture is made: the picture is of that theme. "Done" (`finishDrawing` in `make.ts`) composes the PNG
  (`compose.ts`) and, only while the screen is what the picture was made of (`ViewHost.shows()`, registered by
  `ViewportPane`: object, build, layout, camera, canvas size, section, explode, parts and scans shown), picks the view
  along each pen stroke where ink is left (`under.ts`: every 6 board pixels, 48 points a stroke at most): a face
  (`edges: false`), else a section's cut face, by its part (`Viewport.pickedCutOf`, from `pickUnder`'s `cutOf`), else a
  scan, else nothing. `ViewHost.shows()` is `screenShows`: a scan counts by whether it is drawn, how thin, whether its
  mesh has come and where it stands, not by whether its tree is made. A point of the picture is the same fraction of the canvas: one camera,
  one aspect. The faces' descriptors are waited for 3 s. The drawing then waits per session above the composer's box
  ("Edit", "Remove"); the board put away, by Done or Cancel, gives the keys to the composer's box (its own giving back
  finds "Draw on view" disabled once a drawing waits). It is taken by the next send and given back if that fails, counts as an unsent prompt when the
  window is closed (`unsentSessions`), and goes with the workspace (`clearDrafts`). The composer's box takes the pane's
  width; its buttons are a row under it. The drawing's row says what its ink lies over, in live chips
  (`ui/chat/DrawnOver.tsx`, from `drawnOver` of `shared/drawing.ts`: the faces, `the cut face of lid`, scans, `stroke 1 partly over no part`, `stroke 2
  over no part`; the hover lights a face in the view as everywhere): one that was not worked out says so in `--warn` with
  "Draw again" (which drops it and opens a new board); one drawn on an earlier build says its faces are of that build.
  The sent prompt shows the same line under its picture (`drawing` on the user item). "Attach view", pressed, shows a
  thumbnail of the view as it is now in a row of its own beside the drawing's, with "Remove"; that very picture is the one
  sent (`attachedView` of `chat:send`, kept as bytes beside the thumbnail, shown again if the send fails), not another made as
  the prompt goes. The board is titled "Draw on view", as its button.

## Export

- "Export…" is a button in the status line for the open object, in the head of the page of objects for every
  object that can be exported, and on each card that has a build of this run, for that object. The sheet is
  modal (`aria-modal`, Tab stays in it, nothing behind it takes a click). `Ctrl+Shift+E` (the row `export` of
  `shared/keys.ts`, heard everywhere, the terminal included) brings it up: for the open object, or from the page
  of objects for any. There is no agent tool for it.
- Its format buttons (`HTML page`, `STEP`, `STL`, `3MF`) choose what is written; the HTML page is the default
  and its sheet is as it was. A file of the model is of one object (the objects are then radio buttons), one
  layout (`defaultLayout`: `assembly` for STEP, `print` for a mesh) and the parts ticked (one, by radio, for an
  STL; a part with no solid cannot be ticked for a mesh), each from the plan's `layoutParts`; a mesh has a
  tolerance and an angle typed in, and Export is off while either is out of its range. A 3MF has "Open it once
  saved", off by default. The window sends names and numbers and never a path; once saved, the sheet says where,
  of which build, and what the read-back checked (`ExportSaved.checked`), every number in the monospace face.
- **The sheet is grouped by who will open the file** (`READERS` in `ui/ExportSheet.tsx`, inside the group "Format"): "A page to
  look at" (HTML page), "The CAD file" (STEP, STL, 3MF), and, only where the sheet is of the open project's view
  (`ofView`: an object on show, not the page of projects), "A picture" (PNG) and "A drawing of a section" (SVG, PDF).
  A picture or a drawing is of the open project as it is on screen: the sheet then shows no list of projects, `ViewChoices`
  in its place (a picture's long edge, `PICTURE_SIZES` 1280 to 4000, "Marks", "Axes and scale bar"; a drawing needs a section on
  screen and says so, with Export off, when there is none). The window draws the picture itself (`pictureForPerson` in
  `state/agent.ts`, the code of `look` with `ImageRequest.person`) and hands main its bytes with the object's id
  (`export.savePicture`); the drawing is made in main (`export.saveSection(id, 'svg' | 'pdf')`, no bytes from the window).
  Main asks where to save, so the window names no path. `person` is set only there: a request of the agent's, which comes
  over `view:look`, is held to 2000 px (`connectLook`). Its saved line offers "Show in folder", never "Open in browser".
