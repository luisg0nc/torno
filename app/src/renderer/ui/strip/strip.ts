import { causeOf, type BuildCause, type HistoryEntry } from '../../../shared/history'
import { dollars } from '../../../shared/format'
import { largeTimes, type ProjectUsage } from '../../../shared/usage'
import { saveWords } from '../chat/historyJoin'

// The builds timeline's rules, pure: which nodes the project's history makes, how they are grouped by what made them, what a
// group is labelled and titled, and which builds the status line's ticks stand for. The timeline draws what these say
// (`BuildsTimeline`).

/** One build of the project, as the timeline draws it. */
export interface StripNode {
  /** The history id (`h41`); `building` for the build that runs; `failed-after-h40` for a failure the history has not kept yet. */
  id: string
  kind: 'built' | 'failed' | 'running'
  /** What made it, as its group is labelled (`byOf`): `Prompt 14`, `Manual edit`, `Saved by you`, `Went back`, `Earlier`; empty when nothing is known. */
  by: string
  /** What made it; none for a build the window cannot say of yet. */
  cause?: BuildCause
  /** The person made it: their own save, or their Parameters. */
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

/** What the timeline knows of the build now. */
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
  /** What started the running (or just failed) build, as far as the window can say. */
  cause?: BuildCause
}

const promptBy = (n: number | undefined): string => (n === undefined ? '' : `Prompt ${n}`)

/** What made a build, as its group is labelled: `Prompt 14`, `Manual edit` (the person's Parameters), `Saved by you`, `Went back`, `Earlier`. */
function byOf(cause: BuildCause | undefined, number: number | undefined): string {
  if (number !== undefined) return promptBy(number)
  switch (cause) {
    case 'person':
      return 'Saved by you'
    case 'params':
      return 'Manual edit'
    case 'goback':
      return 'Went back'
    case 'agent':
      return 'Claude Code'
    case 'unknown':
      return 'Earlier'
    default:
      return ''
  }
}

const savedBy = (cause: BuildCause | undefined): boolean => cause === 'person' || cause === 'params'

/**
 * The nodes of the timeline, oldest to newest: every build the history keeps (a failed one too, after the build it came after),
 * a failure the history has not kept yet, and the build that runs, last. `numbering` is the project's prompts by id
 * (`numbersOf`), for the labels.
 */
export function stripNodes(history: readonly HistoryEntry[], live: StripLive, numbering: ReadonlyMap<string, number> = new Map()): StripNode[] {
  const nodes: StripNode[] = []
  let lastBuilt: string | undefined
  for (const entry of history) {
    const prompt = entry.turn ? numbering.get(entry.turn.prompt) : undefined
    const failed = entry.failed === true
    const cause = causeOf(entry)
    nodes.push({
      id: entry.id,
      kind: failed ? 'failed' : 'built',
      by: byOf(cause, cause === 'agent' ? prompt : undefined),
      cause,
      saved: savedBy(cause),
      starred: entry.starred === true,
      onShow: !failed && entry.id === live.onShow,
      reviewing: !failed && entry.id === live.reviewing,
      ...(failed && lastBuilt !== undefined ? { after: lastBuilt } : {}),
      ...(prompt !== undefined ? { prompt } : {})
    })
    if (!failed) lastBuilt = entry.id
  }
  const now = (id: string, kind: StripNode['kind'], after?: string): StripNode => ({
    id,
    kind,
    by: byOf(live.cause, live.prompt),
    ...(live.cause !== undefined ? { cause: live.cause } : {}),
    saved: savedBy(live.cause),
    starred: false,
    onShow: false,
    reviewing: false,
    ...(after !== undefined ? { after } : {}),
    ...(live.prompt !== undefined ? { prompt: live.prompt } : {})
  })
  // The window knows the build failed before the history has it on file.
  if (live.status === 'failed' && history.at(-1)?.failed !== true) {
    const after = live.failedAfter
    nodes.push(now(after === undefined ? 'failed' : `failed-after-${after}`, 'failed', after))
  }
  if (live.status === 'building') nodes.push(now('building', 'running'))
  return nodes
}

/** A run of builds made by one thing: a prompt, the person's Parameters between two prompts, their saves, an earlier run. */
export interface StripGroup {
  /** The id of its first build: what the timeline keeps it open by. */
  id: string
  /** `Prompt 4`, `Manual edit`, `Saved by you`, `Went back`, `Earlier`, `Claude Code`; `Building` or `Failed build` for one nobody can say yet. */
  label: string
  /** Its builds, oldest first. */
  nodes: StripNode[]
  /** Its last build: the one a folded group shows. */
  last: StripNode
  prompt?: number
  /** The person's own: their saves or their Parameters. */
  saved: boolean
  /** How its last build went. */
  state: StripNode['kind']
  /** One of its builds is on show, under review, starred. */
  onShow: boolean
  reviewing: boolean
  starred: boolean
}

/** What puts two nodes side by side in one group: the same prompt, or the same cause that is not a prompt's. Every going back is its own. */
function groupOf(node: StripNode): string {
  if (node.prompt !== undefined) return `prompt ${node.prompt}`
  if (node.cause === 'goback') return `goback ${node.id}`
  if (node.cause === undefined) return `now ${node.id}`
  return node.cause
}

/**
 * The groups of the timeline, oldest to newest: the builds of one prompt are one group, and so are consecutive builds of the
 * person's Parameters between two prompts, consecutive saves and an earlier run. A group shows its last build and a count.
 */
