import type { HistoryEntry } from '../../../shared/history'

// The builds strip's rules, pure: which nodes the project's history makes, which of them the prompts in sight cover, when the
// strip folds, and which builds the status line's ticks stand for. The strip draws what these say (`BuildsStrip`).

/** One build of the project, as the strip draws it. */
export interface StripNode {
  /** The history id (`h41`); `building` for the build that runs; `failed-after-h40` for a failure the history has not kept yet. */
  id: string
  kind: 'built' | 'failed' | 'running'
  /** The muted line under the node: `prompt 14`, `you saved`, `you tried`, `went back`, `earlier`; empty when nothing is known. */
  by: string
  /** The person made it with their own save. */
  saved: boolean
  starred: boolean
  /** The build the view shows. */
  onShow: boolean
  /** The build the open round of the review is of. */
  reviewing: boolean
  /** For a failed build: the build it came after (`h40`), when it came after one. */
  after?: string
  /** The prompt it was made for, by number. */
  prompt?: number
}

/** What the strip knows of the build now. */
export interface StripLive {
  status: 'idle' | 'building' | 'ok' | 'failed'
  /** The id of the build on show. */
  onShow: string | null
  /** While the last build failed: the build it came after. */
  failedAfter?: string
  /** The build the open round is of. */
  reviewing?: string
  /** The number of the prompt the running (or just failed) build is for. */
  prompt?: number
}

/** The dock's height under which the strip folds to its head line and a row of ticks (ruling 9). */
export const STRIP_FOLD_BELOW = 640

export const stripFolded = (dockHeight: number): boolean => dockHeight < STRIP_FOLD_BELOW

const promptBy = (n: number | undefined): string => (n === undefined ? '' : `prompt ${n}`)

/** What made a build, in the muted line. */
function byOf(entry: HistoryEntry, number: number | undefined): string {
  switch (entry.cause) {
    case 'person':
      return 'you saved'
    case 'params':
      return 'you tried'
    case 'goback':
      return 'went back'
    case 'agent':
      return number === undefined ? 'Claude Code' : promptBy(number)
    default:
      return 'earlier'
  }
}

/**
 * The nodes of the strip, oldest to newest: every build the history keeps (a failed one too, after the build it came after),
 * a failure the history has not kept yet, and the build that runs, last. `numbering` is the project's prompts by id
 * (`numbersOf`), for the muted line.
 */
export function stripNodes(history: readonly HistoryEntry[], live: StripLive, numbering: ReadonlyMap<string, number> = new Map()): StripNode[] {
  const nodes: StripNode[] = []
  let lastBuilt: string | undefined
  for (const entry of history) {
    const prompt = entry.turn ? numbering.get(entry.turn.prompt) : undefined
    const failed = entry.failed === true
    nodes.push({
      id: entry.id,
      kind: failed ? 'failed' : 'built',
      by: byOf(entry, prompt),
      saved: entry.cause === 'person',
      starred: entry.starred === true,
      onShow: !failed && entry.id === live.onShow,
      reviewing: !failed && entry.id === live.reviewing,
      ...(failed && lastBuilt !== undefined ? { after: lastBuilt } : {}),
      ...(prompt !== undefined ? { prompt } : {})
    })
    if (!failed) lastBuilt = entry.id
  }
  // The window knows the build failed before the history has it on file.
  if (live.status === 'failed' && history.at(-1)?.failed !== true) {
    const after = live.failedAfter
    nodes.push({ id: after === undefined ? 'failed' : `failed-after-${after}`, kind: 'failed', by: promptBy(live.prompt), saved: false, starred: false, onShow: false, reviewing: false, ...(after !== undefined ? { after } : {}), ...(live.prompt !== undefined ? { prompt: live.prompt } : {}) })
  }
  if (live.status === 'building') {
    nodes.push({ id: 'building', kind: 'running', by: promptBy(live.prompt), saved: false, starred: false, onShow: false, reviewing: false, ...(live.prompt !== undefined ? { prompt: live.prompt } : {}) })
  }
  return nodes
}

/**
 * The span of nodes that the prompts in sight in the conversation made (indexes into `nodes`, both ends included, the saves
 * between them too), and what it says; null when no prompt in sight made a node.
 */
export function bracketOf(nodes: readonly StripNode[], promptsInSight: readonly number[]): { from: number; to: number; label: string } | null {
  const sight = new Set(promptsInSight)
  const at = nodes.flatMap((node, i) => (node.prompt !== undefined && sight.has(node.prompt) ? [i] : []))
  if (at.length === 0) return null
  const prompts = [...new Set(at.map((i) => nodes[i]!.prompt!))].sort((a, b) => a - b)
  const names = prompts.length === 1 ? `prompt ${prompts[0]}` : `prompts ${prompts[0]} to ${prompts.at(-1)}`
  return { from: at[0]!, to: at.at(-1)!, label: `${names}, in sight below` }
}

/** The builds the status line's ticks stand for: the last `n`, and the build on show among them when it is older (in its place in the order). */
export function ticksOf(nodes: readonly StripNode[], n = 8): StripNode[] {
  const last = nodes.slice(-n)
  const shown = nodes.find((node) => node.onShow)
  if (!shown || last.includes(shown) || n < 2) return last
  return [shown, ...nodes.slice(-(n - 1))]
}

/** What a pick does now, at the right of the strip's head line. */
export function stripSays({ nodes, exporting }: { nodes: readonly StripNode[]; exporting: boolean }): string {
  const shown = nodes.find((node) => node.onShow)
  if (exporting) return shown ? `Exporting the build on show, ${shown.id}` : 'Exporting the build on show'
  if (nodes.some((node) => node.kind === 'running')) return 'A build is running'
  const reviewing = nodes.find((node) => node.reviewing)
  if (reviewing) return `Your review is of ${reviewing.id}`
  if (shown && nodes.findLast((node) => node.kind !== 'running')?.kind === 'failed') return `${shown.id} is still on show`
  return 'Pick one to compare, star or go back'
}

/** A prompt of the conversation and the stretch of the transcript it takes: its words, what Claude did, up to the next prompt. */
export interface PromptSpan {
  number: number
  top: number
  bottom: number
}

/** The numbers of the prompts whose stretch of the transcript shows in the window `[viewTop, viewBottom]` (a stretch that only touches its edge is out). */
export function inSightOf(spans: readonly PromptSpan[], viewTop: number, viewBottom: number): number[] {
  return spans.filter((span) => span.bottom > viewTop && span.top < viewBottom).map((span) => span.number)
}
