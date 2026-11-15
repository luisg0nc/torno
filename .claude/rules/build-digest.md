---
paths:
  - "app/src/main/sanity.ts"
  - "app/src/main/sanity.test.ts"
  - "app/src/main/context.ts"
  - "app/src/main/context.test.ts"
  - "app/src/main/statefile.ts"
  - "app/src/main/statefile.test.ts"
  - "app/src/main/builds.ts"
  - "app/src/main/builds.test.ts"
  - "app/src/shared/sanity.ts"
  - "app/src/shared/sanity.test.ts"
  - "app/src/shared/diagnosis.ts"
  - "app/src/shared/diagnosis.test.ts"
  - "app/src/shared/build.ts"
  - "app/src/shared/build.test.ts"
  - "app/src/shared/diff.ts"
  - "app/src/shared/diff.test.ts"
  - "app/src/renderer/ui/BuildErrorSheet.tsx"
  - "app/src/renderer/ui/BuildErrorSheet.test.ts"
---

# What the agent is told of a build: state.md, the sanity digest, the output, the diagnosis

Moved as written from the folder `CLAUDE.md` files; each heading names the folder it came from, and paths are written as they were there (see "Rules by area" in the root `CLAUDE.md`).

## Marks (`app/src/main`)

- `<object>/.torno/state.md` says the same as the tools, as text
  (`src/main/statefile.ts`): the build (and under it the digest of a build that
  worked, naming tools as `the diff tool`), the parts, the scans with how each is
  aligned in every layout, the open marks. Its first line is when it was
  written. A `## Params` section lists each numeric `Params` field with the source its comment begins with
  (`shared/params.ts` `sourceOf`: the model's claim, never checked; no or unknown word is `no source`, never
  `assumed`). The answer to an edit adds `Assumed: …; no source: n` (`paramsLine` in `context.ts`) only when the set
  differs from the build before's, compared from the two kept scenes, so no state is tracked.

## Agents (`app/src/main`)

- **The sanity pass** (`src/main/sanity.ts`, pure). After every successful build `sanity(previous, current,
  verdicts)` holds it against the successful build before (`Builds.scenes`, the data `diff` reads) from what the
  kernel sent with each (`solids`, `openShells`, `meshVolume`, `meshDisagrees`, `valid`, `reversed`): no query.
  Parts are compared by name, each in the first layout of the build that has it, with `partDiff` (`shared/diff.ts`, which `diff`
  uses too: the same line, the volume's change also in percent, `≈` where either build is not exact; a number that
  is not exact has changed only by more than both builds' doubt of it, `volumeDoubt` and `bboxDoubt`, twice that of
  a size); unchanged parts are counted. Its flags are of the shape alone, never a guess at intent: not valid, inside out, no solid or
  no volume, more than one solid or another count than before, an open shell, a mesh that disagrees, a part come
  or gone, face or edge counts changed (refs may name others), a dimension that passed on the build before and
  fails now. Each says whether it is new; a hard one (`DigestFlag.hard`: not valid, inside out, a solid count that
  went up, a mesh that disagrees, each new) holds a Stop back. `digestText` says it in two lines, `Changed since
  rN:` and `Check:`, in at most `DIGEST_LIMIT` (1,200) characters, cut by whole parts and flags, the hard ones
  first and what is cut counted with where to read it. `buildContextFor` puts it after the status and before the
  dimensions, in what their least leaves of `CONTEXT_LIMIT` (status, digest, dimensions, output, each outranking
  the next); it is told nowhere else to the agent (not with a prompt), and `state.md` writes it under the build.
- **What the model printed reaches the agent** (`modelOutput` of `context.ts`; the kernel returns it as `output` of
  the scene of a good build and of the error of a failed one). The model's own text, run through `HttpRouter.redact`
  (`ContextDeps.redact`, `ToolDeps.redact`) before it is cut. It is told in two places and in no other (not with a
  prompt, not in `state.md`): the last block of `buildContextFor`, `Model printed (last N lines):` and the tail
  (`OUTPUT_LINES` 15, `OUTPUT_CHARS` 1,000, the end kept; `, earlier output cut` when anything was left out), and
  `output` (with `outputCut`) of `scene`, which also gives it after a first build that failed, with no scene. It is
  of the build that ended last: a failed build's is its error's, never the output of the good build before; none
  while a build runs; none for the error main makes when the kernel process stopped (`kernelStderr`, whose `output` is the kernel's stderr and
  not the model's); a build process the supervisor reports as a `crash` (killed, a garbled result) keeps its prints. It takes
  what is left of `CONTEXT_LIMIT` after the status, the digest, the dimensions and the count of those that pass, so a
  traceback, the digest and a dimension outrank it; with less than `MIN_OUTPUT_CHARS` left it is a line that there is output and that
  `scene` has it, or nothing.
- **Why a fillet or a chamfer failed** (`BuildError.diagnosis`, the kernel's `diagnose.py`; the words are
  `diagnosisText` of `shared/diagnosis.ts`, numbers through `shared/format.ts`, a bisected size by `thousandth`).
  Before a failed build that carries one is told, `Builds.withRefs` asks the live worker of the last good build
  (`match_edges`, `MATCH_MS`, 2 s at most; nothing when there is none, it was let go, or the kernel cannot say) which
  of its edges are exactly those of the diagnosis (ends, length, curve and the points sampled along it), and sets
  `sameAs` (`{ ref, layout, revision }`) on those: a ref only where an edge matches exactly and of one part (the
  same part in two layouts is that part; an edge two parts share, as a lid and a base built at the origin, is named
  by neither, never the first), said as of that build; the rest are known by their number in the call and their
  ends in the frame of the shape filleted (`local`). It is told under the error's message, before the traceback,
  wherever the error is: the status lines of `contextFor` and `buildContextFor` (in `DIAGNOSIS_LIMIT`, 1,000
  characters, leaving `TRACEBACK_LEAST`, 200, to the traceback, the edges cut first and counted), `scene` under
  `build.error.diagnosis` (the data and its `reading`) and in its error before a first build that worked, `state.md`,
  and the error sheet (`ui/BuildErrorSheet.tsx`, under "Why", and in what Copy takes). Nothing is retried in the
  model: the agent decides.
  A failed **boolean** carries a diagnosis of the other kind (`BooleanDiagnosis`, the kernel's `booleans.py`: its
  operands, how base and tool meet, `causes`), told by the same `diagnosisText` in the same places. Its operands are
  not parts of any build and `Builds.withRefs` leaves it as it is (`isBoolean`): nothing in it is named by a ref.
