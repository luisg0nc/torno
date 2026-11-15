---
paths:
  - "app/src/main/mcp/askTool.ts"
  - "app/src/main/asks.ts"
  - "app/src/shared/ask.ts"
  - "app/src/renderer/ui/QuestionCard.tsx"
  - "app/src/renderer/state/asks.ts"
  - "app/src/main/sessions/permissions.ts"
  - "app/src/main/sessions/permissions.test.ts"
  - "app/e2e/chatask.spec.ts"
---

# Questions: torno's own ask, and the CLI's permission asks

Moved as written from the folder `CLAUDE.md` files; each heading names the folder it came from, and paths are written as they were there (see "Rules by area" in the root `CLAUDE.md`).

## Agents (`app/src/main`)

- **`ask`, the question of torno's own** (`mcp/askTool.ts`, `main/asks.ts`, `shared/ask.ts`, `ui/QuestionCard.tsx`): `ask
  {question, options: [{label, refs}], pick?}` puts a card to the person and waits for what they choose, as data: the
  option (label and refs), or the one face or edge they select in the view when `pick`, or "not answered". Refs are
  checked as `highlight`'s are (`checkedRefs`: marks and groups turned into refs, all or nothing); at most 6 options of 20
  refs, one question per object at a time (a second is refused). It is not an `AgentAsk`: nothing of the CLI's is
  in it, so it is no transcript item. `Asks` keeps the open questions and tells the window the whole list on every
  change (`asks:changed`; `asks:list` for a window just begun; `asks:answer` back, checked by `answerOf` against the
  options of that question); the window never says more than an index or a ref. **Status:** a session shows
  `needs_input` while it has one open, by `Sessions.holdAsk` (a count, `Session.held`), the one status the hooks do not
  say, since the call is a single tool open as long as the person takes and nothing is posted meanwhile. A
  `PostToolUse` of another tool meanwhile does not make it `working`; when the last is answered the status goes
  back to what it was. The question ends with the first of: an answer, 10 minutes (`ASK_LIMIT_MS`: "not answered"), the
  client hanging up, the turn ending (the session turns `idle`: Claude Code's cancel of one call does not reach a
  server without sessions, so the end of the turn is what ends it), the session ending, the window closing or the
  workspace being left. While it waits the tool sends a progress notification every 30 s (`ASK_PROGRESS_MS`) when the
  client gave a progress token, since Claude Code ends an MCP call quiet for 5 minutes. An answer says when the model was built again
  meanwhile; a picked ref is looked up in the last build. It changes nothing in the person's view beyond lighting refs.
- Asks (`control_request` `can_use_tool`) wait in `Session.asks`, are answered only through `Sessions.respond` and
  show the status `needs_input` while open. They end when the CLI cancels the request (`control_cancel_request`,
  which it sends right after an `interrupt`; the card reads "Cancelled: the turn was stopped", `why`), at any
  `result`, and with the session (`ended`, no `why`); a late answer to one does nothing. The tool runs with the
  input it asked with; only the answers of `AskUserQuestion`, filtered to the question texts it asked, are taken
  from the window. **Session-only rule:** "Allow for this session" sends `updatedPermissions` made by
  `sessionRules` alone, the `addRules` suggestions with `destination: "session"`; `localSettings`,
  `projectSettings`, `userSettings`, `setMode` and `addDirectories` are never passed on, because the first three
  would write `.claude/` in the object's folder or the person's settings. A deny with no reason says "The person
  denied this."

## Agents (`app/src/renderer`)

- **The agent's question** (`ask`; `state/asks.ts` follows main's list, `ui/QuestionCard.tsx` draws it): a card with
  the question, a button for each answer (its label, its refs in the monospace face), and "None of these". The pointer
  or the keys' focus on a button lights its refs by `peek`, as a ref chip does, and only when the layout shown is the
  question's. With `pick` the card offers "Answer with `lid/F12`" while exactly one face or edge is selected in the
  view (selecting is the Select tool's, unchanged), else says to select one. It stands above the box of the chat
  (`where="chat"`) and, where the chat is not in sight (a terminal session, or the dock put away), over the foot of the
  view (`where="view"`), never both. It answers once (the buttons go off) and goes when main takes the question down.
