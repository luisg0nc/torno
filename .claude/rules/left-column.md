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
  - "app/src/renderer/ui/Rail.tsx"
  - "app/src/renderer/ui/railBadges.ts"
  - "app/src/renderer/ui/sectionSaid.ts"
  - "app/src/renderer/ui/sectionSaid.test.ts"
  - "app/src/renderer/ui/ColumnSplit.tsx"
  - "app/src/renderer/ui/LeftEdge.tsx"
  - "app/src/renderer/state/column.ts"
  - "app/src/renderer/state/column.test.ts"
  - "app/src/renderer/styles/panels.css"
  - "app/src/renderer/styles/card*.css"
  - "app/src/renderer/styles/rail.css"
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

- **The rail and the route card** (`ui/Rail.tsx`, `ui/card/RouteCard.tsx`, `ui/card/CardSection.tsx`, `ui/card/sections.ts`, `styles/rail.css`, `styles/card.css` and the `card-*.css` of each section, `state/column.ts`).
  The left of the window is `aside[data-region="left"]` (`aria-label="Panels"`), the F6 region `left`, holding the rail
  (52 px, `--rail-w`, `RAIL_W`) and, beside it, the route card (`.card`, `--card-w`) while a project is open (`sectionsFor`: the card is away, and
  `--card-space` is `0px`, on the page of projects, with a new project and with none open: `data-left="away"` on the shell, `open` otherwise). The rail is buttons of 36 × 36 with
  their name in `aria-label`, on `--surface`: Projects at the top, a hairline (`.rail-sep`) when the index is offered, the eight icons of the index
  (`SECTIONS` in `ui/card/sections.ts`: Needs you, Parts, Parameters, Checks, Marks, Scans, Tracings, Print profile, `data-section`) and Keys at the foot (`data-rail="keys"`, `showKeys`).
  The name shows in a tip (`ui/RailTip.tsx`: an ink pill, `aria-hidden`, fixed 6 px right of the button, on pointer hover and `:focus-visible`, no transition). Projects
  is `aria-pressed` while the page of projects is up (`data-dyed`, the dyed tile: `--dye` and `--on-accent`, the accent in the dark theme; radius `--radius-float`) and
  a press shows the page, or goes back to the open project (`actions.showPage`; with no project open there is no back). The index is a press
  that brings the section into sight and unfolds it (`actions.showSection`: unfolds, then scrolls the card to `[data-section]` once drawn); the section in sight has the accent wash and
  `aria-current="true"` (`store.sectionHere`, found by the card's `IntersectionObserver` on the heads, `inSight` and `READING_LINE`). Tab and Ctrl+Tab are not bound: the
  rail's buttons are in the page's own order, the rail then the card. A badge on an icon (`ui/railBadges.ts`, `badgeText(section, data)` and `badgeSaid`, data from `useBadgeData`):
  what waits for the person on Needs you (marks to review, marks the agent left, failing checks), the parts switched off on Parts, the model's checks that fail plus failing dimensions on Checks (on `--fail`),
  the scans not aligned on Scans, the marks to review on Marks; the number is in the monospace face, the badge is `aria-hidden`, and the words are the button's `aria-description`. The Projects icon carries the dot of any project's session that works or waits
  (`switcherSign`), its description naming which.
  The card: `ui/card/RouteCard.tsx` is the head slot (`head`, pinned above the scroll, up to 60 % of the card, `.route-hand` in `card.css`, scrolling inside itself; `App` fills it with `InHand`, see `marks-window`) and `.route-scroll`, in it a `CardSection` for each of `SECTIONS`. A section
  (`section.route-section`, `data-section`, `data-folded`, `data-here`, `data-needs`, `data-empty`, `aria-labelledby` its head) has a dot on the route (9 px, 1 px `--route` at 17.5 px) and a head that is a button (`.route-head-button`, `aria-expanded`):
  the name at 16 px, 600, and `said`, one line in the monospace face at 10.5 px (`useSectionFacts`: the words and the failing part in `--fail`). A click on the head folds the section (a folded section draws no body); one with nothing in it
  says "none" and does not unfold (`empty`; Marks and Scans are never empty, their body holds Review this build and Import scan…). The bodies are today's components: Parts is `Layers`, Parameters `ParamsPanel` (the Parameters alone), Checks `ChecksSummary` and `ChecksPanel`,
  Marks `MarksPanel`, Scans `ScansPanel`, Tracings `TracingRows` (the tracings shown in 3D), Print profile `PrintProfile`, Needs you empty for now; what was a `SectionTitle`'s one thing to do is a `.route-tools` row at the top of the body.
  The card scrolls as a whole. Which sections are folded and the card's width are the window's (`store.column`: `{ folded: SectionId[], width }`, in `localStorage` under `torno.column`, read with `readColumn(storedColumn(…))` and written in try/catch; an old value `{ open, width }`
  reads as the default folding, `COLUMN_DEFAULT`, at its width), never the workspace's. The card's right edge (`ui/LeftEdge.tsx`,
  `role="separator"`, `left.resize` Left/Right) makes it wider than its default, 296 px (`CARD_DEFAULT`; 264, `leftDefault(window.innerWidth)`, in a window narrower
  than 1360 px, `NARROW_WINDOW`), up to `CARD_MAX` and what leaves the viewport `VIEWPORT_MIN` (420 px) beside the rail and the dock
  (`clampLeft`); what is kept never goes below `CARD_NARROW` (264, which is also what a double click keeps): the width `CARD_DEFAULT` stands for the default of whichever window shows it (`clampLeft`). Its drag writes
  `--card-w` on the shell, and the dock's own limit reads the left's width now (`e2e/boot.spec.ts`).
  The dock's width is the window's too (`state/dock.ts`: `torno.dock` in `localStorage`, `readDock` and `writeDock` in try/catch,
  `clampDock(width, windowWidth, leftWidth)`, `dockDefault`: 420 px, 384 in a narrow window, never under `DOCK_MIN` 320): a drag of the dock's edge
  or an arrow key keeps it, and until then `--dock-w` stands at the CSS default (`tokens.css`, with the narrow defaults of the card and
  the dock in a media query that a test holds to `CARD_NARROW` and `DOCK_NARROW`). A window made smaller than a kept width shows less, and keeps what was set. Opening a project leaves the folding as it is.
- **The projects of the folder** are the page of projects (`ShowPage`), and the project crumb's menu of the title bar (All projects at its head, a project that cannot be built muted, its reason the title). The example's note
  ("A temporary copy…", with Keep this as a folder…) and a folder that would not open (`role="alert"`, which brings the page up to be read) are said at the top of the page of projects (`ShowPage`'s `notes`, the spec being silent on where). There
  is no switcher: the rail's Projects icon says that a session of another project waits.
