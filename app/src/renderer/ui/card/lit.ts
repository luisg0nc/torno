import { type Mark, markEndParts } from '../../../shared/marks'

/**
 * What the lit rows need to know of a check: its row's id and the part it is about. Task 12's `CheckRow` (a check of the model, or
 * a person's dimension check) has these two to give: pass `{ id: row.id, part: row.part }`. A check of no one part has none.
 */
export interface LitCheck {
  id: string
  part?: string
}

/** The rows of the card that are lit while the pointer is on a part in the view: ids of marks (`M3`) and of checks. */
export interface LitRows {
  marks: Set<string>
  checks: Set<string>
}

/**
 * The rows lit when the pointer is on `part` (null for none): the marks on it (a dimension between two parts is on both, a mark of a
 * scan on none) and its checks. Each such row gets the accent wash and a bar at its left (`data-lit`), instead of a line drawn to
 * it from the view (leader rule 4). `marks` are those of the layout shown.
 */
export function litRows(part: string | null, marks: readonly Mark[], checks: readonly LitCheck[]): LitRows {
  const lit: LitRows = { marks: new Set(), checks: new Set() }
  if (part === null) return lit
  for (const mark of marks) {
    if (mark.kind === 'region') continue
    if (markEndParts(mark).includes(part)) lit.marks.add(mark.id)
  }
  for (const check of checks) if (check.part === part) lit.checks.add(check.id)
  return lit
}

/**
 * The part the pointer is on, from the refs the view lights for it (`peek`, or the face under the pointer): the first ref that is a
 * part of the layout, whole (`airbox-tub`) or by one of its faces and edges (`airbox-tub/F12`). A mark, a set or a stroke is no part.
 */
export function litPart(refs: readonly string[], parts: readonly string[]): string | null {
  for (const ref of refs) {
    if (ref.startsWith('#') || /^M\d+/.test(ref)) continue
    const name = ref.split('/')[0]
    if (parts.includes(name)) return name
  }
  return null
}
