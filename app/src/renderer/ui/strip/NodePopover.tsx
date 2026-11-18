import { useEffect, useState, type ReactNode } from 'react'
import type { HistoryEntry } from '../../../shared/history'
import { openRoundNow, reviewActions, useReview } from '../../state/review'
import { actions, explodeNow, runningSession, store, useStore } from '../../state/store'
import { BuildErrorSheet } from '../BuildErrorSheet'
import { useGoBack } from '../chat/GoBack'
import type { JoinedTurn } from '../chat/historyJoin'
import { ChatIdle, PromptNumbers } from '../chat/turnContext'
import { numbered } from '../numbered'
import { pinToBoard } from '../projectBoard/pin'
import { Popover } from '../Popover'
import { useMenu } from '../useMenu'
import { NODE_ACT_WORDS, goBackTarget, nodeMenu, type NodeAct } from './nodeMenu'
import type { StripNode } from './strip'
import { useStripNodes } from './useStripNodes'

/** How long what a Pin says stays up. */
const SAID_MS = 4000

/** The sentence that stands from a node: what came of a Pin, or what Go back could not do. */
function Said({ anchor, text, onClose }: { anchor: HTMLElement; text: ReactNode; onClose: () => void }) {
  return (
    <Popover anchor={anchor} width={260} className="node-said" role="status" aria-label="Build" onClose={onClose}>
      <p className="node-said-text">{text}</p>
      <button type="button" className="button button-quiet" onClick={onClose}>
        Close
      </button>
    </Popover>
  )
}

