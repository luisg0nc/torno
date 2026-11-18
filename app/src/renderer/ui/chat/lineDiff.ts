// An edit of a file as lines removed and added. The pure part of `Diff.tsx`, drawn from the tool's own input
// (`old_string` against `new_string`): nothing of the person's files is read to make it.

export interface DiffRow {
  /** `same` is a line kept beside a change, `gap` the lines left out between. */
  kind: 'same' | 'removed' | 'added' | 'gap'
  text: string
  /** The line's number in the file, when asked for: a removed line's in the old text, any other's in the new one. */
  line?: number
}

export interface Hunk {
  /** Which edit of several this is. */
  title?: string
  rows: DiffRow[]
  /** The two texts were the same. */
  same?: boolean
  /** What differs had more than `COMPARED_LINES` lines on a side: every line of the old text in it is a line removed and every line of the new one a line added, not compared. */
  tooLong?: boolean
  /** The edit has `replace_all`: it replaces every match in the file, of which the rows show one. */
  everywhere?: boolean
}

/** The most lines of either text that are compared, once what the two share at both ends is left out. */
export const COMPARED_LINES = 400
/** How many lines removed and added a card shows before "Show all". */
export const CHANGE_LINES = 6
/** How many lines of what did not change are kept on each side of a change. */
const CONTEXT = 1

/** The lines of a text; the newline that ends it is no line, when both ends of a comparison have one (`trim`). */
const linesOf = (text: string, trim: boolean): string[] => {
  if (text === '') return []
  const lines = text.split('\n')
  if (trim && lines[lines.length - 1] === '') lines.pop()
  return lines
}

/** The rows of two lists of lines: the lines of `a` that `b` lacks removed, the lines of `b` that `a` lacks added. */
function compare(a: string[], b: string[]): { rows: DiffRow[]; tooLong: boolean } {
  let start = 0
  while (start < a.length && start < b.length && a[start] === b[start]) start += 1
  let end = 0
  while (end < a.length - start && end < b.length - start && a[a.length - 1 - end] === b[b.length - 1 - end]) end += 1
  const x = a.slice(start, a.length - end)
  const y = b.slice(start, b.length - end)
  const rows: DiffRow[] = a.slice(0, start).map((text) => ({ kind: 'same', text }))
  const tail: DiffRow[] = a.slice(a.length - end).map((text) => ({ kind: 'same', text }))
  if (x.length > COMPARED_LINES || y.length > COMPARED_LINES) {
    // Not compared, and nothing hidden: all of what differs is removed and all of it added.
    // (Concatenated, not spread: a text can have more lines than a call has arguments.)
    const removed = x.map((text): DiffRow => ({ kind: 'removed', text }))
    const added = y.map((text): DiffRow => ({ kind: 'added', text }))
    return { rows: rows.concat(removed, added, tail), tooLong: true }
  }
  // The longest common run of what is left: `table[i][j]` is its length in x[i..] and y[j..].
  const width = y.length + 1
  const table = new Uint16Array((x.length + 1) * width)
  for (let i = x.length - 1; i >= 0; i -= 1) {
    for (let j = y.length - 1; j >= 0; j -= 1) {
      table[i * width + j] = x[i] === y[j] ? table[(i + 1) * width + j + 1] + 1 : Math.max(table[(i + 1) * width + j], table[i * width + j + 1])
    }
  }
  let i = 0
  let j = 0
  while (i < x.length || j < y.length) {
    if (i < x.length && j < y.length && x[i] === y[j]) {
      rows.push({ kind: 'same', text: x[i] })
      i += 1
      j += 1
    } else if (j >= y.length || (i < x.length && table[(i + 1) * width + j] >= table[i * width + j + 1])) {
      rows.push({ kind: 'removed', text: x[i] })
      i += 1
    } else {
      rows.push({ kind: 'added', text: y[j] })
      j += 1
    }
  }
  return { rows: rows.concat(tail), tooLong: false }
}

