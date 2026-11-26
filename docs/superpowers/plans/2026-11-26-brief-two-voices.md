# The Brief page in two voices (#336 to #341)

Direction C of #331, picked by Luis on 2026-11-26. The look is `design/mockups/brief-2/c-voices.html` (local branch
`design/brief-2`); merged code's behaviour and names win, the mockup's look wins.

## Data (#336)

- `Card.turn?: CardTurn` (`{ prompt, conversation? }`, as a build's turn without its words: the words stay in the chat
  log, which does not travel), `Card.at?: string` (ISO, when made or last changed), `Card.was?: CardWas[]` (what an agent's
  card said before each edit, oldest first, `{ text, turn?, at? }`, the last `MAX_WAS`).
- Main's only: `applyPerson` / `applyAgent` stamp them; `sanitiseCard` keeps whole ones from the file; nothing from the
  window or a tool's arguments. The turn in flight is the session's (`Sessions.turnNow`), given to `BoardStore.agent`.
- `board` says a card's prompt: `C7 · text · by you, prompt 11`, the number from `listPrompts` (the chat logs and the
  history), "a prompt not on this computer" when its log is not here.

## Claude writes the brief as cards (#337)

- The agent prompt, the torno-model skill and `add_card`'s description: `brief.md` is the person's words; what Claude
  learns goes in as its cards, one per topic, starting with the topic's name, its own card of a topic changed with
  `card` and `text` rather than a second one added.
- `refusalOf` refuses `Write`, `Edit`, `MultiEdit` of `<project>/brief.md` with a line naming `add_card`.

## The page (#338)

- "In your words": `brief.md` rendered (headings, paragraphs, lists with hanging indents, links as a link with its host,
  numbers in Martian Mono) on a sheet of its own, the pictures beside it, the STEP and PDF lines, and the person's notes
  made on the page ("Added on this page, 17:55").
- "What Claude wrote down": Claude's cards (and the ones made the person's, under the prompt Claude wrote them in) on a
  spine of prompts (`shared/brief.ts` `briefSpine`), each node the prompt's number and time, "In the chat", "You:" and
  the prompt in two lines with a red edge, then the cards with a green edge; a card changed later shows struck in the
  node of what it was ("Changed in prompt 11"). Cards with no turn (made before this) are one node "Before torno kept the
  prompt".
- Pointing at a card (click or focus) opens its prompt in full, what it replaced, "Show prompt N in the chat" (lights it
  in the dock), Make it yours, Remove.
- Sizes and rules keep their ledgers and gain the hand: a pill with a dot ("You", "Claude, prompt 13").

## Make it yours (#339)

- `PersonChange` `{ op: 'adopt', id }`: an agent's text or size card becomes `by: 'person'` with
  `from: { by: 'agent', turn?, at? }`; the page then edits it in place with a red edge. A size of Claude's keeps
  `from Claude` as its source until the person edits it and says where it came from.

## New since you looked (#340)

- `.torno/board/seen.json` (ignored): `{ at, cards: { id: hash } }` of Claude's cards, written by main
  (`board:markSeen`) when the person leaves the Brief or presses "Mark as seen". The page reads it once when it opens:
  new prompts get the accent node and a "new" pill, the band says which, and the seen prompts fold to one line.
  No `seen.json` yet: nothing is new, and it is written.

## Old briefs (#341)

- `briefSplit` (`shared/brief.ts`) finds Claude's sections in `brief.md` (`## Answers`, `## Changes`, `## Decisions`,
  `## Assumptions`, with or without a date). The page shows them under "Claude wrote these into brief.md before".
- The next prompt says once (`told.json` `brief.md`, the hash of the text told) to move them into cards and put
  `brief.md` back to the person's words; that turn's session may edit `brief.md` (the refusal lets it through).
