import { number } from '../../shared/format'
import { isTried } from '../../shared/params'
import type { Param, ParamKind, ParamValue } from '../../shared/scene'

/** What the Parameters section draws for one field of the model's `Params`. */
export interface ParamRow {
  name: string
  /** The text a click puts in the prompt: `Params.wall`. It names no geometry, so it is plain text there. */
  text: string
  /** The default as the person reads it, numbers to four digits; null where the kernel has no value to give (a default worked out in the model that JSON cannot say). */
  value: string | null
  /** The default whole, only where it differs from `value`. */
  full: string | null
  /** Whether the default in the source is not a literal (an expression, a `default_factory`). */
  worked: boolean
  /** The field's comment, as the model has it. */
  doc: string | null
  /** The row's tooltip: the name, the type as written, the value whole and the comment. */
  title: string
  /** What the person may try in its place (a number, a flag or a choice), else null: the row is text. */
  editable: ParamKind | null
  /** What the last build used: the default, or the value the person is trying. */
  current: ParamValue | null
  /** The values of a `Literal` field. */
  choices: Array<string | number>
  /** Its least, most and step, where the model's own `metadata` says. */
  range: { min?: number; max?: number; step?: number }
  /** The build was made with a value other than the file's: the file's default as read, else null. */
  file: string | null
  /** Why an override of it was let go of, as main noted it, else null. */
  note: string | null
}

/** A value as Python writes it, numbers to four significant digits, or whole. */
function show(value: unknown, whole: boolean): string {
  if (value === null || value === undefined) return 'None'
  if (typeof value === 'number') return whole ? String(value) : number(value)
  if (typeof value === 'boolean') return value ? 'True' : 'False'
  if (typeof value === 'string') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map((item) => show(item, whole)).join(', ')}]`
  if (typeof value === 'object') return `{${Object.entries(value).map(([key, item]) => `${JSON.stringify(key)}: ${show(item, whole)}`).join(', ')}}`
  return String(value)
}

/** Whether the last build was made with a value other than the file's default for this field. */
export const tried = (param: Param): boolean => isTried(param)

/** The row of a field. No unit is taken from its comment: the comment is shown as it was written. */
export function paramRow(param: Param, note: string | null = null): ParamRow {
  const worked = !param.literal
  const nothing = worked && param.default === null
  const value = nothing ? null : show(param.default, false)
  const whole = nothing ? null : show(param.default, true)
  const text = `Params.${param.name}`
  const said = [`${text}: ${param.type}`, whole !== null ? ` = ${whole}` : '', worked ? ', worked out in the model' : ''].join('')
  return {
    name: param.name,
    text,
    value,
    full: whole !== null && whole !== value ? whole : null,
    worked,
    doc: param.doc,
    title: param.doc ? `${said}. ${param.doc}` : said,
    editable: param.editable ?? null,
    current: ((): ParamValue | null => {
      const used = param.value === undefined ? param.default : param.value
      return typeof used === 'number' || typeof used === 'boolean' || typeof used === 'string' ? used : null
    })(),
    choices: param.choices ?? [],
    range: param.metadata ?? {},
    file: tried(param) ? show(param.default, false) : null,
    note
  }
}

/**
 * What "Ask the agent to bake it in" puts in the chat box: the model is the agent's to edit, so the values the
 * person tried are asked for as defaults, each with what the file has.
 */
export function bakeText(params: readonly Param[]): string {
  const asked = params.filter(tried)
  if (asked.length === 0) return ''
  const each = asked.map((p) => `Params.${p.name} to ${show(p.value, true)} (the file has ${show(p.default, true)})`)
  const list = each.length === 1 ? each[0] : `${each.slice(0, -1).join(', ')} and ${each.at(-1)}`
  const them = asked.length === 1 ? 'it' : 'them'
  return `Make ${list} the default${asked.length === 1 ? '' : 's'} in the model: I tried ${them} in torno and want to keep ${them}.`
}
