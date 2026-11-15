---
paths:
  - "app/src/main/sessions/manager.ts"
  - "app/src/main/sessions/manager.itest.ts"
  - "app/src/main/sessions/status.ts"
  - "app/src/main/sessions/status.test.ts"
  - "app/src/main/verdicts.ts"
  - "app/src/main/verdicts.test.ts"
---

# The build after an edit, the Stop of a turn, and the hooks that set the status

Moved as written from the folder `CLAUDE.md` files; each heading names the folder it came from, and paths are written as they were there (see "Rules by area" in the root `CLAUDE.md`).

## Agents (`app/src/main`)

- **The build after an edit, and the Stop of a turn** (`Sessions.toolHook`, `afterEdit`, `stopAnswer`). Tool hooks
  are read (up to 8 MB; longer, or no JSON, is answered `{}`) only for the tool's name and `file_path`. The
  `PostToolUse` of `Edit`, `Write` or `MultiEdit` of a `.py` inside the object's folder waits for a build begun at
  or after that tool's `PreToolUse` (`Sessions.built`, fed every `BuildState` from `index.ts`), then, of a build
  that worked, for its marks to be checked against it and its dimensions measured (`Verdicts.settled`, 10 s at
  most, `EDIT_SETTLE_MS`), and is answered with `buildContextFor` of `context.ts` (the first lines and the
  dimensions of `contextFor`, in the same words, and between them the digest: The sanity pass, below) as
  `additionalContext`; the chat puts it under that tool's card (`Transcript.toolContext`: `forTool`), with the digest as data
  (`digest` of the `context` item), how long a build that worked took (`seconds`) and the last line of what one that
  failed said (`error`, `errorLine` of `shared/build.ts`: the traceback's last line), which the window draws the
  build line from. No build begun within 3 s: `{}`. Still running at 55 s: `A build is running
  (rN); call scene …` (`claude.ts` gives `PostToolUse` a 60 s timeout).
  A `Stop` (`stopAnswer`, `claude.ts` gives it a 25 s timeout) is judged from what the turn did (`TurnState`, made at
  its `UserPromptSubmit` by `beginTurn`: the count of builds ended, the last successful build and what the dimensions
  said of it, the last `look`, the reasons already held, when the turn first changed a source). A build is the turn's
  (`caused` in `stopAnswer`) only if it began at or after `TurnState.changedAt`: the `PreToolUse` of an `Edit`, `Write`
  or `MultiEdit` of a `.py` inside the object, or the start of a `Bash` after which the newest `.py` directly in the object's
  folder or in `common/` is newer than before (`aroundBash`, `Sessions` dep `sourcesSaved`; the command's text is never read, and
  a Bash that rewrites nothing is no change). The first build of an object just opened, a save of the person's before
  the turn's first edit, and every build of a turn with no edit are told as ever (digest, context) and never hold a
  Stop back, nor is waited for: every one of the five reasons looks only at a build the turn caused, and the hard-defect
  and dimension reasons then judge it against the build the turn began with. First it
  waits, up to `STOP_WAIT_MS` (20 s), for a build the turn caused that is still running and, when a dimension passed
  when the turn began, for the dimensions to be measured on the build that ended, if the turn caused it (`Verdicts.settled`, to the same
  deadline). Then it is held back (`decision: block`) for the first of these five reasons: the build the turn caused is still running; the latest build, caused
  and ended in the turn, failed (said as "The build after rN failed", `failedAfter`: a revision names a build that worked, and a
  failure has no number of its own); the last successful build, caused by the turn, has a hard defect (`hardDefects`) that the
  last successful build when the turn began (`TurnState.before`) had not, and the reason says the agent may answer
  that it is meant; a dimension that passed on that build fails on the latest, which the turn caused (`verdictChanges` of `verdicts.ts`,
  kept `pass` to `fail`; the reason names it with `valueAgainstExpected`); a build the turn caused, ended
  after the turn's last `look` (`TurnState.lookedAt`, the count of builds ended at the `PostToolUse` of a `look`, one
  of a subagent too), however the model was written, unless nothing in the parts changed since the build the turn
  began with (`partsUnchanged` of `sanity.ts`: the same parts, each with the same `hash` and the same `loc` and
  `arranged`; the digest's `changed` is not enough, a moved hole keeps every count and size; the turn began with no
  build, or a scene that is not the latest's: it looks). A reason already held is not waited for again: a Stop after
  one held for a running build does not wait for the build, one after a dimension hold does not wait for the
  measuring. A reason is held once
  (`TurnState.held`) and a turn is held twice at most (`holds`): `stop_hook_active` is no guard of its own, the ledger
  is. A hold for a defect or a dimension that finds the build unlooked says so, and counts for that reason too. The
  reasons say "built during this turn", never "you edited": the person's own edit also ends a build. Never for a
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
