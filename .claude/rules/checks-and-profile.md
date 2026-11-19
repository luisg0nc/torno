---
paths:
  - "app/src/shared/modelChecks.ts"
  - "app/src/shared/modelChecks.test.ts"
  - "app/src/shared/profile.ts"
  - "app/src/shared/profile.test.ts"
  - "app/src/main/profile.ts"
  - "app/src/main/profile.test.ts"
  - "app/src/main/builds.ts"
  - "app/src/main/builds.test.ts"
  - "app/src/renderer/ui/card/Checks.tsx"
  - "app/src/renderer/ui/card/Checks.test.ts"
  - "app/src/renderer/ui/card/checksOrder.ts"
  - "app/src/renderer/ui/card/checksOrder.test.ts"
  - "app/src/renderer/ui/checkRows.ts"
  - "app/src/renderer/ui/PrintProfile.tsx"
  - "app/e2e/checks.spec.ts"
---

# The model's own checks, and the print profile

Moved as written from the folder `CLAUDE.md` files; each heading names the folder it came from, and paths are written as they were there (see "Rules by area" in the root `CLAUDE.md`).

## Marks (`app/src/main`)

- **The model's own checks** (`checks(p)`, kernel `modelchecks.py`) arrive in the scene as `checks`, measured by the
  kernel, each with its `status`, `value`, `unit`, wanted `min`/`max`, the kernel's `exact` and `how`, and the
  `declared` dict. They are the model's, never the person's: no check resolves, replaces or silences a dimension
  (a mark). `shared/modelChecks.ts` is the one rule for the words (`checksLine`, `checkText`). `context.ts` tells
  them in one line (at most `CHECKS_LIMIT`) after the dimensions, with every prompt and after an edit, saying
  while a build runs that they are not of the last edit; `state.md` has a `## Checks` section; `scene` gives them
  under `checks`. A failing check never holds the Stop back and never fails a build. The agent writes both the part
  and its checks, so `Builds.succeeded` compares each new build's checks with the build before (`keepNotes`) and
  keeps, as `Scene.checkNotes`, a note for each check removed, made easier to pass (`min` lowered, `max` raised or
  dropped, a bed made larger, an angle widened) or aimed at other parts, with the build it was first seen on; it
  stays while the check is weaker than it first was, in memory only. A check the model rewrote for renamed parts (a
  check the build before did not have, of the kind and layout of one it drops) is that check under a new name, not a
  removed one: it is noted only when its bounds are looser, under the new name (`replacements`), and then as any note. The window shows the notes; the agent is told
  of them by `state.md` and `scene` (`checksEasier`).
- **Against an assumed reference.** After a good build `Builds.succeeded` gives each check `assumedRefs` (`assumedAgainst` of
  `shared/modelChecks.ts`, from `assumedReferences` of `shared/params.ts`): the references it names (`a`, `b`, a group by its
  parts; an `interference` all of them) whose `reads` include a `Params` field commented `assumed:`. Every place says it:
  `checkText` ("…; against an assumed reference: radiator"), `checksLine` ("N of the passes against an assumed reference"),
  the row of the Checks section and the failing-checks pointers (`CheckWords.assumed`), and `scene`'s `checks[].assumedRefs`. It
  is the model's own claim of its sources, as `assumedLine` is; the pass itself is never softened.

## Print profile (`app/src/main`)

