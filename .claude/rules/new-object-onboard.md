---
paths:
  - "app/src/main/onboard.ts"
  - "app/src/main/onboard.itest.ts"
  - "app/src/main/onboard.test.ts"
  - "app/e2e/onboard.spec.ts"
---

# Onboarding a new object: the first prompt and its pictures

Moved as written from the folder `CLAUDE.md` files; each heading names the folder it came from, and paths are written as they were there (see "Rules by area" in the root `CLAUDE.md`).

### Onboarding the new object (`onboard.ts`, `objects:onboard`) (`app/src/main`)

- After `create` the window opens the object and calls `objects.onboard(objectId, draft)` (`OnboardDraft` in
  `shared/bridge.ts`: the description, the photos and doodles by their `reference/` file with the note and the
  picture, the scans by path, the objects by id). It rejects, doing nothing, for an object that is not of the open
  workspace, one with a session or one starting (`sessionRunning`), one already being onboarded (a second call while the first imports), and a draft that is not what it may be (files that are not
  plain files of `reference/`, caps, a scan that is not a scan path, an object that is not of the workspace or is the
  object itself). Then it imports each scan through `ScanStore.import` (one that fails does not stop the rest: the text
  says it could not be imported), starts the chat session (`Sessions.start`, the agent chosen for the object, which
  has no `agent.json`, on the model and effort of `OnboardDraft.choice` held to `agentChoiceOf`), and sends one
  prompt (`Sessions.prompt`): the text of `onboardPrompt`, then the pictures.
  On screen a doodle's ink over a picture (a photo, or an earlier doodle drawn on again) is `OVER_PICTURE` (`ink/strokes.ts`): `PNG_INK` with a `PNG_GROUND` casing, whatever the theme (#208); without a picture it is the theme's `--ink`. A doodle drawn over a photo (the photo in the draft, or taken from it after) is told as the person's ink over that photo, with no grid; the sentence about the light grid (1 square = 40 px) is said only when a doodle has none under it. Which it is, is the flag `OnboardDraft.items[].over` (and `PromptPreviewDraft`'s) that the window sets from the draft; the prompt never reads the note's words (#197). The text names, after the references (the PDFs among them, "A PDF; read it with your own tools if it helps."), the
  sizes the person gave (`saySize`, one line each), the rules, and the links ("torno does not open links"); the draft's
  sizes are held by `checkSize` (by the person: at most 40), the rules to 4000 characters, the links by `create`'s
  `checkLink` (at most 20, `http` or `https`), the PDFs to plain files of `reference/` ending `.pdf` (at most 6). A
  preview leaves out what `onboard` would refuse. Just before `Sessions.prompt`, and not when no prompt goes,
  `deps.boardTold` (`BoardStore.markAllTold`) keeps what the board line would say of every card and arrow as told, so
  the line of this prompt reads "Board: N cards (0 new)": the prompt says them in its words. A failure of that does not
  stop the prompt.
  The text ends (#111, #324, `settleText`) with the placeholder's line, that what is above is kept in `brief.md` and
  on the board for later conversations (it no longer says to read `brief.md`), and what to settle before building:
  `SETTLE`, how the thing is arranged or mounted, which bought part it holds, how a drawing reads, and any size that
  decides fit or function and has no source, asked in one round, only what would change the build, with a sketch in
  the option where the question is about shape; a size that does not decide fit is an assumption the person can
  change afterwards in `Params`, not a question; the reply lists what was assumed. Given torno's skills (`OnboardDeps.skills`, `Sessions.skills`:
  the adapter's; `onboardPrompt`'s third argument, as `systemPrompt` takes it) the prompt names the `torno-model`
  skill's "Before the first model", where the procedure is (sources of a size, `AskUserQuestion`, a typical value,
  "build with assumptions", `assumed:` in `Params`), about 750 characters with the placeholder's line, where the three steps were 1,200; without them it says that procedure itself. `held` is always the long form: it may be sent later in a session
  without the skills. A session whose plugin did not load is still sent the short form (the prompt is written before
  the CLI's `init` says so), as its system prompt is.
  How many questions and options is the schema of `AskUserQuestion`, said in neither. The skill applies the rule to a
  later feature too; the system prompt has no room for it. `onboard.test.ts` holds both forms and `prompt.test.ts`
  holds the skill to `SETTLE` and to the section the prompt names. The preview takes the same flag, so the plate
  shows what is sent; while the description is empty it shows `BLANK_DESCRIPTION` in its place. The window needs
  nothing new: the question is the chat's card (or the CLI's own in a terminal).
  The prompt goes as the onboarding prompt (`Sessions.prompt`'s `onboarding`, kept only for the first prompt of a
  conversation begun with the session): its hook's context (`contextFor`'s `onboarding`) has no references line and
  `boardLine` is not asked `again`, so with `markAllTold` the brief is not told twice (`onboard.itest.ts`).
  `app/evals` has two cases that start from this prompt (`onboard` in `case.json`, the text read from
  `objects.previewPrompt` of the built app): `m-open-mount` (every size given, the mounting open: an `asked` check
  about it) and `m-nothing-to-ask` (`asked` false).
