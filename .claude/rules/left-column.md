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
  - "app/src/renderer/ui/SectionTitle.tsx"
  - "app/src/renderer/ui/sectionSaid.ts"
  - "app/src/renderer/ui/sectionSaid.test.ts"
  - "app/src/renderer/ui/ColumnSplit.tsx"
  - "app/src/renderer/ui/LeftEdge.tsx"
  - "app/src/renderer/ui/ObjectList.tsx"
  - "app/src/renderer/state/column.ts"
  - "app/src/renderer/state/column.test.ts"
  - "app/src/renderer/styles/panels.css"
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
- **Named sets in Layers** (`ui/Layers.tsx`, `ui/sets/SetRows.tsx`, `rows.ts` `setRows`): a set whose members (lost ones too) are all of
  one part of the layout shown stands under that part's row, indented (`data-in-part`); any other, with members in several parts or with
  strokes, is under a "Named sets" heading after the groups and parts (`.layer-sets`). A row is the swatch (`--set-1`…`--set-8`, dashed for
  a proposal), the name as `#deck`, the count, "Show only" (the parts it has ok members in, `partsOfSet`) and a menu with Rename, Colour,
  Add selection, Take away selection, Re-pick (only with lost members: two presses, "Select what takes the place of the lost ones",
  then "Re-pick with N selected"), Make it a tag and Delete; a proposal has Accept and Dismiss and "Proposed by Claude" in
  place of the menu. The pointer or the keys' focus on a row lights the set in the view (`setActions.hover`, `Viewport.setLitSet`), the name
  selects its ok faces, edges and parts. `2 of 5 faces lost` is `lostText`. **Groups stay the model's**: `groups(p)` are groups
  of parts in the code, drawn as headers and never made, renamed or deleted here; a person's names for faces are sets, and no text a person
  or Claude reads calls one a group (code says `set`, `NamedSet`).

## The page of objects (`app/src/renderer`)

- **The rail and its panel** (`ui/Rail.tsx`, `ui/PanelHost.tsx`, `styles/rail.css`, `styles/panels.css`, `state/column.ts`).
  The left of the window is `aside[data-region="left"]` (`aria-label="Panels"`), the F6 region `left`, holding the rail
  (52 px, `--rail-w`, `RAIL_W`) and, beside it, the one panel that is open (`.panel-host`, `--card-w`, `--panel-w` is its old name): five icons with a
  word under each, Projects, Layers, Params, Scans and Marks (`RailPanel`), buttons with `aria-pressed`. A press opens
  that panel and pushes the view over (the shell is one grid, `grid-template-columns: var(--rail-w) var(--card-space) minmax(0, 1fr) var(--dock-space)`, rows `--title-h`, the rest, `--status-h`; `.left` spans the rail's column and the card's, and
  `--card-space` is `--card-w`, or `0px` with none open: `data-panel` on the shell; `--left-w` is the two together, for the sheet that rises from the status line), a press on the open one closes it, another switches
  (`actions.openPanel`; pressed with the pointer, the keys go back to the view). Tab and Ctrl+Tab are not bound: the
  rail's buttons are in the page's own order. The rail offers what the page allows (`panelsFor`): all five for an open
  project, Projects and Marks on the page of projects, Projects alone for a new project or with none open; a kept panel it
  does not offer is not shown (`shownPanel`), except that where Projects is the only one it stands in, so that a
  workspace with no project open shows its list. A badge on the icon is what the folded titles said: the parts switched
  off (Layers), the model's checks that fail (Params), the scans not aligned (Scans), the marks to review (Marks)
  (`ui/railBadges.ts`: the text, and the same in words as the button's `aria-description`; the number is in the
  monospace face and the badge is `aria-hidden`). The Projects icon carries the dot of any project's session that works or waits
  (`switcherSign`), its description naming which. Projects is the workspace's: the example's
  note, a folder that would not open, then the list (the folder's name and menu are the title bar's); Params is Parameters, then Checks and Print profile; the sections
  of a panel do not fold, and the panel scrolls as a whole except Marks, which keeps its title and line of checks in
  place and scrolls its list. Which panel is open and the panel's width are the window's (`store.column`: `{ open, width }`,
  in `localStorage` under `torno.column`, read and written in try/catch; a value of the old shape, folded sections and a
  marks height, reads as Marks open at its width), never the workspace's. The panel's right edge (`ui/LeftEdge.tsx`,
  `role="separator"`, `left.resize` Left/Right) makes it wider than its default, 296 px (`LEFT_DEFAULT`; 264, `leftDefault(window.innerWidth)`, in a window narrower
  than 1360 px, `NARROW_WINDOW`), up to `PANEL_MAX` and what leaves the viewport `VIEWPORT_MIN` (420 px) beside the rail and the dock
  (`clampLeft`); what is kept never goes below `LEFT_MIN` (264, which is also what `COLUMN_DEFAULT` and a double click keep): a wide window
  shows the default for a kept width under it, so "the default" is the default of whichever window shows it. Its drag writes
  `--card-w` on the shell, and the dock's own limit reads the left's width now (`e2e/boot.spec.ts`).
  The dock's width is the window's too (`state/dock.ts`: `torno.dock` in `localStorage`, `readDock` and `writeDock` in try/catch,
  `clampDock(width, windowWidth, leftWidth)`, `dockDefault`: 420 px, 384 in a narrow window, never under `DOCK_MIN` 320): a drag of the dock's edge
  or an arrow key keeps it, and until then `--dock-w` stands at the CSS default (`tokens.css`, with the narrow defaults of the card and
  the dock in a media query that a test holds to `LEFT_MIN` and `DOCK_NARROW`). A window made smaller than a kept width shows less, and keeps what was set. Opening a project from the list leaves the panel as it is.
- **The list of projects** is whole, one row for each, in the Projects panel (a project that cannot be built is muted,
  its reason the title; "All projects" is beside the title while a project is open and the first row otherwise). There
  is no switcher: the rail's Projects icon says that a session of another project waits.
