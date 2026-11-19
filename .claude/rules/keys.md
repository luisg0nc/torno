---
paths:
  - "app/src/renderer/tools/*.test.ts"
  - "app/src/renderer/viewport/ShapeGizmo.ts"
  - "app/src/renderer/viewport/ShapeGizmo.test.ts"
  - "app/src/renderer/ui/ShapeFields.tsx"
  - "app/src/renderer/tools/*Tool.ts"
  - "app/src/renderer/state/tools.ts"
  - "app/src/shared/keys.ts"
  - "app/src/shared/keys.test.ts"
  - "app/src/shared/keyboard.ts"
  - "app/src/shared/keyboard.test.ts"
  - "app/src/shared/keySentences.ts"
  - "app/src/shared/keySentences.test.ts"
  - "app/src/renderer/ui/KeySheet.tsx"
  - "app/src/renderer/ui/typing.ts"
  - "app/src/main/devkeys.ts"
  - "app/src/main/devkeys.test.ts"
  - "app/src/renderer/tools/Tool.ts"
  - "app/src/renderer/tools/measureTool.ts"
  - "app/src/renderer/tools/tools.test.ts"
  - "app/src/renderer/ui/BuildStatus.tsx"
  - "app/src/renderer/ui/BuildStatus.test.ts"
  - "app/src/renderer/ui/BuildErrorSheet.tsx"
  - "app/src/renderer/ui/BuildErrorSheet.test.ts"
  - "app/src/renderer/ui/ToolPalette.tsx"
  - "app/src/renderer/state/measured.ts"
  - "app/src/renderer/state/measured.test.ts"
  - "app/src/renderer/viewport/heldValue.ts"
  - "app/src/renderer/ui/view/MeasureTag.tsx"
  - "app/src/renderer/ui/ViewportPane.tsx"
---

# Keys and tools: the table of keys, Rebuild, the error sheet, the Measure tool

Moved as written from the folder `CLAUDE.md` files; each heading names the folder it came from, and paths are written as they were there (see "Rules by area" in the root `CLAUDE.md`).

## Marks (`app/src/renderer`)

