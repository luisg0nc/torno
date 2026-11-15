---
paths:
  - "app/src/preload/index.ts"
  - "app/src/shared/bridge.ts"
  - "app/src/main/mcp/**"
  - "app/src/main/refusal.ts"
  - "app/src/main/refusal.test.ts"
  - "app/src/shared/refusal.ts"
  - "app/src/shared/refusal.test.ts"
  - "app/src/main/ipc.ts"
  - "app/src/readme.test.ts"
---

# The MCP tools: the list, their schemas and what they share; refusals; the prompts

Moved as written from the folder `CLAUDE.md` files; each heading names the folder it came from, and paths are written as they were there (see "Rules by area" in the root `CLAUDE.md`).

## Marks (`app/src/main`)

- The MCP tools (`src/main/mcp/schemas.ts` holds every input schema and
  description, and `TOOLS`; `mcp/tools.ts` registers them and holds what
  every tool shares, with `marks` and `describe`; `scene`, `look`, `show` and
  `save_view` are in `mcp/viewTools.ts`; those that place and resolve marks in
  `mcp/markTools.ts`; those that read the part in `mcp/readTools.ts`; those
  that ask about scans in `mcp/scanTools.ts`): `scene`, `look`, `marks`,
  `describe`, `highlight`, `ask`, `show`, `save_view`, `add_mark`, `resolve_mark`,
  `measure`, `section`, `check`, `diff`, `history`, `expect`, `try_fillet`, `try_params`, `features`, `scans`, `scan_clash`, `scan_deviation`.
  `expect` (`mcp/expectTools.ts`, `Expectations`, wired in `index.ts`) is the agent's note on one edit: checks on a
  part's volume, faces, edges or size, a `measure` with `expected`, or `unchanged` parts, taken against the last
  build and held in memory for the next successful build only (never a file, never a mark, never a Stop reason). It is
  settled in `buildContextFor`'s wrapper in `index.ts` and told once as the last line of the edit's answer; `scene`
  keeps the last verdict. Numbers not exact are `≈` and judged within the kernel's doubt; a ref of a part whose
  face (or edge) count changed is told as moved and not measured.
  `diff` compares two of the last two successful builds (`Builds.scenes`; the blob of the older is not kept) or any build kept in the history (#56:
  `from` and `to` take a revision, `r3`, or an id, `h41`; `ToolDeps.history` and `historyScene`, read by `ipc.ts` `historyOf` after the writes that
  just landed, 2 s at most; a revision of this run that is no longer in memory is found there too; given only the last build, the
  default is the newest kept build of other sources; what a kept build had then (`failingChecks`, `defects`, `dimensions`) is told with a
  note that it is as of then); `diff` refuses a failed entry (by id, with a sentence naming it and its error) and never takes one for the build of
  a revision (it carries the revision of the last good build) or as the default to compare with; `history` (`historyTool`) lists the kept builds newest first or gives one with the paths of its
  copies, so that the agent can read them and edit the project's files itself. Its `changed` says after the line what caused the build
  (`· by Claude (prompt "<first 80 characters>")`, `· your edit`, `· params`, `· went back to h40`, `· undone`; nothing for an entry with no `cause`) and a
  failed one is `failed: <error>`; the entry's `cause`, `turn`, `failed`, `error`, `wentBackTo` and `undone` go as stored. `history:ghost`,
  `history:thumbnail` and `history:source` answer null for a failed entry, and `ghosts` never names one.
  Each part is compared by `partDiff` of `shared/diff.ts`, which the window's status line and ghosts use too,
  from what the kernel sent with each, asking it nothing: a number is `exact` only where both builds say so.
  `look` and `show` take the name of a saved view as `view`, and `save_view`
  proposes one (Views). `show` changes
  the view for now and is never saved to `scene.json`; it is refused while a
  button is held in the viewport. `marks`, `describe`, `add_mark`, `measure`,
  `section`, `check` and the three scan tools say which
  revision they answer from, and that it is stale while a newer build runs or
  has failed. `scene` counts the unresolved dimensions held to a value
  (`dimensions: {pass, fail, notMeasured}`).
  - What a client reads of a tool before it calls one is beside its description in `TOOLS`: a `title` (sentence
    case), `annotations` and, for the tools loaded upfront, `meta`. Every tool has `openWorldHint: false`; the
    ones that only read have `readOnlyHint: true` (`scene`, `look`, `marks`, `describe`, `measure`, `section`,
    `check`, `diff`, `history`, `try_fillet`, `try_params`, `features`, `scans`, `scan_clash`, `scan_deviation`: Claude Code runs the calls of those side by side;
    `look` reads, the picture it writes under `.torno/views/` being torno's own), the rest `readOnlyHint: false,
    destructiveHint: false`. `scene`, `look`, `marks`, `describe` and `measure` have
    `_meta["anthropic/alwaysLoad"]` (Claude Code's tool search defers every other MCP tool until it is searched for,
    and each upfront tool costs context in every turn and sits in the prompt cache's prefix: the list stays short).
    The server gives `instructions` at `initialize` (`SERVER_INSTRUCTIONS`: a paragraph on what the server is for,
    then a line for every tool in the words an agent would search with; under 4,096 characters, which Claude Code
    cuts at: `schemas.test.ts` holds that, every tool's line, and every description under the same length). A
    tool added to `TOOLS` has a title, annotations and a line there, or the test fails. Annotations change nothing
    of what `--allowedTools` permits.
  - Every tool is registered through `registerTools`, which refuses a key the
    tool's schema in `TOOLS` does not name (`refusedKeys`, `mcp/keys.ts`),
    naming the keys it takes: a dropped key would change what is measured. A
    new argument goes into the schema, or it is refused.
  - The schemas of a plane and of an end of a measurement refuse nothing
    (`planeInput`, `endInput`: a union that ends in `z.unknown()`): whatever
    is given reaches the handler, which answers with what one looks like
    (`NO_PLANE`, `noEnd`). Keep it so: the schema's own refusal says only
    "Invalid input".
  - `measure`, `section` and `check` answer with the kernel's reply and a
    `reading` of it in a line. Refs and marks are checked against the scene in
    main before the kernel is asked (`endsOf`: a mark stands for what it is on
    only when the last build's check confirmed it, and a dimension for
    neither of its ends), and nothing is said to be exact that the kernel
    does not say is: `≈` and `approximate` otherwise. A query that took its
    30 s is told as that; the answer of a worker still busy with one is told
    in the kernel's words (`refusal` in `mcp/readTools.ts`).
- **A refusal is not a failure.** What the person asked that cannot be done (a dimension the kernel refuses,
  one placed on an older build or between parts torno spread apart, a change of a mark that is not valid, a
  choice while a session runs) is thrown as a `Refusal` (`main/refusal.ts`). Every channel is registered through
  `handle` in `ipc.ts` (`refusable`), which resolves a `Refusal` as `{ __tornoRefused: message }`
  (`shared/refusal.ts`) so that Electron prints nothing; the preload throws it again (`unrefused`), so the window
  sees a rejection with that message. Anything else is thrown, and logged.
- The MCP prompts (`mcp/prompts.ts`, `PROMPTS`, registered by `registerPrompts` beside the tools): `review`,
  `printable` (argument `bed`, `XxYxZ` in mm, read by `parseBed`) and `explain`, each one user message. Their text
  names tools through a `toolName`, Claude Code's (`mcp__torno__<tool>`): the server is stateless and does not know
  the client. The manual lists them as `/mcp__torno__<name>` (`readme.test.ts` holds it to `PROMPTS`).
