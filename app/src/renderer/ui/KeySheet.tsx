import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { useStore as useZustand } from 'zustand'
import { createStore } from 'zustand/vanilla'
import { contextOf, drawnKeyboard, PLACES } from '../../shared/keyboard'
import { capsFor, matchRows, pointerSentence, sentencesFor, type Piece } from '../../shared/keySentences'
import { capsOf, cheatSheet, hint, pressed } from '../../shared/keys'
import { POINTER, POINTER_GROUP, type PointerRow } from '../../shared/pointer'
import { numbered } from './numbered'
import { TYPING } from './typing'

/** Whether the sheet of keys is up. It is asked for by `?`, and by the button at the foot of the tools. */
const sheetStore = createStore<{ open: boolean }>(() => ({ open: false }))

/** Show the sheet of keys, put it away, or the other of the two. */
export function showKeys(open: boolean = !sheetStore.getState().open): void {
  sheetStore.setState({ open })
}

/**
 * `?` outside any field and the terminal brings the sheet up, from the first screen as from an object or the
 * page of objects. Put away, it is the sheet's own doing: while it is up the focus is in its field.
 */
export function useKeysKey(): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.defaultPrevented || e.repeat || !pressed(e, 'keys')) return
      if (e.target instanceof Element && e.target.closest(TYPING)) return
      showKeys()
      e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
}

/** The rows of the pointer's group that say all of what was typed, as the keys' do. They are no keys: the count at the foot gives the keys first, then these rows (`N keys`, `, M of the pointer`). */
export function matchingPointer(typed: string): PointerRow[] {
  const words = typed.toLowerCase().split(/\s+/).filter(Boolean)
  return POINTER.filter((row) => words.every((word) => `${row.gesture} ${row.does} ${POINTER_GROUP.context} ${POINTER_GROUP.when}`.toLowerCase().includes(word)))
}

/** The sheet of keys, over the window while it is asked for. */
export function KeySheet() {
  const open = useZustand(sheetStore, (s) => s.open)
  return open ? <Sheet /> : null
}

/** A sentence of the answers: its keys in the mono face, and where it is not heard under it. */
function Said({ pieces, note, on }: { pieces: Piece[]; note?: string; on?: boolean }) {
  return (
    <p className={on ? 'keys-said on' : 'keys-said'}>
      {pieces.map((piece, n) => (piece.cap ? <mark key={n}>{piece.text}</mark> : <span key={n}>{piece.text}</span>))}
      {note && <small>{note}</small>}
    </p>
  )
}

/** A key with a modifier is no cap of the keyboard: `Ctrl+G`, `Shift+1`. */
const chord = (key: string): boolean => key !== '+' && key.includes('+')

/**
 * The keyboard, risen from the foot of the window. The places keys are heard in are chips, and the keyboard says what each key
 * does in the one chosen; the keys with a modifier are listed under it. What is typed (or a key pointed at) is answered in
 * sentences, made of the rows of the one table. Escape, `?` again or a press beside it puts it away, and the focus goes back to
 * where it was. A dialog: while it is up Tab stays within it and a click inside keeps the focus in it (it can take the focus
 * itself), so no tool behind it is handed a key; when the focus does leave it for something else in the window, it is put away.
 */
