# Parts shelf (#345): plan

Luis picked direction B with A's folders and A's ask (2026-11-26). Build issues #349 to #355, one branch
`feat/parts-shelf`, one PR. Mockup: branch `design/parts-shelf`, `design/mockups/parts-shelf/` (`b-bench.html`,
`b-*.png`, `README.md`). Merged code's behaviour and names win; the mockup's look wins.

## Decisions taken here (say them in the PR)

- **A part's folder name is a Python identifier** (`ec11`, `push_button_16`, `esp32_c6_lcd_147`): a project imports it
  as `from common.parts.ec11.part import Params as EC11, body as ec11_body, cutout as ec11_cutout`, and a name with
  `-` cannot be imported. The mockup's `esp32-c6-lcd-147` becomes `esp32_c6_lcd_147`.
- **The part contract** (`common/parts/<id>/part.py`):
  - the module docstring: first line the part's name (`EC11 rotary encoder`), the rest what it is (one line);
  - `@dataclass class Params` whose every size has a comment starting with its source:
    `datasheet:`, `datasheet <file>:`, `listing:`, `measured:`, `ISO 15:` / `DIN 912:` (a standard), `assumed:`,
    `derived:`;
  - `body(p) -> Part` (required): the part as bought. The panel it mounts in is the XY plane, its front face at
    `z = 0`; the side the person sees is `+Z`; the part's mounting axis is Z through the origin;
  - `cutout(p) -> Part` (optional): the solid to subtract from a panel at the origin (it spans the panel's thickness,
    `z` from a few mm below 0 to 0 or more), the fit included;
  - `keepout(p) -> Part` (optional): the room to keep clear around and behind the part;
  - its datasheets and photos beside `part.py`; torno's own files in `common/parts/<id>/.torno/`.
- **Source words.** `shared/params.ts` `SOURCES` gains `listing`, `measured` and `standard` (a comment starting
  `ISO <n>`, `DIN <n>`, `EN <n>` or `standard` is `standard`; `sourceWord` keeps `ISO 15` as written). This also shows
  in the Parameters tab: the manual's list of sources and `params.md` say it.
