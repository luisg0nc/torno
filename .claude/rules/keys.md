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
  - "app/src/renderer/ui/ViewportPane.tsx"
---

# Keys and tools: the table of keys, Rebuild, the error sheet, the Measure tool

Moved as written from the folder `CLAUDE.md` files; each heading names the folder it came from, and paths are written as they were there (see "Rules by area" in the root `CLAUDE.md`).

## Marks (`app/src/renderer`)

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
