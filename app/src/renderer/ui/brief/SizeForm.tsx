import { useEffect, useRef, useState, type FocusEvent, type KeyboardEvent, type ReactNode } from 'react'
import { pressed } from '../../../shared/keys'
import { AGENT_SOURCE, MAX_SIZE_NOTE, MAX_SIZE_VALUE, MAX_SIZE_WHAT, PERSON_SOURCES, SIZE_UNITS, checkSize, type SizeFact, type SizeSource, type SizeUnit } from '../../../shared/size'
import { chosen, pointerChoice } from '../typing'

// The form of a size, in the ledger: what it measures, the value as typed, the unit, where it came from and a note.
// Enter or Done keeps it when it is whole (and says what is missing when it is not); Esc and Cancel leave it as it was.

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

export function SizeForm({ was, onKeep, onCancel, note }: { was?: SizeFact; onKeep: (size: SizeFact) => void; onCancel: () => void; /** A line under the fields: whose the size is now (#339). */ note?: ReactNode }) {
  const [fields, setFields] = useState<Fields>(() => (was ? { what: was.what, value: was.value, unit: was.unit, source: was.source, note: was.note ?? '' } : FRESH))
  const [help, setHelp] = useState<string | null>(null)
  const first = useRef<HTMLInputElement>(null)
  useEffect(() => first.current?.focus({ preventScroll: true }), [])

  const set = (patch: Partial<Fields>): void => {
    setFields((f) => ({ ...f, ...patch }))
    setHelp(null)
  }

  function keep(): void {
    const size = sizeOf(fields)
    if (typeof size === 'string') return setHelp(size)
    onKeep(size)
  }

  function onKeyDown(e: KeyboardEvent<HTMLElement>): void {
    e.stopPropagation()
    if (pressed(e.nativeEvent, 'field.leave')) {
      e.preventDefault()
      onCancel()
    } else if (pressed(e.nativeEvent, 'field.keep') && e.target instanceof HTMLInputElement) {
      e.preventDefault()
      keep()
    }
  }

  function onBlur(e: FocusEvent<HTMLElement>): void {
    // Moving from one field to another is not leaving; leaving with nothing written is.
    if (e.relatedTarget instanceof Node && e.currentTarget.contains(e.relatedTarget)) return
    if (e.relatedTarget === null && fields.what === '' && fields.value === '' && fields.note === '' && !was) onCancel()
  }

  return (
    <div className="brief-form brief-sizeform" role="group" aria-label="Size" onKeyDown={onKeyDown} onBlur={onBlur}>
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
          {/* A size of Claude's made the person's keeps Claude's source until they say where it came from. */}
          {was?.source === AGENT_SOURCE && (
            <option value={AGENT_SOURCE} disabled>
              {AGENT_SOURCE}: say where it came from
            </option>
          )}
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
        <p className="brief-form-help" role="status">
          {help}
        </p>
      )}
      {note && (
        <p className="brief-form-note">
          <span>{note}</span>
        </p>
      )}
      <div className="brief-form-actions">
        <button type="button" className="button button-quiet" onClick={onCancel}>
          Cancel
        </button>
        <button type="button" className="button" onClick={keep}>
          {was ? 'Done' : 'Add'}
        </button>
      </div>
    </div>
  )
}
