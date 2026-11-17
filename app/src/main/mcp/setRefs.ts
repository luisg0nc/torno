import type { Mark } from '../../shared/marks'
import { type SetExpansion, isLost, lostText, memberRef, membersOfPart } from '../../shared/sets'
import { messageOf } from './tools'
import type { ToolDeps } from './tools'
import { strokeLine } from '../sketches/text'

// What the tools say of a named set (`#deck`, `block/#deck`): the one place that turns a set into words for the agent.

/** The most members `describe` asks the kernel about: the rest are counted. */
export const MOST_DESCRIBED = 20

/** A refusal about a set of another layout, with how to ask for it: the layout it is of is named. */
export const withLayoutHint = (error: string): string => {
  const of = /^(#\S+) is of layout (.+)$/.exec(error)
  return of ? `${error}: give layout "${of[2]}"` : error
}

/**
 * A set as `describe` tells it: its name, comment, layout, author and whether it is a proposal; each member found by the
 * last build with the kernel's descriptor (20 at most, the rest counted); the members that are lost by their last ref and
 * state, with how many; and each stroke by its sketch and its id with the sketch's own line for it.
 */
export async function setDescribed(deps: ToolDeps, objectId: string, layout: string, expanded: SetExpansion, marks: readonly Mark[], part?: string): Promise<object> {
  const { set } = expanded
  const members = part === undefined ? set.members : membersOfPart(set.members, part)
  const shown = expanded.refs.slice(0, MOST_DESCRIBED)
  const described = await Promise.all(
    shown.map(async (ref) => {
      try {
        const got = await deps.describe(objectId, layout, ref)
        return { ref, kind: got.kind, descriptor: got.descriptor }
      } catch (e) {
        return { ref, error: messageOf(e) }
      }
    })
  )
  const lostMembers = members.filter((m) => isLost(m, marks)).map((m) => ({ ref: memberRef(m), state: 'lost' }))
  const strokes = expanded.strokes.map((ref) => {
    const [sketch, id] = ref.split('/')
    const mark = marks.find((m) => m.id === sketch)
    const stroke = mark?.kind === 'sketch' ? mark.strokes.find((s) => s.id === id) : undefined
    return { ref, sketch, stroke: id, ...(mark?.kind === 'sketch' && stroke ? { line: strokeLine(mark, stroke) } : {}) }
  })
  const lost = lostText({ members }, marks)
  return {
    type: 'named set',
    set: `${part === undefined ? '' : `${part}/`}#${set.slug}`,
    id: set.id,
    name: set.name,
    comment: set.comment,
    layout: set.layout,
    by: set.by,
    ...(set.proposed ? { proposed: true } : {}),
    said: expanded.said,
    members: described,
    ...(expanded.refs.length > shown.length ? { omitted: expanded.refs.length - shown.length, note: `${expanded.refs.length - shown.length} more members are not described here: describe them by their refs, or ask for one part with part/#${set.slug}` } : {}),
    ...(strokes.length > 0 ? { strokes } : {}),
    ...(lost ? { lost, lostMembers } : {})
  }
}
