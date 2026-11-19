import { number } from './format'
import { assumedReferences } from './params'
import type { Scene } from './scene'

/**
 * A check the model declares in its `checks(p)` and the kernel measured on a build (`kernel/src/torno_kernel/modelchecks.py`).
 * `pass` and `fail` have a `value`; `error` could not be measured and `not run` was left past the time the checks have,
 * each with a `reason`. `min` and `max` are what is wanted of the value (null for no bound), `unit` is its unit, `exact`
 * and `how` are the kernel's, `declared` the declaration as the model wrote it. Never the person's: a dimension is a mark.
 */
export interface ModelCheck {
  name: string
  kind: string
  status: 'pass' | 'fail' | 'error' | 'not run'
  layout?: string
  value?: number | null
  unit?: string
  min?: number | null
  max?: number | null
  exact?: boolean
  how?: string
  reason?: string
  declared?: Record<string, unknown>
  /** The references this check names (or, an interference, all) that were made from assumed sizes: it holds only as far as that guess does. Main's, after the build; absent for none. */
  assumedRefs?: string[]
}

/**
 * What a check of the model has become since an earlier build, told to the person because the agent writes both the
 * part and its checks and could otherwise make one pass by weakening it. `from` is the check as it first was.
 */
export interface CheckNote {
  name: string
  what: 'removed' | 'loosened' | 'changed'
  /** `walls: min 1.2 → 0.6 mm`, without the revision. */
  text: string
  /** The build it was first seen on. */
  since: number
  from: ModelCheck
}

const SLACK = 1e-9

const withUnit = (text: string, unit: string | undefined): string => (unit ? `${text} ${unit}` : text)

/** What is wanted of a check's value: `0.15 to 0.25 mm`, `at least 1.2 mm`, `at most 0 mm`, `exactly 1 solids`. */
export function wantedText(c: Pick<ModelCheck, 'min' | 'max' | 'unit'>): string {
  const low = c.min ?? undefined
  const high = c.max ?? undefined
  if (low !== undefined && high !== undefined) return low === high ? withUnit(`exactly ${number(low)}`, c.unit) : withUnit(`${number(low)} to ${number(high)}`, c.unit)
  if (low !== undefined) return withUnit(`at least ${number(low)}`, c.unit)
  if (high !== undefined) return withUnit(`at most ${number(high)}`, c.unit)
  return 'nothing in particular'
}

/** What a check measured, as the person reads it: `0.12 mm`; a `thin` that found no wall under its least says so. */
export function readingText(c: Pick<ModelCheck, 'value' | 'unit' | 'kind' | 'exact'>): string {
  if (c.value === undefined || c.value === null) return c.kind === 'thin' ? 'none found by sampling' : 'no value'
  return `${withUnit(number(c.value), c.unit)}${c.exact === false ? ' (approximate)' : ''}`
}

/** One check in a line: `lid fits the tub (0.12 mm, wanted 0.15 to 0.25 mm)`. The name is the model's own words. */
export function checkText(c: ModelCheck): string {
  if (c.status === 'error') return `${c.name} (could not be measured: ${c.reason ?? 'no reason given'})`
  if (c.status === 'not run') return `${c.name} (not run: ${c.reason ?? 'no time'})`
  return `${c.name} (${readingText(c)}, wanted ${wantedText(c)}${againstText(c) ? `; ${againstText(c)}` : ''})`
}

/** `against an assumed reference: radiator`; empty when the check names none. */
export function againstText(c: Pick<ModelCheck, 'assumedRefs'>): string {
  const refs = c.assumedRefs ?? []
  return refs.length === 0 ? '' : `against ${refs.length === 1 ? 'an assumed reference' : 'assumed references'}: ${refs.join(', ')}`
}

/**
 * For each check, the references it is against that were made from assumed sizes (`assumedReferences`): those of its `a`
 * and `b`, a group by its parts, and for an `interference` every one. In the order of `checks`; `[]` for a check against none.
 */
export function assumedAgainst(checks: readonly ModelCheck[], scene: Pick<Scene, 'parts' | 'params' | 'groups'>): string[][] {
  const assumed = assumedReferences(scene)
  if (assumed.size === 0) return checks.map(() => [])
  const expand = (ref: unknown): string[] => (typeof ref !== 'string' ? [] : (scene.groups?.find((g) => g.name === ref)?.parts ?? [ref]))
  return checks.map((c) => {
    const named = c.kind === 'interference' ? [...assumed.keys()] : [c.declared?.a, c.declared?.b].flatMap(expand)
    return [...new Set(named)].filter((name) => assumed.has(name))
  })
}

/** How the model's checks stand, counted: `pass`, `fail`, could not be measured, not run, and how many passes are by sampling or approximate. */
export function checksCount(checks: readonly ModelCheck[]): { pass: number; fail: number; error: number; notRun: number; approximate: number } {
  const count = (status: ModelCheck['status']): number => checks.filter((c) => c.status === status).length
  return { pass: count('pass'), fail: count('fail'), error: count('error'), notRun: count('not run'), approximate: checks.filter((c) => c.status === 'pass' && c.exact === false).length }
}

/**
 * `Checks (the model's own, on r5): 4 pass, 1 fails: lid fits the tub (0.12 mm, wanted 0.15 to 0.25 mm)`. What did not
 * pass is named, up to `limit` characters; a pass is never "verified": a number from sampling says so.
 */
