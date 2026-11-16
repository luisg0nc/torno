import { useEffect, useRef, type KeyboardEvent } from 'react'
import { MAX_NAME_CHARS, MAX_TEXT_CHARS } from '../../../shared/board'
import { pressed } from '../../../shared/keys'
import { boardActions, useBoard } from '../../state/board'
import { arrowLine } from './geometry'
import { addCard, addFrame, editCard, wordArrow } from './ops'
import { SizeEditor } from './SizeEditor'

// The field a card's words, a frame's name or the word on an arrow is written in (a size card's form is `SizeEditor`), over the place it is for and in the
// board's own space, so that the camera moves it with the rest. Enter keeps a name or a word, Esc and leaving the field
// keep what was typed (a text card has Enter for a new line); words that are nothing make nothing.

const NAME_WIDTH = 240

export function Editor({ objectId }: { objectId: string }) {
  const editing = useBoard((s) => s.editing)
  const board = useBoard((s) => s.board)
  const field = useRef<HTMLTextAreaElement & HTMLInputElement>(null)
  const done = useRef(false)

  useEffect(() => {
    done.current = false
    const el = field.current
    if (!el) return
    el.focus({ preventScroll: true })
    el.setSelectionRange(el.value.length, el.value.length)
  }, [editing])

  if (!editing || !board) return null
  // A size card has a form of its own: several fields, not one.
  if (editing.kind === 'size') return <SizeEditor key={`size:${editing.id ?? `${editing.x},${editing.y}`}`} objectId={objectId} editing={editing} />

  const card = 'id' in editing && editing.id !== undefined ? board.cards.find((c) => c.id === editing.id) : undefined
  const arrow = editing.kind === 'word' ? board.arrows.find((a) => a.id === editing.id) : undefined
  const ends = arrow ? [board.cards.find((c) => c.id === arrow.from), board.cards.find((c) => c.id === arrow.to)] : []

  let at: { left: number; top: number; width: number; height?: number }
  let initial = ''
  let area = false
  if (editing.kind === 'text') {
    area = true
    initial = card?.text ?? ''
    at = { left: editing.x, top: editing.y, width: editing.w, height: editing.h }
  } else if (editing.kind === 'frame') {
    at = { left: editing.x + 12, top: editing.y + 8, width: Math.min(NAME_WIDTH, Math.max(120, editing.w - 24)) }
  } else if (editing.kind === 'name') {
    if (!card) return null
    initial = card.name ?? ''
    at = { left: card.x + 12, top: card.y + 8, width: Math.min(NAME_WIDTH, Math.max(120, card.w - 24)) }
  } else {
    if (!arrow || !ends[0] || !ends[1]) return null
    initial = arrow.label ?? ''
    const line = arrowLine(ends[0], ends[1])
    at = { left: (line.x1 + line.x2) / 2 - 80, top: (line.y1 + line.y2) / 2 - 14, width: 160 }
  }

  /** Keeps what was typed, once. */
  function keep(value: string): void {
    if (done.current || !editing || editing.kind === 'size') return
    done.current = true
    boardActions.edit(null)
    // A text or a frame is made once, and Select is in hand again.
    if (editing.kind === 'text' || editing.kind === 'frame') boardActions.setTool('select')
    if (editing.kind === 'text') {
      if (editing.id === undefined) {
        if (value.trim() !== '') void addCard(objectId, { kind: 'text', text: value }, { x: editing.x, y: editing.y, w: editing.w, h: editing.h })
      } else if (value !== initial) void editCard(objectId, editing.id, { text: value })
    } else if (editing.kind === 'frame') void addFrame(objectId, { x: editing.x, y: editing.y, w: editing.w, h: editing.h }, value)
    else if (editing.kind === 'name') {
      if (value.trim() !== '' && value.trim() !== initial) void editCard(objectId, editing.id, { name: value.trim() })
    } else void wordArrow(objectId, editing.id, value.trim())
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement | HTMLInputElement>): void {
    e.stopPropagation()
    const value = e.currentTarget.value
    if (pressed(e.nativeEvent, 'board.step')) {
      e.preventDefault()
      keep(value)
    } else if (!area && pressed(e.nativeEvent, 'field.keep')) {
      e.preventDefault()
      keep(value)
    }
  }

  const common = {
    ref: field,
    className: 'pboard-editor',
    'aria-label': editing.kind === 'text' ? 'Words of the card' : editing.kind === 'word' ? 'Word on the arrow' : 'Name of the frame',
    defaultValue: initial,
    // What the board keeps: main refuses more, and a long text would be lost whole.
    maxLength: editing.kind === 'text' ? MAX_TEXT_CHARS : MAX_NAME_CHARS,
    spellCheck: false,
    style: at,
    // A pointer on the field is the field's: it never starts a drag of the board.
    onPointerDown: (e: { stopPropagation: () => void }) => e.stopPropagation(),
    onKeyDown,
    onBlur: (e: { currentTarget: { value: string } }) => keep(e.currentTarget.value)
  }
  // `key` makes a field of its own of each thing written, so that one is never taken for the next.
  const key = `${editing.kind}:${'id' in editing ? (editing.id ?? 'new') : 'new'}:${editing.kind === 'text' || editing.kind === 'frame' ? `${editing.x},${editing.y}` : ''}`
  return area ? <textarea key={key} {...common} /> : <input key={key} type="text" {...common} />
}