- The pictures are the window's. Main has no decoder (Electron's `nativeImage` has none for WebP, and the window already
  decodes), so the window scales to a long edge of 1280 px and sends PNG or JPEG bytes; main reads the size from the
  header (`checkedImage`) and attaches only a PNG or JPEG of at most 2000 px and 3.75 MB (`MAX_IMAGE_BYTES`; base64 of
  it is 5 MB, the API's limit). One that is not is left out and the
  text says "not attached: read reference/<file>". Photos and doodles in order, then the pictures of the objects referred
  to (`.torno/thumb.png`, read as a plain file only, `readThumb`), at most 6 in all (`MOST_IMAGES`); a further one is named
  in the text as not attached.
- A referred object is told as `objectSummary` of its last build in this run (the parts of the first layout and their box,
  `exact` or `approximate` as the kernel's `bboxExact` says) or "not built in this run". Notes are one line each.
- Each picture comes after a text block naming it ("Picture 2: reference/doodle-1.png (the person's doodle): <note>",
  "Picture 3: ../lid/ as torno last drew it (its thumbnail): <note>"), because the CLI gives the model no file name for an
  image; the main text says "(attached: picture N)". The transcript's user item shows the first text only: a later text
  right before an image is a caption and is not shown. The caption's form is also read by the transcript, which keeps
  the path of a photo or doodle on its picture (`REFERENCE_CAPTION`): it is a contract, held by `transcript.test.ts`,
  which builds its prompt with `onboardPrompt`.
- The answer has `prompt` (as sent, "attached: picture N" for a picture) and `held` (for the composer to hold: every picture
  "not attached: read reference/<file>", a referred object's as `../<name>/.torno/thumb.png`); the window holds
  `held`. The prompt names the scan tools by the adapter's tool names (`scans`, `section` with `scan`, `scan_clash`,
  `scan_deviation`) and says the person aligns a scan in torno; every tool it names is a key of `TOOLS` (`onboard.test.ts`).
- After the prompt is sent `Sessions.began` is awaited (the CLI said anything, or ended: then its exit note is the
  `problem`, and `held` is held again; a CLI silent for 10 s is taken to have begun). A CLI that left before `began` was
  asked has its exit note too: `Sessions` keeps the note of the last 20 sessions that ended before saying anything
  (`leftSilent`), so the order of the exit and the call does not decide the note. Tested with `FAKE_AGENT_FAIL`, with `began` asked at once and late.
- A session that cannot be started (the command is not on PATH, the trust question) is not a rejection: the answer is
  `sessionId: null`, the prompt text, `held` and the reason, for the composer to hold. An agent whose view is not the chat
  gets `sessionId` and a `problem`, and nothing is sent.
- One onboarding at a time per object: a set of objects in flight, entered before anything is imported and freed in
  `finally`, also after a rejection. Everything that can be refused (the draft's shape, caps, notes folded and
  length-checked, scan paths with control characters, duplicates, the object and the files) is checked before the
  first scan is imported or the session is started. A prompt that cannot be built or sent is not a rejection either:
  the answer holds `sessionId`, the text and a `problem`.
- Tested: `onboard.test.ts` (the text, the pictures, the rules) and `onboard.itest.ts` (the stand-in agent, the real scan
  import: one prompt with its pictures, the scan in `scans.json`, the hook's context, a missing command).
