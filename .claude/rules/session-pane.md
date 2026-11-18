---
paths:
  - "app/src/renderer/ui/SessionPane.tsx"
  - "app/src/renderer/ui/sessionSign.ts"
  - "app/src/renderer/ui/sessionSign.test.ts"
  - "app/src/renderer/ui/SessionDot.tsx"
  - "app/src/renderer/ui/termGround.ts"
  - "app/src/renderer/ui/termGround.test.ts"
  - "app/src/renderer/ui/chat/StartChat.tsx"
  - "app/src/renderer/ui/AgentLine.tsx"
  - "app/src/renderer/styles/session.css"
  - "app/e2e/session.spec.ts"
  - "app/e2e/startchat.spec.ts"
---

# The session pane: the terminal, the signs of a session, the pane with no session

Moved as written from the folder `CLAUDE.md` files; each heading names the folder it came from, and paths are written as they were there (see "Rules by area" in the root `CLAUDE.md`).

## Agents (`app/src/renderer`)

- The agent's terminal (`ui/SessionPane.tsx`) has its inset in the pane in the terminal's ground: the panel's,
  or the one the agent paints the edges of its screen in, when it paints one. Most of the left column and the
  bottom row decides (`ui/termGround.ts` `edgeGround`, after every write parsed); the terminal's own ground and
  the inset then take it, so that the agent's screen fills the pane (`window.__tornoTerm.ground()`; the
  stand-in's `ground r g b`).
- The dock (`aside[data-region="session"]`) is the shell grid's last column, `--dock-w` wide (420 px, 384 in a window under 1360 px) and as tall as the
  row between the title row and the status line; its left edge (`.dock-edge`) is dragged, or moved with Left and Right, down to 320 px and up to what leaves the
  view 420 px beside the left column (`clampDock` in `state/dock.ts`). The width the person gave is the window's (`localStorage`, `torno.dock`, read and
  written in try/catch) and outlasts a reload; until they give one the CSS default stands. See `left-column`.
- A session away from its pane is told where the eye is (`ui/sessionSign.ts` the rule, `ui/SessionDot.tsx` the dot,
  still, 6 px, the status line's `.status-dot`). Only `working` and `needs_input` have a sign: `working` is a
  `--muted` dot with no words; `needs_input` is `--warn`, a larger dot on the dock's toggle and the words "needs you"
  on a row, never colour alone: the state is the element's `aria-description` and its `title`, and never part of its
  accessible name, which stays the object's name (a row) or `Show session` / `Hide session` (the toggle), so that a test
  and a person's tools find a row by its name whatever its session does: the row's description is `session needs you`
  (`is working`), the hidden dock's toggle's is `Claude Code needs you`. The status line's button (`.status-needs`,
  in a `role="status"` that is always there) names the first object of the list whose session waits, with "and N
  more"; it opens that object, shows the dock (`dockOpen` and `actions.setDockOpen` are in the store, not in
  `App.tsx`) and `focusAsk` takes the focus to the open card or the terminal once the pane is of that object. The
  toggle's dot is of the open object's session and only while the dock is hidden. The rail's Projects icon
  carries the dot of any object of the list whose session works or waits (`switcherSign`: a waiting one first); its
  description says each (`session is working; bracket needs you`), "needs you" alone for the open object's; the rows of the
  Projects panel have their own dots.
- **The title bar** (`ui/TitleBar.tsx`, `styles/titlebar.css`) is the row above the columns, a drag region (`-webkit-app-region`;
  every crumb, pill and button in it is `no-drag`): the vise, the folder crumb (`Folder <name>`, `FolderMenu`), `/`, the
  project crumb (`Project <name>`; its menu, `role="menu"` named Projects, is All projects first, then each project; only on
  the page of a project, and "New project" on the new page), then at the right the session signs of the *other* projects
  (`ui/titleSigns.ts`: waiting first, at most two, `+N`; each a button named by the project with `session needs you` / `session is working`
  as its description, a click opens it and, if it waits, shows the dock and `focusAsk`), the dock's toggle (same name, description and
  title as before, `.dock-toggle`), and `WindowControls` (46 x 40, `--muted` 10 px glyphs) only when `drawsControls()`. The first
  screen has no bar, only `BareControls`.
