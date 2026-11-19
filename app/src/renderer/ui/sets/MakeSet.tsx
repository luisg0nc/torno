import { useEffect, useRef, useState } from 'react'
import { hint, pressed } from '../../../shared/keys'
import { SET_COLOURS, SET_COMMENT_MAX, SET_NAME_MAX, parseSetRef, setNameError } from '../../../shared/sets'
import { boardStore, inModel } from '../../state/board'
import { describe, descriptorOf } from '../../state/descriptors'
import { isStrokeRef, nextColour, setActions, suggestName, useSets } from '../../state/sets'
import { store, useStore } from '../../state/store'
import { giveKeysBack, TYPING } from '../typing'
import { setColourVar } from './SetRows'

/** What is selected, in words: `2 faces, 1 part`. */
export function selectionSaid(refs: readonly string[]): string {
  const count = { face: 0, edge: 0, part: 0, stroke: 0 }
  for (const ref of refs) {
    if (isStrokeRef(ref)) count.stroke += 1
    else {
      const parsed = parseSetRef(ref)
      if (parsed) count[parsed.kind] += 1
    }
  }
  const noun = (n: number, one: string): string => `${n} ${one}${n === 1 ? '' : 's'}`
  return (Object.keys(count) as Array<keyof typeof count>)
    .filter((k) => count[k] > 0)
    .map((k) => noun(count[k], k))
    .join(', ')
}

/**
 * The keys of a set, heard outside a field and the terminal with a project on show: Ctrl+G with something selected opens the
 * box that names it, in the head of the card (`InHand` hears it), and with nothing selected the status line says what to select.
 */
export function useSetKeys(): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.defaultPrevented || e.repeat || !pressed(e, 'set.make')) return
      if (e.target instanceof Element && e.target.closest(TYPING)) return
      const s = store.getState()
      // Only with the model on show: the page of projects, the page of a new one, the board and a tracing have keys of their own.
      if (s.page !== 'object' || s.objectId === null || !inModel(boardStore.getState().shown)) return
      e.preventDefault()
      setActions.startMake()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
}

/** What the box shows and does: its fields, and the way out. Pure, so that it is drawn the same from any state. */
export interface MakeSetFormProps {
  name: string
  comment: string
  colour: number
  /** The names of the sets there are: one that makes the same ref is refused. */
  taken: readonly string[]
  /** What is being named, in words. */
  what: string
  /** What main said when it refused. */
  refused?: string | null
  busy?: boolean
  onName?(name: string): void
  onComment?(comment: string): void
  onColour?(colour: number): void
  onMake?(): void
  onCancel?(): void
}

/** Why the set cannot be made with this name, or null. Empty says nothing until something is typed: the button is off all the same. */
export function makeError(name: string, taken: readonly string[]): string | null {
  return name.trim() === '' ? null : setNameError(name, taken)
}