export function checksLine(checks: readonly ModelCheck[], revision: number | undefined, limit = 500): string {
  if (checks.length === 0) return ''
  const n = checksCount(checks)
  const parts = [`${n.pass} pass`, ...(n.fail > 0 ? [`${n.fail} ${n.fail === 1 ? 'fails' : 'fail'}`] : []), ...(n.error > 0 ? [`${n.error} could not be measured`] : []), ...(n.notRun > 0 ? [`${n.notRun} not run`] : [])]
  const guessed = checks.filter((c) => c.status === 'pass' && (c.assumedRefs ?? []).length > 0).length
  const sampled = `${n.approximate > 0 ? ` (${n.approximate} of the passes by sampling or approximate)` : ''}${guessed > 0 ? ` (${guessed} of the passes against an assumed reference)` : ''}`
  const head = `Checks (the model's own${revision === undefined ? '' : `, on r${revision}`}): ${parts.join(', ')}${sampled}`
  const unmet = checks.filter((c) => c.status !== 'pass')
  if (unmet.length === 0) return head
  const named: string[] = []
  let text = `${head}: `
  for (const [i, c] of unmet.entries()) {
    const one = checkText(c)
    const rest = unmet.length - i - 1
    const more = rest > 0 ? `; … and ${rest} more` : ''
    if (text.length + named.join('; ').length + one.length + more.length > limit && named.length > 0) return `${text}${named.join('; ')}; … and ${unmet.length - i} more`
    named.push(one)
  }
  return `${text}${named.join('; ')}`
}

const bound = (c: ModelCheck, key: 'min' | 'max'): number | null => c[key] ?? null
const same = (a: unknown, b: unknown): boolean => JSON.stringify(a ?? null) === JSON.stringify(b ?? null)

/**
 * How a check differs from an earlier version of it in a way that lets it pass more easily; undefined when it does
 * not. A check that asks about other parts or another kind is `changed`: it is another check under an old name.
 */
function compare(from: ModelCheck, now: ModelCheck): Pick<CheckNote, 'what' | 'text'> | undefined {
  const asked = (c: ModelCheck): unknown[] => [c.kind, c.declared?.a, c.declared?.b, c.declared?.layout]
  if (!same(asked(from), asked(now))) return { what: 'changed', text: `${now.name}: it was a ${from.kind} of ${[from.declared?.a, from.declared?.b].filter(Boolean).join(' and ') || 'the layout'}, now a ${now.kind} of ${[now.declared?.a, now.declared?.b].filter(Boolean).join(' and ') || 'the layout'}` }
  const says: string[] = []
  for (const key of ['min', 'max'] as const) {
    const before = bound(from, key)
    const after = bound(now, key)
    if (before === null) continue
    const looser = after === null || (key === 'min' ? after < before - SLACK * Math.max(1, Math.abs(before)) : after > before + SLACK * Math.max(1, Math.abs(before)))
    if (looser) says.push(`${key} ${number(before)} → ${after === null ? 'none' : number(after)}`)
  }
  const angle = [from.declared?.angle, now.declared?.angle]
  if (typeof angle[0] === 'number' && (angle[1] === undefined || (typeof angle[1] === 'number' && angle[1] > angle[0]))) says.push(`angle ${number(angle[0])} → ${angle[1] === undefined ? '45' : number(angle[1] as number)}`)
  const [bigger, wider] = [from.declared?.size, now.declared?.size].map((size) => (Array.isArray(size) ? size.map(Number) : undefined))
  if (bigger && wider && bigger.some((s, i) => (wider[i] ?? s) > s)) says.push(`bed ${bigger.map(number).join(' × ')} → ${wider.map(number).join(' × ')}`)
  return says.length > 0 ? { what: 'loosened', text: `${now.name}: ${says.join(', ')}${now.unit ? ` ${now.unit}` : ''}` } : undefined
}

/**
 * The notes on the checks of a new build: those of the build before kept as long as the check is still weaker than it
 * first was, and those the new build adds, each against the check as it was before (the earliest `from` there is). A
 * check back to what it was, or tighter, is no longer noted. `revision` is the new build's.
 */
export function keepNotes(notes: readonly CheckNote[], before: readonly ModelCheck[] | undefined, now: readonly ModelCheck[] | undefined, revision: number): CheckNote[] {
  if (!before || !now) return [...notes]
  const kept = new Map(notes.map((n) => [n.name, n]))
  const names = new Set([...kept.keys(), ...before.map((c) => c.name)])
  const out: CheckNote[] = []
  for (const name of names) {
    const note = kept.get(name)
    const from = note?.from ?? before.find((c) => c.name === name)
    if (!from) continue
    const current = now.find((c) => c.name === name)
    if (!current) {
      out.push({ name, what: 'removed', text: `${name}: removed`, since: note?.since ?? revision, from })
      continue
    }
    const said = compare(from, current)
    if (said) out.push({ name, ...said, since: note?.since ?? revision, from })
  }
  return out
}

/** A note as the person and the file read it: `walls: min 1.2 → 0.6 mm (since r7)`. */
export function noteText(note: CheckNote): string {
  return `${note.text} (since r${note.since})`
}
