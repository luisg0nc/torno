import { useEffect, useMemo, useRef, useState } from 'react'
import { useStore as useZustand } from 'zustand'
import { createStore } from 'zustand/vanilla'
import { hint, pressed } from '../../shared/keys'
import { peek } from '../state/agent'
import { actions, store, useStore } from '../state/store'
import { paramFind } from '../state/paramFind'
import { pickerRows, stepPick, type PickerRow } from './pickerRows'
import { TYPING } from './typing'
import { numbered } from './numbered'

/** Whether the picker is up. Asked for by `Ctrl+P`. */
const pickerStore = createStore<{ open: boolean }>(() => ({ open: false }))

/** Put the picker up, away, or the other of the two. */
export function showPicker(open: boolean = !pickerStore.getState().open): void {
  pickerStore.setState({ open })
}

/** `Ctrl+P` outside a field and the terminal brings the picker up, with an object on show that has a part or a value to find. */
export function usePickerKey(): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.defaultPrevented || e.repeat || !pressed(e, 'picker.open')) return
      if (e.target instanceof Element && e.target.closest(TYPING) && !e.target.closest('[data-picker]')) return
      const scene = store.getState().scene
      if (!scene || (scene.parts.length === 0 && (scene.params ?? []).length === 0)) return
      e.preventDefault()
      showPicker()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
}

/** The picker, over the view while it is asked for. */
export function PartPicker() {
  const open = useZustand(pickerStore, (s) => s.open)
  const has = useStore((s) => s.scene !== null)
  return open && has ? <Picker /> : null
}

/**
 * Every part of the layout and every value of the model in one list, found by what is typed: a part by its name or its
 * group's, a value by its name or its comment. Up and Down choose, Enter takes the row (a part is selected and brought into view,
 * a value is shown in the Parameters tab with its control in focus), Alt+Enter shows only the part and Alt+H hides it or
 * shows it again; the pointer on a row lights the part in the view as in the Parts tab. Esc or a click beside it puts it away.
 */
