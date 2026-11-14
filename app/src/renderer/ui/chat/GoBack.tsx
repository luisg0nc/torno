import { useContext, useState } from 'react'
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

/** What the plan says it will do, one line each, for the confirmation. Nothing is said of a thing the plan does not do. */
export function planLines(plan: GoBackPlan, numbers: Map<string, number>, number: number): string[] {
  if (plan.fallback) return [FALLBACK_SAID]
  const lines = [`Puts the files back as they were at ${plan.to}, before prompt ${number}.`]
  if (plan.write.length > 0) lines.push(`Writes: ${plan.write.join(', ')}`)
  if (plan.remove.length > 0) lines.push(`Deletes, made by the prompts it undoes: ${plan.remove.join(', ')}`)
  if (plan.write.length === 0 && plan.remove.length === 0) lines.push('The files are already as they were then.')
  if (plan.changedSince.length > 0) lines.push(`You changed these since, and they are overwritten: ${plan.changedSince.join(', ')}`)
  if (plan.leftAlone.length > 0) lines.push(`Left as they are, not of this project: ${plan.leftAlone.join(', ')}`)
  if (plan.params) lines.push('Your tried Params are put back as they were for that build.')
  if (plan.prompts.length > 0) lines.push(`Undoes ${promptsSaid(plan.prompts, numbers).join('; ')}`)
  return lines
}

/** The first thing a Go back could not do, or why it did nothing, in words. */
export const resultSaid = (r: GoBackResult): string | null => (r.refused ? r.refused : r.failed ? `${r.failed.file}: ${r.failed.why}${r.done.length > 0 ? ` (written before: ${r.done.join(', ')})` : ''}` : null)

type State = { at: 'idle' } | { at: 'asking' } | { at: 'confirm'; plan: GoBackPlan } | { at: 'going'; plan: GoBackPlan } | { at: 'said'; text: string }

/**
 * "Go back to before this prompt": reads what it would do (`history.goBackPlan`), asks once with all of it listed (the files it
 * writes and deletes, those it leaves, those the person changed since, the Params, the prompts undone), then puts the files back
 * (`history.goBack`). With no copy to restore the plan says so and the same button asks Claude to undo instead (`chat.undo`).
 * Not while Claude works. What is written is main's to work out: the window only sends back what it was shown.
 */
export function GoBack({ turnId, joined, undoable }: { turnId: string; joined: JoinedTurn | undefined; undoable: boolean }) {
  const objectId = useStore((s) => s.objectId)
  const sessionId = useContext(AskSession)
  const idle = useContext(ChatIdle)
  const numbers = useContext(PromptNumbers)
  const [state, setState] = useState<State>({ at: 'idle' })
  const number = joined?.number ?? 0
  if (objectId === null) return null
  const built = (joined?.entries.length ?? 0) > 0
  // A build that was not kept leaves only the undo of the last turn.
  if (!built && !undoable) return null
  if (built && joined!.entries.every((e) => e.undone)) return <span className="chat-turn-problem">You went back from this prompt</span>

  const say = (text: string): void => setState({ at: 'said', text })
  const ask = async (): Promise<void> => {
    if (!joined || !built) return setState({ at: 'confirm', plan: { to: '', write: [], remove: [], leftAlone: [], changedSince: [], params: false, undone: [], prompts: [], fallback: 'undo' } })
    setState({ at: 'asking' })
    try {
      const plan = await window.torno.history.goBackPlan(objectId, joined.promptId)
      if ('refused' in plan) say(plan.refused)
      else setState({ at: 'confirm', plan })
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

  if (state.at === 'confirm') {
    const { plan } = state
    return (
      <Confirm label="Go back to before this prompt" accept={plan.fallback ? 'Ask Claude' : 'Go back'} cancel="Cancel" onAccept={() => void accept(plan)} onCancel={() => setState({ at: 'idle' })}>
        {planLines(plan, numbers, number).map((line) => (
          <span key={line} className="goback-line">
            {numbered(line)}
          </span>
        ))}
      </Confirm>
    )
  }
  const busy = state.at === 'asking' || state.at === 'going'
  return (
    <>
      <button type="button" className="button button-quiet" disabled={!idle || busy} title={idle ? undefined : 'Wait for Claude to finish'} onClick={() => void ask()}>
        {state.at === 'going' ? 'Going back…' : 'Go back to before this prompt'}
      </button>
      {state.at === 'said' && (
        <span className="chat-turn-problem" role="alert">
          {numbered(state.text)}
        </span>
      )}
    </>
  )
}
