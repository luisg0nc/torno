import { useEffect, useRef, useState, type FocusEvent, type KeyboardEvent } from 'react'
import { pressed } from '../../../shared/keys'
import { MAX_SIZE_NOTE, MAX_SIZE_VALUE, MAX_SIZE_WHAT, PERSON_SOURCES, SIZE_UNITS, checkSize, type SizeFact, type SizeSource, type SizeUnit } from '../../../shared/size'
import { boardActions, type Editing, useBoard } from '../../state/board'
import { chosen, pointerChoice } from '../typing'
import { addCard, editSize } from './ops'

// The form of a size card, over the card's place and in the board's own space: what it measures, the value as typed,
// the unit, where it came from and a note. Enter or Done keeps it when it is whole (and says what is missing when it is
// not); Esc and leaving the form keep it when it is whole and make nothing when it is not, as an empty text does.

interface Fields {
  what: string
  value: string
  unit: SizeUnit
  source: SizeSource
  note: string
}

const FRESH: Fields = { what: '', value: '', unit: 'mm', source: 'measured', note: '' }

/** The fields as the size main takes, or why they are not one. */
export function sizeOf(f: Fields): SizeFact | string {
  return checkSize({ what: f.what, value: f.value, unit: f.unit, source: f.source, ...(f.note === '' ? {} : { note: f.note }) }, 'person')
}

export function SizeEditor({ objectId, editing }: { objectId: string; editing: Extract<Editing, { kind: 'size' }> }) {
  const board = useBoard((s) => s.board)
  const card = editing.id === undefined ? undefined : board?.cards.find((c) => c.id === editing.id)
  const was = card?.size
  const [fields, setFields] = useState<Fields>(() => (was ? { what: was.what, value: was.value, unit: was.unit, source: was.source, note: was.note ?? '' } : FRESH))
  const [help, setHelp] = useState<string | null>(null)
  const done = useRef(false)
  const first = useRef<HTMLInputElement>(null)

  useEffect(() => {
    done.current = false
    first.current?.focus({ preventScroll: true })
  }, [editing])

  if (editing.id !== undefined && !card) return null

  const set = (patch: Partial<Fields>): void => {
    setFields((f) => ({ ...f, ...patch }))
    setHelp(null)
  }

  /** Ends the form, once. `keep`: the size is kept if it is whole; `said`: when it is not, say what is missing instead of closing. */
  function end(keep: boolean, said: boolean): void {
    if (done.current) return
    const size = sizeOf(fields)
    if (keep && typeof size === 'string') {
      if (said) return setHelp(size)
      // Left half-written: nothing is made, and a size that was there stays as it was.
    }
    done.current = true
    boardActions.edit(null)
    if (editing.id === undefined) boardActions.setTool('select')
    if (!keep || typeof size === 'string') return
    if (editing.id === undefined) void addCard(objectId, { kind: 'size', size }, { x: editing.x, y: editing.y, w: editing.w, h: editing.h })
    else if (JSON.stringify(size) !== JSON.stringify(was)) void editSize(objectId, editing.id, size)
  }

  function onKeyDown(e: KeyboardEvent<HTMLElement>): void {
    e.stopPropagation()
    if (pressed(e.nativeEvent, 'board.step')) {
      e.preventDefault()
      end(true, false)
    } else if (pressed(e.nativeEvent, 'field.keep') && e.target instanceof HTMLInputElement) {
      e.preventDefault()
      end(true, true)
    }
  }

  function onBlur(e: FocusEvent<HTMLElement>): void {
    // Moving from one field to another is not leaving.
    if (e.relatedTarget instanceof Node && e.currentTarget.contains(e.relatedTarget)) return
    end(true, false)
  }

  return (
    <div
      className="pboard-sizeform"
      role="group"
      aria-label="Size"
      style={{ left: editing.x, top: editing.y }}
      onPointerDown={(e) => e.stopPropagation()}
      onKeyDown={onKeyDown}
      onBlur={onBlur}
    >
      <label data-wide="">
        What it measures
        <input ref={first} type="text" value={fields.what} maxLength={MAX_SIZE_WHAT} spellCheck autoComplete="off" aria-label="What it measures" onChange={(e) => set({ what: e.target.value })} />
      </label>
      <label>
        Value
        <input className="num" type="text" value={fields.value} maxLength={MAX_SIZE_VALUE} placeholder="186 × 128" spellCheck={false} autoComplete="off" aria-label="Value" onChange={(e) => set({ value: e.target.value })} />
      </label>
      <label>
        Unit
        <select
          className="num"
          value={fields.unit}
          aria-label="Unit"
          {...pointerChoice}
          onChange={(e) => {
            set({ unit: e.target.value as SizeUnit })
            chosen(e.currentTarget)
          }}
        >
          {SIZE_UNITS.map((u) => (
            <option key={u} value={u}>
              {u}
            </option>
          ))}
        </select>
      </label>
      <label data-wide="">
        Where it came from
        <select
          value={fields.source}
          aria-label="Where it came from"
          {...pointerChoice}
          onChange={(e) => {
            set({ source: e.target.value as SizeSource })
            chosen(e.currentTarget)
          }}
        >
          {PERSON_SOURCES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </label>
      <label data-wide="">
        Note
        <input type="text" value={fields.note} maxLength={MAX_SIZE_NOTE} placeholder="A few words more" spellCheck autoComplete="off" aria-label="Note" onChange={(e) => set({ note: e.target.value.replace(/[\r\n]+/g, ' ') })} />
      </label>
      {help !== null && (
        <p className="pboard-sizeform-help" role="status">
          {help}
        </p>
      )}
      <div className="pboard-sizeform-actions">
        <button type="button" className="button button-quiet" onClick={() => end(false, false)}>
          Cancel
        </button>
        <button type="button" className="button" onClick={() => end(true, true)}>
          Done
        </button>
      </div>
    </div>
  )
}
