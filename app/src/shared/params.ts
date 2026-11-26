import type { Param, Scene } from './scene'

/**
 * Where a size of the model's `Params` says it comes from: the first word of the field's comment, before a `:`
 * (`# assumed: 5 perimeters at 0.4 mm`). `M<n>` and `S<n>` stand for a mark and a scan, whatever the number; `ref`
 * and `datasheet` may be followed by a name. It is the model's own claim, never checked by torno; a missing or
 * unknown word is `unsaid`, never `assumed`.
 */
export const SOURCES = ['brief', 'mark', 'scan', 'ref', 'object', 'datasheet', 'person', 'derived', 'assumed'] as const
export type Source = (typeof SOURCES)[number] | 'unsaid'

/** The source a comment begins with; `unsaid` for none, or for a word that is not one of the convention's. */
export function sourceOf(doc: string | null | undefined): Source {
  const word = /^\s*([A-Za-z][^:\n]*?)\s*(?:≈\s*)?:/.exec(doc ?? '')?.[1]?.toLowerCase()
  if (!word) return 'unsaid'
  if (/^m\d+$/.test(word)) return 'mark'
  if (/^s\d+$/.test(word)) return 'scan'
  if (word === 'ref' || word.startsWith('ref ')) return 'ref'
  if (word === 'datasheet' || word.startsWith('datasheet ')) return 'datasheet'
  return (SOURCES as readonly string[]).includes(word) ? (word as Source) : 'unsaid'
}

/** The source word of a comment as the model wrote it (`ref photo-1.jpg`, `M3`, `assumed`), for the row's own word; '' when it says none. */
export function sourceWord(doc: string | null | undefined): string {
  if (sourceOf(doc) === 'unsaid') return ''
  const written = /^\s*([A-Za-z][^:\n]*?)\s*(?:≈\s*)?:/.exec(doc ?? '')?.[1] ?? ''
  const named = /^(?:ref|datasheet)\s+(.+)$/i.exec(written)?.[1]
  return (named ?? written).replace(/\.(?:jpe?g|png|webp|pdf)$/i, '')
}

/** A comment cut after its source (`assumed:`, `ref photo-1.jpg:`): the source as written, and the rest. */
export function splitSource(doc: string | null | undefined): { source: string; rest: string } {
  const text = doc ?? ''
  if (sourceOf(text) === 'unsaid') return { source: '', rest: text }
  const at = text.indexOf(':')
  return { source: text.slice(0, at + 1).trim(), rest: text.slice(at + 1) }
}

/** A field is a size when its default is a number (a count, a clearance); text, flags and lists have no source to tell. */
export const isSize = (param: Pick<Param, 'default'>): boolean => typeof param.default === 'number'

/**
 * The unit a field's value is in, `''` for none. Only a number has one: a flag, a text, a choice, a list and a value
 * there is none of have not, whatever the model declares. A number is in what the field's `metadata` says, as written;
 * where it says nothing a float is in millimetres, as every length of torno is, and a whole number has no unit, being
 * most often a count. The model's own claim: torno converts nothing.
 */
export function unitOf(param: Pick<Param, 'type' | 'default' | 'editable' | 'unit'>): string {
  if (!isSize(param) || param.editable === 'choice') return ''
  if (typeof param.unit === 'string') return param.unit
  return param.editable === 'float' || (param.editable !== 'int' && /\bfloat\b/.test(param.type)) ? 'mm' : ''
}

/** How a unit is written beside its number: `deg` is `°`, a `count` is said by the number alone, any other as it is. */
export const unitMark = (unit: string): string => (unit === 'deg' ? '°' : unit === 'count' ? '' : unit)

/** Whether a unit's mark stands against its number, with no space: `15°`, `50%`. */
export const unitTight = (mark: string): boolean => mark === '°' || mark === '%'

/** A number as said with its unit: `96 mm`, `15°`, `50%`, `9`. */
export function withUnit(text: string, unit: string): string {
  const mark = unitMark(unit)
  return mark === '' ? text : `${text}${unitTight(mark) ? '' : ' '}${mark}`
}

/**
 * Why a comment does not count as a source, in a few words: it has none, it does not begin with a word and a colon
 * (`source: …`), or the word is not one of the convention's. '' for a comment that counts.
 */
export function whyUnsaid(doc: string | null | undefined): string {
  if (sourceOf(doc) !== 'unsaid') return ''
  if (!doc || doc.trim() === '') return 'no comment'
  const word = /^\s*([A-Za-z][^:\n]*?)\s*(?:≈\s*)?:/.exec(doc)?.[1]
  return word ? `"${word}" is not a source word (${SOURCES.join(', ')})` : 'its comment does not begin with a source word and a colon (brief: …)'
}

export interface SourceCount {
  /** The sizes of the model. */
  sizes: number
  /** Those whose comment says `assumed`, in the model's order. */
  assumed: Param[]
  /** Those with no source, or one that is not of the convention. */
  unsaid: Param[]
}