- Tools and keys: every key torno listens to is a row of `shared/keys.ts`
  (`KEYS`: its keys, what it does, the group the sheet lists it in, and the
  scope it is listened to in). A handler asks `pressed(e, id)` or
  `which(e, id)` and never names a key; a button or a tooltip takes its key
  from `hint(id)`; the reed's tools, the compass's views and the gizmo's
  ways are `TOOL_KEYS`, `VIEW_KEYS` and `GIZMO_KEYS`; the sheet of keys (`?`,
  `ui/KeySheet.tsx`) is `cheatSheet()`. A tool's key is shown in its tooltip,
  in the name of the tool in hand (the reed's pill) and on the sheet of keys; on no button (`aria-keyshortcuts` holds it); nowhere else. The empty Marks section names no key: it
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
  table: it is another program. The reed's tools are `TOOL_KEYS` in the order of their groups (`group`:
  `inspect` Select, Measure, Section; `mark` Pin, Arrow, Draw, Shape, Region; `scan` Align), drawn as one
  `role="group"` each (`TOOL_GROUPS` in `state/tools.ts`, its `aria-label` the group's name), each a pill of the reed; the sheet of keys and the manual's table follow that order. The Measure tool is
  `tools/measureTool.ts`; what its clicks measure is chosen in the pill of Measure (`pillOf` in `ui/view/reedPill.ts`, drawn by `ReedPillView` of
  `ui/ToolPalette.tsx`), and a dimension's expectation is typed in
  `ui/DimensionFields.tsx`. **A measurement is no mark**: the tool asks main (`ctx.measure`, `geometry.measure`)
  and nothing is committed; the kernel's value replaces the `≈` estimate at the pointer, and the last
  measurement is held in `state/measured.ts` (`Held`: its ends, kind, layout, build, camera, value and `how`),
  which changes once per measurement. Its tag on the measured line shows it (`ui/view/MeasureTag.tsx`, only for the object and build on show)
  until the next first end, Escape with nothing under way or the tool put down. It is kept as a dimension only
  by `measure.keep` (Enter) or its "Keep as a dimension", both `keepHeld`, which commits the same
  anchors through `commitMark` (main measures it again); the tag then says `Kept as M7`, and a kept dimension main refuses is a second tag (`problem`). The kernel's two points (`Held.points`) draw it in the view until then: a `held` draft (`Draft.held`, the value text) in `--ink`, not faint; the tag's subject is the middle of that line (`readingAt` in `viewport/heldValue.ts`: nothing of the value is drawn on the canvas); the tag holds the value in mono 19 px with its unit at 11 px, `how, exact` and a distance's `Δx Δy Δz` (`componentsOf`), and the primary "Keep as a dimension". While a size of the brief is being tied (`state/tying.ts`, `board.md`) the button and Enter are `keepHeldAndTie`: "Keep and tie to the size". A readout is not a
  mark and is never drawn in a mark's colour. In Angle, before the second click, an end the kernel takes by its axis, only if
  flat or straight, or never (`angleTaking`, by the descriptor's type, the kernel's rule) is said at the pointer
  in place of the `≈` estimate; it is a hint, never a gate: the click is sent whatever it says. A tool is a `Tool`
  (`src/renderer/tools/Tool.ts`) and gets every pointer event the chips of the marks do not take from the one
  subscription in `ui/ViewportPane.tsx`. Nothing of a pointer move goes
  through React or the store. **The Draw tool is a 3D sketch** (`tools/sketchTool.ts`, `state/sketching.ts`): its keys
  are the scope `sketch`, which has the key before the viewport and may take a letter of a mark tool, but never a key of the
  view (fit, `1`-`4`, explode, section, ortho: `keys.test.ts`); the figures are the length of a segment only while one is
  drawn. While a sketch is open `X` (`tool.section`) is the sketch tool's: it shows or hides the view's existing cut (`viewport.setSection(null)` or the store's plane, the store untouched, shown again when the tool is put down) and `ToolPalette` does not pick Section for it; a new cut still means picking Section, which ends the sketch as Done. Shift with a letter is that letter, so no sketch key is Shift and a letter; the planes are `Shift+1`, `Shift+2`,
  `Shift+3`. `Ctrl` held is read off the pointer event (`ViewportPointer.ctrl`), and `Ctrl+Z` has its own listener
  (`connectSketching`), the viewport pane handing no chord to a tool. What it lays over the view (the hint, the label of its
  plane, the view cube) is drawn by `OverlayPass`, and the sheet of the plane and its handle by `SketchSheet`, never through React.
  The pens grow out of Draw's name in the reed (`pillOf('draw', …)`, `.reed-pill` in `styles/tools.css`) while Draw has a sketch open: Free, Line, Point to point and Erase (Snap and X-ray are switches, `role="switch"`, in the sketch panel in the card's head, `.sketchpanel-switch`); each pen is a real `<button>` with its key from `hint()` and calling the actions the keys call (`setPen`, `setSnapping`, `setXray`), so a key and a button never disagree. Snap has no key of its own: it shows `Ctrl`, which turns it off while held.
- **The keys of a review** are three rows of scope `window`, heard outside a field and the terminal with the model on show
  (`useReviewKeys`, `ui/ReviewBar.tsx`): `marks.review` (`H`) starts a round on the build on show, or finds the one that is open;
  `review.dont` (`-`) and `review.want` (`=`, `+`) choose what the marks made next are while a round is open on the layout shown, the
  key of the one chosen taking it back to plain. A `window` key has no other row in any scope, so none of them is `[` or `]` (the align
  patch and the region brush), and `keys.test.ts` says so. The bar's buttons take their keys from `hint()`.
- **`set.make`** (`Ctrl+G`, scope `window`) names what is selected as a set: heard outside a field and the terminal with the model on show
  (`useSetKeys`, `ui/sets/MakeSet.tsx`), it opens the popover (name, comment, colour; `Enter` makes it, `Esc` leaves), and with nothing selected says
  `Select faces, edges, parts or strokes first` in the status line (`data-notice="sets"`). It is a `window` key, so no other row has it in any
  scope; the popover's hint is `hint('set.make')`, never `Ctrl+G` written out. The select scope Set has no key of its own.
- **`board.swap`** (`Ctrl+Tab`, scope `window`) goes Board, Model, Tracing and back to Board, and passes over Tracing in a project with no tracing (`swapped`, `state/board.ts`).
  **The `tracing` scope** is heard only while the Tracing view is shown (`ui/tracings/TracingView.tsx`, which also stops the view's own keys, `viewKey`): fit and 1:1 (`Shift+1`, `Shift+0`), the
  tools (`V` Select, `T` Trace, `P` Pin, `I` Ink, `M` Measure, `O` Should be here), the arrows that nudge a shape (`tracing.nudge`, which is four keys in one row), and `Enter`, `Backspace`,
  `Ctrl` (snapping off), `Esc`, `Delete` and `Ctrl+Z` for what is under way. **The `lineup` scope** is the photo's line-up, which covers the view while it is open (`S`, `Backspace`, `Enter`,
  `Esc`): its rows are `tracing.*` ids in the scope `lineup`, so a key the tracing scope has too (`Backspace`, `Enter`, `Esc`) is not heard twice. Neither scope takes a key of another scope
  with the same chord (`keyClashes`), and the buttons and hints take their keys from `hint()`, never written out. The tests of `tools/*.test.ts` and `keys.test.ts` hold the table, and the
  manual's key table is generated from it (`readme.test.ts`).
- **The keyboard** (`?`, or the `?` button of the status line, `data-keys-button`; `ui/KeySheet.tsx`, `styles/keys.css`) rises from the foot of the window, 400 px high over the view and the card (the status
  line stays), with `--scrim` fading in from a fifth of the height above it (0.32 s, none under reduced motion). The places are chips (`PLACES` in `shared/keyboard.ts`, each
  holding finer `Context`s, from `contextOf(row)`: scope and group of the row); a field, a menu and the keys for working on torno are searched, not browsed. The keyboard is `KEYBOARD` (US
  QWERTY, `Esc` and `F6` among its caps), 56 by 48 keys with a 7 px radius (the one hard radius `styles.test.ts` allows in `keys.css`); `capOf(code, context)` says what a cap does there (a word from
  the row's id, the whole text for its tip), whether it is a tool's key (accent wash) and whether it is heard in the view (outline); what is heard everywhere shows in every place. The sheet draws
  `drawnKeyboard(...)` and never reads a key press: a cap's `code` is read only in `shared/` (`keys.test.ts` scans the window's sources). Keys with a modifier are listed under the keyboard, by place.
  **Search answers in sentences** (`shared/keySentences.ts`): `sentencesFor(query)` is one sentence for each place a key or words are heard, from the rows' `does` turned from the imperative
  ("Draw the parts apart") to what the key does ("E draws the parts apart"); several keys take the verb as it is, a row's `Label:` is the sentence's "for Label" (or, for a tool's key, "V picks Select: ...";
  for a label that is a verb, "Esc steps back: ..."), and `notHeard` says where a key is not heard, from its scope. No sentence is written by hand for a key: the grammar knows the verbs (`VERBS`, `NOUNS`)
  and `keySentences.test.ts` fails for a row that begins with a word it does not know, so a new row either reads as a sentence or its first word is added there. A single key's name searches by key
  (`E`); anything else is all the words, in what a row does, its keys, its place and its id (`explode`). The count line is said once (`aria-live`); the pointer's rows are searched as before (`matchingPointer`).

## The left column's key

- `column.toggle` (`Ctrl+Shift+L`, scope `global`, as `dock.toggle` is) shows or hides the left column (`useColumnKey` in `App.tsx`, `store.leftOpen`, `actions.setLeftOpen`). It is the window's and is not kept: a window opens with the column shown. It does nothing on the pages that have no column. Hidden, the `aside.left` is `hidden`, so F6 skips it, and the status line says what waits: the dimensions that fail (`.status-dimensions`) and, when `leftOpen` is false, `N values tried` (`data-part="tried"`), a button that shows the column. `/` and the picker find nothing to open while it is hidden.
