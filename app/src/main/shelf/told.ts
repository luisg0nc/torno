import { assumedCount, holeText, type ShelfPart } from '../../shared/shelf'

/** The most characters of the shelf's line a new conversation is told; the parts that do not fit are counted. */
export const SHELF_LIMIT = 600

/** What a part says of itself in a line: its hole and how many of its sizes are assumed, each left out when there is none. */
function partLine(part: ShelfPart): string {
  if (part.error) return `${part.id}: does not build`
  const assumed = assumedCount(part)
  const said = [holeText(part), assumed > 0 ? `${assumed} ${assumed === 1 ? 'size' : 'sizes'} assumed` : ''].filter(Boolean).join(', ')
  return said ? `${part.id}: ${said}` : part.id
}

/**
 * The line that tells a new conversation what is on the parts shelf (`common/parts/`), or '' when nothing is: a head that
 * says to use a part before researching one, then a line a part, as many as fit in SHELF_LIMIT, and the rest counted
 * (`and 4 more`). Claude is told no more of a part than this; it reads the folder for the rest.
 */
export function shelfLine(parts: readonly ShelfPart[]): string {
  if (parts.length === 0) return ''
  const head = `On the shelf, common/parts/ (${parts.length} ${parts.length === 1 ? 'part' : 'parts'}; use one before researching it, and say which sizes are assumed):`
  const lines = parts.map(partLine)
  const more = (left: number): string => `and ${left} more`
  let used = head.length
  let listed = 0
  for (const line of lines) {
    const left = lines.length - listed - 1
    // This line must fit with the count of the rest after it, unless it is the last and there is no rest.
    if (used + 1 + line.length + (left > 0 ? 1 + more(left).length : 0) > SHELF_LIMIT) break
    used += 1 + line.length
    listed++
  }
  const rest = lines.length - listed
  return [head, ...lines.slice(0, listed), ...(rest > 0 ? [more(rest)] : [])].join('\n')
}
