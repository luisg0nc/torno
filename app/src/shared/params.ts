import type { Param } from './scene'

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

/** A field is a size when its default is a number (a count, a clearance); text, flags and lists have no source to tell. */
export const isSize = (param: Param): boolean => typeof param.default === 'number'

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

/** The fields whose value in this build is other than the default the file gives, in the model's order. */
export function triedParams(params: readonly Param[] | undefined): Tried[] {
  const tried: Tried[] = []
  for (const p of params ?? []) if (p.value !== undefined && p.value !== p.default) tried.push({ name: p.name, value: p.value, default: p.default })
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
