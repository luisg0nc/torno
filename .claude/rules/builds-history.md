---
paths:
  - "app/src/renderer/ui/AskToCommit.tsx"
  - "app/src/renderer/ui/AskToCommit.test.ts"
  - "app/src/main/history.ts"
  - "app/src/main/history.test.ts"
  - "app/src/main/buildlog.ts"
  - "app/src/main/buildlog.test.ts"
  - "app/src/main/git.ts"
  - "app/src/main/git.test.ts"
  - "app/src/main/meshes.ts"
  - "app/src/main/meshes.test.ts"
  - "app/src/shared/history.ts"
  - "app/src/shared/history.test.ts"
  - "app/src/shared/git.ts"
  - "app/src/shared/git.test.ts"
  - "app/src/renderer/ui/HistorySheet.tsx"
  - "app/src/renderer/ui/historyBits.ts"
  - "app/src/renderer/ui/historyBits.test.ts"
  - "app/src/renderer/ui/useHistory.ts"
  - "app/src/renderer/ui/useGit.ts"
  - "app/src/renderer/ui/GitText.tsx"
  - "app/src/renderer/viewport/ghosts.ts"
  - "app/src/renderer/viewport/ghosts.test.ts"
  - "app/src/renderer/viewport/earlier.ts"
  - "app/src/renderer/viewport/earlier.test.ts"
  - "app/src/renderer/state/landing.ts"
  - "app/e2e/history.spec.ts"
  - "app/e2e/git.spec.ts"
---

# Builds: identity, git, the history kept, ghosts and an earlier build

Moved as written from the folder `CLAUDE.md` files; each heading names the folder it came from, and paths are written as they were there (see "Rules by area" in the root `CLAUDE.md`).

## The page of objects (`app/src/main`)