function Sheet() {
  const [typed, setTyped] = useState('')
  const [place, setPlace] = useState(1)
  const [pointed, setPointed] = useState<string | null>(null)
  const sheet = useRef<HTMLElement>(null)
  const field = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const before = document.activeElement
    field.current?.focus()
    return () => {
      const now = document.activeElement
      if (before instanceof HTMLElement && before.isConnected && (now === null || now === document.body || !now.isConnected)) before.focus()
    }
  }, [])

  const rows = cheatSheet()
  const chosen = PLACES[place]
  const searching = typed.trim() !== ''
  const query = typed.trim() || pointed || ''
  const pointer = searching ? matchingPointer(typed) : []
  const answers = sentencesFor(query, rows)
  const lit = capsFor(query, rows)
  const keyboard = drawnKeyboard(chosen.contexts, rows)
  const total = rows.reduce((sum, group) => sum + group.rows.length, 0)
  const found = searching ? matchRows(typed, rows).length : total
  const chords = rows.flatMap((group) => group.rows.filter((row) => chosen.contexts.includes(contextOf(row)) && row.keys.some(chord)))

  return (
    <div
      className="keys-layer"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) showKeys(false)
      }}
    >
      <section
        ref={sheet}
        className="keys-sheet"
        role="dialog"
        aria-modal="true"
        aria-label="Keys"
        tabIndex={-1}
        onBlur={(e) => {
          // The focus went to something outside it (a key heard everywhere took it to the session, a sheet came up): it gives way.
          // Not when the window itself lost the focus: it is still what is up when the person comes back. Nor for the button that asked for it:
          // that press puts it away itself.
          const to = e.relatedTarget
          if (to instanceof Element && to.closest('[data-keys-button]')) return
          if (to instanceof Node ? !e.currentTarget.contains(to) : document.hasFocus() && document.activeElement !== null && !e.currentTarget.contains(document.activeElement)) showKeys(false)
        }}
        onKeyDown={(e) => {
          // The sheet's own, all of them: Escape here puts no tool down and leaves no page.
          e.stopPropagation()
          if (pressed(e, 'sheet.close') || pressed(e, 'keys')) {
            e.preventDefault()
            showKeys(false)
            return
          }
          if (!pressed(e, 'sheet.round')) return
          const stops = [...sheet.current!.querySelectorAll<HTMLElement>('input, button')]
          const at = stops.indexOf(document.activeElement as HTMLElement)
          if (e.shiftKey ? at <= 0 : at === stops.length - 1) {
            e.preventDefault()
            stops[e.shiftKey ? stops.length - 1 : 0].focus()
          }
        }}
      >
        <div className="keys-main">
          <header className="keys-head">
            <h2>Keys</h2>
            <div className="keys-places" role="group" aria-label="Where keys are heard">
              {PLACES.map((one, n) => (
                <button key={one.name} type="button" className="keys-place" aria-pressed={n === place} onClick={() => setPlace(n)}>
                  {one.name}
                </button>
              ))}
            </div>
          </header>
          <div className="keys-board" role="group" aria-label={`The keyboard: ${chosen.name}`} onPointerLeave={() => setPointed(null)}>
            {keyboard.map((line, i) => (
              <div key={i} className="keys-line">
                {line.map((cap) => (
                  <div
                    key={cap.id}
                    className="keys-cap"
                    data-cap={cap.id}
                    data-kind={cap.tool ? 'tool' : cap.view ? 'view' : undefined}
                    data-mod={cap.mod || undefined}
                    data-bound={cap.does !== null || undefined}
                    data-lit={lit.has(cap.id) || undefined}
                    style={{ '--w': cap.w } as CSSProperties}
                    title={cap.full ?? undefined}
                    onPointerEnter={() => setPointed(cap.name)}
                    onPointerDown={(e) => {
                      // A click asks the table about the key, and the focus stays where it can type.
                      e.preventDefault()
                      setTyped(cap.name)
                      field.current?.focus()
                    }}
                  >
                    <b>{cap.label}</b>
                    {cap.does && <span>{cap.does}</span>}
                  </div>
                ))}
              </div>
            ))}
          </div>
          {/* The keys with a modifier are no cap of the keyboard: here they are, by the place chosen. */}
          <ul className="keys-chords" aria-label={`With a modifier: ${chosen.name}`}>
            {place === 1 &&
              POINTER.map((row) => (
                <li key={row.id}>
                  <span className="keys-caps">
                    <span className="keys-gesture">{row.gesture}</span>
                  </span>
                  <span>{numbered(row.does)}</span>
                </li>
              ))}
            {chords.map((row) => (
              <li key={row.id}>
                <span className="keys-caps">
                  {capsOf(row.keys.filter(chord)).map((key) => (
                    <kbd key={key}>{key}</kbd>
                  ))}
                </span>
                <span>{numbered(row.does)}</span>
              </li>
            ))}
          </ul>
        </div>
        <div className="keys-find">
          <label className="keys-search">
            <input ref={field} type="text" value={typed} placeholder="Type a key or what you want to do" aria-label="Search the keys" spellCheck={false} autoComplete="off" onChange={(e) => setTyped(e.target.value)} />
            <button type="button" className="keys-esc" aria-label="Close" title={`Close (${hint('sheet.close')})`} onClick={() => showKeys(false)}>
              <span>{hint('sheet.close')}</span>
            </button>
          </label>
          <div className="keys-answers">
            {query === '' && <p className="keys-none">Type a key, or what you want to do, and it is told here. Point at a key to hear where it works.</p>}
            {query !== '' && answers.length === 0 && pointer.length === 0 && (
              <p className="keys-none">
                No key says <span className="keys-typed">{query}</span>.
              </p>
            )}
            {answers.map((one) => (
              <Said key={one.context} pieces={one.pieces} note={one.notHeard} on={chosen.contexts.includes(one.context)} />
            ))}
            {pointer.map((row) => <Said key={row.id} pieces={pointerSentence(row).pieces} on={chosen.contexts.includes('Viewport')} />)}
          </div>
          {/* What changes as the search is typed, said once: not fifty sentences read out again at every letter. */}
          <p className="keys-count" aria-live="polite">
            <span className="num">{found}</span> {found === 1 ? 'key' : 'keys'}
            {searching && ' found'}
            {(!searching || pointer.length > 0) && (
              <>
                {', '}
                <span className="num">{searching ? pointer.length : POINTER.length}</span> of the pointer
              </>
            )}
            {'.'}
            {!searching && ' Tools are in the accent, keys heard in the view are outlined.'}
          </p>
        </div>
      </section>
    </div>
  )
}
