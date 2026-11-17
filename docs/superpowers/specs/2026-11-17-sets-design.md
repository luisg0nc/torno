# Named sets of faces, parts and strokes (#171; piece 4 of #173)

The person gathers faces, edges, parts and sketch strokes into a named set ("deck face", "intake port RH", "hose runs
here"). Then they and Claude point at it by name, `#deck`, instead of guessing which faces are meant. torno keeps the
set in `.torno/`, finds it again after each build, and can ask Claude to write it into the model as a tag.

## Why

A selection is gone at the next click, and a lasting name for faces today is a tag in the model's code that only Claude
can write. On a big model (the 780-part engine) the same faces are pointed at again and again, by refs that change
with every rebuild. A name the person owns, found again after each build, makes "the deck face" mean one thing for
both of them.

## Goals

- **torno keeps named sets** (Luis's decision): `Ctrl+G` with faces, edges or parts selected (and strokes, while a sketch
  is open or a sketch's strokes are selected) asks a name, a comment and a colour, and makes the set at once, in
  `.torno/sets.json`, which travels in git. A face may be in several sets; a set may span parts.
- **"Make it a tag"** asks Claude, with a prompt the person sends, to write the set into `tags(p, parts)`, for when a
  script or another tool should see the name. The set stays torno's until the person removes it.
- **Members**: faces, edges, whole parts, and strokes of a sketch (`M7/k2`) (Luis's decision).
- **Refs** (Luis's decision): `#deck` names the set wherever its members are; `block/#deck` narrows it to one part.
  Distinct from tags (`block/@top`). Group names have no `/`, `#` or `@`, are unique per project, at most 40
  characters.
- **Colour**: one of 8 muted tokens added to `styles/tokens.css` (none red or green, those mean the person and Claude),
  picked in turn, changeable (Luis's decision).
- **In the view**: with Set chosen in the select scope (beside face, edge, part), a click selects the whole set;
  hovering lights it in its colour and shows its name. Marks can be placed on a set as a whole (anchor on its first
  member, `set: '#deck'` kept on the anchor, as a tag is).
- **Layers** lists named sets under their part, or under "Named sets" when they span parts, to light, isolate, rename, recolour,
  edit (add or take away the current selection) or delete, with undo.
- **Found again after each build** (Luis's decision): each face or edge member keeps the kernel's selector for it
  (`selector_for`) and its point and normal; after a build the selector is tried first, then the nearest face or edge
  by point and normal within the part's tolerance. A member found by neither is lost; the set says `2 of 5 faces
  lost` and offers **Re-pick** (select again, press Re-pick). Part members follow the part by name. Stroke members
  follow their sketch (gone when the sketch or stroke is).
- **For Claude**: `scene` lists named sets (name, comment, members by ref, lost count); `#deck` and `block/#deck` work in
  `describe`, `measure`, `highlight`, `show`, `look` and `add_mark`; `add_set` lets Claude **propose** a set, shown
  dashed in the view and in Layers until the person accepts it (it becomes theirs) or dismisses it (Luis's decision).
  Claude can use a proposal's ref meanwhile.

## Non-goals

- Groups inside the model other than through "Make it a tag".
- Groups of scans or scan regions.
- The model's own `groups(p)` (groups of parts in the code) stay as they are and keep the word "group" everywhere
  (Luis's decision): the person's are **named sets** in every text a person or Claude reads; code identifiers use
  `set`/`NamedSet`.

## Anti-goals

- The kernel never evaluates a text it did not make. A set stores each selector as the structured form
  `selector_for` builds (axis, sort, index, filters), never as Python text; the kernel rebuilds the expression from that
  form and checks it gives one face, as it checks its own forms today.
- No red or green set colours; no per-set fonts.
- torno never writes the model; "Make it a tag" is a prompt to Claude.

## Constraints

- `<object>/.torno/sets.json` has one writer, main (`main/sets/store.ts`), one change at a time, written atomically;
  ids `N<n>` are main's, never reused. It joins what travels in git.
- Refs crossing processes are in the object frame of the set's layout; a set belongs to one layout.
- Every number told to Claude is the kernel's and says whether it is exact.
- Tests never open a visible window and never run the real `claude`.

## Approaches

- **torno keeps named sets, tag on request (chosen by Luis).** Instant, survives rebuilds by selector then point and
  normal, travels in git; a tag when a script must see it.
- *Always a tag via Claude.* One kind of name, but nothing exists until Claude edits and the model builds.
- *torno only, no tags.* Rejected: the name could never reach the model.

## Design

### Storage

`sets.json`: `{ next, sets: NamedSet[] }`, `NamedSet { id: 'N3'; name; comment; colour: 0..7; layout; by: 'person' |
'agent'; proposed?: true; members: Member[]; createdAt }`.
`Member = { part } | { face: 'block/F12'; selector?: SelectorForm; point; normal; state: 'ok' | 'lost' } | { edge: 'block/E40'; selector?; point; state } | { stroke: 'M7:s2' }`.
`state` and refreshed refs are main's.

### Making and editing

- `Ctrl+G` (a `window` scope key, `set.make`) with a selection opens a small popover: name (a suggestion from the
  first face's descriptor, e.g. "plane +Z face"), comment, colour swatches. Enter makes it. Main asks the kernel for each
  face's and edge's selector (`describe` with `selector: true`) and stores the form and the point and normal.
- Edit from Layers: add the selection, take away the selection, rename, recolour, delete (undo as marks have it).

### After each build

- One kernel query per layout, `refind`, with every member's selector form and point and normal: the kernel rebuilds
  each form (its own grammar only), keeps it if it gives exactly one face, else asks `nearest` with the point and
  normal; it answers the new ref and how it was found. Main writes the refs and `state` in one change. Lost members are
  kept (with their last point) for Re-pick.

### For Claude

- `scene` gains `sets`. Group refs expand to member refs (`shared/sets.ts` beside `expandTag`), lost members left
  out with a note. `measure` of a named set measures what it measures of several refs today (as for a tag of several).
- `add_set { name, comment?, refs }`: refuses a name in use; makes a proposal (`by: 'agent'`, `proposed: true`).
  Accept (person) clears `proposed` and sets `by: 'person'`; Dismiss deletes it.
- "Make it a tag" puts a composer chip "Make #deck a tag" whose text asks Claude to add the tag for the set's faces in
  `tags(p, parts)`.
- The agent prompt gains a sentence: sets are the person's names for faces and parts; use them in refs.

### Strokes

- A stroke member is `M<n>/k<i>` (the sketch's mark id and the stroke's id). Hovering lights the stroke; the set's
  stroke members are told to Claude by sketch and stroke with the stroke's line. A set can carry a comment and
  `take` for its strokes is the sketch's own (no second literalness).

## Builder's questions, settled (my calls unless marked)

- **Selector trust.** `selectors.py` builds text from `(prefix, terminal)` pairs today. It gains a structured form of
  the same pairs (a fixed set of prefixes: by type, by axis, at a centre, by radius, by size; terminals: only, end,
  group, order), which it emits beside the text and rebuilds itself; `describe`'s `selector.expression` keeps working.
  "By order" forms are **not stored** (they can name the wrong face silently). On refind a selector's single face is
  accepted only when its surface type matches and its normal is within 10° of the stored one; otherwise the point and
  normal rule decides.
- **Fallback.** Faces: the nearest face within the part's tolerance whose normal is within 10° of the stored one (a new
  kernel match beside `nearest`). Edges: the nearest edge within `EDGE_TOLERANCE_MM` of the stored point.
- **Ctrl+G is instant**: the set is written at once with point, normal and ref; main then asks selectors in batches per
  part and writes them in a second change. A rebuild before that refinds by point and normal.
- **Strokes get stable ids**: `SketchStroke.id` (`k<n>` within the sketch, main's, never reused) is added to sketches;
  a stroke member is `M7/k3`. Strokes are selected from the sketch panel's stroke list (and by click while the sketch is
  open); the selection learns `M<n>/k<i>` refs.
- **Marks on a named set** keep `set` on the anchor as a label: the mark is reanchored as any mark and does not follow
  the set. (So refind and reanchor have no order between them.)
- **Another layout**: a set belongs to one layout; `#deck` in another layout is refused with "#deck is of layout
  assembly". Claude's `add_set` is in the layout on show unless it names one.
- **Make it a tag** for a set spanning parts asks for one tag of the same name in each part; after that both
  `block/@deck` (the model's) and `#deck` (torno's) resolve.

## Builder's calls

- The look of the popover, the Layers rows and the dashed proposal, within the tokens.
- The kernel's `refind` query shape and where the selector form is serialised.
- Test layout, following tags, marks and Layers tests; an e2e makes a set of two faces, rebuilds with the faces
  renumbered, and checks the set still names them.
