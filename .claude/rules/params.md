---
paths:
  - "app/src/renderer/ui/Selection.tsx"
  - "app/src/main/paramsfile.ts"
  - "app/src/main/paramsfile.test.ts"
  - "app/src/main/params.itest.ts"
  - "app/src/shared/params.ts"
  - "app/src/shared/params.test.ts"
  - "app/src/renderer/ui/ParamsPanel.tsx"
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
  not read them) has no section. A row (`paramRow` in `ui/paramRows.ts`, pure) is the name and the default in the
  monospace face (`shared/format.ts`, four digits at most, a list or a dict by its items, a bool as Python writes it;
  the whole value in the value's `title` where it differs, with the type as written in the row's), the comment (`doc`)
  as written, its numbers in the monospace face (`numbered`), cut to two lines (whole in the row's title), and, for a default that is not a literal, "worked out in the
  model" (its value too when the kernel has one). No unit is taken from a comment.
- A click on a row puts `Params.<name>` at the cursor of the open object's session by `insertIntoSession`
  (`ui/insertIntoSession.ts`, also the selection's "Insert" and the build error sheet's ask: the box of the chat,
  `insertIntoComposer`, else a paste at the terminal's prompt, never sent; it says whether it went in), and shows the
  dock first (`later`: a box in a hidden dock takes no focus), as the selection's "Insert" does; the box puts its cursor
  after the text once it is given the keys (`unfocused` in `Composer`: a hidden box loses the one it was given). `Params.x` names no geometry, so it is plain text in the
  prompt: `refsIn` and `RefChip` do not see it. A row's accessible name stays `Params.<name>`; its `aria-description` holds
  the row's title (type, value whole, comment) and then what a click does. With no session running a row is text, not a
  button, and the description says to start one (`e2e/params.spec.ts`, which writes its own `Params` into its copy of a
  fixture).
- **Trying a value.** A field the kernel says is `editable` (`Param.editable`: `float`, `int`, `bool`, `choice`)
  has a control under its name (`ParamControl`): a number field, plus a slider when the model gives `min` and `max`
  in the field's `metadata`; a checkbox; a select. A number is taken on Enter or when the field is left, a slider when
  it is let go of (`onPointerUp`, `onKeyUp`): a build runs then, never while it moves. It asks main
  (`object.setParam`, `object.resetParams`; a refusal is said under the title) and the control starts again from
  `Param.value`, the value the last build used (keyed by it), so the window holds no override of its own. A row built
  with a value other than the default (`tried`) says `differs from the file` with a "Reset"; the default stays on
  the line. `Scene.overrides.dropped` is shown on its row (`param-note`). "Ask the agent to bake it in"
  (`bakeText`) puts a request in the session's box like a row's click does, never sent; "Reset all" resets every field.
