---
paths:
  - "app/src/main/goback.ts"
  - "app/src/main/goback.test.ts"
  - "app/src/main/ipc.ts"
  - "app/src/shared/history.ts"
  - "app/src/renderer/ui/strip/BuildsStrip.tsx"
  - "app/src/renderer/ui/strip/NodePopover.tsx"
  - "app/src/renderer/ui/chat/GoBack.tsx"
  - "app/src/renderer/state/goBackAsk.ts"
---

# Go back

## Go back (`app/src/main`)

"Go back to before this prompt" (`src/main/goback.ts`; the plan and result types are in `shared/history.ts`): the one place torno writes and
deletes files of the person's model. `workspace-writes` says what it may write (the fourth exception); these are the rules of the code.

- **Which build.** `entryBefore(entries, prompt, startedFrom?, drawnGone?)`: the newest drawable entry before the prompt's first entry (`turn.prompt`); with
  none, the build that was current when the prompt was sent (`Sessions.startedFrom(prompt)`, from `TurnState.before`, held for the newest 500
  prompts of this run) if that entry is kept before the prompt's first; else a sentence. When ids are missing between that entry and the prompt's
  first one that is kept, and a build that drew may have been one of them (`drawnGone`, from `readHistoryDrawnGone`, is above that
  entry's number: builds that drew were let go, and an old starred one outlived them), it is not the build before the prompt: the
  build current when it was sent if kept, else a sentence. A gap of failed builds only (they are pruned first) is no gap (the window then offers Undo on the last turn). The window names a prompt, never a file or a build:
  `ipc.ts` `goBackTarget` finds the entry.
- **Tried Params** (`HistoryEntry.tried`): a build of the cause `params` names the Params whose applied override (`scene.overrides.applied`) is not what the build before was made with (`triedParams` in `history.ts`), so the chat can say "You set wall to 3 · not in the model yet" (`HistoryEntry.set`: the value each of those was built with; a name of `tried` not in `set` was put back to the file's value; an entry kept before `set` still reads "You tried wall"). Main's only.
- **The plan** (`planGoBack(obj, to)`, reads only; `history:goBackPlan`): `write` is the files of the copy in the project's own folder
  (`<name>/….py`, no hidden part, no `..`, `ownFile`) whose bytes now differ; `leftAlone` the files of `common/` and of other projects that
  differ (never written); `remove` the own `.py` files that are there, are in no entry up to `to` and in one after it, and are not in the copy (a file torno
  never saw is never removed); `changedSince` those of `write` and `remove` that a save of the person's after `to` (an entry of cause `person`, `params` or `unknown`)
  put in another state than the entry before had them, or first brought, or whose bytes are not the newest drawable entry's copy (an unbuilt save);
  `undoneSaves` the entries after `to` of those causes (not failed ones), which the confirmation names ("and your saves h42"); `params`
  whether `.torno/params.json` is not what the build was made with (`scene.overrides.applied` of its `scene.json`, held against the entry's
  `params` defaults; a build that says nothing of overrides leaves them alone); `undone` and `prompts` the entries after `to` and their distinct
  turns. `fallback: 'undo'` when the target holds no copy (`files: []`, or a copy of an own file that cannot be read): Undo (`Sessions.undoTurn`)
  is then the way, and says so.
- **Applying** (`applyGoBack`; `history:goBack`): refused while the object's session is `working`, `needs_input` or has prompts untaken
  (`Sessions.busyWith`) or a build runs. The plan is worked out again and must equal what the window confirmed (`to`, `write`, `remove`), and
  what is written is what main worked out, never what the window sent. Before the first write every file is checked (inside the project by real path, not
  a link, a folder or anything but a plain file); then each is written with `writeFileAtomic`, then the removes, then the Params
  (`paramsfile.replaceOverrides`, the one write); a failure stops there and says `done` and `failed`, and nothing is marked undone or told.
  Before the first write `Builds.expect(id, 'goback', to)` says the next build the watcher starts is the Go back's (it may start between two
  writes, and `rebuild` is refused while it runs); it is let go when a write fails and once `rebuild` has been asked. After the files
  `Builds.rebuild(id, 'goback', to)` (and `Builds.changed` keeps `goback` for the watcher's burst of the same files), the entries after `to` get `undone` in one index write (`History.markUndone`), and `.torno/goback.json` is kept.
- **The notice** (`.torno/goback.json`, ignored by git: `{ to, undone, prompts, at }`): kept until a prompt carries it, so a restart or a new
  conversation still gets it; a second Go back before then adds its prompts. `takeGoBackNotice(dir)` reads it and gives `{ text, done }`;
  `index.ts`'s `contextFor` puts its text first in the next prompt's context (`contextFor`'s `opts.notice`, in addition to `CONTEXT_LIMIT`) and
  gives `done` as `PromptContext.delivered`, which the session manager calls once the hook's answer has left, so the file is removed (only if it is
  still the one read) after the agent was handed it, never before.
  It names the prompts by their words (the turn's `text`, 60 characters each, six at most), since the agent knows no prompt numbers. The chat
  also gets a quiet note at once (`Sessions.noteGoBack`).
- Nothing here is taken from the window but a prompt id and what was confirmed; `cause`, `wentBackTo` and `undone` are main's.

## Go back in the window (`app/src/renderer/ui`)

- One confirmation, `useGoBack` (`chat/GoBack.tsx`), for every place that offers it: the turn's dots (`TurnMore`) and a node of the builds strip (`strip/NodePopover.tsx`, "Go back to here"; the prompt is `goBackTarget` of `strip/nodeMenu.ts`, and main's `entryBefore` finds the node's build again from it). It stands from the anchor it is given, lists `planLines`, and while it asks (`confirm`, `going`) it tells `state/goBackAsk` what the plan undoes (`plan.undone`, the prompts of `plan.prompts`): the strip draws those nodes (`data-struck`) and `Items` the prompts' groups struck and muted. The one that set it lets it go (cancel, done, unmount). The strip is outside the chat's contexts, so `NodePopover` provides `ChatIdle` and `PromptNumbers` itself; what came of an ask that was refused or failed stands from the node in a card with Close (`GoBackOffer.step`, `dismiss`).
