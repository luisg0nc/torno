---
paths:
  - "app/src/main/shelf/**"
  - "app/src/shared/shelf.ts"
  - "kernel/src/torno_kernel/shelf.py"
  - "kernel/tests/test_shelf.py"
  - "app/src/renderer/state/shelf.ts"
  - "app/src/renderer/state/shelfFind.ts"
  - "app/src/renderer/ui/card/ShelfPanel.tsx"
  - "app/src/renderer/styles/card-shelf.css"
---

# The parts shelf: the kernel's read, main's store, the types

The shelf is `common/parts/<id>/part.py` of the workspace, one folder a bought part (the contract is in the rule
`kernel-model-contract`; the plan is `docs/superpowers/plans/2026-11-26-parts-shelf.md`).

- **The kernel reads it, in a worker of its own** (`kernel/src/torno_kernel/shelf.py`, the op `shelf`: rule
  `kernel-supervisor`). Folders that are not a part's id (`isPartId` in `shared/shelf.ts` and `shelf.is_part_id`: one rule in two
  places), links and folders with no plain `part.py` are skipped; at most 60, sorted. Each part is imported alone under a module
  name of its own, with `Params()`, and fails alone: its `error` is the model's traceback from the first frame in `part.py`, and
  `name`, `what` and `params` stay as far as they were read. The name falls back to the id when the docstring is empty.
- **The drawings are the B-rep's** (`section.section`, never a mesh): `body` and `keepout` have `bbox` (`extent.box`) and `side`,
  the section by the XZ plane through the middle of the bbox in Y (x is X, y is Z); `cutout` and `keepout` have `plan`, the section
  by XY at `z = -0.5`; `cutout.size` is `{d}` when the plan is one circle (twice the B-rep circle's radius, from `section`'s
  snaps) else `{w, h}` of its points' box. A cutout that misses `z = -0.5` is an error of the part, not a cutout without a size.
  An outline is `{points: [[x, y], ...], hole?: true}` in mm, closed, at most 400 points (thinned from the section's own 0.05 mm
  deflection) and at most 40 to a drawing. Numbers are the kernel's, in full.
- **The kernel writes nothing, and main writes nothing here**: `ShelfStore` (`app/src/main/shelf/store.ts`) reads the kernel's
  answer and each part's `.torno/checked.json` (`{<param>: {value, date}}`; a bad file or entry is ignored). Nothing in this
  folder writes a file of the shelf. (The writes of #352 and #355 are in the rule `workspace-writes`.)
- **The store asks when the workspace opens and when a file under `common/parts/` changes**, 400 ms after the last change (the
  watch is `watchFolder` on `common/`, filtered to `common/parts`; while `common/` is missing, `watchTop` waits for it, one level
  deep). One ask runs at a time; a change meanwhile has the answer applied and another asked, so the newest state stays. A failed
  ask leaves the last good list and is logged. `list()` and the event `changed` give the whole list; `close()` empties it.
  An answer of a workspace that has been left is dropped (`epoch`).
- **The window gets it through `shelf:list` and `shelf:changed`** (`window.torno.shelf.list()`, `onChanged`), and a new
  conversation is told it through `shelfLine` (`shelf/told.ts`, rule `agent-prompt`). `Scene.shelf` says which parts a project used.
- **The tab is #351** (`ui/card/ShelfPanel.tsx`; the text of it is in the rule `left-column`): the window keeps the shelf in `state/shelf.ts`
  (`connectShelf`: `shelf.list()` and `onChanged`, the newest wins), draws a part from `body.side` and nothing else (`drawingOf`, 1.25 px
  a mm, one scale for all) and says nothing of a part's sizes that `ruleKinds` does not: only a size has a rule, a `checked` entry or a
  `measured` source is checked, and a checked size is no longer assumed in the tab (the block told to Claude counts `assumed` by the
  comment alone, `assumedCount`).