export function MakeSetForm({ name, comment, colour, taken, what, refused = null, busy = false, onName, onComment, onColour, onMake, onCancel }: MakeSetFormProps) {
  const error = makeError(name, taken)
  const canMake = !busy && name.trim() !== '' && setNameError(name, taken) === null
  const first = useRef<HTMLInputElement>(null)
  // The name is the first thing to type: it is chosen, so that a suggestion is replaced by typing.
  useEffect(() => {
    first.current?.focus()
    first.current?.select()
  }, [])
  const keys = (e: React.KeyboardEvent): void => {
    if (e.nativeEvent.isComposing) return
    if (pressed(e, 'field.leave')) {
      e.preventDefault()
      e.stopPropagation()
      onCancel?.()
    } else if (pressed(e, 'field.keep')) {
      e.preventDefault()
      if (canMake) onMake?.()
    }
  }
  return (
    <div className="setmake" role="dialog" aria-label="Name a set" data-part="make-set">
      <p className="setmake-title">Name a set</p>
      <label className="setmake-label">
        <span>Name</span>
        <input ref={first} className="setmake-name" type="text" value={name} maxLength={SET_NAME_MAX} aria-invalid={error !== null} aria-describedby="setmake-error" spellCheck={false} autoComplete="off" onChange={(e) => onName?.(e.target.value)} onKeyDown={keys} />
      </label>
      <p id="setmake-error" className="setmake-error" role="alert">
        {error ?? refused ?? ''}
      </p>
      <label className="setmake-label">
        <span>Comment</span>
        <textarea className="setmake-comment note-field" rows={2} value={comment} maxLength={SET_COMMENT_MAX} placeholder="What is it for?" onChange={(e) => onComment?.(e.target.value)} onKeyDown={keys} />
      </label>
      <div className="setmake-swatches" role="radiogroup" aria-label="Colour">
        {Array.from({ length: SET_COLOURS }, (_v, n) => (
          <button key={n} type="button" role="radio" className="set-colour" aria-checked={colour === n} aria-label={`Colour ${n + 1}`} style={{ ['--set-colour' as string]: setColourVar(n) }} onClick={() => onColour?.(n)} />
        ))}
      </div>
      <div className="setmake-foot">
        <span className="setmake-what num">{what}</span>
        <button type="button" className="button" onClick={() => onCancel?.()}>
          Cancel
        </button>
        <button type="button" className="button button-primary" disabled={!canMake} title={`Make the set (${hint('field.keep')})`} onClick={() => onMake?.()}>
          Make
        </button>
      </div>
    </div>
  )
}

/** The box Ctrl+G or "Name a set" opens, in the head of the card under the refs: it draws only while a set is being named. */
export function MakeSet() {
  const making = useSets((s) => s.making)
  return making ? <NameSet /> : null
}

function NameSet() {
  const sets = useSets((s) => s.sets)
  const refused = useSets((s) => s.refused)
  const selection = useStore((s) => s.selection)
  const objectId = useStore((s) => s.objectId)
  const revision = useStore((s) => s.revision)
  const layout = useStore((s) => s.layout)
  const taken = sets.map((s) => s.name)
  const first = selection.find((ref) => !isStrokeRef(ref))
  const [name, setName] = useState(() => suggestName(objectId !== null && first !== undefined ? descriptorOf(objectId, revision, layout, first) : undefined, taken))
  const [comment, setComment] = useState('')
  const [colour, setColour] = useState(() => nextColour(sets))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // The name is a suggestion until the person types: what the kernel says of the first face makes it better once it comes.
  const typed = useRef(false)
  useEffect(() => {
    if (objectId === null || first === undefined || descriptorOf(objectId, revision, layout, first) !== undefined) return
    let live = true
    void describe(objectId, revision, layout, first).then((said) => {
      if (live && said !== null && !typed.current) setName(suggestName(said, taken))
    })
    return () => {
      live = false
    }
  }, [])
  const close = (): void => {
    setActions.cancelMake()
    if (document.activeElement instanceof HTMLElement) giveKeysBack(document.activeElement)
  }
  const make = (): void => {
    setBusy(true)
    setError(null)
    void setActions.asks().then(
      (members) => {
        // The kernel could not say where a face is: the status line and the box say so, and it stays open as it was.
        if (members === null) return setBusy(false)
        return setActions.make({ name: name.trim(), comment: comment.trim(), colour, layout, members }).then(
          () => {
            setBusy(false)
            close()
          },
          (e: unknown) => {
            setBusy(false)
            setError(e instanceof Error ? e.message : String(e))
          }
        )
      },
      (e: unknown) => {
        setBusy(false)
        setError(e instanceof Error ? e.message : String(e))
      }
    )
  }
  return (
    <MakeSetForm
      name={name}
      comment={comment}
      colour={colour}
      taken={taken}
      what={selectionSaid(selection)}
      refused={error ?? refused}
      busy={busy}
      onName={(n) => {
        typed.current = true
        setName(n)
        setError(null)
      }}
      onComment={setComment}
      onColour={setColour}
      onMake={make}
      onCancel={close}
    />
  )
}
