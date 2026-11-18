import { useContext, useState, type ReactNode } from 'react'
import type { BuildTurn, GoBackPlan, GoBackResult } from '../../../shared/history'
import { useStore } from '../../state/store'
import { Confirm } from '../Confirm'
import { numbered } from '../numbered'
import { AskSession } from './AskCard'
import type { JoinedTurn } from './historyJoin'
import { ChatIdle, PromptNumbers } from './turnContext'

/** What Claude is asked, in the confirmation, when no copy of the build is kept to put back. */
export const FALLBACK_SAID = 'Claude will be asked to put the files back instead.'

const MOST_PROMPTS = 4

const clip = (text: string | undefined): string => (text ? (text.length > 60 ? `${text.slice(0, 60)}…` : text) : '')

/** The prompts a Go back undoes, as `prompt 14 "make it taller"`, the first few of them. */
export function promptsSaid(prompts: readonly BuildTurn[], numbers: Map<string, number>): string[] {
  const said = prompts.slice(0, MOST_PROMPTS).map((p) => {
    const n = numbers.get(p.prompt)
    const text = clip(p.text)
    return `${n !== undefined ? `prompt ${n}` : 'a prompt'}${text ? ` “${text}”` : ''}`
  })
  return prompts.length > MOST_PROMPTS ? [...said, `${prompts.length - MOST_PROMPTS} more`] : said
}

/** What is said when there is no copy to put back and Claude cannot be asked to undo the prompt either. */
export const UNAVAILABLE_SAID = 'No copy of that build is kept to put back, and Claude cannot be asked to undo it from here.'

/** What the plan says it will do, one line each, for the confirmation. Nothing is said of a thing the plan does not do. */
export function planLines(plan: GoBackPlan, numbers: Map<string, number>, number: number): string[] {
  if (plan.fallback) return [FALLBACK_SAID]
  const lines = [`Puts the files back as they were at ${plan.to}, before prompt ${number}.`]
  if (plan.write.length > 0) lines.push(`Writes: ${plan.write.join(', ')}`)
  if (plan.remove.length > 0) lines.push(`Deletes, first seen after that build: ${plan.remove.join(', ')}`)
  if (plan.write.length === 0 && plan.remove.length === 0) lines.push('The files are already as they were then.')
  if (plan.changedSince.length > 0) lines.push(`You changed these since, and they are overwritten or deleted: ${plan.changedSince.join(', ')}`)
  if (plan.leftAlone.length > 0) lines.push(`Left as they are, not of this project: ${plan.leftAlone.join(', ')}`)
  if (plan.params) lines.push('Your tried Params are put back as they were for that build.')
  const saves = plan.undoneSaves.length > 0 ? `your saves ${plan.undoneSaves.join(', ')}` : ''
  if (plan.prompts.length > 0) lines.push(`Undoes ${promptsSaid(plan.prompts, numbers).join('; ')}${saves ? ` and ${saves}` : ''}`)
  else if (saves) lines.push(`Undoes ${saves}`)
  return lines
}

/**
 * What follows the plan main gave: the question; or, with no build to go back to or no copy of it, asking Claude to undo
 * (only the last turn of a live chat can be, `undoable`); or nothing to offer.
 */
export function afterPlan(plan: GoBackPlan | { refused: string }, undoable: boolean): { at: 'confirm'; plan: GoBackPlan } | { at: 'unavailable' } | { at: 'said'; text: string } {
  if ('refused' in plan) return undoable ? { at: 'confirm', plan: NO_COPY } : { at: 'said', text: plan.refused }
  if (plan.fallback && !undoable) return { at: 'unavailable' }
  return { at: 'confirm', plan }
}

/** The first thing a Go back could not do, or why it did nothing, in words. */
export const resultSaid = (r: GoBackResult): string | null => (r.refused ? r.refused : r.failed ? `${r.failed.file}: ${r.failed.why}${r.done.length > 0 ? ` (written before: ${r.done.join(', ')})` : ''}` : null)

/** What there is to confirm when only Claude can be asked to undo. */
const NO_COPY: GoBackPlan = { to: '', write: [], remove: [], leftAlone: [], changedSince: [], params: false, undone: [], undoneSaves: [], prompts: [], fallback: 'undo' }

type State = { at: 'idle' } | { at: 'unavailable' } | { at: 'asking' } | { at: 'confirm'; plan: GoBackPlan } | { at: 'going'; plan: GoBackPlan } | { at: 'said'; text: string }