- **git is read, never written** (`src/main/git.ts`, `shared/git.ts`; #62). `gitState(objectDir)` runs one `git status
  --porcelain=v2 --branch -z` by `execFile` (no shell) with `--no-optional-locks`, `GIT_OPTIONAL_LOCKS=0`, `core.fsmonitor=false`, no
  prompt, `GIT_DIR` and its kin taken out of the environment, 5 s (`GIT_TIMEOUT_MS`) and then killed, over the project's folder and
  the `common/` beside it (the paths of the work tree, found by `rev-parse --show-toplevel`), and drops what is under `.torno/`.
  It answers the commit, the branch and the files that differ (30 named at most, all counted), or null: no git, not a work tree,
  no answer in time. `git.test.ts` holds that the index's mtime, inode and size are as they were after a status on a stale entry.
  No other git command is run, none that writes: **torno never commits**; the person asks the agent to (the Marks panel offers the
  request). It reaches the window as `git.status(objectId)` (`gitStateRecently`: an answer is kept for a second, so a page of
  cards and the status line cost one run) and as `ObjectCard.git`.
- **A build has an identity** (`src/main/buildlog.ts`, #62). When a build lands, `BuildLog.record` finds `sourcesHash` (twelve hex of the
  SHA-256 of the `.py` files directly in the project's folder and in `common/`, and the files the build says it imported from
  elsewhere in the workspace, `Scene.uses` when the kernel gives it; each by its path and bytes), the commit (`gitState`) and whether files
  differ from it, keeps that in memory for the run (40 builds an object; `identity(id, revision)`, `buildIdentity` in `ipc.ts`) and
  adds a line to `.torno/builds.jsonl` (`revision`, `at`, `run`, `sources`, `head`, `dirty`): one write at a time, through
  `ownTorno` and `ensureIgnored(dir, ['builds.jsonl'])`, appended, or the last 500 lines written whole when it would pass that.
  `run` is the run of torno (random): a revision counts from 1 in every run, so a line of the file is a revision of *that* run alone.
  The hash is of the files as they are when the build lands; a save during a build builds again.
- **A history of builds** (`src/main/history.ts`, `shared/history.ts`; #56). `History.keep` (called from `ipc.ts` when a build lands, with the
  promise of `BuildLog.record`, so in the order builds landed) keeps each build that worked under `.torno/history/`, ignored through
  `ensureIgnored(dir, ['history/'])`: `index.json` (`{ next, drawnGone, entries }`, written whole and atomically; `drawnGone` is the number of the newest build that
  drew of those pruned, so Go back can tell a gap of failed builds only from one it must refuse, and an index without it takes it as the
  entry before the oldest one not starred), and per build `h41/scene.json` (the
  scene without `output`; its mesh was never in it), `h41/source/<path from the workspace>` (copies of the files `sourcesHash` goes by, read
  once with `readSources`; not copied, and the entry kept with `files: []`, when they hash otherwise than `BuildRecord.sources` says, or pass
  `MOST_FILE_BYTES` a file or `MOST_COPY_BYTES` a build) and `h41/thumb.png` (the card's picture, attached by `History.thumbnail` from
  `show:saveThumbnail` once `keepThumbnail` took it; at most `MOST_THUMB_BYTES`). The folder of a build is written before the index names it,
  so a crash leaves the index whole and at most a folder no index names, which the next change sweeps (only folders named `h<n>`). **An id
  is `h<n>`, counts on across runs and is never given twice** (`next`, and above any folder there: a lost index does not repeat one); a revision
  is of its run and is told beside it. A build made from the sources the newest entry was made from is not kept again (unless the person's
  `Params` made it: the files are the same and the shape is not). **What caused each build, and its prompt, are main's alone** (`cause`, `turn`,
  `wentBackTo`: never from the window or a tool): `Builds` says what it started a build for (`BuildReason`: `watch`, `params`, `rebuild`,
  `goback`, `open`, on the `build` and `scene` events), `params` and `goback` are the cause as they are, and else `Sessions.causeOf(objectId,
  startedMs)` says `agent` (a session of the object has a turn running whose first edit, `TurnState.changedAt`, was at or before the build began;
  a build begun between the prompt and that edit is the person's) with the turn (`conversation`, `prompt`: the id of the prompt's `user` item as the chat's log holds it, or `t-<conversation>-<n>` in a terminal, `text`: its first 200 characters), or `person`; a build begun while the turn was on is still its own when its scene lands after the `Stop` (`Session.lastTurn`). A build that **failed** is kept too
  (`History.keepFailed`, from `ipc.ts` on the `build` event): a line with `failed`, `error` (`errorLine`), `files: []`, the revision of the last
  good build, no folder; the same failure of the same sources as the newest's is not kept again; not for a cancel, a stopped kernel or a project
  with no model. `thumbnail` and `dimensions` never go to a failed entry. Pruning lets go of the oldest failed entries before any build, and never
  of the newest entry. A build whose declared
  checks fail is kept and marked (`failing`). The newest 100 are kept besides every starred one (`HISTORY_KEPT`; `History.star`). The entry's
  verdicts are **as of then** (`dimensions` is set when the check that followed the build ends, `keepDimensions` in `ipc.ts`): never told as
  how the build stands now. One writer, one change at a time per object, `ownTorno(dir, 'history')` before every write and delete; nothing
  of it is copied back by Go back alone (`goback.ts`, see Go back below); the agent's tools never restore a file.
  **Meshes for the ghost of a kept build** (`src/main/meshes.ts` `RecentMeshes`, `ws.meshes`): the scene and the blob of each build of
  this run, in memory only, never written; `MESH_BUDGET_BYTES` (64 MB) for all the objects, not counting the newest build of each, the
  oldest let go first. `history:list` says which kept builds still have theirs (`ghosts`), `history:ghost` hands them to the window
  (a build of this run only), and **builds any other kept build again from its copy** (`oldbuild.ts` `rebuildKept`): the
  copies of its files are laid out under `<userData>/compare/<random>/` at their paths from the workspace (so the model's
  `common/` and other projects are the copies, never today's files) and the workspace's own kernel builds them as a `trial`
  with `mesh: true`: a worker of its own, in the environment a build of that workspace has, the model's own default
  `Params` (those of the build are not kept with its copies). The folder is removed when the answer comes and the whole of
  `compare/` is swept when torno starts; nothing is written in the workspace. A build that failed, one with no copies, a kernel busy with a
  build and a copy that does not build are `{ refused }` with a sentence, which `history:ghost` answers as null.

## What a build changed (`app/src/renderer`)

- When a build lands over another of the same object, `actions.applyScene` keeps the one before as `before`, and the
  status line (`ui/BuildStatus.tsx`, `state/landing.ts`) says which parts of the layout shown changed
  (`landing`, `landingText` of `shared/diff.ts`: `tub changed, lid same`), with the `diff` lines in its title; the
  one rule of what a part's change is is `partChanged` (another mesh, or another `loc`). Nothing of it for a first
  build, a build running or a failed one.
- The ghosts (`viewport/ghosts.ts`, `Viewport.setScene`): of each part that changed, its old edges in `--muted`
  (seen through the part) where it stood, and its new edges in the accent, for `GHOST_HOLD_MS` and then one fade of
  `GHOST_FADE_MS`, by `invalidate()` steps and by a clock of their own (never endless, never waiting on a frame).
  Any key or a press on the canvas, another layout, a section or an explode ends them at once; none is made with a
  section or an explode on, for a part switched off, or of another layout, and they are hidden for a picture
  (`hideGizmo` in the host of `PictureMaker`). Not a mark, in no mark colour. `__tornoTest.ghosts()` and
  `holdGhosts()` are for tests.
- The parts fade for a build only once it has run `FADE_AFTER_MS` (`fadeIn` of `shared/build.ts`, applied by
  `ViewportPane`); a failed build fades them at once; the pick lock does not wait.

## History of builds (`app/src/renderer`)

- **Prompts only** is the history of the project, in the session pane (`ui/chat/PromptsOnly.tsx`; the old `HistorySheet` is gone). **History**
  in the status line (`BuildStatus`, `status-history`) and the chat head's `Chat | Prompts only` toggle (`ChatPane`, the group `Show`) are
  the one flag `store.promptsOpen` (`actions.setPromptsOpen`, which also shows the dock; of the open object, so another one starts at the chat).
  In the chat it is drawn over the transcript (`.prompts`, absolute inside `.chat-scroll`), which keeps its scroll and is `inert` meanwhile; where
  the chat is not (a terminal session, or no session yet) `SessionPane` draws `PromptsPane` over the session area (`.session-prompts`, with Close).
  Rows are `promptLines` (`ui/chat/promptsView.ts`, pure and held by its test): the project's prompts (`chat.prompts` through `usePrompts`, asked
  again when a prompt is sent or a build kept) joined to the history's entries by `turn.prompt`, newest first, with `savesBetween` lines between
  rows, a `began` line where a conversation's run starts (`current`: the conversation of the open chat), the prompts of `goneBack` folded into one
  openable row, `Starred` (a build of the prompt is starred) and `Hide gone back`. A row: number, `useThumb` of its last build, the text cut to a line,
  `<from> → <to>` (where it started from, its last drawable build), `resultWord` (`gone back from`, `build failed`, `<n> failed on the way`,
  `<n> checks fail`, `starred`, `passes`; nothing for a prompt that built nothing) and `ago`. A click is `actions.compare(from, to, number)` (a second
  click `endCompare`; `aria-disabled` with the reason when there is nothing to compare or a section or an explode is on), a double click or the row's
  "Open in chat" is `ChatPane.openInChat`: it puts Prompts only away, reads the earlier conversations first when the prompt is of another, and scrolls
  `.chat-group[data-id=<user item id>]` into view. A terminal's prompt (`t-` ids) is never opened. The chat's **Earlier conversations (n)** button (at the
  top of the transcript, shown for the project's other conversations that have a chat log) reads them (`chat.conversation`, read-only, no history joined)
  and draws each above the current one under `ChatEarlier`.
- **One number for a prompt.** `listPrompts` (`main/sessions/prompts.ts`) numbers every sent prompt of every conversation from 1 by time; the window's
  `numbersOf(rows, items)` (`historyJoin.ts`) is that map by prompt id, plus the prompts of the open transcript the list does not have yet (queued or just
  sent), numbered on from its last; `ChatItems` takes it as `numbers`, and turn cards, Go back's confirmation, Prompts only and `comparing prompt <n>` all use it.
- The window's own reading of the history (`useHistory`, `history.list`, again at `history:changed`) writes nothing. The source of a kept build
  and "Ask the agent to go back to this build" were the sheet's and are gone with it (`history.source` stays for tools that read it); Go back is on the turns.
- **Compare: a kept build against the live one** (`state/compare.ts`, `ui/CompareBar.tsx`, `viewport/earlier.ts` `Earlier`, `Viewport.setEarlier`
  and `setCompareMode`). `store.compare` is `{ from, to, mode, prompt? }` (history ids, `from` the earlier; `building` and `refused` are said of
  `from`'s drawing), set by `actions.compare(from, to, prompt?)` (a row of Prompts only, a turn of the chat),
  changed by `compareMode` (`before`, `overlay`, `after`, `side`) and ended by `endCompare` ("Back to live" in the band, `Esc`: the row
  `compare.end`, scope `compare`, which `ViewportPane`'s key handler asks before the tool in hand and the viewport's `escape`). `ViewportPane`
  asks main for `from`'s scene and meshes (`history.ghost`: held in memory for a build of this run, else built again from its copy in a worker thrown
  away; a `refused` sentence, shown in the view, when it cannot be) and draws its parts of the layout shown (`EARLIER_SURFACE_OPACITY`, in `--muted`, with
  edges). Which build is the "after" is `to`: when it is not the build on show (`isLive`: this run, the revision shown; a past turn compared while newer
  builds have landed) `ViewportPane` asks main for it as it does for `from` and `Viewport.setLater` draws it in the live build's place for the whole
  of the comparing (the live meshes, marks, ghosts and scans are left out of the frame by `renderScene`, never disposed; a live build landing updates
  them unseen; `clearLater` has them back; asked again at every revision). Overlay: `from` translucent in `--muted` over `to`. Before, After and the two halves
  of Side by side draw their build opaque in the normal part colours (`colorsOfParts` of its own scene; edges their darker tint): `from` alone, `to` alone
  (the live build itself when it is `to`), the two in the left and right halves, with the scissor test and one camera framed for half the width, a line down the middle
  (`OverlayPass.split`), no marks, chips or cues, and no pick (`Viewport.pick` is null whenever what is drawn is not the live build: a point of the canvas is on neither
  as the camera has it, nor a chip of a mark made on another build). The status line says `comparing prompt 14 · h40 → h41` (`compareStatus`), or
  `Building h40 to compare…` once the wait passes 300 ms. The boxes over the view are the history entries' (`useHistory`): "What changed" is the later
  build's `line`, "Checks and marks" is `checksMoved` of both entries' `dimensions` and `failing`. For display only: no bounds tree, a ray finds nothing, it is
  hidden for a picture (`hideGizmo`), and nothing is measured, marked or written from it. A live build landing does not end it; another object, another layout, a
  section or an explode does. It is not the ghosts of a build that landed (`ghosts.ts`, a moment, edges only). `__tornoTest.earlier()` and `compare()` are for tests.