- **The kernel's op `shelf`** (#350): forked like a trial, never in the supervisor, no live worker kept, JSON only
  (no blob). It lists `common/parts/*/part.py` of the workspace (identifier folders, sorted, 60 at most), and for each
  part, alone (one failing part is that part's `error`, never the whole answer): name and what (docstring), `params`
  (as `read_params` gives them, defaults), and drawn with default `Params`:
  - `body`: `bbox`, and `side`, the outlines of its section by the XZ plane through its bbox's centre in Y
    (polylines in mm, outer and holes), via `section.py`'s helpers where they fit;
  - `cutout`: `side` the same way, `plan` the outlines of its section by the XY plane at `z = -0.5` (inside a panel),
    and `size`: `{ d }` when that plan is one circle (exact, from the B-rep edge), else `{ w, h }` of its bbox;
  - `keepout`: `bbox`, `side`, `plan` the same way.
  Numbers are the kernel's, full precision. A project build's `scene` gains `shelf: { <id>: <count> }`, the parts of
  `common/parts/` its model used, counted as calls of the part's `cutout` (else `body`) during the build, by
  `sys.monitoring` on those functions' code only (Python 3.12+); on 3.11 the count is left out and `uses` alone says
  the part is used.
- **Main's `ShelfStore`** (`app/src/main/shelf/`): asks the kernel's `shelf` op when a workspace opens and when a
  file under `common/parts/` changes (debounced, the watcher `builds.ts` already keeps on `common/` where it fits),
  merges each part's `.torno/checked.json`, keeps the last answer, serves `shelf:list` and broadcasts
  `shelf:changed`. Types in `app/src/shared/shelf.ts`.
- **Writes (the rulings).** Main may write a shelf part's own `common/parts/<id>/.torno/` (only `checked.json`, through
  `ownTorno(partDir)`, as it does a project's) (#352). And, on the person's send of an "add a part" request (#355), it
  copies the files the person dropped into `common/parts/<id>/` (the folder made when missing): each a plain file,
  size-capped, of the kinds the new project page takes plus STEP, written whole or not at all, never over a file that
  is there, never through a link, the name checked by main. That is the fifth exception of the workspace-writes rule:
  root `CLAUDE.md`, `.claude/rules/workspace-writes.md` and the manual say both. Claude writes `part.py` (it already
  may write `common/`), after asking.
- **What Claude is told** (#349): one line block given with a conversation's first prompt and after /clear or a
  compaction (`newConversation || fresh`, as the references line), cut at `SHELF_LIMIT` (600 characters), counted in
  `CONTEXT_LIMIT`:
  `On the shelf, common/parts/ (6 parts; use one before researching it, and say which sizes are assumed):` then one line
  a part `ec11: hole Ø7, 2 sizes assumed` (the hole from the kernel's cutout size, `window 33.4 × 18.4` for a
  rectangle, nothing when there is no cutout; "assumed" from the sources), the rest counted (`and 4 more`). No
  shelf, no line. `turncost.test.ts` holds that a part costs at most 60 characters and the block at most `SHELF_LIMIT`.
  The system prompt does not grow: the skills say the rest.
- **The skills** (#349, #354): `torno-model` "References: bought parts" says the shelf: the contract above, use a part
  from the shelf before researching it, import it rather than copy it, say which sizes are assumed, and before saving a
  part it researched ask with `AskUserQuestion` (header `Shelf`, the question `Put <name> on the parts shelf?` then
  one line a size `<value> <what> (<source>)`, options `Put it on the shelf` and `Not this one`), writing the folder
  only on yes. `build123d` points there. `prompt.test.ts` holds the sentences.
- **The ask card** (#354): an `AskUserQuestion` question whose header is `Shelf` draws its size lines as the mockup's
  table (value in mono, what, source word; assumed in warn). Nothing else of the card changes.
- **The slip** (#354): under a tool card of Edit, Write or MultiEdit whose file is in `common/parts/<id>/`, the chat
  draws a torno slip: `On the shelf: <id>` and which file, with "Open it" (opens the part in the view). Derived in the
  window from the transcript item, nothing stored.
- **The tab** (#351): `BenchTab` gains `shelf`; the tab shows when the workspace has a shelf (any part) and is
  `Shelf <n>`. Rows: the part's side outline drawn at one scale for all (1.25 px a mm, from `body.side`), name, the hole,
  a row of short rules for its sizes (solid sourced, green checked, dashed warn assumed, dotted derived), `× n` used here.
  Groups "In <project>" (from `scene.shelf`, else `scene.uses`) and "Not in this project". Find box (name, what, a size's
  value) and chips All, In this project, Assumed sizes. Foot text as the mockup, naming `common/parts/`.
- **The part opened** (#352): a fourth `Shown`, `part`, with the open part's id; the switch shows `<id> ×`. A page in
  the view (like `BriefPage`): name, what, file line, actions (Place on the model, Ask Claude about it, Open part.py,
  its files), the drawing (side section through a 2 mm panel at `z ∈ [-2, 0]` with the cutout's gap, the keep-out
  dashed in the accent labelled "keep clear", the cutout plan from above; dimension lines from the kernel's numbers:
  cutout Ø or w × h, height above the panel, depth below, body width; each takes the line style of the one `Params`
  size of equal value, if exactly one), the legend, and the ledger: one row a size (value with unit, the comment's
  rest, source word, and "I measured it…" or "checked <date>"). "I measured it…" opens "You measured [ ] mm / Ask
  Claude to change it / Cancel": main writes the value and today's date into `.torno/checked.json` and the box gets
  `In the shelf's ec11, set body_h to 6.6: I measured it on the part. Make its comment measured.` (never sent).
- **Placing** (#353): a tool `place` with a band `Placing <id> from the shelf, <n> placed` [Ask Claude] [Stop]. Starts
  from a row's drag (a custom drag type, dropped on the viewport) or "Place on the model". Over a face, a ghost of
  the cutout's plan and the keep-out's plan in the accent, in the face's plane at the pointer; a tag names the part
  and what it cuts and keeps clear. A drop (or click while placing) commits a user `pin` mark on that face (note
  `<id> from the shelf`) and the request in the box names every mark placed so far:
  `Put the shelf's ec11 at M7 and M8 on the face: cut its cutout and keep its keep-out clear.` Never sent by itself.
  Esc or Stop ends placing; Ask Claude ends it and focuses the box.
- **Add by hand** (#355): Files dropped on the Shelf tab (PDF, PNG, JPEG, WebP, STEP) open the form: the files'
  names (and pictures), Name (an identifier, checked live), What is it, sizes (what, value, source: datasheet,
  listing, measured, a guess), Add a size, "Ask Claude to put it on the shelf". That puts the request in the box,
  shown first; the files are copied into `common/parts/<id>/` when the person sends that message from the chat. In a
  terminal session the copy is made at the click and the form says so.

## Order and commits

One commit an issue, in the issue order, each with its manual and rules text and tests:

1. #349: contract, skills, `SOURCES`, the shelf line (`shelfLine`, `ContextDeps.shelf`), the rulings' text.
2. #350: the kernel op, `scene.shelf`, client, `ShelfStore`, IPC, types.
3. #351: the tab.
4. #352: the part page, the drawing, the ledger, `checked.json`.
5. #353: placing.
6. #354: the skill's ask, the card's size table, the slip, a stand-in test.
7. #355: add by hand.

Then the whole-branch review, all four suites and the e2e specs touched, rebase on main, PR.
