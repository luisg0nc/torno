---
paths:
  - "app/src/main/prompt.ts"
  - "app/src/main/prompt.test.ts"
  - "app/src/main/ablations.ts"
  - "app/src/main/ablations.test.ts"
  - "app/resources/agent-plugin/**"
  - "app/src/main/context.ts"
  - "app/src/main/context.test.ts"
  - "app/evals/**"
---

# What the agent is given: the system prompt, the skills, the reviewer, ablations

Moved as written from the folder `CLAUDE.md` files; each heading names the folder it came from, and paths are written as they were there (see "Rules by area" in the root `CLAUDE.md`).

## Agents (`app/src/main`)

- The system prompt is one text (`src/main/prompt.ts` `systemPrompt(toolName, skills)`). Claude Code is
  given torno's skills, a plugin in `app/resources/agent-plugin` (`torno-model`, `build123d`, `scans`,
  `dimensions`) passed with `--plugin-dir` (`paths.ts` `agentPluginDir()`; nothing is installed in the person's
  Claude Code), so its prompt (`SYSTEM_PROMPT`, `skills` true, under 7,000 characters) says of scans and
  dimensions only what a prompt's lines need and names the skills; `SCANS_TEXT` and `DIMENSIONS_TEXT` are said
  to the letter in the skills `scans` and `dimensions`. Started without the plugin folder (`skills` false) it is
  told the whole text (`FULL_PROMPT`, under 8,000 characters). A change to what the prompt says of scans
  or dimensions is a change to the skill too (`prompt.test.ts` holds them together); the template of
  `torno-model` is built by the kernel's `tests/test_skill_template.py`. The `build123d` skill carries files beside its `SKILL.md`, which `electron-builder.yml` ships with the plugin folder: an API reference of the pinned build123d, generated (`kernel/scripts/build123d_api.py`) and held to it by `tests/test_skill_api.py`, which also runs the skill's examples, and `reference/fasteners.md`. The skill sends the agent to grep the reference (`${CLAUDE_SKILL_DIR}`), never to run Python for it, and says `bd_warehouse` is in torno's kernel, with the sizes for a model that should not depend on it; the `torno-model` skill has the section on `references(p)`. Claude Code is also given a subagent on
  its command line, `--agents` with `torno-reviewer` (`claude.ts` `reviewerAgents`): tools `scene`, `look`,
  `marks`, `measure`, `check`, `section`, `describe`, `diff`, the scan tools and `Read`, never one that edits,
  resolves, adds a mark or changes the view; `model: sonnet` (`TORNO_REVIEWER_MODEL` names another, or `inherit`
  passes none) and `maxTurns: 20`; its prompt reads `brief.md`, then checks the build against what was asked, every
  open mark and every dimension, numbers first and at most two looks, and ends with lines of `HOLDS`, `FAILS` or
  `UNCHECKED` (never left out). Claude Code's prompt says to use it after a change of several steps, before saying it
  is done. The prompt states the verify loop in one paragraph: after an edit, numbers first (`measure`, `check`,
  `section`, `diff`), then one `look` with the marks drawn, a second only for what the first could not show; `review`
  asks the same (one or two looks at all the open marks, a look at one mark alone only where numbers cannot settle
  it). It is appended with `--append-system-prompt`, not an agent definition or an output style. `contextFor`
  names tools through `opts.toolName` likewise.
- **Ablations of an eval run** (`main/ablations.ts`, `ablations()`, read once in `index.ts`): `TORNO_EVAL_ABLATE`
  (`skills`, `reviewer`, `stop`, `look`, `digest`), and `evalTuning()` of `TORNO_EVAL_LOOK_SIZE` (`ToolDeps.lookSize`,
  the fallback of `clampSize`) and `TORNO_EVAL_HOLDS` (`Sessions`' `mostHolds`, 1 or 2), are read only when both
  `TORNO_TEST=1` and `TORNO_EVAL=1` are set, and are empty otherwise; an unknown name or a value out of range throws.
  `digest` is `ContextDeps.digest: false` on the deps of `buildContextFor` (`state.md` keeps its digest). Each is one switch: no plugin folder for the adapter, `claudeAdapter`'s
  `reviewer: false` (no `--agents`), `Sessions`' `holdStops: false` (`stopAnswer` holds nothing), `ToolDeps.off` (the
  tool answers `LOOK_OFF`). None of the variables reaches the agent (`agentEnv`). Only `app/evals` sets them together.
- The first prompt of a new conversation (`newConversation`: a session not resumed, its first `UserPromptSubmit`;
  or `fresh`, after /clear or after a compaction: the `PostCompact` hook, which moves no status, or the stream's
  `compact_boundary`, either sets `Session.compacted`, which the next prompt takes once as `fresh`) is told in a last line the files of `reference/` (`referencesLine` in `context.ts`,
  `listReferences`: plain files of create's names, photos then doodles, twelve named at most). It is no mark, and is
  left out when it does not fit in the context's limit. The onboarding prompt names them too; the repetition is
  accepted.
