import { useContext, useEffect, useMemo, useRef } from 'react'
import { peek } from '../../state/agent'
import { boardActions, useBoard } from '../../state/board'
import { useSets } from '../../state/sets'
import { actions, useStore } from '../../state/store'
import { giveKeysBack } from '../typing'
import { ChatEarlier } from './place'
import { type RefInfo, refInfo } from './refs'

/**
 * A ref the chat shows (`M4`, `lid/F12`, `r12`) as a chip that is live: the pointer on it lights what it names in
 * the viewport, a click on a mark goes to it, a click on a face or an edge selects it, a click on a card of the board (`C7`) shows the board with it selected, and a click on the build on show opens the sheet of the build after it that failed. One that names nothing
 * in the window now (another layout, a part not drawn, a mark that is gone) says so in its tooltip and does
 * nothing else. `value` is the ref (`ref` is React's own word). `prose`: the ref was found in running text, where one
 * the object has no such thing as (`M3` the screw, a build not made yet) is only text.
 */
export function RefChip({ value, prose = false, of }: { value: string; prose?: boolean; of?: string }) {
  const earlier = useContext(ChatEarlier)
  // Only what a ref depends on is followed (not the selection or the camera), and what it says is worked out again
  // only when one of those changes.
  const marks = useStore((s) => s.marks)
  const scene = useStore((s) => s.scene)
  const layers = useStore((s) => s.layers)
  const layout = useStore((s) => s.layout)
  const revision = useStore((s) => s.revision)
  const build = useStore((s) => s.build)
  // The named sets are followed only by a ref that names one: `#deck` lights its members, and is only text where the project has no such set.
  const isSet = value.includes('#')
  const sets = useSets((s) => (isSet ? s.sets : undefined))
  // A card of the board is followed only by a ref that names one.
  const isCard = /^C\d+$/.test(value)
  const board = useBoard((s) => (isCard ? s.board : null))
  const info: RefInfo = useMemo(() => refInfo({ marks, scene, layers, layout, revision, build, board, sets }, value), [marks, scene, layers, layout, revision, build, board, sets, value])
  const lit = useRef(false)
  const light = (on: boolean): void => {
    if (on === lit.current) return
    lit.current = on
    peek(on ? info.lights : [])
  }
  // A chip that goes while the pointer is on it takes its light with it.
  useEffect(() => () => light(false), [])
  // What it lights follows the state while the pointer is on it.
  useEffect(() => {
    if (lit.current) peek(info.lights)
  }, [info.lights.join(' ')])

  if (prose && info.plain) return <span className="num">{value}</span>
  // A build is told with what it was made from (`of`), and in an earlier part of the conversation with how little its number says now.
  const title = info.kind !== 'build' ? info.title : [info.title, of ? `made from ${of}` : '', earlier ? 'Revisions count from 1 in every run: from an earlier part of this conversation, it may name another build now' : ''].filter(Boolean).join('. ')
  const props = { className: 'ref-chip num', 'data-ref': value, 'data-kind': info.kind, 'data-author': info.author, 'data-live': info.live ? '' : undefined, title }
  if (!info.live || info.act === undefined) return <span {...props}>{value}</span>
  return (
    <button
      type="button"
      {...props}
      onPointerEnter={() => light(true)}
      onPointerLeave={() => light(false)}
      onFocus={() => light(true)}
      onBlur={() => light(false)}
      onClick={(e) => {
        if (info.act === 'focus') actions.focusMark(value)
        else if (info.act === 'build') actions.setErrorOpen(true)
        else if (info.act === 'card') boardActions.reveal(value)
        else if (info.select === undefined || info.select.length > 0) actions.setSelection(info.select ?? (info.lights.length > 0 ? info.lights : [value]))
        // Made with the pointer, the next letter is the view's: what the chip did, it did to the view. (Enter on it keeps the focus.)
        if (e.detail > 0) giveKeysBack(e.currentTarget)
      }}
    >
      {value}
    </button>
  )
}
