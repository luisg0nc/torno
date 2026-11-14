import { landing, landingText } from './diff'
import { partDefects } from './sanity'
import type { Scene } from './scene'

/**
 * The history of an object's builds (`main/history.ts`, #56): what is kept of each build that landed, under
 * `<object>/.torno/history/`, and what the window and the tools say of it. A build there has its own id, `h41`,
 * which counts on across runs of torno; a revision (`r3`) counts from 1 in every run and is told beside it.
 */

/** The history ids of an object: `h` and a whole number from 1, never given again. */
export const HISTORY_ID = /^h[1-9][0-9]{0,8}$/

/** How many builds are kept besides the ones the person stars. */
export const HISTORY_KEPT = 100

/** The dimensions the person has marked, counted by what they said of this build when it was last checked. */
export interface HistoryDimensions {
  pass: number
  fail: number
  none: number
}

/** What made a build: the agent, the person editing, the person's params, a Go back; `unknown` for builds kept before this was said. */
export type BuildCause = 'agent' | 'person' | 'params' | 'goback' | 'unknown'

/** The prompt of the turn a build came out of. Main's only: never taken from the window or from a tool. */
export interface BuildTurn {
  /** The chat it was said in, when it was one the person can open again. */
  conversation?: string
  prompt: string
  /** What the agent said at the end of the turn, shortened. */
  text?: string
}

/** One kept build, as `index.json` of the history holds it. */
export interface HistoryEntry {
  id: string
  /** When the build landed, ISO 8601. */
  at: string
  /** The run of torno it was made in; the revision is of that run alone. */
  run: string
  revision: number
  /** The hash of the sources it was made from (`sourcesHash`). */
  sources: string
  head?: string
  dirty?: true
  /** The model file, from the project's folder. */
  model: string
  /** The copies of the sources held, from the workspace, with `/`; none when they were too large or changed while they were read. */
  files: string[]
  starred?: true
  /** Whether a picture of it is on file. */
  thumb?: true
  parts: number
  seconds: number
  /** The model's `Params` and their defaults in that build. */
  params?: Record<string, unknown>
  /** The checks the model declares that did not pass in that build: kept all the same, and marked. */
  failing?: string[]
  /** Parts with a defect the shape says (`not valid`, `inside out`...), as `tub: not valid`. */
  defects?: string[]
  /** What the person's dimensions said of it, as of the check that followed it. */
  dimensions?: HistoryDimensions
  /** What changed since the entry before, as the status line says it. */
  line: string
  /** What made the build; absent is `unknown` (`causeOf`). Main's only, as the fields below are. */
  cause?: BuildCause
  /** The turn of the agent it came out of, for the cause `agent`. */
  turn?: BuildTurn
  /** A build that failed: kept as a line of the history with no `scene.json`, picture or copies. */
  failed?: true
  /** The first line of the failure, for a failed entry only. */
  error?: string
  /** For the cause `goback`: the id of the build it restored. */
  wentBackTo?: string
  /** Undone by a later Go back. */
  undone?: true
}

/** What made the build; `unknown` for an entry that says nothing. */
export const causeOf = (e: HistoryEntry): BuildCause => e.cause ?? 'unknown'

/** Whether the build has a scene to draw (a failed one has none). */
export const drawable = (e: HistoryEntry): boolean => !e.failed

/** Said of a build kept with no build before it. */
export const FIRST_BUILD = 'first build kept'

/** What a build changed, against the scene of the build kept before it, in one line (`tub changed, lid same`). */
export function changeLine(before: Scene | undefined, now: Scene): string {
  if (!before) return FIRST_BUILD
  const said = now.layouts.map((layout) => ({ layout, text: landingText(landing(before, now, layout)) })).filter(({ text }) => text !== 'no part changed')
  const gone = before.layouts.filter((layout) => !now.layouts.includes(layout))
  if (said.length === 0 && gone.length === 0) return 'no part changed'
  const lines = said.map(({ layout, text }) => (now.layouts.length > 1 ? `${layout}: ${text}` : text))
  return [...lines, ...gone.map((layout) => `${layout} gone`)].join('; ')
}

/** A build as `diff` is asked for one: a revision of this run (`3`, `"3"`, `"r3"`), or a kept build by its id (`"h41"`). */
export type BuildRef = { revision: number } | { id: string }

/** The build a value names, or null when it names none. */
export function parseBuildRef(value: unknown): BuildRef | null {
  if (typeof value === 'number') return Number.isSafeInteger(value) && value >= 1 ? { revision: value } : null
  if (typeof value !== 'string') return null
  const text = value.trim().toLowerCase()
  if (HISTORY_ID.test(text)) return { id: text }
  const revision = /^r?([1-9][0-9]{0,8})$/.exec(text)
  return revision ? { revision: Number(revision[1]) } : null
}

/** The entry's facts that come from the scene alone. */
export function sceneFacts(scene: Scene): Pick<HistoryEntry, 'parts' | 'seconds' | 'params' | 'failing' | 'defects'> {
  const params = Object.fromEntries((scene.params ?? []).map((p) => [p.name, p.default]))
  const failing = (scene.checks ?? []).filter((c) => c.status === 'fail' || c.status === 'error').map((c) => c.name)
  const defects = scene.parts.flatMap((p) => partDefects(p).map((d) => `${p.name}: ${d}`))
  return {
    parts: scene.parts.length,
    seconds: scene.seconds,
    ...(Object.keys(params).length > 0 ? { params } : {}),
    ...(failing.length > 0 ? { failing } : {}),
    ...(defects.length > 0 ? { defects } : {})
  }
}

/** The history of an object as the window is given it. */
export interface HistoryList {
  /** The run of this torno: an entry of it has a revision the window knows (`r3`). */
  run: string
  /** Where the copies lie, `<project>/.torno/history`: a build's are under `<base>/h41/source/`. For naming them in a request to the agent; the window reads and writes nothing there. */
  base: string
  /** Oldest first. */
  entries: HistoryEntry[]
  /** The ids of the builds that can be drawn over the current one: made in this run, with their meshes still held (a budget of bytes, the oldest let go first). */
  ghosts: string[]
}

/** A kept build's parts as the window draws them over the current build: its scene and the bytes of its meshes. */
export interface HistoryGhost {
  scene: Scene
  blob: ArrayBuffer
}

/** The builds of the list an entry is among those made in this run. */
export const madeHere = (list: Pick<HistoryList, 'run'>, entry: Pick<HistoryEntry, 'run'>): boolean => entry.run === list.run
