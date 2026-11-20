---
paths:
  - "app/src/renderer/ui/Selection.tsx"
  - "app/src/main/paramsfile.ts"
  - "app/src/main/paramsfile.test.ts"
  - "app/src/main/params.itest.ts"
  - "app/src/shared/params.ts"
  - "app/src/shared/params.test.ts"
  - "app/src/renderer/ui/ParamsPanel.tsx"
  - "app/src/renderer/state/drives.ts"
  - "app/src/renderer/state/drives.test.ts"
  - "app/src/main/drives/**"
  - "app/src/shared/drives.ts"
  - "app/src/renderer/ui/ParamsPanel.test.ts"
  - "app/src/renderer/ui/paramRows.ts"
  - "app/src/renderer/ui/paramRows.test.ts"
  - "app/src/renderer/ui/insertIntoSession.ts"
  - "app/src/renderer/ui/insertIntoSession.test.ts"
  - "app/e2e/params.spec.ts"
---

# Params: what the model offers, and the values the person tries

Moved as written from the folder `CLAUDE.md` files; each heading names the folder it came from, and paths are written as they were there (see "Rules by area" in the root `CLAUDE.md`).

## What crosses processes (root `CLAUDE.md`)

- The model's `Params` can be tried without editing the model: the person's overrides are `<object>/.torno/params.json`
  (main the only writer; the file always wins: an override is dropped when the file's default of its field changes),
  every build of the object carries them, and the agent is told so with every prompt; the agent's `try_params` builds
  a throwaway copy in a trial worker and keeps nothing. torno never writes the model for this: a value is baked in by the
  agent editing it (below, Params the person tries; the rule `kernel-model-contract`).

## Params the person tries (`app/src/main`)

- `<object>/.torno/params.json` (`{ "overrides": { "wall": { "value": 2.4, "default": 2 } } }`, `src/main/paramsfile.ts`)
  holds the values the person tries in place of the model's defaults, with the default the file had when each was
  made. Main is the only writer: one change at a time per folder, atomically (`writeOwn`), git-ignored
  (`ensureIgnored`), the memory put back when a write fails. The model file is never written: that is the rule that
  keeps torno from being a modeller, and the one thing that bakes a value in is the agent editing the model.
  `Builds` gives every build of the folder `overrideValues(dir)` (`overrides` of the kernel's build request, which
  applies only what an `editable` field of its type can take and says what it dropped).
- **The file always wins.** After each good build `reconcile` (called from `Builds`, `OverridesPort`) holds the
  overrides against the scene: one whose field the model no longer offers, that the kernel refused, or whose recorded
  default is not the file's default now is dropped and noted (`Scene.overrides.dropped`, with the reason, until the
  person says anything of that field), and that build, made with a value that was let go of, is made again. One equal
  to the default is dropped with no word and no build. `scene.overrides` and each `Param.value` are how the window
  and the agent learn what a build was made with.
- The agent is told every time (`triedLine` of `shared/params.ts`; the second line of `contextFor` and
  `buildContextFor`, at most `TRIED_LIMIT` characters, its room kept before the status is fitted), in `state.md`
  (`## Params tried`) and by `scene` (`params[].value`, `paramsTried`), that the build is not the file's values. The
  channels `object:setParam` and `object:resetParams` are the window's; the agent has no tool that writes an override
  (`try_params` asks a trial and keeps nothing).

## Parameters (`app/src/renderer`)

