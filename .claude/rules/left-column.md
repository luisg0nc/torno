---
paths:
  - "app/src/shared/groups.ts"
  - "app/src/shared/groups.test.ts"
  - "app/src/shared/palette.ts"
  - "app/src/shared/palette.test.ts"
  - "app/src/renderer/ui/Layers.tsx"
  - "app/src/renderer/ui/Layers.test.ts"
  - "app/src/renderer/ui/layerMarks.ts"
  - "app/src/renderer/ui/layerMarks.test.ts"
  - "app/src/renderer/ui/card/*.ts"
  - "app/src/renderer/ui/card/*.tsx"
  - "app/src/renderer/state/paramFind.ts"
  - "app/src/renderer/state/paramFind.test.ts"
  - "app/src/renderer/state/pointed.ts"
  - "app/src/renderer/ui/LeftEdge.tsx"
  - "app/src/renderer/ui/PartPicker.tsx"
  - "app/src/renderer/ui/pickerRows.ts"
  - "app/src/renderer/ui/pickerRows.test.ts"
  - "app/src/renderer/state/column.ts"
  - "app/src/renderer/state/column.test.ts"
  - "app/src/renderer/styles/panels.css"
  - "app/src/renderer/styles/card*.css"
  - "app/src/main/mcp/viewTools.ts"
  - "app/e2e/groups.spec.ts"
  - "app/e2e/references.spec.ts"
---

# The left column: layers, groups of parts, references, folding and the splitters

Moved as written from the folder `CLAUDE.md` files; each heading names the folder it came from, and paths are written as they were there (see "Rules by area" in the root `CLAUDE.md`).

## What crosses processes (root `CLAUDE.md`)

