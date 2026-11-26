/** What the On block ("Latest build · prompt 5") is made of: the rows that wait on the person, in the order they block. */
export interface OnCheck {
  /** A dimension's id or a model check's name. */
  id: string
  /** A dimension's chip (`M9`); null for a check of the model's own. */
  chip: string | null
  words: string
  /** The value read, in the face of numbers. */
  reading: string
}
export interface OnMark {
  id: string
  words: string
}
export interface OnTried {
  name: string
  value: string
  file: string
}
export interface OnInput {
  /** Claude's open question, if it waits on one. */
  ask: { text: string } | null
  failing: OnCheck[]
  /** Checks that pass, the model's and the person's dimensions. */
  pass: number
  /** Brief sizes nothing checks. */
  unchecked: number
  /** Marks Claude resolved that the person has not judged. */
  review: OnMark[]
  /** Marks Claude left for the person. */
  fromAgent: OnMark[]
  tried: OnTried[]
}
export type OnRow =
  | { kind: 'ask'; text: string }
  | ({ kind: 'check' } & OnCheck)
  | { kind: 'sizes'; count: number }
  | { kind: 'review'; mark: OnMark }
  | { kind: 'fromAgent'; mark: OnMark }
  | { kind: 'tried'; tried: OnTried[] }

/** The most rows the block lists before "N more". */
export const ON_ROWS_SHOWN = 4

/** The build's verdict in a line: `27 checks pass`, `2 checks fail, 5 pass`. A zero is left out. */
export function verdictSaid(fail: number, pass: number): string {
  if (fail === 0 && pass === 0) return 'nothing checked yet'
  const failed = `${fail} ${fail === 1 ? 'check fails' : 'checks fail'}`
  if (pass === 0) return failed
  if (fail === 0) return `${pass} ${pass === 1 ? 'check passes' : 'checks pass'}`
  return `${failed}, ${pass} pass`
}

/** The block: its verdict line and its rows, at most `ON_ROWS_SHOWN` unless `opened`; `more` is how many the closed block leaves out. */
export function onBlock(input: OnInput, opened = false): { said: string; rows: OnRow[]; more: number } {
  const all: OnRow[] = [
    ...(input.ask ? [{ kind: 'ask' as const, text: input.ask.text }] : []),
    ...input.failing.map((c) => ({ kind: 'check' as const, ...c })),
    ...(input.unchecked > 0 ? [{ kind: 'sizes' as const, count: input.unchecked }] : []),
    ...input.review.map((mark) => ({ kind: 'review' as const, mark })),
    ...input.fromAgent.map((mark) => ({ kind: 'fromAgent' as const, mark })),
    ...(input.tried.length > 0 ? [{ kind: 'tried' as const, tried: input.tried }] : [])
  ]
  return { said: verdictSaid(input.failing.length, input.pass), rows: opened ? all : all.slice(0, ON_ROWS_SHOWN), more: Math.max(0, all.length - ON_ROWS_SHOWN) }
}
