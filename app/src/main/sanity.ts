import type { BuildDigest, DigestFlag, DigestPart, VerdictChange } from '../shared/sanity'
import type { Part, Scene } from '../shared/scene'
import { DIFF_APPROXIMATE, DIFF_REFS, clean, partDiff } from '../shared/diff'
import { number } from './marks/describe'

/**
 * The sanity pass after every successful build: what it did to the parts since the successful build before, and
 * what the shape alone says is wrong with them, worked out in main from what the kernel sent with each build (no
 * query). Deltas are told, never judged: torno cannot know whether a pocket was meant. A defect that a sound part
 * never has and that appeared with the build is hard (`DigestFlag.hard`): it holds a Stop back once.
 */

export { DIFF_APPROXIMATE, DIFF_REFS, clean, partDiff }
export type Kept = { revision: number; scene: Scene }

/** The most of the answer to an edit the digest takes, in characters. */
export const DIGEST_LIMIT = 1200

/** The parts of a build by name, each as it is in the first layout of the build that has it, with every layout it is in. */
function byName(scene: Scene): Map<string, { part: Part; all: Part[] }> {
  const named = new Map<string, { part: Part; all: Part[] }>()
  for (const layout of scene.layouts) {
    for (const part of scene.parts) {
      if (part.layout !== layout) continue
      const had = named.get(part.name)
      if (had) had.all.push(part)
      else named.set(part.name, { part, all: [part] })
    }
  }
  return named
}

/** What the shape of a part (in every layout it is in) says of it, as facts to hold one build against the next. */
interface Shape {
  invalid: boolean
  reversed: number[]
  solids?: number
  open: number
  mesh?: { mesh: number; volume: number; exact: boolean }
  empty?: 'no solid' | 'no volume'
}

function shapeOf(all: readonly Part[]): Shape {
  const solids = all.map((p) => p.solids).filter((n): n is number => n !== undefined)
  const off = all.find((p) => p.meshDisagrees === true && p.meshVolume !== undefined)
  // A shell or a face has no solid; a solid that encloses nothing, no volume.
  const empty = all.some((p) => p.solids === 0) ? 'no solid' : all.some((p) => p.volume <= 0) ? 'no volume' : undefined
  return {
    invalid: all.some((p) => p.valid === false),
    reversed: all.find((p) => p.reversed && p.reversed.length > 0)?.reversed ?? [],
    ...(solids.length > 0 ? { solids: Math.max(...solids) } : {}),
    open: Math.max(0, ...all.map((p) => p.openShells ?? 0)),
    ...(off ? { mesh: { mesh: off.meshVolume!, volume: off.volume, exact: off.volumeExact === true } } : {}),
    ...(empty ? { empty } : {})
  }
}

/** `solid 1` or `solids 0, 2` */
const solidsNamed = (indexes: readonly number[]): string => `solid${indexes.length === 1 ? '' : 's'} ${indexes.join(', ')}`

/** The flags of one part on this build, against what it was on the build before (`was`; none of a new part or a first build). */
function partFlags(name: string, now: Shape, was: Shape | undefined, since: number | undefined): DigestFlag[] {
  const flags: DigestFlag[] = []
  const asBefore = since === undefined ? '' : `, as on r${since}`
  const flag = (kind: DigestFlag['kind'], isNew: boolean, hard: boolean, text: string): void => {
    flags.push({ kind, part: name, new: isNew, hard: hard && isNew, text: isNew ? text : `${text}${asBefore}` })
  }
  if (now.invalid) flag('invalid', !was?.invalid, true, `${name} is not valid (OCC's check finds a defect)`)
  if (now.reversed.length > 0) flag('reversed', !was || was.reversed.length === 0, true, `${name} has ${solidsNamed(now.reversed)} inside out (its volume is a size only)`)
  if (now.mesh) {
    const about = now.mesh.exact ? '' : '≈ '
    flag('mesh', !was?.mesh, true, `${name}: its mesh encloses ≈ ${number(now.mesh.mesh)} mm³ where its volume is ${about}${number(now.mesh.volume)} mm³, so one of them is wrong`)
  }
  if (now.solids !== undefined && (now.solids > 1 || (was?.solids !== undefined && was.solids !== now.solids))) {
    const before = was?.solids
    const moved = before !== undefined && before !== now.solids
    const text = `${name} is ${now.solids} solid${now.solids === 1 ? '' : 's'}`
    // More solids than before is a part come apart; fewer, or as many, is told and held against nothing.
    flags.push({ kind: 'solids', part: name, new: moved || before === undefined, hard: moved && now.solids > before, text: moved ? `${text} (was ${before})` : before === undefined ? text : `${text}${asBefore}` })
  }
  if (now.empty) flag('empty', was?.empty === undefined, false, `${name} has ${now.empty}`)
  if (now.open > 0) flag('open', !was || was.open === 0, false, `${name} has ${now.open === 1 ? 'an open shell' : `${now.open} open shells`} (an edge only one face has)`)
  return flags
}