export function sourceCount(params: readonly Param[] | undefined): SourceCount {
  const sizes = (params ?? []).filter(isSize)
  return {
    sizes: sizes.length,
    assumed: sizes.filter((p) => sourceOf(p.doc) === 'assumed'),
    unsaid: sizes.filter((p) => sourceOf(p.doc) === 'unsaid')
  }
}

const value = (p: Param): string => String(typeof p.default === 'number' ? Math.round(p.default * 1000) / 1000 : p.default)

const SHOWN_UNSAID = 8
const unsaidWhy = (unsaid: readonly Param[]): string =>
  `${unsaid.slice(0, SHOWN_UNSAID).map((p) => `${p.name}: ${whyUnsaid(p.doc)}`).join('; ')}${unsaid.length > SHOWN_UNSAID ? `; and ${unsaid.length - SHOWN_UNSAID} more` : ''}`
const unsaidText = (unsaid: readonly Param[]): string => `no source: ${unsaid.length} (${unsaidWhy(unsaid)})`

/** `Assumed: wall 2, lip 3 (2 of 14 sizes); no source: 1 (lid: no comment)`, each field named with why its comment does not count; '' when there is nothing to say. */
export function assumedLine(params: readonly Param[] | undefined): string {
  const { sizes, assumed, unsaid } = sourceCount(params)
  if (assumed.length === 0 && unsaid.length === 0) return ''
  if (assumed.length === 0) return `No source: ${unsaid.length} of ${sizes} sizes (${unsaidWhy(unsaid)})`
  return `Assumed: ${assumed.map((p) => `${p.name} ${value(p)}`).join(', ')} (${assumed.length} of ${sizes} sizes)${unsaid.length > 0 ? `; ${unsaidText(unsaid)}` : ''}`
}

/** The set of assumed and unsaid sizes as one string, to tell whether it changed between two builds. */
export const assumedKey = (params: readonly Param[] | undefined): string => {
  const { assumed, unsaid } = sourceCount(params)
  return `${assumed.map((p) => `${p.name}=${value(p)}`).join(',')}|${unsaid.map((p) => p.name).join(',')}`
}

/** A field built with a value other than the file's default: the person's override, or a trial's. */
export interface Tried {
  name: string
  value: unknown
  default: unknown
}

/** What a value of a field is said as: a number to three decimals, anything else as it is. */
export const said = (v: unknown): string => String(typeof v === 'number' ? Math.round(v * 1000) / 1000 : v)

/** Whether two values of a field are the same value: a tuple or a list by its items, an object by its keys, the rest as they are (#310). */
export function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (Array.isArray(a) || Array.isArray(b)) return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((v, i) => sameValue(v, b[i]))
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return false
  const ka = Object.keys(a)
  const kb = Object.keys(b)
  return ka.length === kb.length && ka.every((k) => Object.hasOwn(b, k) && sameValue((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]))
}

/** Whether a field's value in this build is other than the default the file gives. */
export const isTried = (p: Pick<Param, 'value' | 'default'>): boolean => p.value !== undefined && !sameValue(p.value, p.default)

/** The fields whose value in this build is other than the default the file gives, in the model's order. */
export function triedParams(params: readonly Param[] | undefined): Tried[] {
  const tried: Tried[] = []
  for (const p of params ?? []) if (isTried(p)) tried.push({ name: p.name, value: p.value, default: p.default })
  return tried
}

/**
 * `Params tried by the person (…): wall 2.4 (file 2), lid false (file true).`; '' when the build used the file's
 * values. `dropped` are overrides let go of, each with its reason.
 */
export function triedLine(params: readonly Param[] | undefined, dropped: ReadonlyArray<{ name: string; reason: string }> = []): string {
  const tried = triedParams(params)
  const parts: string[] = []
  if (tried.length > 0) {
    parts.push(
      `Params tried by the person (this build is made with them; the model file says otherwise): ${tried.map((t) => `${t.name} ${said(t.value)} (file ${said(t.default)})`).join(', ')}. To make one the default, edit it in the model.`
    )
  }
  if (dropped.length > 0) parts.push(`Params overrides let go of: ${dropped.map((d) => `${d.name} (${d.reason})`).join('; ')}.`)
  return parts.join(' ')
}

/**
 * The references (bought parts) of a build that were made from sizes the model's comments say are assumed, by name,
 * each with those sizes: `references(p)` read an `assumed:` field of `Params` (`Part.reads`). A kernel that did not
 * say what it read counts it as having read every one. The model's own claim of the sources, as `sourceCount` is.
 */
export function assumedReferences(scene: Pick<Scene, 'parts' | 'params'>): Map<string, string[]> {
  const { assumed } = sourceCount(scene.params)
  const found = new Map<string, string[]>()
  for (const part of scene.parts) {
    if (part.role !== 'reference' || found.has(part.name)) continue
    const mine = assumed.filter((p) => part.reads === undefined || part.reads.includes(p.name)).map((p) => p.name)
    if (mine.length > 0) found.set(part.name, mine)
  }
  return found
}
