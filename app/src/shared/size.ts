// A size the person knows, or Claude measured: the facts of a `size` card of the board (`shared/board.ts`). The value
// is kept as it was typed; the numbers are read from it whenever they are told, by `parseSize`, and never stored.

export type SizeSource = 'measured' | 'from a manual or datasheet' | 'a guess' | 'from Claude'
export type SizeUnit = 'mm' | '°'

export interface SizeFact {
  /** What it measures: "battery tray". */
  what: string
  /** As typed: "186 x 128", "Ø62", "about 60". */
  value: string
  unit: SizeUnit
  source: SizeSource
  /** A few words more, on one line. */
  note?: string
}

export const MAX_SIZES = 40
export const MAX_SIZE_WHAT = 200
export const MAX_SIZE_VALUE = 60
export const MAX_SIZE_NOTE = 300

export const SIZE_UNITS: readonly SizeUnit[] = ['mm', '°']
/** What the person may say a size came from. */
export const PERSON_SOURCES: readonly SizeSource[] = ['measured', 'from a manual or datasheet', 'a guess']
/** What Claude's sizes say, and the only thing it may. */
export const AGENT_SOURCE: SizeSource = 'from Claude'

const NUMBER = String.raw`\d+(?:[.,]\d+)?`
const PARSED = new RegExp(`^(?:([ØR])\\s*)?(${NUMBER}(?:\\s*[x×]\\s*${NUMBER}){0,2})$`, 'i')

/** The numbers a value holds: one to three joined by `x` or `×`, with `,` or `.` for decimals and a leading `Ø` or `R`. Null when it is anything else. */
export function parseSize(value: string): { mark?: 'Ø' | 'R'; numbers: number[] } | null {
  const found = PARSED.exec(value.trim())
  if (!found) return null
  const numbers = found[2].split(/[x×]/i).map((n) => Number(n.trim().replace(',', '.')))
  if (!numbers.every(Number.isFinite)) return null
  const mark = found[1] === undefined ? undefined : (found[1].toUpperCase() as 'Ø' | 'R')
  return { ...(mark !== undefined ? { mark } : {}), numbers }
}

/** A size in words, the one form the prompt and the `board` tool tell: `battery tray 186 × 128 mm (measured)`. */
export function saySize(s: SizeFact): string {
  const parsed = parseSize(s.value)
  const from = (as: string): string => ` (${as}${s.note ? `: ${s.note}` : ''})`
  const unit = s.unit === '°' ? '°' : ` ${s.unit}`
  if (!parsed) return `${s.what} ${s.value.trim()}${unit}${from(`as typed, ${s.source}`)}`
  return `${s.what} ${parsed.mark ? `${parsed.mark} ` : ''}${parsed.numbers.join(' × ')}${unit}${from(s.source)}`
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)

function line(value: unknown, max: number, as: string): string {
  if (typeof value !== 'string') return `The ${as} must be text.`
  if (/[\r\n\p{Zl}\p{Zp}]/u.test(value)) return `The ${as} is one line.`
  if (value.length > max) return `The ${as} is ${value.length} characters long, and a size keeps at most ${max}.`
  return ''
}

/**
 * The size `raw` says, with only the fields a size has, or the reason it is refused. `by` is who says it: the person may
 * give three sources, and Claude only its own (whatever it gives, `from Claude`; any other source it names is refused).
 * The unit is `mm` when none is given. The value is kept as typed.
 */
export function checkSize(raw: unknown, by: 'person' | 'agent'): SizeFact | string {
  if (!isRecord(raw)) return 'A size is an object with what, value, unit and a source (and a note).'
  for (const [key, max, as] of [['what', MAX_SIZE_WHAT, 'what it measures'], ['value', MAX_SIZE_VALUE, 'value']] as const) {
    const wrong = line(raw[key], max, as)
    if (wrong) return wrong
    if ((raw[key] as string).trim() === '') return `A size has ${key === 'what' ? 'what it measures' : 'a value'}.`
  }
  const unit = raw.unit === undefined ? 'mm' : raw.unit
  if (unit !== 'mm' && unit !== '°') return 'The unit of a size is mm or °.'
  let source: SizeSource
  if (by === 'agent') {
    if (raw.source !== undefined && raw.source !== AGENT_SOURCE) return `A size you add is ${AGENT_SOURCE}: no other source is yours to give.`
    source = AGENT_SOURCE
  } else {
    if (raw.source === AGENT_SOURCE) return `${AGENT_SOURCE} is the source of Claude's own sizes: say where the person got this one.`
    if (!PERSON_SOURCES.includes(raw.source as SizeSource)) return `The source of a size is one of: ${PERSON_SOURCES.join(', ')}.`
    source = raw.source as SizeSource
  }
  const fact: SizeFact = { what: raw.what as string, value: raw.value as string, unit, source }
  if (raw.note !== undefined && raw.note !== '') {
    const wrong = line(raw.note, MAX_SIZE_NOTE, 'note')
    if (wrong) return wrong
    fact.note = raw.note as string
  }
  return fact
}
