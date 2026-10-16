import { join } from 'node:path'
import type { BuildState } from '../shared/build'
import type { Mark } from '../shared/marks'
import { type ScanInfo, importText } from '../shared/scans'
import { groupsIn } from '../shared/groups'
import type { Scene } from '../shared/scene'
import { type SavedView, viewGone } from '../shared/views'
import type { ObjectInfo } from '../shared/workspace'
import { writeFileAtomic } from './atomic'
import { ensureIgnored } from './ignored'
import { FOLDER, ownTorno } from './own'
import { describeMark, sizes } from './marks/describe'
import { alignmentSaid } from './scans/said'

const NAME = 'state.md'
const TRACEBACK_LINES = 12
/** How long after the last change of an object its file is written, in ms. */
export const STATE_DELAY_MS = 1000

/**
 * `<object>/.torno/state.md`: how the build stands, the layouts and their parts
 * with sizes, the scans with how each is aligned, and every mark that is not
 * resolved, a line each. It is what an agent without torno's tools can read to
 * know what one with them is told.
 * Nothing in it changes unless the build, the marks, the scans or the saved views do: no times, no camera.
 * The saved views are named in a line, each with what of it no longer fits the build.
 * The file itself begins with `writtenLine`, before this.
 */
export function stateText(obj: ObjectInfo, build: BuildState | undefined, last: { revision: number; scene: Scene } | undefined, marks: readonly Mark[], scans?: readonly ScanInfo[], views?: readonly SavedView[]): string {
  const lines = [
    `# ${obj.name}`,
    '',
    'torno keeps this file: it is rewritten after every build and every change of the marks or the scans. Do not edit it.',
    'Lengths are millimetres, Z up, in the frame of the layout named.',
    '',
    '## Build',
    '',
    ...buildLines(build, last?.revision),
    '',
    '## Layouts and parts',
    ''
  ]
  if (!last) lines.push('Nothing has been built yet.')
  else {
    if (last.scene.model) lines.push(`Model: ${last.scene.model}, r${last.revision}.`, '')
    for (const layout of last.scene.layouts) {
      const parts = last.scene.parts.filter((p) => p.layout === layout)
      const groups = groupsIn(last.scene, layout)
      const grouped = groups.length > 0 ? `groups ${groups.map((g) => `${g.name} (${g.parts.join(', ')})`).join(', ')}; ` : ''
      lines.push(`- ${layout}: ${grouped}${parts.map((p) => `${p.name} ${p.bboxExact === true ? '' : '≈ '}${sizes(p.bbox.max.map((max, i) => toHundredth(max - p.bbox.min[i])))} mm`).join(', ') || 'no parts'}`)
    }
    // Exact only where the kernel says so.
    if (last.scene.parts.some((p) => p.bboxExact !== true)) lines.push('', 'A size with ≈ is approximate (the part has freeform or turned faces): measure it for a number to rely on.')
  }
  if (views && views.length > 0) lines.push('', `Saved views: ${views.map((view) => viewSaid(view, last?.scene)).join(', ')}.`)
  if (scans && scans.length > 0) {
    lines.push('', '## Scans', '', 'A scan is a mesh of the real surroundings: nothing from it is exact.', '')
    for (const scan of scans) lines.push(`- ${scanLine(scan, last)}`)
  }
  lines.push('', '## Marks', '')
  const open = marks.filter((m) => m.status !== 'resolved')
  if (open.length === 0) lines.push('None.')
  else {
    lines.push(
      'What the user and the agent have pointed at and not resolved. `lid/F12` is face 12 of the part lid, `lid/E3` its edge 3, in the layout the mark is in.'
    )
    for (const layout of [...new Set(open.map((m) => m.layout))]) {
      lines.push('', `In layout ${layout}:`, '')
      for (const mark of open) if (mark.layout === layout) lines.push(`- ${describeMark(mark, { revision: last?.revision, layout, ...(last ? { scene: last.scene } : {}), ...(scans ? { scans } : {}) })}`)
    }
  }
  return `${lines.join('\n')}\n`
}

/** A saved view as the file names it: its name, that the agent proposed it, and what of it the build no longer has. */
function viewSaid(view: SavedView, scene: Scene | undefined): string {
  const notes: string[] = []
  if (view.proposed) notes.push('proposed by the agent')
  const gone = scene && viewGone(view, { layouts: scene.layouts, parts: scene.parts.filter((part) => part.layout === view.layout).map((part) => part.name) })
  if (gone?.layout) notes.push(`of layout ${view.layout}, which the model no longer has`)
  else if (gone && gone.parts.length > 0) notes.push(`hides ${gone.parts.join(', ')}, which layout ${view.layout} no longer has`)
  return `"${view.name}"${notes.length > 0 ? ` (${notes.join('; ')})` : ''}`
}

/**
 * The first line of the file: when it was written, and that nothing keeps it
 * up to date once torno has quit. Whoever reads it later can tell how old it is.
 */
export function writtenLine(at: Date): string {
  return `Written by torno at ${at.toISOString()}; it is only current while torno is running.`
}

/**
 * A scan in a line: what the `scans` tool says of it, and how it is aligned in
 * every layout of the build, each in the words every tool uses of an alignment
 * (`alignmentSaid`): what it rests on, and what puts it in doubt.
 */
