---
paths:
  - "app/src/shared/usage.ts"
  - "app/src/shared/usage.test.ts"
  - "app/src/main/sessions/usage.ts"
  - "app/src/main/sessions/usage.test.ts"
  - "app/src/renderer/state/usage.ts"
  - "app/src/renderer/ui/usage/**"
  - "app/src/renderer/ui/chat/TurnUsage.tsx"
  - "app/src/renderer/ui/chat/TurnUsage.test.ts"
  - "app/src/renderer/styles/usage.css"
  - "app/e2e/usage.spec.ts"
---

# What Claude Code spent: the turn's line, why a turn was large, the Usage page, the timeline's costs

Written with #357 (direction A, said in words, plus B's costs on the timeline chips; Luis's picks of 2026-11-26: dollars first
with tokens beside, a turn is large at 3 × the project's median turn cost and never within its first 3 prompts). The mockups
are on the local branch `design/usage`. The reader is in `chat-log-and-undo` (`chat:usage`), the turn's end there too.

- **Only the CLI's numbers.** Every cost, count of tokens and of calls is the `usage` a turn item carries (the `result`'s,
  `TurnUsage`, #356) or a sum of them; pictures and builds are counts of the log's own items (`usageFacts`; a build
  line marked `byPerson`, of the person's saves alone, is not the turn's: `stop-hook`, #384). Nothing is
  estimated, and a turn's cost is never split by cause (no dollars per picture). The first turn after a resume has tokens
  and no `costUsd`: it is said as "not known", never worked out from `sessionCostUsd`. A terminal's prompt is "not
  recorded". Numbers through `shared/format.ts`: `dollars` (to the cent, whole from $100, `under $0.01`), `tokens` (three
  digits, `k`, `M`), `number`.
- **The project's usage in the window** is `state/usage.ts` (`usageStore`): the rows of `chat.usage` for the open project,
  asked when it opens (`useProjectUsage`), when a `turn` item comes (`connectChat`) and when the page mounts; an answer for
  another project or older than the last ask is let go. It also holds the page's range (week, the default, month, all;
  never kept), the conversation open and the prompt lit.
- **The Usage page** (`ui/usage/UsagePage.tsx`, the rules pure in `ui/usage/usageView.ts`, styles `usage.css`) is the
  board's `Shown` `usage` (`board.md`): the switch's third button, mounted by `App` in the view's place, so the 3D view
  pauses and the timeline is not drawn, as for the brief. `Ctrl+Tab` does not go to it (`swapped('usage')` is the model).
  The page: the head (`Usage of <project>`, the span, Week | Month | All as `.segmented`), the lead (`pageLead`: the cost
  over prompts and conversations and the share read again; under it the prompt that took at least a quarter and twice the
  next one, and the prompts with no cost to count), the cost by day or by week (`buckets`; an SVG, one series in the accent,
  a value over each column of a week and over the highest one otherwise, `?` dashed where only unknown costs are, `+ n ?`
  over a column with some, a `<title>` per column for the pointer), where the tokens went (`tokenKinds`: read again in the
  accent, new in its wash, written in the field edge's grey, each labelled with its share in the legend), the turns by
  their pictures (`byPictures`: 5 or more, 2 to 4, 1 or none, each turn whole), and the conversations (`conversationsOf`,
  named by their first prompt, a spark of each prompt's cost, outlined where not known; a terminal's as not recorded) with
  `PLAN_NOTE` at the foot. A conversation's button opens its ledger: crumbs back to Usage, its lead (`ledgerLead`), a row
  a prompt (number, words, calls, pictures, builds, a bar against its largest, cost or "not known" / "not recorded"), a
  large one (`largeTimes` on the row's number and the project's median) lit with `WhyLarge` under it, the prompt "Open in
  Usage" named lit and scrolled to, and "Resumed here, in a new Claude Code process" before a resumed turn.
- **The builds timeline's chips** (#372) say each prompt group's cost (`chipCost` in `ui/strip/strip.ts`, from the row of
  that prompt number), the large one in the accent; nothing for a prompt with no cost known.
