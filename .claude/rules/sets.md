---
paths:
  - "app/src/main/sets/**"
  - "app/src/shared/sets.ts"
  - "app/src/renderer/state/sets.ts"
  - "app/src/renderer/ui/sets/**"
  - "kernel/src/torno_kernel/refind.py"
---

# Named sets: the store, the file, finding them again, the window

A **named set** is the person's name for faces, edges, parts and sketch strokes (`#deck`), kept in `<project>/.torno/sets.json`.
The design is `docs/superpowers/specs/2026-11-17-sets-design.md`; the manual's "Named sets" says what a person sees. In every text a person
or Claude reads it is a *named set*; the model's `groups(p)` are groups and keep that word (`left-column`). Code says `set`, `NamedSet`.

## Main (`app/src/main/sets`)

- Main is the only writer of `sets.json` (`store.ts` `SetStore`): one change at a time per object, written atomically (`writeOwn`) before it
  is told (`changed`). Ids are `N1`, `N2`, … per object, never reused, also when the file is lost (`next` goes past every `N<n>` in its text).
  The file travels in git. The window and the tools only ask: `sets:*` channels in `ipc.ts`, and `add_set` (`mcp/setTools.ts`), which is
  refused for anything but a proposal.
- A set is `{ id, name, slug, comment, colour 0..7, layout, by: 'person' | 'agent', proposed?, members, createdAt }`. A name is 1 to 40 characters,
  starts with a letter, has no `/`, `#` or `@`; the slug (`slugOf`: lower case, runs of white space one `-`) is what the ref says and what is
  unique, so `Deck` and `deck` are one name. A member is `{ part }`, `{ face, selector?, type?, point, normal?, arranged?, state }`, `{ edge, … }` or
  `{ stroke: 'M7/k3' }`; `state` (`ok` or `lost`) and every ref are main's. A set belongs to one layout. At most 2000 members and 2000 characters
  of comment. A file that cannot be read is copied aside (`sets.json.corrupt-<time>`), what the sanitiser drops is copied aside (`sets.json.dropped-<time>`),
  and a missing file is empty and writes nothing (`file.ts`).
- **The kernel never evaluates a text it did not make.** A member keeps the selector as the structured `form` the kernel built (`selector_for`) and
  parses it again on the way in (`parseSelectorForm`: the fixed prefixes and terminals, numbers finite and in range, no `order` terminal, a form
  with anything else dropped and the member kept). Never Python text. `describe` strips `form` before the agent reads it (`mcp-tools`).
