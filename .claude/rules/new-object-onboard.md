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
  The text ends in three numbered steps (#111): list the sizes that decide fit or function with the source of each
  (`brief.md`, a picture's note, a scan, another object, or nowhere); ask for those from nowhere in one round with
  `AskUserQuestion` (at most 4 questions, each with 2 to 4 options, one a typical value labelled as such; "build
  with assumptions" is an answer; nothing about what it can choose freely); build with the answers, a size still
  unknown being "assumed" in `Params` and listed in the reply. The same rule is in the `torno-model` skill, "Before
  the first model", which also applies it to a later feature whose key size is not given; the system prompt has no
  room for it. Both are held by `onboard.test.ts` and `prompt.test.ts`. The window needs nothing new: the question
  is the chat's card (or the CLI's own in a terminal).
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
  `problem`, and `held` is held again; a CLI silent for 10 s is taken to have begun). Tested with `FAKE_AGENT_FAIL`.
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