/** What `useGoBack` gives the place that offers Go back: whether to offer it, what the offer is, and the question and the words that follow it. */
export interface GoBackOffer {
  /** Whether there is anything to offer: a build of the prompt, or the last turn of a live chat to ask Claude to undo. */
  offered: boolean
  /** The label of the offer, which says it is working while it works. */
  label: string
  disabled: boolean
  title: string | undefined
  ask: () => void
  /** What stands from the offer: the question with the plan, or what came of it. Drawn once, wherever the offer is. */
  panel: ReactNode
}

/**
 * "Go back to before this prompt": reads what it would do (`history.goBackPlan`), asks once with all of it listed (the files it
 * writes and deletes, those it leaves, those the person changed since, the Params, the prompts undone), then puts the files back
 * (`history.goBack`). With no copy to restore the plan says so and the same offer asks Claude to undo instead (`chat.undo`).
 * Not while Claude works. What is written is main's to work out: the window only sends back what it was shown. The question
 * stands from `anchor` (the button that opened the menu the offer is in, which is gone by then), or from the element that asked.
 */
export function useGoBack({ turnId, joined, undoable, anchor }: { turnId: string; joined: JoinedTurn | undefined; undoable: boolean; anchor?: HTMLElement | null }): GoBackOffer {
  const objectId = useStore((s) => s.objectId)
  const sessionId = useContext(AskSession)
  const idle = useContext(ChatIdle)
  const numbers = useContext(PromptNumbers)
  const [state, setState] = useState<State>({ at: 'idle' })
  const number = joined?.number ?? 0
  const built = (joined?.entries.length ?? 0) > 0
  const gone = built && joined!.entries.every((e) => e.undone)
  const none = { offered: false, label: '', disabled: true, title: undefined, ask: () => undefined, panel: null }
  // A build that was not kept leaves only the undo of the last turn.
  if (objectId === null || (!built && !undoable)) return none
  if (gone) return { ...none, panel: <span className="chat-turn-problem">You went back from this prompt</span> }

  const say = (text: string): void => setState({ at: 'said', text })
  const ask = async (): Promise<void> => {
    if (!joined || !built) return setState({ at: 'confirm', plan: NO_COPY })
    setState({ at: 'asking' })
    try {
      const plan = await window.torno.history.goBackPlan(objectId, joined.promptId)
      setState(afterPlan(plan, undoable))
    } catch (e) {
      say(e instanceof Error ? e.message : String(e))
    }
  }
  const accept = async (plan: GoBackPlan): Promise<void> => {
    setState({ at: 'going', plan })
    try {
      if (plan.fallback) {
        if (!sessionId) return say('This session has ended.')
        await window.torno.chat.undo(sessionId, turnId)
        return setState({ at: 'idle' })
      }
      const result = await window.torno.history.goBack(objectId, joined!.promptId, { to: plan.to, write: plan.write, remove: plan.remove })
      const problem = resultSaid(result)
      setState(problem ? { at: 'said', text: problem } : { at: 'idle' })
    } catch (e) {
      say(e instanceof Error ? e.message : String(e))
    }
  }

  let panel: ReactNode = null
  if (state.at === 'confirm') {
    const { plan } = state
    panel = (
      <Confirm label="Go back to before this prompt" accept={plan.fallback ? 'Ask Claude' : 'Go back'} cancel="Cancel" anchor={anchor} onAccept={() => void accept(plan)} onCancel={() => setState({ at: 'idle' })}>
        {planLines(plan, numbers, number).map((line) => (
          <span key={line} className="goback-line">
            {numbered(line)}
          </span>
        ))}
      </Confirm>
    )
  } else if (state.at === 'unavailable') {
    // No copy and no undo: nothing to offer but the sentence (the spec's "neither available").
    panel = <span className="chat-turn-problem">{UNAVAILABLE_SAID}</span>
  } else if (state.at === 'said') {
    panel = (
      <span className="chat-turn-problem" role="alert">
        {numbered(state.text)}
      </span>
    )
  }
  const busy = state.at === 'asking' || state.at === 'going'
  return { offered: state.at !== 'unavailable', label: state.at === 'going' ? 'Going back…' : 'Go back to before this prompt', disabled: !idle || busy, title: idle ? undefined : 'Wait for Claude to finish', ask: () => void ask(), panel }
}

/** "Go back to before this prompt" as a button of its own, with its question. */
export function GoBack(props: { turnId: string; joined: JoinedTurn | undefined; undoable: boolean }) {
  const offer = useGoBack(props)
  return (
    <>
      {offer.offered && (
        <button type="button" className="button button-quiet" disabled={offer.disabled} title={offer.title} onClick={offer.ask}>
          {offer.label}
        </button>
      )}
      {offer.panel}
    </>
  )
}
