import { type MemberAsk, type NamedSet, type SelectorFound, MOST_SET_MEMBERS, STROKE_REF, finiteVec3, memberRef, parseSetRef, setNameError, slugOf, strokeLive } from '../../shared/sets'
import { kindsText } from '../sets/text'
import { checkedRefs } from './markTools'
import type { AddSetArgs } from './schemas'
import { type ToolDeps, type ToolResult, built, failure, layoutFor, marksOf, messageOf } from './tools'

// `add_set`: Claude proposes a named set. The refs are checked as every tool checks them (a tag or a set stands for its
// members), the kernel is asked where each face and edge is before anything is written, so that no member is held at a
// placeholder, and the set is made as the agent's: a proposal, which only the person accepts (`SetStore.make`, `accept`).
// Nothing here accepts, edits or removes a set.

/** Said of a call that asks for no refs. */
const NO_SET_REFS = 'give refs: the faces (block/F12), edges (block/E3), parts (block), tags (lid/@top), sets (#deck) and sketch strokes (M7/k3) the set is to hold'

export async function addSetTool(deps: ToolDeps, objectId: string, args: AddSetArgs): Promise<ToolResult> {
  const store = deps.setStore
  if (!store) return failure('named sets are not available here')
  const found = built(deps, objectId)
  if ('content' in found) return found
  const layout = layoutFor(deps, objectId, found.scene, args.layout)
  if (typeof layout !== 'string') return layout

  if (typeof args.name !== 'string') return failure('A named set needs a name.')
  const nameError = setNameError(args.name, [])
  if (nameError) return failure(nameError)
  if (args.comment !== undefined && typeof args.comment !== 'string') return failure('The comment of a named set is text.')
  if (!Array.isArray(args.refs) || args.refs.length === 0 || !args.refs.every((r) => typeof r === 'string' && r !== '')) return failure(NO_SET_REFS)
  if (args.refs.length > MOST_SET_MEMBERS) return failure(`A named set holds at most ${MOST_SET_MEMBERS} members, and this has ${args.refs.length} refs: name fewer`)
  let existing: NamedSet[] = []
  try {
    existing = (await deps.sets?.(objectId)) ?? []
  } catch (e) {
    return failure(messageOf(e))
  }
  const slug = slugOf(args.name)
  const clash = existing.find((s) => s.slug === slug)
  if (clash) return failure(`#${clash.slug} is taken (${clash.id})`)

  // The strokes are the marks' to say; everything else is a ref of the layout's parts, a tag, a set or a mark's number.
  const marks = await marksOf(deps, objectId)
  if ('content' in marks) return marks
  const strokes: string[] = []
  const rest: string[] = []
  const gone: string[] = []
  for (const ref of args.refs) {
    if (!STROKE_REF.test(ref)) rest.push(ref)
    else if (!strokeLive(ref, marks)) gone.push(ref)
    else if (!strokes.includes(ref)) strokes.push(ref)
  }
  if (gone.length > 0) return failure(`nothing was proposed: ${gone.join(', ')} ${gone.length === 1 ? 'is' : 'are'} no stroke of a sketch of this project (marks lists the sketches, and a stroke is M<n>/k<i>)`)
  const out = { strokes, said: [] as string[] }
  const refs = rest.length === 0 ? [] : await checkedRefs(deps, objectId, found, layout, rest, 'proposed', out)
  if (!Array.isArray(refs)) return refs
  if (refs.length + strokes.length === 0) return failure(NO_SET_REFS)
  if (refs.length + strokes.length > MOST_SET_MEMBERS) return failure(`A named set holds at most ${MOST_SET_MEMBERS} members, and these refs make ${refs.length + strokes.length}: name fewer`)

  // The kernel says where each face and edge is, a part at a time, before the set is written: a set that cannot be told
  // where its faces are is refused rather than kept held at a guess.
  const byPart = new Map<string, string[]>()
  for (const ref of refs) {
    const parsed = parseSetRef(ref)
    if (parsed && parsed.kind !== 'part') byPart.set(parsed.part, [...(byPart.get(parsed.part) ?? []), ref])
  }
  const answers: SelectorFound[] = []
  for (const [part, asked] of byPart) {
    try {
      const reply = await deps.query<{ selectors?: SelectorFound[] }>(objectId, 'selectors', { layout, refs: asked })
      if (!Array.isArray(reply?.selectors)) throw new Error('the kernel did not answer')
      answers.push(...reply.selectors)
    } catch (e) {
      return failure(`nothing was proposed: the kernel could not say where the faces and edges of ${part} are (${messageOf(e)}); ask again in a moment`)
    }
  }
  const members: MemberAsk[] = []
  const lacking: string[] = []
  for (const ref of refs) {
    const parsed = parseSetRef(ref)
    if (parsed?.kind === 'part') {
      members.push({ ref })
      continue
    }
    const answer = answers.find((a) => a?.ref === ref)
    const point = finiteVec3(answer?.center)
    if (!answer || point === null || typeof answer.type !== 'string') {
      lacking.push(`${ref}${typeof answer?.selectorWhy === 'string' ? ` (${answer.selectorWhy})` : ''}`)
      continue
    }
    const normal = parsed?.kind === 'face' ? finiteVec3(answer.normal) : null
    members.push({ ref, point, ...(normal ? { normal } : {}) })
  }
  if (lacking.length > 0) return failure(`nothing was proposed: the kernel gave no place for ${lacking.join(', ')}`)
  for (const stroke of strokes) members.push({ stroke })

  let set: NamedSet
  try {
    set = await store.make(objectId, { name: args.name, comment: args.comment ?? '', layout, members }, 'agent', found.revision)
    // The second change: types and selector forms. A build that landed meanwhile drops it, and the members are found by place.
    set = (await store.withSelectors(objectId, set.id, found.revision, answers).catch(() => null)) ?? set
  } catch (e) {
    return failure(messageOf(e))
  }
  const ref = `#${set.slug}`
  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify({
          set: ref,
          id: set.id,
          proposed: true,
          members: set.members.map(memberRef),
          reading: `Proposed ${ref} (${set.id}): ${kindsText(set.members)}. The person sees it dashed and accepts or dismisses it; you may use ${ref} meanwhile.`
        })
      }
    ]
  }
}