export function stripGroups(nodes: readonly StripNode[]): StripGroup[] {
  const groups: StripGroup[] = []
  let at: string | undefined
  for (const node of nodes) {
    const of = groupOf(node)
    const open = groups.at(-1)
    if (open && of === at) {
      open.nodes.push(node)
      open.last = node
      open.state = node.kind
      open.onShow ||= node.onShow
      open.reviewing ||= node.reviewing
      open.starred ||= node.starred
    } else {
      const label = node.by !== '' ? node.by : node.kind === 'running' ? 'Building' : 'Failed build'
      groups.push({ id: node.id, label, nodes: [node], last: node, ...(node.prompt !== undefined ? { prompt: node.prompt } : {}), saved: node.saved, state: node.kind, onShow: node.onShow, reviewing: node.reviewing, starred: node.starred })
    }
    at = of
  }
  return groups
}

export const groupCount = (group: StripGroup): number => group.nodes.length

/**
 * What a prompt group's chip says it cost (#372): the cost of its prompt, from the project's usage (`chat:usage`), and whether
 * that prompt was large (`largeTimes`). Null for a group of no prompt, a prompt whose cost is not known, or before the usage is read.
 */
export function chipCost(group: StripGroup, usage: ProjectUsage | undefined): { text: string; large: boolean } | null {
  if (group.prompt === undefined || !usage) return null
  const cost = usage.rows.find((r) => r.number === group.prompt)?.usage?.costUsd
  if (cost === undefined) return null
  return { text: dollars(cost), large: largeTimes(cost, group.prompt, usage.median) !== null }
}

/**
 * What a group says in its title, two lines: what made it in words (the prompt's own, the values the person set, what a going
 * back restored), then its builds and how they stand. The label never carries these.
 */
export function groupTitle(group: StripGroup, entries: ReadonlyMap<string, HistoryEntry>): string {
  const kept = group.nodes.flatMap((node) => entries.get(node.id) ?? [])
  const cause = group.nodes[0]!.cause
  let words = group.label
  if (cause === 'agent') {
    const text = kept.find((e) => e.turn?.text)?.turn?.text
    if (text) words = `${group.label}: ${text}`
  } else if ((cause === 'params' || cause === 'person') && kept.length > 0) {
    const said = saveWords({ cause, entries: kept }).replace(/ · h\d+( to h\d+)?$/, '')
    words = cause === 'params' ? `${group.label}: ${said}` : said
  } else if (cause === 'goback') {
    const to = kept[0]?.wentBackTo
    if (to) words = `Went back to ${to}`
  }
  const ids = group.nodes.filter((node) => node.kind !== 'running')
  const span = ids.length === 0 ? '' : ids.length === 1 ? ids[0]!.id : `${ids[0]!.id} to ${ids.at(-1)!.id}`
  const facts = [
    group.nodes.length > 1 ? `${group.nodes.length} builds, ${span}` : group.last.kind === 'running' ? 'building' : span,
    ...group.nodes.filter((node) => node.onShow).map((node) => `${node.id} on show`),
    group.reviewing ? 'under review' : '',
    group.state === 'failed' ? (group.nodes.length > 1 ? 'the last failed' : 'failed') : '',
    group.starred ? 'starred' : ''
  ].filter((part) => part !== '')
  return `${words}\n${facts.join(', ')}`
}

/** A build named in words, as the head of the left column's On block says it (#335). */
export interface BuildNamed {
  /** Its history id: said in the title only. */
  id: string
  /** `Latest build · prompt 5`, `Latest build · manual edit`, or `Prompt 3 · older build`. */
  head: string
  /** It is the newest build that drew (a failed or a running one after it does not count). */
  latest: boolean
}

/** What made a build, inside a line: `prompt 5`, `manual edit`, `saved by you`; `Claude Code` keeps its capitals. */
const byInLine = (by: string): string => (by === 'Claude Code' ? by : by.charAt(0).toLowerCase() + by.slice(1))

/** A build of the timeline named with the timeline's own words: the latest one by what made it, an older one as older. Null when the timeline does not have it. */
export function buildNamed(nodes: readonly StripNode[], id: string): BuildNamed | null {
  const node = nodes.find((n) => n.id === id && n.kind === 'built')
  if (!node) return null
  const latest = nodes.findLast((n) => n.kind === 'built') === node
  const by = node.by !== '' ? node.by : 'Earlier'
  return { id, head: latest ? (node.by === '' ? 'Latest build' : `Latest build · ${byInLine(node.by)}`) : `${by} · older build`, latest }
}

/** The builds the status line's ticks stand for: the last `n`, and the build on show among them when it is older (in its place in the order). */
export function ticksOf(nodes: readonly StripNode[], n = 8): StripNode[] {
  const last = nodes.slice(-n)
  const shown = nodes.find((node) => node.onShow)
  if (!shown || last.includes(shown) || n < 2) return last
  return [shown, ...nodes.slice(-(n - 1))]
}

/** What a pick does now, at the right of the drawer's head line. */
export function stripSays({ nodes, exporting }: { nodes: readonly StripNode[]; exporting: boolean }): string {
  const shown = nodes.find((node) => node.onShow)
  if (exporting) return shown ? `Exporting the build on show, ${shown.id}` : 'Exporting the build on show'
  if (nodes.some((node) => node.kind === 'running')) return 'A build is running'
  const reviewing = nodes.find((node) => node.reviewing)
  if (reviewing) return `Your review is of ${reviewing.id}`
  if (shown && nodes.findLast((node) => node.kind !== 'running')?.kind === 'failed') return `${shown.id} is still on show`
  return 'Pick one to compare, star or go back'
}