- A set is **instant and then exact**: `make` writes the members with their ref, point and normal at once; the handler then asks the kernel's
  `selectors` once per part and writes the answers in a second change (`withSelectors`, which is dropped when a newer build landed, and writes
  the kernel's centre, normal, type and form). A member made with no point is `held` at its part's box middle until then, and `refind` skips it
  on the build it was made on; on a later one it is `lost` (so Re-pick is offered): no build looks for a held member. Nothing makes one any
  more: `add_set` asks `selectors` first and refuses when it cannot, `sets:make`/`sets:edit` place a point-less face or edge the same way
  (`placed` in `sets/ipc.ts`, refused with `The kernel gave no place for …`), and the window refuses the selection (`Unplaced`, said in the
  status line) when the kernel cannot give a point.
- **Which build a set's refs are of** (`SetStore.refsOf`, in memory only, by set id, never a file: build numbers are of a run). `make` and `edit` stamp
  the revision the refs came from (the window sends the one it shows, `add_set` the one it read; `edit` keeps the older of that and what the set had),
  `refound` stamps `revision` on every set it looked at and that was not edited meanwhile (`Refound` is given for each set, changed or not),
  `restore` gives back the stamp the set had when removed. A write whose stamp is older than the last build, or unknown, emits `behind`, which
  `ipc.ts` (`followSets`) turns into `ws.refind`; `retrying` coalesces it with a run under way, so a set edited during a refind is passed over and then
  refound. Staleness is judged per set: `expandSet(…, fresh)` (`SetsFresh`) puts `not refound against r8 yet; its refs are of r7` in the `said` of
  every tool reply that uses the set (the set is still used, "don't wait"), and `scene` and `state.md` say it in `stale`. `askSelectors` (which asks for what `unanswered` lists) in `sets/ipc.ts`
  never asks `selectors` for a set whose stamp is not the last build (the same number names another face now).
- **Found again after every build** (`refind.ts` `refindAll`, wired in `ipc.ts` `retrying` beside the marks' check, its own coalescer and store
  turn): one `refind` query per layout that has sets, each member sent with its form, point and normal and `within` (the part's `tolerance`, or
  `EDGE_TOLERANCE_MM`), a part spread otherwise than the member's `arranged` moved by the difference. Answers are written in one change
  (`SetStore.refound`) for the sets whose members are still those it was asked about, only for the last build. A part member follows its
  part's name; a stroke its sketch; a face of a part or layout the build lacks is lost. A member found at another ref has its selector asked for
  again (second change), and so is one whose point moved by more than `SAME`, and one the kernel was never asked for (no `type`). A query that fails or answers ill leaves its members as they were and is logged once; an `unchecked` member keeps its
  state. A build that landed meanwhile drops everything.
- Lost members are kept, with their last point, for **Re-pick**: `edit({ repick })` removes every lost member and adds the selection, and is refused
  (`nothing lost in #deck`) when none is. `take` of a ref not in the set, `add` of one already in it (it stays one), and `restore` after a
  `remove` (once) are the other edits. `dismiss` is not undone. `accept` and `dismiss` are for a proposal only (`by: 'agent'`); the person's own
  are refused.
- `scene` and `state.md` list the members found (`members`) apart from the lost ones (`lostMembers`), and a proposal says `proposed by you, not accepted yet`
  (`PROPOSED_SAID`).
- A stroke member is checked against the marks (`marks(objectId)`), live while its sketch and its id are (`strokeLive`).
- Refs of a set in tools: `shared/sets.ts` `expandSet` (lost left out and counted); the kernel is never given a `#` ref.

## The window (`app/src/renderer/state/sets.ts`, `ui/sets`)

- The store follows main (`connectSets`, `sets:changed`); nothing keeps a copy of a set that main did not say. `setActions` ask main and say what it
  refused (`refused`, `said` in the status line, `removed` for Undo, 10 s, `problem` for what main found wrong with the file: `sets:problem` and `sets.problem`
  at open, shown in Layers with a Dismiss that calls `sets.dismissProblem`, as the marks' notice is). The selection may hold strokes while a sketch is open (`dropStrokes` when it
  closes); `Selection.tsx` and the view never ask the kernel for a stroke.
- Ctrl+G is `set.make` (`keys`); the popover is `MakeSetForm`, pure, with `makeError` and the same `setNameError` main uses. The select scope Set
  (`tools/selectTool.ts` `refInScope`) gives the first (oldest) set that holds the face; a face in no set is passed over.
- A set is drawn in its token colour on the `set` layer of the viewport (one set at a time; a proposal hatched and dashed); Layers is `left-column`, the chat's
  chips are `chat-cards-and-refs`, the tokens `styles-themes`, a mark on a set `marks-store`.
- "Make it a tag" never sends by itself and never writes the model: it puts a chip (chat) or text in the prompt (terminal) that asks Claude for a tag of
  `tagNameOf(name)` in `tags(p, parts)`, one in each part the set spans, saying what it leaves out (`makeTagText`).

## The kernel (`kernel/src/torno_kernel/refind.py`)

`refind` is a query on the last build of a layout; the order it tries, the budget (`REFIND_BUDGET`) and what it never does are in `kernel-measures`. It
answers one entry per member, in order, and never raises for a member it cannot find: that is `lost`.

## Tests

`src/main/sets/*.test.ts` (the store over a temporary folder and a fake `query`), `refind.itest.ts` (the real kernel on `morph`), `src/shared/sets.test.ts`,
`src/renderer/ui/sets/*.test.ts`, `state/sets.test.ts`, and `e2e/sets.spec.ts` (Ctrl+G, a rebuild that renumbers the faces, a proposal accepted).
