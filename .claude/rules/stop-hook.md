---
paths:
  - "app/src/main/sessions/manager.ts"
  - "app/src/main/sessions/manager.itest.ts"
  - "app/src/main/sessions/claudes.ts"
  - "app/src/main/sessions/status.ts"
  - "app/src/main/sessions/status.test.ts"
  - "app/src/main/verdicts.ts"
  - "app/src/main/verdicts.test.ts"
---

# The build after an edit, the Stop of a turn, and the hooks that set the status

Moved as written from the folder `CLAUDE.md` files; each heading names the folder it came from, and paths are written as they were there (see "Rules by area" in the root `CLAUDE.md`).

## Agents (`app/src/main`)

- **The build after an edit, and the Stop of a turn** (`Sessions.toolHook`, `afterEdit`, `stopAnswer`). Tool hooks
  are read (up to 8 MB; longer, or no JSON, is answered `{}`) only for the tool's name, its `tool_use_id` and its input. The
  `PostToolUse` of `Edit`, `Write` or `MultiEdit` of a source the build is made from (`ofSource`: a `.py` inside the object's folder or the workspace's `common/`, or a file the last build imported, `Scene.uses`, `Sessions` dep `uses`) waits for a build begun at
  or after that tool's `PreToolUse` (`Sessions.built`, fed every `BuildState` from `index.ts`), then, of a build
  that worked, for its marks to be checked against it and its dimensions measured (`Verdicts.settled`, 10 s at
  most, `EDIT_SETTLE_MS`), and is answered with `buildContextFor` of `context.ts` (the first lines and the
  dimensions of `contextFor`, in the same words, and between them the digest: The sanity pass, below) as
  `additionalContext`; the chat puts it under that tool's card (`Transcript.toolContext`: `forTool`), with the digest as data
  (`digest` of the `context` item), how long a build that worked took (`seconds`) and the last line of what one that
  failed said (`error`, `errorLine` of `shared/build.ts`: the traceback's last line), which the window draws the
  build line from. No build begun within 3 s: `{}`. Still running at 55 s: `A build is running
  (rN); call wait_build …` (`claude.ts` gives `PostToolUse` a 60 s timeout). The `PostToolUse` of a `Bash` after which a source is newer than before it
  (`aroundBash`, below) is answered the same way (`afterEdit` from the command's start): the build the command started is told as an edit's is.
  A `Stop` (`stopAnswer`, `claude.ts` gives it a 25 s timeout) is judged from what the turn did (`TurnState`, made at
  its `UserPromptSubmit` by `beginTurn`: when it began, the prompts its calls were made for, the last successful build
  and what the dimensions said of it, the last `look`, the reasons already held). A prompt the CLI folds into a
  chat's turn under way (its hook comes between the turn's `init` and `result`, `Transcript.underWay`) begins none: all of
  that stands, the holds made too, and only the prompt the turn is named by changes (`startedFrom` still keeps the build
  current as each prompt was sent). An interrupted turn has no `Stop`, and its `result` ends it, so the next prompt begins
  anew. A terminal has no stream to tell the two apart: each of its `UserPromptSubmit` begins a turn, a prompt typed
  while it works too. A build is the turn's only by its cause (`sessions/claudes.ts`, `claudesIn`; #397): Claude made it
  (`BuildState.made` is `agent`: one of its tool calls accounts for the save, `sessions`, "Which saves are Claude's"),
  for a prompt a call of the turn was made for (`TurnState.prompts`, added at each `PreToolUse` the ledger is told of, so
  that a folded prompt keeps the ones before it), whenever it began; one with no prompt to name must have begun since the
  turn did. Never by when a build began alone: the person's save mid-turn, a build with no cause (the opening one) and
  one of an earlier prompt's are told as ever (digest, context) and are neither waited for nor held for. Of two of
  Claude's saves that fold into one build the later one's prompt is named (`merged` in `builds.ts`). `ClaudesBuilds`
  keeps the last 20 of Claude's builds of each object as each ends, with its scene and whether a later build, whoever's,
  worked (`redrawn`); a state told again (stale, let go) is no new build. So an earlier prompt's later build hides none
  of the turn's, and the Stop judges Claude's newest (`own`), not the latest there is. The build line the chat puts under
  a tool's card is marked `byPerson` when that build was of the person's saves or Params alone (`BuildState.made`,
  `reason`): the agent is told of it all the same, and the turn does not count it. First the Stop waits, up to
  `STOP_WAIT_MS` (20 s), for a build of Claude's that is still running and, when a dimension passed when the turn began,
  for the dimensions to be measured on `own` (`Verdicts.settled`, to the same deadline). A save heard that no build has
  started for yet is not waited for (the answer to the edit waited for its build). Then it is held back
  (`decision: block`) for the first of these five reasons: a build of Claude's is still running; `own` failed and no
  later build worked (said as "The build after rN failed", `failedAfter`: a revision names a build that worked, and a
  failure has no number of its own); `own` has a hard defect (`hardDefects`) that the last successful build when the turn
  began (`TurnState.before`) had not, and the reason says the agent may answer that it is meant; a dimension that passed
  on that build fails on `own` (`verdictChanges` of `verdicts.ts`, kept `pass` to `fail`; the reason names it with
  `valueAgainstExpected`); when a later build has drawn, a defect it no longer has (by flag and part) and a dimension
  that passes on it are let go, and what only it has is never held for; `own` ended after the turn's last `look`
  (`TurnState.lookedAt`, the count of builds ended at the `PostToolUse` of a `look`, one of a subagent too), however the
  model was written, unless nothing in the parts changed since the build the turn began with (`partsUnchanged` of `sanity.ts`: the same parts, each with the same `hash` and the same `loc` and
  `arranged`; the digest's `changed` is not enough, a moved hole keeps every count and size; the turn began with no
  build, or a scene that is not the latest's: it looks). A reason already held is not waited for again: a Stop after
  one held for a running build does not wait for the build, one after a dimension hold does not wait for the
  measuring. A reason is held once
  (`TurnState.held`) and a turn is held twice at most (`holds`): `stop_hook_active` is no guard of its own, the ledger
  is. The answer to the edit says it first (`notLookedAt` in `Sessions`, #227): its last line is `Not yet looked at: rN was built in this turn. Call look before you write your summary; …` when the build is the turn's by the same cause, worked, and changed the parts (`partsUnchanged`) or has a hard defect. A `measure`, `check` or `features` after the build (`TurnState.measuredAt`, `NUMBER_TOOLS`) counts as a look for a small change only (`smallChange` of `sanity.ts`: no part added or removed, no face or edge count changed, no hard defect). A hold for a defect or a dimension that finds the build unlooked says so, and counts for that reason too. The
  reasons say "built during this turn", never "you edited": a command's time may take in a save of the person's. Never for a
  dimension that failed when the turn began, never for a change of volume alone. A Stop held back moves no status
  and ends no turn.
- **Each build's verdicts** (`src/main/verdicts.ts`, `Verdicts`, in memory only, 16 builds an object). Recorded
  from the marks whenever they change and when a check of them against a build ends (`onMarksChecked` of
  `registerIpc`), always of the last successful build, never of an older one: a mark holds one value.
  `verdictChanges(was, now)` is the one place that says which dimensions changed verdict between two builds
  (`{ id, was, now }`, each `pass`, `fail` or `none`): the digest takes it from there, and so does whatever else
  needs it.
- A `StopFailure` hook (a turn an error of the API ended: a login that failed, an overload; posted in place of the
  `Stop`) is idle and ends the turn as a `Stop` does, and is never held back (`stopAnswer` is not asked; the CLI reads
  no answer to it), so a terminal session is not left "working" until its next prompt.
- A `Notification` hook is a question (`needs_input`) unless its body says it is none (`reduceStatus` in
  `sessions/status.ts`: `notification_type` `idle_prompt` or `auth_success`, or, without a type, a message that
  it is waiting for input): Claude Code also posts one when it has only been idle at its prompt for a while.