function Picker() {
  const scene = useStore((s) => s.scene)
  const layout = useStore((s) => s.layout)
  const layers = useStore((s) => s.layers)
  const [typed, setTyped] = useState('')
  const [at, setAt] = useState(0)
  const field = useRef<HTMLInputElement>(null)
  const list = useRef<HTMLUListElement>(null)
  const { rows, found, total } = useMemo(() => (scene ? pickerRows(scene, layout, layers, typed) : { rows: [], found: 0, total: 0 }), [scene, layout, layers, typed])
  const chosen: PickerRow | undefined = rows[Math.min(at, rows.length - 1)]

  useEffect(() => {
    const before = document.activeElement
    field.current?.focus()
    return () => {
      peek([])
      const now = document.activeElement
      if (before instanceof HTMLElement && before.isConnected && (now === null || now === document.body || !now.isConnected)) before.focus()
    }
  }, [])
  useEffect(() => {
    list.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' })
  }, [at, rows])

  const take = (row: PickerRow, how: 'go' | 'only' = 'go'): void => {
    showPicker(false)
    if (row.kind === 'part') {
      if (how === 'only') actions.soloLayers(layout, [row.name])
      else actions.setLayer(row.name, { visible: true })
      actions.setSelection([row.name])
      actions.framePart(row.name)
      return
    }
    actions.setBenchTab('params')
    // A find or a chip that hides the value would show nothing: the list is whole for it.
    paramFind.clear()
    const find = (): void => {
      const item = document.querySelector<HTMLElement>(`[data-param="${CSS.escape(row.name)}"]`)
      item?.scrollIntoView({ block: 'center' })
      item?.querySelector<HTMLElement>('input, select, button')?.focus()
    }
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => requestAnimationFrame(find))
    else find()
  }

  return (
    <div
      className="picker-layer"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) showPicker(false)
      }}
    >
      <section
        className="picker"
        role="dialog"
        aria-modal="true"
        aria-label="Find a part or a value"
        data-picker=""
        onBlur={(e) => {
          const to = e.relatedTarget
          if (to instanceof Node ? !e.currentTarget.contains(to) : document.hasFocus() && document.activeElement !== null && !e.currentTarget.contains(document.activeElement)) showPicker(false)
        }}
        onKeyDown={(e) => {
          e.stopPropagation()
          if (pressed(e, 'sheet.close') || pressed(e, 'picker.open')) {
            e.preventDefault()
            showPicker(false)
          } else if (pressed(e, 'picker.next') || pressed(e, 'picker.previous')) {
            e.preventDefault()
            setAt(stepPick(Math.min(at, rows.length - 1), rows.length, pressed(e, 'picker.next') ? 1 : -1))
          } else if (chosen && pressed(e, 'picker.only') && chosen.kind === 'part') {
            e.preventDefault()
            take(chosen, 'only')
          } else if (chosen && pressed(e, 'picker.hide') && chosen.kind === 'part') {
            e.preventDefault()
            actions.setLayer(chosen.name, { visible: chosen.hidden })
          } else if (chosen && pressed(e, 'field.keep')) {
            e.preventDefault()
            take(chosen)
          }
        }}
      >
        <div className="picker-find">
          <input
            ref={field}
            type="text"
            value={typed}
            placeholder="Find a part or a value"
            aria-label="Find a part or a value"
            aria-controls="picker-rows"
            aria-activedescendant={chosen ? `picker-${chosen.kind}-${chosen.name}` : undefined}
            role="combobox"
            aria-expanded="true"
            spellCheck={false}
            autoComplete="off"
            onChange={(e) => {
              setTyped(e.target.value)
              setAt(0)
            }}
          />
          <kbd>{hint('sheet.close')}</kbd>
        </div>
        <ul className="picker-rows" id="picker-rows" role="listbox" ref={list}>
          {rows.map((row, i) => (
            <PickerItem key={`${row.kind}:${row.name}`} row={row} on={row === chosen} lit={(on) => peek(on && row.kind === 'part' ? [row.name] : [])} onTake={() => take(row)} onPoint={() => setAt(i)} />
          ))}
          {rows.length === 0 && <li className="picker-none">{total === 0 ? 'Nothing to find in this model.' : 'No part or value matches.'}</li>}
        </ul>
        <div className="picker-foot">
          <span>
            <kbd>{hint('field.keep')}</kbd> takes it
          </span>
          <span>
            <kbd>{hint('picker.only')}</kbd> shows only
          </span>
          <span>
            <kbd>{hint('picker.hide')}</kbd> hides
          </span>
          <span className="picker-count">{numbered(rows.length < found ? `${rows.length} of ${found}` : `${found} of ${total}`)}</span>
        </div>
      </section>
    </div>
  )
}

function PickerItem({ row, on, lit, onTake, onPoint }: { row: PickerRow; on: boolean; lit: (on: boolean) => void; onTake: () => void; onPoint: () => void }) {
  return (
    <>
      {row.head && (
        <li className="picker-head" role="presentation">
          {row.head}
        </li>
      )}
      <li
        id={`picker-${row.kind}-${row.name}`}
        className="picker-row"
        role="option"
        aria-selected={on}
        data-kind={row.kind}
        data-hidden={row.kind === 'part' && row.hidden ? '' : undefined}
        onPointerEnter={() => {
          onPoint()
          lit(true)
        }}
        onPointerLeave={() => lit(false)}
        onPointerDown={(e) => e.preventDefault()}
        onClick={onTake}
      >
        <span className="picker-name num">{row.name}</span>
        {row.kind === 'part' && row.bought && <span className="picker-note">bought</span>}
        {row.kind === 'part' && row.hidden && <span className="picker-note">hidden</span>}
        {row.kind === 'param' && row.value !== null && <span className="picker-value num">{row.value}</span>}
        {row.kind === 'param' && row.doc && <span className="picker-doc">{row.doc}</span>}
      </li>
    </>
  )
}
