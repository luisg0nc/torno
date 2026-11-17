# Reviews: want and don't want, a round per build (#172; piece 4 of #173)

When a build is partly wrong, the person goes over it marking what they don't want ("these clamps hold nothing") and
what they want ("a handle along the top"), then sends it all at once. Claude answers item by item. After the next build
the person says OK or Still wrong for each item, and the Still wrong ones go into the next round.

Luis ruled in triage (#172's comment) that this is an **intent a mark carries**, not a new mode with red and green pens:
red and green already mean the person's marks and Claude's. The design canvas holds the mockups `Review-A`, `Review-B`
and `Review-C` (row 6); Luis chose **A to make a round, B and C to follow it up**.

Builds on 3D sketches (PR #200): a "want" in space is a sketch with the want intent.

## Why

A partly wrong build today takes a mark with a note for every clamp that holds nothing and every handle in the wrong
place, each told to Claude as a separate request, with nothing that says "these are one pass over h41", and nothing that
keeps Claude from bringing back what was taken out three builds ago. A round makes one pass one thing: one line in the
prompt, one answer per item, one follow-up after the next build.

## Goals

- **Every mark can carry an intent**: plain (as today), **want** or **don't want** (Luis's decision: every kind).
  For a shape, want and don't want are its own `add` and `remove`; `keep-out` and `reference` stay shape-only.
- **The look**: marks keep their author's colour (the person's red, Claude's green). Don't want is hatched with a `−`
  in its chip, want is solid with a `+` in its chip, so they read without colour and as the person's marks.
- **A round**: "Review this build" starts round `R<n>` on the build on show (`h41`). While it is open a bar over the
  view (Review-A) chooses whether new marks are plain, don't want or want, with any tool, and counts them; marks made
  while it is open are its items. Intents can also be set on any mark at any time, outside a round.
- **Send review** puts a chip in the composer, `Review of h41 · 3 − · 2 +`, which goes with the next prompt the person
  types (they can add words). Claude is asked to answer item by item.
- **Follow-up** (Review-B): after a later build, the round panel lists each item with Claude's resolution and **OK** /
  **Still wrong**, with the reviewed build shown faint beside the live one (Compare). OK acknowledges the item; Still
  wrong reopens it with an optional note. "Start round 2" makes a round on the build on show whose items are the Still
  wrong ones.
- **On the board** (Review-C): each round is a frame main keeps, `Review of h41 · 3 − · 2 +`, holding its items' mark
  cards, each tagged `OK in h42` or `Still wrong` once judged; a carried item moves into the next round's frame.
- **Claude reads all, sets none** (Luis's decision): `marks` lists intents and rounds; a `review` argument gives earlier
  rounds (what was removed and still must stay removed, what is still wrong). Claude's own marks stay plain; `add_mark`
  and `add_sketch` take no intent.

## Non-goals

- Claude setting intents or making rounds.
- Several rounds open at once (one open round per project).
- Named groups of strokes (#171) and sheets (#174).
- A separate checklist status beside the marks' own (Luis chose resolve / reopen).

## Anti-goals

- No new colours for want / don't want; nothing that makes a person's mark read as Claude's.
- No second store: rounds live in `marks.json` beside the marks they group (Luis's decision), with its one writer.
- A round never changes the model.

## Constraints

- `marks.json` has one writer, main; one change at a time, atomic. Round ids `R<n>`, per project, main's, never reused.
- `MAIN_ONLY_KEYS` hold; `round` on a mark is main's (set when the mark is made in an open round, or carried), never
  taken from the window or a tool.
- UI text in sentence case; numbers and refs monospace; `−` and `+` in the monospace face.
- Tests never open a visible window and never run the real `claude`.

## Approaches

- **Rounds in `marks.json` (chosen by Luis).** `intent` and `round` on marks, a short `rounds` list in the same file.
  One writer, one atomic file, travels in git; a delete and its undo keep a mark's round.
- *A file of their own* (`.torno/reviews.json` with the ids of its marks): two files must agree after every delete,
  undo or pull. Rejected.
- *Only drafts with an intent, no round object*: no board frame, no follow-up per round. Rejected (Luis chose rounds).

## Design

### Data

- `MarkBase` gains `intent?: 'want' | 'dont'` (absent = plain) and `round?: string` (`R<n>`, main's).
  - A shape keeps its `intent` field (`add | remove | keep-out | reference`); `markIntent(mark)` gives the review intent
    of any mark: a shape's `add` → want, `remove` → don't want, others plain; any other kind its `intent`. Setting want
    / don't want on a shape writes `add` / `remove`. (So a shape never has two intent fields.)
- `MarksFile` gains `rounds?: Round[]` and `nextRound?: number`:
  `Round { id: 'R1'; build: string /* history id, h41 */; sources: string /* the build's sources hash */; line: string;
  layout: string; startedAt; endedAt?; sentAt?; from?: string /* the round it carried items from */ }`. At most one round has no `endedAt` (the open one).
- A mark's `round` is set by main when the mark is made while its layout's round is open, and when "Start round 2"
  carries it. Setting an intent on an existing mark does not put it in a round. A mark in a round can be taken out of it
  from its row (`round` cleared; my call).

### Making a round (Review-A)

- "Review this build" (in the marks panel and on the build's row in the chat; and a key, `marks.review`, scope window,
  the builder picks a free letter) asks main for a round on the build on show; refused while a build is running or
  failed, or while another round is open (then it opens that one).
- The bar over the view: `Review of h41`, a three-way choice **Plain / − Don't want / + Want** for new marks (two
  keys, scope `window`, not `[`/`]`, which the align patch and region brush hold; the builder picks free ones and
  `keys.test.ts` checks every scope), the counts `3 − · 2 +`, **End** and **Send review**. Any mark tool works; the mark it makes gets the chosen intent and the round.
- End closes the round without sending (its marks stay drafts with their intent; it can be reopened from its panel while
  unsent). Send review closes it and puts the chip in the composer.

### Sending

- The chip `Review of h41 · 3 − · 2 +` names the round. On send, the prompt carries, before the marks lines, one line
  `Review of h41 (R1): 3 don't want, 2 want. Answer each item by its id.` and each item's mark line says its intent:
  `M8 · pick · don't want · lid/F12 …`. The items go as drafts go today (the round's drafts are sent with this prompt;
  marks of the round already sent are listed by id). `sentAt` is set when the prompt is delivered (the same point as
  `sentMarkIds`). Removing the chip sends the marks as ordinary drafts with their intents and leaves the round unsent.
- A draft with an intent outside any round goes with the next prompt as any draft, its line saying its intent.

### Following up (Review-B)

- The round panel (from the marks panel's round row, the board frame, or the bar's chip) lists the round's items: chip
  (`− M8`), note, Claude's `resolvedNote`, and, for an item Claude resolved, **OK** (acknowledge, as "To review" does)
  and **Still wrong** (reopen, with an optional note that is appended to the mark's note as `Still wrong in h42: …`).
  An item not resolved says "Not answered yet".
- With the panel open, the reviewed build is shown faint beside the live one through Compare (`actions.compare` with
  the round's build), when the history still has it; otherwise the panel says the build is no longer kept.
- **Start round 2** opens the next round's bar; Still wrong has already moved those items into it (see below). Items
  OK'd stay in R1.

### On the board (Review-C)

- Main keeps one frame per round (`by: 'torno'`, `source: 'R1'`), named `Review of h41 · 3 − · 2 +` from the round, made
  when the round has its first item, placed in a free spot, holding its items' cards (their `frame`). A carried item's
  card moves into the new round's frame. The person can move or resize the frame; removing it hides it as other cards
  that appear by themselves.
- A mark card in a round shows its intent chip and, once judged, `OK in h42` or `Still wrong`.

### Claude

- `marks` lines say each mark's intent and round. `marks` gains `review: 'R1' | 'all'`: the round(s) with their build,
  items, intents, resolutions and judgments, so Claude can see what was taken out before (don't want items OK'd are
  "removed on purpose; keep them out").
- The agent prompt gains a sentence: a review lists what the person doesn't want and wants on one build; answer each
  item by its id with `resolve_mark`, and don't bring back what an earlier review removed.
- Claude's marks are plain. `add_sketch` takes no intent. `add_mark` keeps a shape's own `intent` (add, remove,
  keep-out, reference: it says what the shape is), but `markIntent` gives the review intent of the **person's** marks
  only, so a shape of Claude's never reads as want or don't want. (My call.)

### IPC

- `marks:setIntent(objectId, id, intent | null)`: the person's marks only (a shape writes add/remove).
- `marks:round` with `{ start: { layout } } | { end: id } | { reopen: id } | { carry: id }`, and `marks:roundOut(objectId,
  markId)`. Main checks the round's state for each.
- The open round per project and the bar's chosen intent are window state; the round itself is main's.

## Builder's questions, settled

- **A round's items are held until Send review** (Luis's decision). While a round is unsent, its drafts are left out of
  every prompt, as an open sketch is (`contextFor` gains a held rule beside `sketching`), and the marks panel and their
  cards say "in review, not sent". Send review releases them with the review line. End without sending keeps them held;
  "Send as plain marks" on the round releases them as ordinary drafts and ends the round unsent.
- **Still wrong goes straight into the next round**: the item is reopened and its `round` becomes the next round's,
  which main makes (unopened, on the build on show, `from` the judged round) if it does not exist yet, so the item is
  held there too. "Start round 2" opens that round's bar. So Still wrong items never leak out one by one. (Follows from
  Luis's decision.)
- **Judgments are main's**: a new main-only key `judged?: { verdict: 'ok' | 'still-wrong'; build: string }` (in
  `MAIN_ONLY_KEYS`), set by the round panel's OK and Still wrong only. OK also acknowledges the mark. "OK all" and "To
  review" acknowledge as today but do not set `judged`; the round panel shows those as "OK (accepted)". `reopened` is
  cleared on send as today; `judged` stays, so the board and `marks review` keep it. (My call.)
- **A round's build across computers**: `Round` stores the build's history id, its `sources` hash (as a build card
  does) and its line; starting a round stars that build in the history so it is never pruned. A local `h41` whose hash
  differs is not the round's build: the panel then says "the reviewed build is not on this computer" and Compare is
  off. `revision` is not stored (revisions restart per run). (My call, following build cards.)
- **Setting an intent on a sent mark** makes it a draft again, `(changed)`, for every kind, as a shape's intent does
  today. (My call: one behaviour.)
- **Claude's marks never join a round**, even when made while one is open. (My call: Claude sets none.)
- **Board frames**: round frames are a new kind of card of main's own (`kind: 'frame'`, `by: 'torno'`, `source: 'R1'`);
  `reconcile` learns the source type `round`: made when the round has its first item, hidden (not deleted) when the
  person removes it, gone when the round is gone. Claude may `add_card` into a round frame as into any frame (the new
  card goes in, the frame is not changed). A mark card is put into its round's frame only when it is placed for the
  first time, or when it was in the previous round's frame (a carried item); a card the person has placed elsewhere or
  framed themselves stays where it is. (My call: the person's layout wins.)
- **Where Send review works**: the chip lives in the chat composer, as board attachments do. In the terminal view Send
  review adds the review line to the next prompt's hook context, the same way the terminal carries board attachments
  today; the builder follows that path. (My call.)
- **One open round per project**, on one layout (its build's). Marks made in another layout while it is open do not
  join it. Reopening an ended unsent round clears its `endedAt`; a sent round cannot be reopened (start the next one).

## Builder's calls

- The look of the bar, the round panel and the hatch (a CSS or shader pattern in the author colour), within the tokens
  and the mockups.
- Where "Review this build" sits on the build row.
- Test layout: store tests for rounds, describe tests for the prompt lines, panel tests, an e2e that makes a round with a
  don't want pick and a want sketch, sends it, has the stand-in agent resolve both, and marks one OK and one Still wrong.