function scanLine(scan: ScanInfo, last: { revision: number; scene: Scene } | undefined): string {
  const source = `source ${scan.source.path}${scan.sourceState === 'missing' ? ' (missing)' : scan.sourceState === 'changed' ? ' (changed since it was read)' : ''}`
  const head = `${scan.id} ${scan.name}: ${scan.meshState === 'ok' ? `${scan.imported.triangles.toLocaleString('en-US')} triangles` : 'MESH MISSING'}, ${importText(scan.imported)}; ${source}`
  const alignedIn = Object.keys(scan.alignments)
  // Before any build there is no layout to say it of, and nothing to check it against.
  if (!last) return `${head}; ${alignedIn.length > 0 ? `aligned in: ${alignedIn.join(', ')}` : 'aligned in no layout'}.`
  const layouts = last.scene.layouts
  const aligned = layouts.filter((layout) => alignedIn.includes(layout)).map((layout) => alignmentSaid(scan, layout, last.revision).line)
  const not = layouts.filter((layout) => !alignedIn.includes(layout))
  const gone = alignedIn.filter((layout) => !layouts.includes(layout))
  return `${[head, ...aligned, ...(not.length > 0 ? [`not aligned in ${not.join(', ')}`] : []), ...(gone.length > 0 ? [`aligned in ${gone.join(', ')}, which r${last.revision} does not have`] : [])].join('; ')}.`
}

/** To 0.01 mm, as the scene tool gives sizes. */
function toHundredth(value: number): number {
  return Math.round(value * 100) / 100
}

function buildLines(build: BuildState | undefined, revision = 0): string[] {
  const shown = revision > 0 ? `The parts below are those of r${revision}, the last build that worked.` : 'Nothing has been built yet.'
  if (!build || build.status === 'idle') return ['Not built yet.']
  if (build.status === 'building') return [`A build is running. ${shown}`]
  if (build.status === 'failed') {
    const traceback = (build.error?.traceback ?? '').trimEnd().split('\n').slice(-TRACEBACK_LINES).join('\n')
    return [`BUILD FAILED. ${shown}`, '', '```', build.error?.message ?? 'no reason was given', ...(traceback ? [traceback] : []), '```']
  }
  return [`Build ok, r${build.revision}.`]
}

export interface StateFileDeps {
  object(objectId: string): ObjectInfo | undefined
  /** Where the build of an object stands; undefined for one that is not open, of which nothing is written. */
  build(objectId: string): BuildState | undefined
  scene(objectId: string): { revision: number; scene: Scene } | undefined
  marks(objectId: string): Promise<Mark[]>
  /** The scans of an object: each is listed, and a region of one is told where the scan's alignment puts it. */
  scans?(objectId: string): Promise<ScanInfo[]>
  /** The views saved of an object: each is named. */
  views?(objectId: string): Promise<SavedView[]>
  delayMs?: number
  write?(path: string, text: string): Promise<void>
  log?(message: string): void
  now?(): Date
}

/**
 * Keeps the state file of every open object up to date. Told that an object's
 * build or marks changed, it waits until a second has passed without another
 * change and then writes the file, unless it already says the same. The first
 * time in a run it is written whatever the file of an earlier run says: its
 * first line is the time of writing, and that one would be of the earlier run.
 */
export class StateFiles {
  private timers = new Map<string, NodeJS.Timeout>()
  /** By path: what the file was last made to hold, below its first line. */
  private written = new Map<string, string>()

  constructor(private deps: StateFileDeps) {}

  /** The build, the marks, the scans or the saved views of an object changed. */
  changed(objectId: string): void {
    clearTimeout(this.timers.get(objectId))
    const timer = setTimeout(() => {
      this.timers.delete(objectId)
      this.write(objectId).catch((e: unknown) => (this.deps.log ?? console.error)(`cannot write the state file of ${objectId}: ${e instanceof Error ? e.message : String(e)}`))
    }, this.deps.delayMs ?? STATE_DELAY_MS)
    // Nothing waits for a state file: it does not keep the app from quitting.
    timer.unref()
    this.timers.set(objectId, timer)
  }

  /** Drop what is waiting to be written, as when the workspace is left. */
  forget(): void {
    for (const timer of this.timers.values()) clearTimeout(timer)
    this.timers.clear()
    this.written.clear()
  }

  /** Write the state file of an open object now, if it would say something new. */
  async write(objectId: string): Promise<void> {
    const obj = this.deps.object(objectId)
    if (!obj || !this.deps.build(objectId)) return
    const marks = await this.deps.marks(objectId)
    // Scans that cannot be read are left out: the build and the marks are still told.
    const scans = await this.deps.scans?.(objectId).catch(() => undefined)
    // Nor are views that cannot be read a reason to write nothing.
    const views = await this.deps.views?.(objectId).catch(() => undefined)
    // As things are once the marks are read: a build may have ended meanwhile.
    const build = this.deps.build(objectId)
    if (!build || this.deps.object(objectId)?.dir !== obj.dir) return
    const text = stateText(obj, build, this.deps.scene(objectId), marks, scans, views)
    const path = join(obj.dir, FOLDER, NAME)
    if (this.written.get(path) === text) return
    await ownTorno(obj.dir)
    await (this.deps.write ?? writeFileAtomic)(path, `${writtenLine(this.deps.now?.() ?? new Date())}\n\n${text}`)
    this.written.set(path, text)
    // It changes at every build and every mark: not for git. (Not when a test writes it elsewhere.)
    if (!this.deps.write) await ensureIgnored(obj.dir, [NAME])
  }
}