- On the New object page the dock is hidden (Task 39: `App.tsx`), and the preview is `DraftPane` on the page itself. The pane that stays mounted under `hidden` is still of the object being made (`drafting` in `SessionPane`; these branches only keep it quiet, and are the ones to remove when the pane is next reworked): no status, no End,
  New session or Resume, no view switch, no held prompt, and a note in the body; `.session-term` stays laid out.
  A live session (any status but `exited`) of the object that was open stays as it is, with the note
  `.session-aside` above it ("This is the session of …"); an ended one counts as none.
- **The pane with no session, in the chat view** (`ui/chat/StartChat.tsx`, in `SessionPane` when `choice.view` is `chat`)
  has the box at its foot (`data-start-composer`, not `data-chat-composer`: that is the live chat's): Enter starts a
  session and sends the prompt to it (`startWith`, the prompt held in `pending` until the session exists, so that the
  trust question keeps it; a failed send puts it in the new chat's box, and a terminal view types it at the prompt,
  `fixRequest`, never sent). With a conversation on file (`resumable`) it shows the end of that conversation read-only
  under "Last conversation, 2 days ago" (`chat.lastConversation`: main reads `.torno/chat/`, the words and the turns of
  the last eight items, no tools, writes nothing; `ago.ts`), and "Continue" (resume, the default) / "New conversation"
  beside "Send". "New session" and "Resume" stay as plain buttons: they start with no prompt, and what was written
  waits unsent in the new chat's box (`holdDraft`). A terminal view keeps the old empty state. No "Attach view" or
  "Draw on view" here: a drawing is of a session.
- **The header** (`SessionPane`, `styles/session.css`) is one row of 40 px (spec 2026-11-18, the session dock): "Claude Code"
  (13.5 px, 600), the state as a dot and a word (`STATUS_WORD`: Starting, Idle, Working, **Needs you** in `--warn` 600, Ended;
  ", retrying (attempt 3)" inside the `role="status"` `.session-status`, which stays the first status of the dock), beside it
  `.session-elapsed` (`0:42`, `ui/sessionClock.ts`, counted by the second while the status is `working` from `workStart`, a
  session's own; not part of the status's text), then at the right the model (`ModelButton` of `chat/ModelMenu.tsx`: one mono
  button named by the model, a `Popover` with the model, edits and effort lists, which are the lists of today in rows
  (`dock-menu-row`); a terminal's session has the model as a plain word), the segment **Chat / Terminal** (`role="group"` named
  View, buttons with `aria-pressed`) and **More** (`ui/SessionMore.tsx`, `aria-label` "More", a `Popover` holding a
  `role="menu"` named More, `useMenu`: arrows, Home, End, Escape and a press outside). Its items: End (a session that is not
  ended), Resume (an ended one with a conversation on file), New session (any session), Prompts only (`setPromptsOpen`), What
  Claude Code reads (unfolds `.session-reads` in the menu: the instruction files as paths and sizes, never read, and the note
  of an `agent.json` that was not followed) and Hide session (`setDockOpen(false)`). Where there is no session, End, Resume and
  New session are not in it: the empty pane has its own "New session". End on a busy session still asks (`Confirm`), as
  New session does; both stand from the More button (`anchor`). What the next prompt carries stays a quiet line under
  the header until the composer's box holds it (`.session-next`). When `.torno/agent.json` could not be followed (`note` of
  `session:current`) the pane says why in one warn line (`.session-note`) with "Use Claude Code", which writes the file anew and
  is disabled while a session runs; the same note is in What Claude Code reads. A first prompt not sent and the aside of a new
  project stay as lines under the header.
- **A build's chip says what it was made from** (#62). A context item carries `identity` (`BuildIdentity`, main's, from `builds.jsonl`'s
  record of this run); the `r12` chip's title gets `made from sources …, on a1b2c3d with changes` (`RefChip`'s `of`, `identitySaid`),
  and a build line's "Show text" has it in a line. Under "Earlier in this conversation" (`ChatEarlier`) the title says that a
  revision counts from 1 in every run and may name another build now. The status line and the card say what has changed since
  the last commit (`useGit`, `GitText`): read, never written.