/** Only the lines of change and `CONTEXT` lines beside them; a longer run of the others is one `gap` row. */
function trimmed(rows: DiffRow[]): DiffRow[] {
  const near = rows.map((_, n) => rows.slice(Math.max(0, n - CONTEXT), n + CONTEXT + 1).some((r) => r.kind !== 'same'))
  const out: DiffRow[] = []
  let hidden: DiffRow[] = []
  // A single line is no shorter to say than to show.
  const flush = (): void => {
    if (hidden.length === 1) out.push(hidden[0])
    else if (hidden.length > 1) out.push({ kind: 'gap', text: `${hidden.length} unchanged lines` })
    hidden = []
  }
  rows.forEach((row, n) => {
    if (near[n]) {
      flush()
      out.push(row)
    } else hidden.push(row)
  })
  flush()
  return out
}

/** The rows with the number of their line in the file: counted before the unchanged ones are folded into a gap. */
function withLines(rows: DiffRow[]): DiffRow[] {
  let old = 0
  let now = 0
  return rows.map((row) => {
    if (row.kind === 'removed') return { ...row, line: (old += 1) }
    if (row.kind === 'added') return { ...row, line: (now += 1) }
    old += 1
    return { ...row, line: (now += 1) }
  })
}

/** Two texts as the lines removed and added to make the first the second; `numbered` gives each line its number in the file (the sheet of a turn's changes). */
export function diffText(old: string, now: string, numbered = false): Omit<Hunk, 'title'> {
  const trim = old.endsWith('\n') && now.endsWith('\n')
  const a = linesOf(old, trim)
  const b = linesOf(now, trim)
  const { rows, tooLong } = compare(a, b)
  if (rows.every((r) => r.kind === 'same')) return { rows: [], same: true }
  const shown = trimmed(numbered ? withLines(rows) : rows)
  return tooLong ? { tooLong, rows: shown } : { rows: shown }
}

/** How many lines a diff adds and removes. */
export function countLines(hunk: Pick<Hunk, 'rows'>): { added: number; removed: number } {
  return { added: hunk.rows.filter((r) => r.kind === 'added').length, removed: hunk.rows.filter((r) => r.kind === 'removed').length }
}

const text = (value: unknown): string | undefined => (typeof value === 'string' ? value : undefined)

/**
 * What an `Edit` or a `MultiEdit` changes, one hunk for each edit (a `MultiEdit` titled by its place); undefined for
 * any other tool, and for an input that holds no edit.
 */
export function editHunks(tool: string, input: unknown): Hunk[] | undefined {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return undefined
  const fields = input as Record<string, unknown>
  const hunk = (edit: Record<string, unknown>): Omit<Hunk, 'title'> | undefined => {
    const old = text(edit.old_string)
    const now = text(edit.new_string)
    return old === undefined || now === undefined ? undefined : { ...diffText(old, now), ...(edit.replace_all === true ? { everywhere: true } : {}) }
  }
  if (tool === 'Edit') {
    const one = hunk(fields)
    return one && [one]
  }
  if (tool === 'MultiEdit' && Array.isArray(fields.edits)) {
    const hunks = fields.edits.flatMap((edit) => {
      const one = typeof edit === 'object' && edit !== null && !Array.isArray(edit) ? hunk(edit as Record<string, unknown>) : undefined
      return one ? [one] : []
    })
    return hunks.length === 0 ? undefined : hunks.map((h, n) => ({ title: `Edit ${n + 1} of ${hunks.length}`, ...h }))
  }
  return undefined
}

/** The hunks cut after `limit` lines removed and added (none, with `all`), and how many of those lines are left out. */
export function limitHunks(hunks: Hunk[], limit: number, all = false): { hunks: Hunk[]; more: number } {
  if (all) return { hunks, more: 0 }
  let left = limit
  let more = 0
  const cut = hunks.map((hunk) => {
    const rows: DiffRow[] = []
    for (const row of hunk.rows) {
      if (row.kind === 'same' || row.kind === 'gap') {
        // What is beside a change goes with it; once the lines are used up, nothing more is shown.
        if (left > 0) rows.push(row)
      } else if (left > 0) {
        rows.push(row)
        left -= 1
      } else more += 1
    }
    return { ...hunk, rows }
  })
  return more === 0 ? { hunks, more } : { hunks: cut, more }
}