- A group of parts is the model's (`groups(p)`, read by the worker that loads the model, `Scene.groups`): one
  level, a part in one group at most, across layouts by part name. A group name is not a ref (no `/`, not `M<n>`,
  not a part's name: the loader refuses those). Wherever a tool takes part names a group's name stands for its parts
  in the layout (`shared/groups.ts` `partsNamed`, in main before a request and in the window alike). torno never
  writes the model: the only thing it keeps of groups is which are folded (`folded` in `scene.json`).

## Marks (`app/src/main`)

- **Groups of parts.** `show`, `look` and `save_view` take group names in `parts`, and `highlight` in `refs` (a
  bare name only: `flat/F1` is refused, saying that `flat` is a group and naming its parts), expanded in main by
  `partsNamed` before the request goes to the window; the window expands what reaches it by the same rule. A
  saved view is kept with part names. `scene` lists `groups` for the layout shown (`{name, parts, visible}`) and
  each part's `group`; `describe` of a group's name is the box of its parts and their volume, from the scene,
  exact only where every part's is, naming by part a member with a solid inside out (`reversed`). `state.md` names each layout's groups before its parts.

## Groups (`app/src/shared`)

- `shared/groups.ts` is the one rule of a model's groups of parts (`Scene.groups`, `PartGroup`), for main and the
  window alike: `groupsIn(scene, layout)` (the groups with a part in the layout, each with only those parts),
  `groupOf`, `partsNamed(scene, layout, names)` (part or group names to the part names of the layout, in order, no
  repeats; an unknown name is the failure, worded `unknown part '…'; parts in layout …; groups: …`) and
  `groupVisibility` (`all`, `some`, `none`; a part with no settings is visible).
- Which groups are folded in the layers list is view state: `folded` (group names) in `scene.json`, read by
  `main/scenefile.ts` as one-line names, each once. A saved view keeps part names, never a group's.

## References (`app/src/shared`)

- `Part.role` is `'reference'` for a bought part the model puts among its `references(p)`; absent of a part to make. Whoever
  lists, exports or counts parts for making leaves such a part out (`main/export/model.ts`, the export sheet's
  `reference` on `layoutParts`). Its colour is `REFERENCE_COLOR` of `shared/palette.ts`, a neutral grey, and
  `colorsOfParts` gives every part its colour with the references outside the palette's order (so adding one changes no
  part's colour): the viewport, the layers list, thumbnails and the exported page all use it, never `colorsByName` of all
  the names.

## Layers (`app/src/renderer`)

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
  (`soloLayers(layout, [name])`) and the title says `N hidden · Show all` while a part of the layout is off. A part the person switched off is remembered by its name through builds (`applyScene` drops the settings of names the build no longer has); when none of the parts that were shown is left and the ones that are all stand switched off, `applyScene` shows them, so a build never leaves the view empty (#220). The build line (`context.ts`) names no part hidden when the view it was told of (`ViewState.visible`) holds none of the build's parts: that view is of the build before. After the
  name, the count of the open marks on the part in the layout shown, in a 16 px pill (`ui/layerMarks.ts` `marksByPart`; `--fail` when
  one is a check that fails on the build); a click shows the Brief page and lists only the marks on that part in its Marks block
  (`store.marksOnPart`, the window's alone and dropped with the object; a chip `Only marks on lid` with a cross
  above the list; `goToRow` clears it). It filters what the list shows and nothing else: the agent is told every mark.
- **Rows lit from the view** (Parts, `ui/card/lit.ts`, `useLit.ts`, `state/pointed.ts`; leader rule 4: marks and checks have no leader).
  The part the pointer is on is `useLitPart()`: the part under the pointer in the view (the Select tool's `pointPart(hit.part)`, cleared
  when it leaves, goes to a chip or a set, or finds no part) or, failing that, the first ref of `peek` that is a part of the layout, whole
  or by a face (`litPart`; a mark, a set or a stroke is none). Its Parts row carries `data-lit` (the accent wash and a 2 px bar). `litRows(part,
  marks, checks)` gives the ids of the marks on it (`markEndParts`: both parts of a dimension; none for a scan's region) and of the
  checks whose `part` it is (`LitCheck`: `{ id, part? }`), and `useLitRows(checks)` reads it for Marks and Checks rows, which put
  `data-lit` on a row whose id is in the set. A part switched off says `hidden` (`.layer-off`) and has its swatch at 40 %; the opacity
  slider, "Show only" and the eye are in `.layer-controls`, over the row's right end, shown on hover and focus (`card-parts.css`); the name does not grow (`max-width` leaves the strip's room), so the count follows it and is never under the strip.
- A part whose build says its shape is broken (`partDefects` of `shared/sanity.ts`: not valid, inside out, not
  closed, mesh disagrees) has its first defect in a word after its name (`.layer-defect`, `--fail`, `+N` for the
  others) and every one in the row's title; the status line counts the layout's broken parts after its parts
  (`.status-defects`, `defectsSaid` in its title). Of the build on show alone: whether a defect is new is for the
  agent's digest (`main/sanity.ts`) to say.
- **Named sets in Layers** (`ui/Layers.tsx`, `ui/sets/SetRows.tsx`, `rows.ts` `setRows`): a set whose members (lost ones too) are all of
  one part of the layout shown stands under that part's row, indented (`data-in-part`); any other, with members in several parts or with
  strokes, is under a "Named sets" subheading after the groups and parts (`.layer-sets`). A row is the 10 px dashed swatch (`--set-1`…`--set-8`, in
  `--agent-mark` for a proposal), the name as `#deck`, the set's comment and what it holds in words (`membersSaid`: `4 faces, 1 stroke`), "Show only" (the parts it has ok members in, `partsOfSet`) and a menu with Rename, Colour,
  Add selection, Take away selection, Re-pick (only with lost members: two presses, "Select what takes the place of the lost ones",
  then "Re-pick with N selected"), Make it a tag and Delete; a proposal has Accept and Dismiss and "Proposed by Claude" in
  place of the menu. The pointer or the keys' focus on a row lights the set in the view (`setActions.hover`, `Viewport.setLitSet`), the name
  selects its ok faces, edges and parts. `2 of 5 faces lost` is `lostText`. **Groups stay the model's**: `groups(p)` are groups
  of parts in the code, drawn as headers and never made, renamed or deleted here; a person's names for faces are sets, and no text a person
  or Claude reads calls one a group (code says `set`, `NamedSet`).

## The page of objects (`app/src/renderer`)

- **The route card** (`ui/card/RouteCard.tsx`, `styles/card.css` and the `card-*.css` of each section, `state/column.ts`).
  There is no rail (it went with #273). The left of the window is `aside[data-region="left"]` (`aria-label="Panels"`), the F6 region `left`, holding the route card (`.card`, `--card-w`) while a project is open (`cardFor`: the card is away, and
  `--card-space` is `0px`, on the page of projects, with a new project and with none open: `data-left="away"` on the shell, `open` otherwise; the region is then empty and F6 passes over it). What the rail held is elsewhere:
  Projects is the title bar's crumb (All projects `W` in its menu; on the page of a new project the title bar has an "All projects" button, which keeps the draft), and another project's session is a pill in the title bar (`titleSigns`); Keys is the `?` button of the status line (`data-keys-button`, `showKeys`); the print profile is the chip of the status line (`ui/ProfileChip.tsx`, see `checks-and-profile`). The card has no sections any more: Checks and Marks are blocks of the Brief page (#277), Scans and Tracings are tabs of the view's switch, and while one is shown its panel takes the bench's place in the column (#278, `ui/view/ViewPanel.tsx`, `styles/view-panel.css`; see `board`, `scans-window`, `tracings`); `goToRow` shows the Brief page. Tab and Ctrl+Tab are not bound. The badges the rail had are gone with it.
  **The bench** (`ui/card/Bench.tsx`, `styles/card-bench.css`, #275): Parameters and Parts are two folder tabs (`role="tablist"`, `.bench-tab`, `data-tab` `params` or `parts`) that fill the card under the On block and the head slot; the open one is `role="tabpanel"` (`.bench-panel`, scrolling inside itself) holding `ParamsPanel` or `Layers`. Checks and Marks left the column for the Brief page with #277 (`ui/brief/Held.tsx` `ChecksBlock` and `MarksBlock`, see `board`), Scans and Tracings for the view's switch with #278 (their panels take the bench's place while shown). `benchTabs(parts, params)` (`state/column.ts`) says which tabs a project has (a one-part model: Parameters alone; no Params: Parts alone; else both), `tabShown` the one drawn (the kept one if the project has it, else Parameters). The open tab is kept for each project by the window: `store.benchTab` (`{ [objectId]: 'params' | 'parts' }`), `actions.setBenchTab`, `localStorage` `torno.bench` (`readBench`, `writeBench`, try/catch), never the workspace's. A tab says its count, and a dot (`.bench-tried`) on Parameters says a value is tried. Left and Right (`bench.next`, `bench.previous`, scope `bench`) move between tabs. `/` (`params.find`, scope `viewport`) opens Parameters and focuses its find box. Find and the tally of four counts all / assumed / brief / no source (`.params-tally`, `.params-count`, each the number over its word and a filter, the names of its sizes in its title; `state/paramFind.ts`: `findParams`, `filterCounts`, `inFilter`, `PARAM_FILTERS`, the window's `paramFindStore`; `none` is a size whose comment names no source) are in `ParamsPanel`; there is no line of sources of its own. A source is the comment's first word (`sourceOf`), only a size is assumed, from the brief or without a source, and a find matches every word in a name or comment. A stored `folded` (the sections' folding of an earlier card) is ignored on reading.
  The card: `ui/card/RouteCard.tsx` is the head slot (`head`, up to 60 % of the card, `.route-hand` in `card.css`, scrolling inside itself; `App` fills it with `Head`, and it is drawn in place of the `OnBlock` while the sketch, a review round or a size being tied is in hand, see `marks-window`; a selection is a tag in the view), or, when the head is not there, the `OnBlock` (`ui/card/OnBlock.tsx`, `onRows.ts`, `card-on.css`: see `marks-window`; its head names the build on show in words, "Latest build · prompt 5" or "Prompt 3 · older build" with Back to latest, and "27 checks pass", the history id in its title only, #335), and under it the bench, which fills the rest (or, while the Scans or the Tracing view is shown and the project has one, that view's `ViewPanel`: `ScansSide`, `TracingsSide`). The bodies are today's components: Parts is `Layers`, Parameters `ParamsPanel`; what was a `SectionTitle`'s one thing to do is a `.route-tools` row at the top of the body.
  The card's width is the window's (`store.column`: `{ width }`, in `localStorage` under `torno.column`, read with `readColumn(storedColumn(…))` and written in try/catch; an old value `{ open, width }` or one with `folded` reads for its width), never the workspace's. The card's right edge (`ui/LeftEdge.tsx`,
  `role="separator"`, `left.resize` Left/Right) makes it wider than its default, 296 px (`CARD_DEFAULT`; 264, `leftDefault(window.innerWidth)`, in a window narrower
  than 1360 px, `NARROW_WINDOW`), up to `CARD_MAX` and what leaves the viewport `VIEWPORT_MIN` (420 px) beside the dock
  (`clampLeft`); what is kept never goes below `CARD_NARROW` (264, which is also what a double click keeps): the width `CARD_DEFAULT` stands for the default of whichever window shows it (`clampLeft`). Its drag writes
  `--card-w` on the shell, and the dock's own limit reads the left's width now (`e2e/boot.spec.ts`).
  The dock's width is the window's too (`state/dock.ts`: `torno.dock` in `localStorage`, `readDock` and `writeDock` in try/catch,
  `clampDock(width, windowWidth, leftWidth)`, `dockDefault`: 420 px, 384 in a narrow window, never under `DOCK_MIN` 320): a drag of the dock's edge
  or an arrow key keeps it, and until then `--dock-w` stands at the CSS default (`tokens.css`, with the narrow defaults of the card and
  the dock in a media query that a test holds to `CARD_NARROW` and `DOCK_NARROW`); a drag that ends where it began with nothing kept takes the width it wrote on the shell off again (`e2e/boot.spec.ts`). A window made smaller than a kept width shows less, and keeps what was set. Opening a project leaves the folding as it is.
- **The projects of the folder** are the page of projects (`ShowPage`), and the project crumb's menu of the title bar (All projects at its head, a project that cannot be built muted, its reason the title). The example's note
  ("A temporary copy…", with Keep this as a folder…) and a folder that would not open (`role="alert"`, which brings the page up to be read) are said at the top of the page of projects (`ShowPage`'s `notes`, the spec being silent on where). There
  is no switcher: the title bar's pills say that a session of another project works or waits.

- **Hiding the column** is `column.toggle` (`Ctrl+Shift+L`; see `keys`): `store.leftOpen`, the grid's `data-left='away'`, the `aside.left` `hidden`. The status line keeps the failing dimensions and a `N values tried` button (`BuildStatus`).

## The picker (`Ctrl+P`)

- `ui/PartPicker.tsx` is one sheet over the view (`picker.open`, scope `window`: not in a field or the terminal), with the parts of the
  layout (a group's first, as the Parts tab has them) and the model's Params in one list, found by `pickerRows` (pure, `ui/pickerRows.ts`:
  every word typed in a part's name or its group's, in a Param's name or its comment, at most `PICKER_LIMIT` rows drawn and the
  count of those found). It is no second list of parts: the rows are the scene's and the layers' own. Enter on a part selects it, switches it on
  and frames it (`framePart`); on a Param it opens the Parameters tab with the find cleared, scrolls to the row and focuses its control
  (the focus lights what it drives, `drives`). Alt+Enter is `soloLayers`, Alt+H the part's eye. The pointer on a part row is `peek`, as in
  Layers. It writes nothing but what those actions do.