- The printer and material an object is made for (`shared/profile.ts`: `Profile`, the one rule for the types, the
  starter materials, `fitVerdict`, `leastWall`, `profileLine`) are the person's numbers, never the kernel's. The
  person's own printers and materials are in torno's user data (`profiles.json` beside `config.json`,
  `UserProfiles` in `main/profile.ts`, in memory with no config file), never in a workspace. The object's choice is
  `<object>/.torno/profile.json`, a copy of the values (`projectProfile` reads it at each question, `setProjectProfile`
  writes it through `writeOwn`; the window's `profile:set`, nothing else writes it), not ignored: it travels.
- `ToolDeps.profile` gives `check` and `measure` their defaults when the call leaves a value out: `bed` the printer's
  bed, `thin` the least wall (the material's, else two nozzles), `overhang` the material's angle, `mass` its density.
  A call that gives a value keeps it. A reading that used the profile ends `by your profile (Bambu X1C, PETG): the
  person's numbers, not measured`, and the data has `profile`. `check` clearance with `fit` is judged against the
  material's band per side (`fitJudged`: `passes`/`FAILS`, how far outside, overlap fails) and always says it is not a
  claim that the part prints; `fit` without a material, or on another kind, is refused. The model's own `checks(p)`
  are not given defaults: they declare their numbers.
- A new conversation is told it in one line (`profileLine`, in `contextFor` with the references, only if it fits; not
  in the system prompt, which is at its cap), `state.md` has a `## Print profile` section, and `scene` gives it as
  `printProfile`. A change of the profile has `state.md` written anew (`onProfile`).

## Checks (`app/src/renderer`)

- `ui/card/Checks.tsx`, the body of the Checks section of the route card: the checks the model declares in its `checks(p)` as the
  kernel measured them at the last build (`Scene.checks`, `Scene.checkNotes`) and the person's dimension checks (`isCheck`) as
  one list. `ui/card/checksOrder.ts` (pure) is the rule: `mergedChecks(model, dimensions, build)` gives `CheckRow`s, failing
  first, then not run or not measured, then passing, stable within each, the model's before the person's; `litChecks` gives
  each row's parts to `litRows`. A row is a grid of 28 px, 1fr and 64 px: the dimension's mark chip or a 3 × 28 bar in
  `--agent-mark`; the name and the verdict word (`passes`, `fails`, `not measured`, `not run`: never colour alone); the value and
  what was wanted in mono (`checkRow` in `ui/checkRows.ts` and `shared/modelChecks.ts` for the model's words, `shownDimension`'s
  rules and `expectedText` for a dimension's: `2.8 mm, wanted 3 ± 0.05`), and for a thin wall or an approximate value that it was
  found by sampling; and `Gauge` (`ui/card/Gauge.tsx`, rules in `gaugeWindow.ts`) with the band wanted (a dimension's is its
  expectation ± its tolerance). A failing row has `--fail-wash`; a row of a part the pointer is on has `data-lit`
  (`useLitRows`). The model's rows are read only and are not marks: no check resolves, replaces or silences a person's
  dimension, and a dimension and a model check on the same thing stay two rows. A dimension's name is the button that goes to
  its mark (`.check-row[data-check-mark]`, which `goToRow` scrolls to) and the one that is the active mark has its own `MarkRow`
  below it, with its fields. After a build the tick of a row whose value moved slides from the value the build before had (the
  model's from `before.checks`, a dimension's from its `history`), and its row lights once (`.check-flash`); a dimension is read
  as of the build it was last measured on until it has been unmeasured for `UNCHECKED_AFTER_MS`, so that no row flickers.
  Under the rows, what the agent made easier to pass or removed since it was first declared (`checkNotes`, `since r7`). Pin to
  board is above the list. No checks and no dimension checks: no body (`e2e/checks.spec.ts`).

## Print profile (`app/src/renderer`)

- `ui/PrintProfile.tsx`, the body of the Print profile section of the route card (its head says
  `Bambu X1C, PETG`, the printer's and the material's names, or `none`: `profileSaid`, read through `state/profile.ts`,
  which the body shares, so the head says it while the section is folded) with two lists, Printer and Material, and "Add a printer…" (name, bed X Y Z, nozzle),
  through `window.torno.profile` (`profile:*` channels). A choice is copied into the object's `.torno/profile.json` by
  main; the printers are the person's, in torno's settings. The numbers shown are the person's, set in the monospace
  face, with the line that they are not measured. Materials of the person's own are added in `profiles.json` (no form).
