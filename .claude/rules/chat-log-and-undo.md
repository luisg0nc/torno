---
paths:
  - "app/src/main/sessions/chatlog.ts"
  - "app/src/main/sessions/chatlog.test.ts"
  - "app/src/main/sessions/snapshots.ts"
  - "app/src/main/sessions/snapshots.test.ts"
  - "app/src/main/sessions/undo.ts"
  - "app/src/main/sessions/undo.test.ts"
  - "app/src/main/sessions/reference.ts"
  - "app/src/main/sessions/reference.test.ts"
  - "app/src/shared/changes.ts"
  - "app/src/renderer/ui/chat/TurnEnd.tsx"
  - "app/src/renderer/ui/chat/turnSummary.ts"
  - "app/src/renderer/ui/chat/turnSummary.test.ts"
  - "app/src/renderer/ui/chat/Changes*.tsx"
---

# The chat's log, what a turn changed, undo, the end of a turn

Moved as written from the folder `CLAUDE.md` files; each heading names the folder it came from, and paths are written as they were there (see "Rules by area" in the root `CLAUDE.md`).

## Agents (`app/src/main`)

- The log (`chatlog.ts`) appends each item as it becomes final to `.torno/chat/<conversation>.jsonl`: text only,
  the data of a picture never, `redact` applied to every line, one write at a time per file, the folder checked
  with `ownTorno(dir, 'chat')` and ignored (`ensureIgnored`); after one write fails none is tried. A picture of the
  first prompt of a new object carries `file`, its path in `reference/` (the transcript reads it from the caption
  before it, `REFERENCE_CAPTION`), and the log keeps that and never the data. `chat:reference` (`sessions/reference.ts`
  `readReference`) gives the window the bytes of such a file again, for a session of the open workspace (one ended
  too): only a name of the form `create.ts` gives (`REFERENCE_FILE`), only a plain file read with `readRegular` of
  `create.ts` (no link, `reference` itself no link), at most `MAX_PHOTO`; anything else is null, never an error. A resumed chat
  reads the tail of the file as "Earlier in this conversation". The pane with no session shows the end of the conversation on file the same
  way, read-only (`chat:lastConversation`, `lastConversation` of `chatlog.ts`: the last eight `user`, `text` and `turn` items and the
  log's modification time; it only reads, and the object must be of the open workspace). A log over 5 MB is cut to its last 2,000 lines, whole
  and atomically, when a session starts on it (`trimLog`; the prompts of the cut part are then no longer listed, and the numbers after them shift down).
  `chat:prompts` (`sessions/prompts.ts` `listPrompts`) lists every `user` item with `state: 'sent'` of every log of `.torno/chat/` (read from
  the tail as `readLog` does, parsing only the lines that say `"kind":"user"`: 50 logs of 2,000 lines take about 85 ms, so there is no index
  file, RF4), and a terminal's prompts from the history entries' `turn` (the ids `t-<conversation>-<n>`, once each, at the time of their first
  build: a terminal keeps no log, so only a prompt that built is known), oldest first and numbered from 1 across the project, at most the newest
  2,000. `chat:usage` (`sessions/usage.ts` `listUsage`, #370) gives each row of `listPrompts` what its turns took: every line of each log is
  read (`readLog`, an item written again counted once, where it first stood), each `turn` goes to the last `sent` prompt before it, and its
  `usage` (the CLI's numbers, `usageOf`: the counts, `requests` and `costUsd`, not the running total nor the models) and the pictures and builds
  of its items (`usageFacts` of `shared/usage.ts`: pictures by the tool that brought them, `you` for the person's; builds that ran, from the build on
  show at the prompt to the last that worked) are summed over the prompt's turns. Tokens with no `costUsd` are the first turn of a resumed
  conversation (`resumed`): its cost is not known and is never worked out from `sessionCostUsd`. A terminal's prompt is a row with `terminal`
  and nothing counted. `median` is the median cost of the rows whose cost is known (`medianCost`). `chat:conversation` reads one conversation's log (`readLog`) for the chat's "Earlier conversations". Both only read, for an object of the open
  workspace. Switching `view` ends the session and resumes the
  conversation in the other kind (`session.json` is the same).
- **What a turn changed in the model** (`sessions/snapshots.ts`, `shared/changes.ts`, `chat:changes`). When a
  prompt is sent (its `UserPromptSubmit`, read before the hook is answered, so before the agent can have touched
  anything) and when the turn ends (its `result`, as the transcript puts the turn item), main reads the text of the `.py`
  files directly in the object's folder (as `sourceFolders` has the own folder; not `<workspace>/common`; plain files
  only, `lstat` and `O_NOFOLLOW`, 60 files at most, `MAX_FILE_BYTES` (200 KB) each: a larger file is told to have
  changed by its size and mtime, with no text), and keeps the files that differ as `TurnChanges`, by the id of the turn's item
  (`KeptChanges`: the last `MAX_TURNS` (20) turns of a session and `MAX_KEPT_CHARS` (4 M characters) of text, the oldest let
  go first). **Held in memory only**: never written (not under `.torno/`, not in `.torno/chat/`, not in `state.md`), not
  a chat item and not logged, gone with the session's record. A prompt folded into a turn under way is not a start of its
  own (the turn keeps its first snapshot); a turn with no hook before it begins where the last ended. What the
  person saved between two turns is no turn's. A change made by a `Bash` is found too (it is by the files, not by
  the tools); a file outside the folder is not. `chat:changes(sessionId, turnId)` answers null for a session that is not
  of the open workspace and for a turn it holds nothing of (also one that changed no file there); it waits for the
  turn's snapshot to be read. The window draws the diff (`ChangesSheet`); torno never writes the model.
  **Undo** (`Sessions.undoTurn`, `chat:undo`, `sessions/undo.ts`) is a request, not a restore: for the last turn of an
  idle chat (refused with a `Refusal` otherwise: working or asking, a prompt untaken, not the last turn, nothing kept of it)
  main puts a quiet note in the transcript and sends one prompt of its own words (`undoPrompt`), as the person's, that asks
  the agent to put the files back, with the lines to reverse (`reverseBlock`: what the file has now between what the two
  texts share at their ends as `-`, what it had as `+`, a line of context each side; at most `MAX_REVERSE_CHARS`, 12,000, for
  all files, a file beyond it or too large to have been kept being named without lines; a file the person saved since,
  read again now, is said to have changed). The agent edits, through its own tools and permission cards: torno writes nothing
  of the model, and this rule is unchanged. Claude Code's checkpoints (`--rewind-files`) are not used: they await the spike
  in the manual's "Not yet verified" (`Part of #131`).

## Agents (`app/src/renderer`)

- **The end of a turn** (`ui/chat/TurnEnd.tsx`; the rule is `ui/chat/turnSummary.ts`, pure). Its first line is
  "Done in 42 s" (bold, in ink, the seconds in the face of numbers) and then, muted, what the turn did, said from the turn's own items and nothing else (`turnSummary` over
  `itemsOfTurn`, the items after the turn before it): the files the agent's `Edit`, `Write` and `MultiEdit` changed (only
  those that finished: a denied one is not counted), the builds their edits started (`r1 → r3 ok`, `build failed`,
  `r3 ok after 1 failed build`: the first revision is the build on show when the prompt was sent), the marks it resolved
  and added (`resolve_mark`'s `id`; `add_mark`'s from its answer), and the dimensions whose verdict at the end is another
  than at the start (the first `was` and the last `now` of the digests, `verdictChanges`' own). What it pulled from torno
  is a line of its own. Above it, what the turn took (#368, `TurnUsage.tsx` `TurnUsageLine`, the rule `usageLine` of `shared/usage.ts`,
  pure): the cost first, in ink, through `dollars`, then the calls (`requests`) and the three kinds of token through `tokens` of `shared/format.ts`
  (`cacheRead` "read again", `input + cacheCreation` "new to it", `output` "written"), from the turn item's `usage` alone; with no `costUsd`
  (the first turn after a resume) "Cost not known for this turn." and the tokens, and `RESUMED_NOTE` under it; nothing for no `usage` or one of
  all zeros. The cost's title says `PLAN_NOTE` (on a Claude plan the dollars are what the tokens would cost). At the right of the first line a row of buttons for the turn (`TurnActions`): "See changes" (only when an edit
  changed a `.py`, a quiet button with its icon), which opens `ChangesSheet` over the view's area (`main.viewport`, `[data-region="viewport"]`: not the card, not the dock; a dialog, `chat.close`
  puts it away, Tab goes round within it, the focus goes back to the button; `TurnEnd` holds whether it is open and lights its turn with
  `data-open`, an accent bar and wash): the top half is the view (its canvas is drawn in that half only), with the parts' tags
  (`changeTags` of the turn's summary, standing on the parts as `CompareBar`'s do, the ones with nothing to stand on in a line) and the scrubber
  `h40` / `h41` (`Scrubber`: `actions.compare` with no summary, mode `before`, when `joined.from` is there; the sheet ends the compare it began
  when it closes); the bottom half is the code, a tab for each file ("airbox.py +3 −2") with the diff numbered by line. Per file main
  kept (`chat.changes`, in memory, the last 20 turns; none is "No change ... is kept for this turn"), "Changes" (the
  file before against after, `Diff` with `ofEdit` false, so without the caption that is true only of an edit's lines)
  or "Whole file" (read only, the monospace face, no refs searched), and, below, the builds taken together
  (`netParts`: a part's volume and faces from the first digest's `before` to the last's `after`, `≈` unless exact). The builds of the turn's prompt are
  joined to it (`ui/chat/historyJoin.ts` `joinTurns`: the turn answers the `user` item before it, and the history's
  entries whose `turn.prompt` is that item's id are its; `ChatPane` reads them with `useHistory`, `ChatItems` joins) and
  drawn as a group of the builds timeline under the view, not under the account (`ui/strip/`, builds-history; `turnFacts`: the parts changed, the checks that flipped, the
  builds that failed on the way). The buttons: "See changes", "Compare" (`actions.compare(from, to, prompt number)`,
  "Comparing" while it is on, off while a section or an explode is) and the dots, `TurnMore`, a menu from the button (a
  `Popover`, `useMenu`: arrows, Escape) that holds "Go back to before this prompt" (`useGoBack` in `GoBack.tsx`; `GoBack`
  is the same offer as a button of its own, which Prompts only uses), "Star" or "Unstar" (`history.star` on the last
  build); there is no "Pin to board" (#256); with neither of them there are no
  dots. Go back's question and its sentences are drawn beside the dots, not inside the menu (the menu is gone by then):
  `Confirm` stands from the dots button (`anchor`). Go back reads `history.goBackPlan` and asks once with `Confirm`, listing
  what is written, deleted, left alone, changed since (a save of the person's among the builds it undoes counts), the Params, the prompts undone and
  "your saves h42" (`planLines`), then calls
  `history.goBack` with what it was shown; it is off while the session works (`ChatIdle`). A plan with `fallback: 'undo'`
  says "Claude will be asked to put the files back instead." and its "Ask Claude" is `chat.undo`, offered only on the
  last turn of a live idle chat (`UndoableTurn`, which `ChatPane` gives its id to while no prompt of the person's
  follows; `afterPlan`): on any other turn, and in a terminal's pane, there is nothing to ask and the answer to the click is a sentence in the
  button's place; a refusal of main is said beside the button. The pane of Prompts only over a terminal (`PromptsPane`) puts "Go back to before this
  prompt" on each row that built something (`PromptsOnly`'s `goBack`, keyed by the row's id, `t-<conversation>-<n>` there). Between turns, a build the person made (`cause` person or
  params) is a line (`SaveLine.tsx`; `savesBetween` takes them between two prompts' times, several in a row with no
  other build between are one run, `saveWords`); the prompts a Go back undid (`goneBack`: every build of the prompt is
  `undone`) are one faded row with "Show" (`rowsOf` in `Items.tsx`, which also places the lines), faded by the muted
  face, never by opacity. Prompt numbers are the project's (`numbersOf`, above). All of it is drawn from main's own labels: the window works out no cause.
  A further action for a turn is one more button in `TurnActions`, given the turn's `item` and `account`.
