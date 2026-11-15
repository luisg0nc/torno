---
paths:
  - "app/src/renderer/ui/chat/**"
  - "app/src/renderer/state/chat.ts"
  - "app/src/renderer/state/chat.test.ts"
  - "app/src/renderer/styles/chat.css"
  - "app/e2e/chat*.spec.ts"
---

# The chat pane: items, build lines, diffs, menus, suggestions, markdown

Moved as written from the folder `CLAUDE.md` files; each heading names the folder it came from, and paths are written as they were there (see "Rules by area" in the root `CLAUDE.md`).

## Agents (`app/src/renderer`)

- **The chat pane** (`ui/chat/`, `state/chat.ts`; a Claude Code session whose `view` is chat has no `.xterm`). The
  window draws what main's transcript says: `placed` and `drawn` in `state/chat.ts` reproduce main's order
  (an item keeps its place; a queued prompt is drawn after all the others; sent, it goes to the end), and items
  and metas are merged by `seq` with the history, so none is drawn twice or lost. Each `context` item is drawn
  under its prompt, as chips from its fields (marks, build, selection, and how many instruction files it named), never from its text. One made for a tool's
  card (`forTool`: the build an edit of the model started) is a build line under that card (`BuildLine`), drawn from
  its fields alone: `Built r2 · ok · 1.2 s`, or `Build after r2 failed: <the last line of the traceback>` in `--fail` (a revision names a build that worked, as
  `main/builds.ts` counts them: a failure has no number of its own and is the build after the one on show, `failedAfter`
  of `shared/build.ts`, which the Stop hook says too; the prompt's "torno added" line says it alike), or, of a build
  still running when the edit's answer could wait no longer (main writes that line once and never again), "Still
  building when Claude Code was answered", in the past so that it stays true, "Show
  error" while that failure is still the latest build, the dimensions whose verdict it changed (`digest.dimensions`,
  from `verdictChanges`, never worked out again here) as chips with `now passes` / `now fails`, and the parts it
  changed (`digest.parts[].text`, four at most, the rest counted), then "Show text". The sheet of a failed build is
  `errorOpen` in the store (`actions.setErrorOpen`): the status line, the viewport's "Show error" and the chat open
  it. An `Edit` or a `MultiEdit` is drawn as a diff (`ui/chat/Diff.tsx`, from the tool's own input by `ui/chat/lineDiff.ts`, never
  from the person's files), in the permission card (six lines removed and added, then "Show all") and, in place of the JSON, in the
  opened tool card (twelve): each line has a `−` or a `+` in the gutter, a removed one is struck through (`<del>`), an added one is
  `<ins>`; the washes behind them (`--diff-removed-wash`, a grey step of the hairline on the panel, and `--diff-added-wash`,
  the accent's wash) only group, and are neither mark colours nor verdicts (`contrast.test.ts`). The diff is of `old_string`
  against `new_string` alone, so its context lines and "N unchanged lines" are of the edit and have no place in the file: a
  caption on every diff says "Lines of the edit, not of the file: where it lands is not shown". An edit with `replace_all`
  says "Replaces every match in the file" (`Hunk.everywhere`), a card never understating a change. The cap of 400 lines is
  of what differs once the lines both texts share at their ends are left out; beyond it the text is not compared, and says
  "Too long to compare": every old line of it is shown removed and every new one added, so a large deletion is never out of
  sight. A `Write` keeps the first lines of what it holds, there being no old text to compare with. A tool card reads "denied" (the person refused its ask) or "cancelled" (its ask ended with the turn stopped) in the muted colour; "failed", in the fail colour, only for an error the person did not cause. Nothing is per frame
  in React, and there is no endless animation in it: a working indication is still, toggled once a second by
  `useBeat`, and only while something streams or runs (`styles.test.ts` fails for an endless one). The window holds
  at most `MAX_ITEMS` (2,000) as main does, dropping the oldest, and says once, at the top, "Earlier items are not
  shown"; a session no pane shows takes in no picture data, also from a history that was on its way.
  The chat that ended before the window was loaded is shown from main's transcript (`session:current`'s `ended`).
  Beside the model menu (`chat/ModelMenu.tsx`) the effort menu (`chat/EffortMenu.tsx`, `EFFORT_LABEL`): "Default
  effort" until one is set (`meta.effort`), then the levels the model takes (`effortsOf`; none for a model that takes
  none, and then no menu), `chat.setEffort` for the session only; a refusal takes the choice back and is said beside it.
  What the CLI says of itself comes as notes and as meta: the header's status word gains ", retrying (attempt 3)"
  while `meta.retrying` is set and the session works (the status itself is still the hooks'), and while
  `meta.pluginLoaded` is false a line above the box offers "Restart with the whole prompt" (disabled while the agent
  works), which starts the session again, resumed, with `session.start(…, { skills: false })`. A note with `action:
  'terminal'` (the chat could not use the login) has "Use the terminal" beside it (`ChatOffer` of `chat/offers.ts`,
  given by `ChatPane` to the session's own items only, never to "Earlier in this conversation"; disabled on the view
  switch's condition), `offerTerminal` of `SessionPane`: asked about first while the session is busy, as a view picked
  is; otherwise, and after that question, `applyView('terminal', true)`, which ends a live session, writes the view and
  starts a terminal session resuming the conversation whether the chat was live or had ended, and also when the
  choice already was the terminal. A note's `action` other than `terminal` is dropped when a log is read (`readLog`).
- **Suggestions** (`ui/chat/Suggestions.tsx`, the rule pure in `ui/chat/suggest.ts`): while the box is empty and the
  session live, at most three chips above it (`MOST_SUGGESTIONS`), in this order and each only when it applies: "Fix the
  build" (`fixPrompt`, the build failed), "Review N marks" (marks not resolved; `/mcp__torno__review `), "Check
  printability" (the layouts have `print` and the conversation, `earlier` too, holds no `check` of kind thin, overhang,
  mesh or bed and no `/mcp__torno__printable` prompt), "Explain this model" (no prompt of the person yet). The three
  commands are not offered when `meta.tornoConnected` is false. A chip fills the box, cursor after, keys the box's, and
  never sends. The build error sheet's "Ask Claude Code to fix it" already does the same with `fixPrompt`.
- The agent's text is drawn by torno's own `markdown.tsx`: React text nodes, never raw HTML, a link shows its URL
  and is not an `<a>`. A picture without its data (`ui/chat/gone.ts` `goneText`): a reference of the person's
  (`ChatImage.file`, `reference/doodle-1.png`) is shown from that file, asked of main once through `chat.reference`
  and scaled by `ui/onboard/images.ts`, as an object URL (`state/chat.ts` `referenceUrl`: 40 at most, revoked when
  let go of, when its session is released or dropped), its file name as the thumbnail's title, the frame empty
  while it comes; one main has no plain file for says `reference/doodle-1.png is no longer there`, the path in the
  monospace face. A tool's picture says "Picture of an earlier build, not kept"; any other "Picture not kept".