/** Where a part came or went, as the flag says it: in every layout, or in some only. */
function whereText(name: string, layouts: readonly string[], all: readonly string[], what: 'is new' | 'is gone'): string {
  if (layouts.length === all.length || all.length <= 1) return `${name} ${what}`
  return `${name} ${what} ${what === 'is new' ? 'in' : 'from'} ${layouts.join(', ')}`
}

/**
 * The digest of a build (`current`) against the successful build before it (`previous`; none of a first build):
 * the parts that changed with what `diff` says of each, how many did not, and the flags, the hard defects first.
 * A part is compared by name, as it is in the first layout of the build that has it; its flags are of every
 * layout it is in. `verdicts` is what `verdictChanges` says of the dimensions between the two builds: a dimension
 * that passed and fails now is flagged.
 */
export function sanity(previous: Kept | undefined, current: Kept, verdicts: readonly VerdictChange[] = []): BuildDigest {
  const now = byName(current.scene)
  const was = previous ? byName(previous.scene) : undefined
  const since = previous?.revision
  const parts: DigestPart[] = []
  let unchanged = 0
  const flags: DigestFlag[] = []
  const refs: string[] = []
  for (const [name, { part, all }] of now) {
    const before = was?.get(name)
    if (before) {
      const told = partDiff(before.all.find((p) => p.layout === part.layout) ?? before.part, part)
      if (told.data.changed) {
        const { changed: _changed, line, min: _min, arranged: _arranged, ...data } = told.data
        parts.push(clean({ ...data, layout: part.layout, text: line }))
      } else unchanged += 1
      if (told.refsMoved) refs.push(name)
    }
    // A part new in this build has nothing to be held against: whatever it has is new.
    flags.push(...partFlags(name, shapeOf(all), before ? shapeOf(before.all) : undefined, before ? since : undefined))
  }
  if (was && previous) {
    const layoutsOf = (scene: Scene, name: string): string[] => scene.layouts.filter((layout) => scene.parts.some((p) => p.layout === layout && p.name === name))
    for (const name of now.keys()) {
      const [had, has] = [layoutsOf(previous.scene, name), layoutsOf(current.scene, name)]
      const added = has.filter((layout) => !had.includes(layout))
      if (added.length > 0) flags.push({ kind: 'added', part: name, new: true, hard: false, text: whereText(name, added, has, 'is new') })
    }
    for (const name of was.keys()) {
      const [had, has] = [layoutsOf(previous.scene, name), layoutsOf(current.scene, name)]
      const gone = had.filter((layout) => !has.includes(layout))
      if (gone.length > 0) flags.push({ kind: 'removed', part: name, new: true, hard: false, text: whereText(name, gone, had, 'is gone') })
    }
  }
  // Said of all of them in one piece by `digestText`.
  for (const name of refs) flags.push({ kind: 'refs', part: name, new: true, hard: false, text: `the face or edge numbers of ${name} may name others now` })
  for (const change of verdicts) {
    if (change.was === 'pass' && change.now === 'fail') flags.push({ kind: 'dimension', mark: change.id, new: true, hard: false, text: `${change.id} FAIL, passed on r${since}` })
  }
  // The hard defects first: the last to be cut, when not all can be told.
  flags.sort((a, b) => Number(b.hard) - Number(a.hard))
  const comeOrGone = flags.some((f) => f.kind === 'added' || f.kind === 'removed')
  return {
    revision: current.revision,
    ...(since !== undefined ? { since } : {}),
    changed: previous !== undefined && (parts.length > 0 || comeOrGone),
    parts,
    unchanged,
    flags,
    dimensions: [...verdicts]
  }
}

/**
 * Whether nothing in the parts changed between two builds: the same parts (by key), each with the same `hash` (the
 * kernel's hash of the part's shape) and the same place (`loc` and `arranged`). The digest's `changed` is not this:
 * it knows a volume, a box and counts, which a moved hole or a mirrored feature leaves as they were.
 */
export function partsUnchanged(before: Scene, now: Scene): boolean {
  if (before.parts.length !== now.parts.length) return false
  const was = new Map(before.parts.map((p) => [p.key, p]))
  return now.parts.every((p) => {
    const q = was.get(p.key)
    return q !== undefined && q.hash === p.hash && JSON.stringify(q.loc) === JSON.stringify(p.loc) && JSON.stringify(q.arranged) === JSON.stringify(p.arranged)
  })
}