- `ui/ParamsPanel.tsx`: the fields of the model's `Params` as the kernel read them at the last build (`Scene.params`,
  as main sends the scene, unchanged), read only; torno never writes the model. A model with none (or a kernel that does
  not read them) has no section. A row (`paramRow` in `ui/paramRows.ts`, pure) is a ledger line of 27 px
  (`.param-line`, `styles/card-params.css`): the name in the monospace face, one source word (`ParamRow.word`: `sourceWord` of
  `shared/params.ts` shortened, `ref photo-1.jpg` is `photo-1`, `person` is `you`, `derived` is `model`, `no source` for a size whose comment says none,
  nothing for a flag or text), and the value in a field of its own (`.param-field`), said once: a number field, a checkbox
  with its word or a select for an `editable` field; plain `.param-value` for one that is not; `= value` (`data-worked`, no field) for a
  default that is not a literal. Numbers go through `shared/format.ts` (four digits at most, a list or a dict by its items, a bool as
  Python writes it; the whole value in the title where it differs, the type as written in the name's title). An assumed value
  (`sourceOf` is `assumed`) has a dashed field edge and its word in `--warn` ("nothing checks this"). A number whose `metadata`
  has `min` and `max` fills its field to where the value stands (`.param-fill`, `role="img"`, `aria-label` from `gaugeSaid`).
  The comment (`doc`) is in the name's title and, whole with its source as written (`splitSource`), in the open part. No unit is taken from a comment.
- **A line opens in place** (`.param-open`, `data-open`) while its field or slider has the keys (a click on the value, Tab, the
  picker's Enter, which focuses `[data-param-field]`) and for as long as its value is tried: the comment whole, the slider, and the kept line
  with Reset. Pointing at a line lights its faces (and borrows the leader) and moves nothing; the keys on the name do not open it.
  The notes under a line (a dropped override, what a value drives) still add a line while they show.
- A click on a name puts `Params.<name>` at the cursor of the open object's session by `insertIntoSession`
  (`ui/insertIntoSession.ts`, also the selection's "Insert" and the build error sheet's ask: the box of the chat,
  `insertIntoComposer`, else a paste at the terminal's prompt, never sent; it says whether it went in), and shows the
  dock first (`later`: a box in a hidden dock takes no focus), as the selection's "Insert" does; the box puts its cursor
  after the text once it is given the keys (`unfocused` in `Composer`: a hidden box loses the one it was given). `Params.x` names no geometry, so it is plain text in the
  prompt: `refsIn` and `RefChip` do not see it. A row's accessible name stays `Params.<name>`; its `aria-description` holds
  the row's title (type, value whole, comment) and then what a click does. With no session running a row is text, not a
  button, and the description says to start one (`e2e/params.spec.ts`, which writes its own `Params` into its copy of a
  fixture).
- **What a value drives** (`state/drives.ts`, `main/drives/`, `shared/drives.ts`). The pointer or the keys' focus on the row of an `editable`
  field for `REST_MS` (500 ms) asks main (`object.drives`, channel `object:drives`), which builds the model once more with that one
  value nudged (`nudgeOf`: a tenth of a number, at least `step` or 0.5, kept inside `min` and `max`; a count by 1; a flag turned; the
  next choice) in a trial worker (`Builds.trial`, the way `try_params` and Compare build; the person's other overrides stand) and
  holds `face_prints` of that build against those of the build on show, layout by layout (`compareBuilds`, pure): a face
  of the same place in the kernel's order and type that moved, changed size or turned is lit (`part/F<i>`); a part whose faces
  are no longer the same ones (another count or types, or gone) is lit whole. The answer is kept for the field, and the prints of the
  build on show for every field, until the next build (`Drives`: the scene's revision); a trial the kernel could not make now (`busy`,
  `no_room`, `cancelled`, a crash, a timeout) or one for a build that is no longer on show is never kept, one the model's own error
  ended is, until the next build. Trials run one at a time. The build on show is only asked with a query that never builds it again,
  and a build that starts cancels the trial. The faces are on the viewport's `drives` layer (`Viewport.setDriven`), in the accent,
  never the selection's or a set's; the row says `Working out what this drives…` (`DRIVES_WORKING`) while it runs and the reason
  when it fails (`param-note`, `role="status"`). A new build or leaving the row puts it out; it lights nothing of a preview and
  writes no file.
- **Trying a value.** A field the kernel says is `editable` (`Param.editable`: `float`, `int`, `bool`, `choice`)
  has its value as the control (`ParamItem`): a number field, plus a slider in the open part when the model gives `min` and `max`
  in the field's `metadata`; a checkbox; a select. A number is taken on Enter or when the field is left, a slider when
  it is let go of (`onPointerUp`, `onKeyUp`): a build runs then, never while it moves. It asks main
  (`object.setParam`, `object.resetParams`; a refusal is said under the title) and the field starts again from
  `Param.value`, the value the last build used, so the window holds no override of its own. A row built
  with a value other than the default (`tried`) says `Kept by torno, not in the model file yet. The file has 6.2.` with a "Reset" in its open part; the file's default is in that line. `Scene.overrides.dropped` is shown on its row (`param-note`). "Ask the agent to bake it in"
  (`bakeText`) puts a request in the session's box like a row's click does, never sent; "Reset all" resets every field; the two sit in one band under the filters while a value is tried (`.params-tried`). There is no
  "write it into the model" button: the model is written only by Go back (`goback`), which restores copies torno kept, so a
  new writer of the model's defaults would break that rule; the agent bakes a value in.
