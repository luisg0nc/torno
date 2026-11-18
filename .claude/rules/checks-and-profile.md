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
  - "app/src/renderer/ui/ChecksPanel.tsx"
  - "app/src/renderer/ui/ChecksPanel.test.ts"
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
  stays while the check is weaker than it first was, in memory only. The window shows the notes; the agent is told
  of them by `state.md` and `scene` (`checksEasier`).

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

- `ui/ChecksPanel.tsx` (its own component, beside the marks, not in them): the checks the model declares in its
  `checks(p)` as the kernel measured them at the last build (`Scene.checks`, `Scene.checkNotes`), read only, under
  Parameters, in the Params panel (a section of it, never folded), with a title that says how many fail (`2 · 1 fails`, `checksSaid`). A row
  (`checkRow` in `ui/checkRows.ts`, pure, words from `shared/modelChecks.ts`) is the model's own name, how it stands
  in a word (`pass`, `fails`, `not measured`, `not run`: never colour alone), what was measured and what was wanted in
  the monospace face, and, for a thin wall or an approximate value, that it was found by sampling; its title is the
  kernel's `how`. A bar in `--agent-mark` marks them as the model's own. They are not marks: no check resolves,
  replaces or silences a person's dimension. Under the rows, what the agent made easier to pass or removed since it was
  first declared (`checkNotes`, `since r7`). A model with no checks, or a kernel that does not read them, has no section
  (`e2e/checks.spec.ts`).

## Print profile (`app/src/renderer`)

- `ui/PrintProfile.tsx`, the body of the Print profile section of the route card (its head says
  `Bambu X1C, PETG`, the printer's and the material's names, or `none`: `profileSaid`, read through `state/profile.ts`,
  which the body shares, so the head says it while the section is folded) with two lists, Printer and Material, and "Add a printer…" (name, bed X Y Z, nozzle),
  through `window.torno.profile` (`profile:*` channels). A choice is copied into the object's `.torno/profile.json` by
  main; the printers are the person's, in torno's settings. The numbers shown are the person's, set in the monospace
  face, with the line that they are not measured. Materials of the person's own are added in `profiles.json` (no form).
