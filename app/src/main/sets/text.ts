import type { Mark } from '../../shared/marks'
import { type NamedSet, type SetMember, lostText, memberRef } from '../../shared/sets'

// What the agent is told of the named sets, in `scene` and in `state.md`: one function for what there is to say, so that the
// two cannot differ. A ref of a set is `#` and its slug.

/** The most members of one set that are listed; the rest are counted. */
export const MOST_LISTED_MEMBERS = 50

/** What `scene` says of one set. */
export interface SetListed {
  ref: string
  id: string
  name: string
  comment: string
  layout: string
  by: 'person' | 'agent'
  /** Only of a proposal: it is the agent's, and the person has not accepted it. */
  proposed?: true
  /** By ref: `block/F12`, `block`, `M7/k3`. */
  members: string[]
  /** How many members are not listed. */
  membersOmitted?: number
  /** `2 of 5 faces lost`: a count of members the last build did not find, not a measure. */
  lost?: string
  /** Said when the set has not been refound against the last build: its refs are of an earlier one. */
  stale?: string
}

/** Why the refs of the sets may be of an earlier build: the sets were refound against `refound`, and the last build is `revision`. */
export function staleText(revision: number, refound: number | undefined): string | undefined {
  return refound === undefined || refound < revision ? `not refound against r${revision} yet` : undefined
}

/**
 * The sets as `scene` lists them, with every layout. `marks` say which strokes are still there, `revision` is the last build
 * and `refound` the build the sets were last refound against (undefined: none since torno opened the project).
 */
export function setsListed(sets: readonly NamedSet[], marks: readonly Mark[], revision: number, refound: number | undefined): SetListed[] {
  const stale = staleText(revision, refound)
  return sets.map((set) => {
    const refs = set.members.map(memberRef)
    const lost = lostText(set, marks)
    // A set of strokes alone is judged by the marks, which are not a build's.
    const built = set.members.some((m) => !('stroke' in m))
    return {
      ref: `#${set.slug}`,
      id: set.id,
      name: set.name,
      comment: set.comment,
      layout: set.layout,
      by: set.by,
      ...(set.proposed === true ? { proposed: true as const } : {}),
      members: refs.slice(0, MOST_LISTED_MEMBERS),
      ...(refs.length > MOST_LISTED_MEMBERS ? { membersOmitted: refs.length - MOST_LISTED_MEMBERS } : {}),
      ...(lost ? { lost } : {}),
      ...(stale && built ? { stale } : {})
    }
  })
}

/** The same in lines, for the state file: one line a set. Empty text when there are no sets. */
export function setsText(sets: readonly NamedSet[], marks: readonly Mark[], revision: number, refound?: number): string {
  return setsListed(sets, marks, revision, refound)
    .map((set) => {
      const proposed = set.proposed ? ', proposed by the agent, not accepted' : ''
      const members = `${set.members.join(', ') || 'no members'}${set.membersOmitted ? ` and ${set.membersOmitted} more` : ''}`
      const comment = set.comment.replace(/\s+/g, ' ').trim()
      const said = [members, set.lost, set.stale, comment === '' ? undefined : `"${comment}"`].filter((s) => s !== undefined)
      return `- ${set.ref} (${set.id}, layout ${set.layout}${proposed}): ${said.join('; ')}`
    })
    .join('\n')
}

const NOUNS = { face: ['face', 'faces'], edge: ['edge', 'edges'], part: ['part', 'parts'], stroke: ['stroke', 'strokes'] } as const

/** What a set holds, by kind and in order, as `3 faces` or `1 face, 1 edge, 1 part, 1 stroke`. */
export function kindsText(members: readonly SetMember[]): string {
  const count = { face: 0, edge: 0, part: 0, stroke: 0 }
  for (const m of members) count['face' in m ? 'face' : 'edge' in m ? 'edge' : 'stroke' in m ? 'stroke' : 'part'] += 1
  const said = (Object.keys(NOUNS) as Array<keyof typeof NOUNS>).filter((k) => count[k] > 0).map((k) => `${count[k]} ${NOUNS[k][count[k] === 1 ? 0 : 1]}`)
  return said.join(', ') || 'nothing'
}