/**
 * A change small enough that a number confirms it (#227): no part came or went, no face or edge count changed (refs
 * may name others) and no hard defect appeared. A `measure`, `check` or `features` after such a build counts as a look.
 */
export function smallChange(digest: BuildDigest): boolean {
  return digest.flags.every((f) => !f.hard && f.kind !== 'added' && f.kind !== 'removed' && f.kind !== 'refs')
}

/** The hard defects of a digest: those that hold a Stop back. */
export function hardDefects(digest: BuildDigest): DigestFlag[] {
  return digest.flags.filter((f) => f.hard)
}

/**
 * The digest as the agent is told it, in at most `limit` characters (`DIGEST_LIMIT` at most) and two lines: what
 * changed since the build before, then what the shape says. Each is cut by whole parts or flags, never mid-line,
 * and what is left out is counted, with where to read it; the hard defects come first and the Check line is fitted
 * before the Changed line. '' when not even the counts fit.
 */
export function digestText(digest: BuildDigest, limit = DIGEST_LIMIT, toolName: (tool: string) => string = (tool) => `mcp__torno__${tool}`): string {
  const room = Math.min(limit, DIGEST_LIMIT)
  /** Pieces joined by `by` after a head, as many as fit in `most` with the tail, then a count of the rest; '' when not even that fits. */
  const fit = (head: string, pieces: readonly string[], tail: string, most: number, more: (n: number) => string, by = '; '): string => {
    let text = head
    for (const [i, piece] of pieces.entries()) {
      const next = `${text}${i === 0 ? '' : by}${piece}`
      const left = pieces.length - i - 1
      if (`${next}${left > 0 ? `${by}${more(left)}` : ''}${tail}`.length > most) {
        const cut = `${text}${i === 0 ? '' : by}${more(pieces.length - i)}${tail}`
        return cut.length <= most ? cut : ''
      }
      text = next
    }
    return `${text}${tail}`
  }
  const refs = digest.flags.filter((f) => f.kind === 'refs').map((f) => f.part!)
  const others = digest.flags.filter((f) => f.kind !== 'refs').map((f) => f.text)
  // The names of the parts whose refs may have moved, as many as a line of its own would hold.
  const refsText = refs.length > 0 ? fit('the face or edge numbers of ', refs, ' may name others now (describe refs again)', REFS_LIMIT, (n) => `${n} more`, ', ') : ''
  const unchanged = digest.unchanged > 0 ? `; ${digest.unchanged} part${digest.unchanged === 1 ? '' : 's'} unchanged` : ''
  const moreChanged = (n: number): string => `${n} ${n === 1 ? 'part' : 'parts'} changed: call ${toolName('diff')}`
  const head = digest.since === undefined ? '' : `Changed since r${digest.since}: `
  const changedAtLeast = digest.since === undefined ? 0 : digest.parts.length === 0 ? nothingChanged(digest).length : `${head}${moreChanged(digest.parts.length)}${unchanged}.`.length
  // The Check line first, leaving the Changed line room to say at least how many changed and where to read them.
  const checkRoom = room - (changedAtLeast > 0 ? changedAtLeast + 1 : 0)
  const check =
    digest.flags.length === 0
      ? SOUND
      : fit('Check: ', [...others, ...(refsText ? [refsText] : [])], '.', checkRoom, (n) => `${n} more: call ${toolName('scene')} and ${toolName('diff')}`)
  const fitted = check.length <= checkRoom ? check : ''
  if (digest.since === undefined) return fitted
  const left = room - (fitted ? fitted.length + 1 : 0)
  const changed = digest.parts.length === 0 ? nothingChanged(digest) : fit(head, digest.parts.map((p) => p.text), `${unchanged}.`, left, (n) => `${n} more changed: call ${toolName('diff')}`)
  return [...(changed && changed.length <= left ? [changed] : []), ...(fitted ? [fitted] : [])].join('\n')
}

/** The most the names of the parts whose refs may have moved take of the Check line. */
const REFS_LIMIT = 240
/** The Check line of a build in which nothing is wrong that the kernel can tell. */
const SOUND = 'Check: nothing found (every part valid, closed, not inside out, its mesh agreeing with its volume).'
/** The Changed line of a build in which no part changed. */
const nothingChanged = (digest: BuildDigest): string => `Changed since r${digest.since}: no part's volume, size or faces${digest.unchanged > 0 ? ` (${digest.unchanged} as they were)` : ''}.`