/** The menu of a build that drew: its acts (`nodeMenu`), and the question of Go back, which stands from the node when it is asked. */
function BuiltMenu({ node, anchor, onClose }: { node: StripNode; anchor: HTMLElement; onClose: () => void }) {
  const { nodes, entries, numbering } = useStripNodes()
  const objectId = useStore((s) => s.objectId)
  const buildOk = useStore((s) => s.build?.status === 'ok')
  const opened = useReview((s) => openRoundNow(s) !== undefined)
  const live = nodes.find((n) => n.onShow)
  const comparing = useStore((s) => s.compare !== null && s.compare.from === node.id)
  const blocked = useStore((s) => (s.section !== null ? 'Take the section away first: an earlier build is not drawn cut.' : explodeNow(s) !== null ? 'Put the parts together first: an earlier build is not drawn apart.' : null))

  const history = [...entries.values()]
  const target = goBackTarget(history, node.id)
  const joined: JoinedTurn | undefined = target === null ? undefined : { promptId: target, number: numbering.get(target) ?? 0, entries: history.filter((e: HistoryEntry) => e.turn?.prompt === target) }
  const acts = nodeMenu(node, { canReview: node.onShow && buildOk && !opened, goBackTo: target })

  const { shown, setShown, button, menu, onKeyDown } = useMenu(0, true)
  button.current = anchor as HTMLButtonElement
  const [phase, setPhase] = useState<'menu' | 'goback' | 'said'>('menu')
  const [said, setSaid] = useState<string | null>(null)
  const back = useGoBack({ turnId: '', joined, undoable: false, anchor })

  // The menu put away (Escape, a press outside) is the end of it, unless a question or a sentence took its place.
  useEffect(() => {
    if (!shown && phase === 'menu') onClose()
  }, [shown, phase, onClose])
  // Asked and answered: the question is gone, and the sentence of what came of it with it.
  useEffect(() => {
    if (phase === 'goback' && back.step === 'idle') onClose()
  }, [phase, back.step, onClose])
  useEffect(() => {
    if (said === null) return
    const timer = setTimeout(onClose, SAID_MS)
    return () => clearTimeout(timer)
  }, [said, onClose])

  const done = (act: NodeAct): void => {
    if (objectId === null) return onClose()
    switch (act) {
      case 'compare':
        if (comparing) actions.endCompare()
        else if (live) actions.compare(node.id, live.id)
        return onClose()
      case 'star':
      case 'unstar':
        void window.torno.history.star(objectId, node.id, act === 'star')
        return onClose()
      case 'review':
        void reviewActions.start(store.getState().layout)
        return onClose()
      case 'pin':
        setShown(false)
        setPhase('said')
        void pinToBoard(objectId, { kind: 'build', id: node.id }).then((how) => setSaid(`${node.id}: ${how.charAt(0).toLowerCase()}${how.slice(1)}`))
        return
      case 'goback':
        setPhase('goback')
        setShown(false)
        return back.ask()
    }
  }
  const noLive = !node.onShow && !live
  const words = (act: NodeAct): string => (act === 'compare' && comparing ? 'Stop comparing' : NODE_ACT_WORDS[act])
  const off = (act: NodeAct): string | undefined => {
    if (act === 'compare') return !comparing && blocked !== null ? blocked : noLive ? 'No build is on show to compare it with' : undefined
    if (act === 'goback') return back.disabled ? (back.title ?? 'Wait') : undefined
    return undefined
  }
  const title = (act: NodeAct): string | undefined => {
    switch (act) {
      case 'compare':
        return off(act) ?? (comparing ? 'Back to the live build' : `Draw ${node.id} over ${live?.id ?? 'the live build'} in the view`)
      case 'star':
        return `Keep ${node.id}: a starred build is never let go`
      case 'unstar':
        return `${node.id} is kept: take the star away`
      case 'pin':
        return 'A card for this build on the board, which stars it'
      case 'review':
        return 'Start a round on this build: mark what you don\'t want and what you want'
      case 'goback':
        return back.disabled ? (back.title ?? undefined) : `Put the files back as they were at ${node.id}, before the prompt that came after it`
    }
  }

  return (
    <>
      {phase === 'menu' && shown && (
        <Popover anchor={anchor} width={210} role="presentation" className="node-menu" onClose={() => setShown(false)}>
          <div ref={menu} className="node-menu-list" role="menu" aria-label={`Build ${node.id}`} onKeyDown={onKeyDown}>
            {acts.map((act) => (
              <button key={act} type="button" role="menuitem" className="menu-item" disabled={off(act) !== undefined} title={title(act)} onClick={() => done(act)}>
                {words(act)}
              </button>
            ))}
          </div>
        </Popover>
      )}
      {phase === 'goback' && (back.step === 'said' || back.step === 'unavailable') ? <Said anchor={anchor} text={back.panel} onClose={back.dismiss} /> : phase === 'goback' ? back.panel : null}
      {phase === 'said' && said !== null && <Said anchor={anchor} text={numbered(said)} onClose={onClose} />}
    </>
  )
}

/**
 * What a click on a node of the builds strip opens (spec 2026-11-18, section 2): the menu of a build that drew, or the error of
 * a build that failed and is not the latest one (the latest one's is the status line's too, `BuildErrorSheet` in `BuildStatus`,
 * and the strip toggles it). Go back asks as the turn's own does (`useGoBack`), from the node.
 */
export function NodePopover({ node, anchor, onClose }: { node: StripNode; anchor: HTMLElement; onClose: () => void }) {
  const { entries, numbering } = useStripNodes()
  const name = useStore((s) => s.workspace?.objects.find((o) => o.id === s.objectId)?.name ?? s.objectId ?? '')
  // Not while Claude works: `useGoBack` reads that, and the numbers of the prompts it names, from the chat's context, and the strip is not in the chat.
  const working = useStore((s) => {
    const status = runningSession(s)?.status
    return status === 'working' || status === 'needs_input'
  })
  if (node.kind === 'built') {
    return (
      <PromptNumbers.Provider value={numbering}>
        <ChatIdle.Provider value={!working}>
          <BuiltMenu node={node} anchor={anchor} onClose={onClose} />
        </ChatIdle.Provider>
      </PromptNumbers.Provider>
    )
  }
  if (node.kind === 'failed') {
    const line = entries.get(node.id)?.error
    return <BuildErrorSheet objectName={name} error={{ kind: 'exception', message: line ?? 'The build failed' }} after={node.after} old anchor={anchor} onClose={onClose} />
  }
  return null
}
