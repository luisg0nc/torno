import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react'
import { hint, pressed } from '../../../shared/keys'
import { useShelf } from '../../state/shelf'
import { runningSession, useStore } from '../../state/store'
import { ADD_SOURCES, canAsk, idProblem, MOST_ADD_SIZES, shelfAdd, sizeIssue, type AddFile, type AddForm, type AddSize, type AddSource } from '../../state/shelfAdd'
import { chosen, giveKeysBack, pointerChoice } from '../typing'
import { askToShelve } from './addAsk'

/**
 * The Shelf tab as a short form (#355), in place of the list: "New part, from 2 files you dropped", the files, a name (the folder's, an identifier,
 * checked as it is typed), what it is, the sizes the person knows with where each came from, and "Ask Claude to put it on the shelf", which puts the
 * request in the message box and leaves. Back and Escape leave with nothing written. torno copies the files only when the request is sent (`addAsk.ts`).
 */
export function AddPart({ form }: { form: AddForm }) {
  const parts = useShelf((s) => s.parts)
  const onShelf = parts.map((p) => p.id)
  const terminal = useStore((s) => runningSession(s)?.view === 'terminal')
  const [asking, setAsking] = useState(false)
  const name = useRef<HTMLInputElement>(null)
  const nameHelp = useId()
  const problem = idProblem(form.id, onShelf)
  const half = form.sizes.some((s) => sizeIssue(s) !== null)
  const ready = canAsk(form, onShelf)
  const folder = form.id === '' ? 'name' : form.id

  // The name is the first thing to check: the keys are its on arrival.
  useEffect(() => name.current?.focus(), [])

  const keep = (e: KeyboardEvent<HTMLElement>): void => {
    if (pressed(e, 'field.keep')) giveKeysBack(e.currentTarget)
  }
  const leave = (e: KeyboardEvent<HTMLElement>): void => {
    if (!pressed(e, 'field.leave') || e.target instanceof HTMLSelectElement) return
    e.preventDefault()
    e.stopPropagation()
    shelfAdd.close()
  }

  async function ask(): Promise<void> {
    if (!ready || asking) return
    setAsking(true)
    try {
      const said = await askToShelve(form)
      if (said !== null) shelfAdd.setProblem(said)
    } finally {
      setAsking(false)
    }
  }

  return (
    <div className="add-part" data-add-part="" role="form" aria-label="New part" onKeyDown={leave}>
      <button type="button" className="add-back" onClick={() => shelfAdd.close()} title={`Back to the shelf: nothing is written (${hint('field.leave')})`}>
        <svg viewBox="0 0 14 14" aria-hidden="true">
          <path d="M8.5 2.5 4 7l4.5 4.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <span>
          New part, from <span className="num">{form.files.length}</span> {form.files.length === 1 ? 'file' : 'files'} you dropped
        </span>
      </button>
      <div className="add-scroll">
        <ul className="add-files" aria-label="Files dropped">
          {form.files.map((f) => (
            <FileTile key={f.path} file={f} />
          ))}
        </ul>
        {form.said.length > 0 && (
          <ul className="add-said" role="status" data-part="add-said">
            {form.said.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        )}
        <div className="add-field">
          <label htmlFor="add-name">Name</label>
          <input
            id="add-name"
            ref={name}
            className="add-input num"
            type="text"
            value={form.id}
            maxLength={48}
            spellCheck={false}
            autoComplete="off"
            aria-invalid={problem !== null}
            aria-describedby={nameHelp}
            onChange={(e) => shelfAdd.setId(e.target.value)}
            onKeyDown={keep}
          />
          <p id={nameHelp} className="add-help" data-tone={problem ? 'warn' : undefined} data-part="add-name-help">
            {problem ?? 'The folder is common/parts/ and this name.'}
          </p>
        </div>
        <div className="add-field">
          <label htmlFor="add-what">What is it</label>
          <input id="add-what" className="add-input" type="text" value={form.what} maxLength={200} placeholder="MTS-101 mini toggle, SPST, two pins" spellCheck autoComplete="off" onChange={(e) => shelfAdd.setWhat(e.target.value)} onKeyDown={keep} />
        </div>
        <div className="add-sizes" role="group" aria-label="Sizes you know">
          {form.sizes.map((s, n) => (
            <SizeRow key={s.uid} size={s} n={n} />
          ))}
          <div className="add-more">
            <button type="button" className="button button-quiet" disabled={form.sizes.length >= MOST_ADD_SIZES} onClick={() => shelfAdd.addSize()}>
              <svg viewBox="0 0 12 12" aria-hidden="true">
                <path d="M6 2v8M2 6h8" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
              Add a size
            </button>
          </div>
        </div>
        <button type="button" className="button button-primary add-ask" data-part="add-ask" disabled={!ready || asking} onClick={() => void ask()} aria-describedby="add-hold">
          Ask Claude to put it on the shelf
        </button>
        <p id="add-hold" className="add-help" data-tone={!ready ? 'warn' : undefined} role="status">
          {half ? 'Finish or clear the size that is half filled.' : ready ? '' : (problem ?? '')}
        </p>
        {form.problem !== null && (
          <p className="add-problem selectable" role="alert" data-part="add-problem">
            {form.problem}
          </p>
        )}
        <p className="add-note" data-part="add-note">
          Claude writes <span className="file">common/parts/{folder}/part.py</span>.{' '}
          {terminal ? (
            <>
              torno copies your files into <span className="file">common/parts/{folder}/</span> when you press the button, as a terminal has no box to send from. You see the request at the prompt first.
            </>
          ) : (
            <>
              torno copies your files into <span className="file">common/parts/{folder}/</span> when you send the request. You see the request in the box first.
            </>
          )}
        </p>
      </div>
    </div>
  )
}

/** A file dropped: its picture when it is one, else a tile with its ending; its name in mono under it, and a button to take it off. */
function FileTile({ file }: { file: AddFile }) {
  return (
    <li className="add-file" data-file={file.name}>
      <span className={`add-pic${file.url === null ? ' add-pic-file' : ''}`}>
        {file.url !== null ? <img src={file.url} alt="" draggable={false} /> : <span className="add-ending num">{file.kind === 'pdf' ? 'PDF' : 'STEP'}</span>}
        <button type="button" className="add-take" aria-label={`Take ${file.name} off`} title="Take it off" onClick={() => shelfAdd.removeFile(file.path)}>
          <svg viewBox="0 0 10 10" aria-hidden="true">
            <path d="m2 2 6 6M8 2 2 8" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
          </svg>
        </button>
      </span>
      <span className="add-file-name num" title={file.name}>
        {file.name}
      </span>
    </li>
  )
}

/** One size: what it is, the value as typed, where it came from; a guess is warm. */
function SizeRow({ size, n }: { size: AddSize; n: number }) {
  const issue = sizeIssue(size)
  const keep = (e: KeyboardEvent<HTMLElement>): void => {
    if (pressed(e, 'field.keep')) giveKeysBack(e.currentTarget)
  }
  return (
    <div className="add-size" data-issue={issue !== null ? '' : undefined}>
      <input
        className="add-input"
        type="text"
        value={size.what}
        maxLength={200}
        placeholder="panel hole"
        aria-label={`What size ${n + 1} measures`}
        aria-invalid={issue !== null && size.what.trim() === ''}
        spellCheck
        autoComplete="off"
        onChange={(e) => shelfAdd.setSize(size.uid, { what: e.target.value })}
        onKeyDown={keep}
      />
      <input
        className="add-input num"
        type="text"
        value={size.value}
        maxLength={60}
        placeholder="Ø 6.2"
        aria-label={`Value of size ${n + 1}`}
        aria-invalid={issue !== null && size.value.trim() === ''}
        spellCheck={false}
        autoComplete="off"
        onChange={(e) => shelfAdd.setSize(size.uid, { value: e.target.value })}
        onKeyDown={keep}
      />
      <select
        className="add-source"
        data-source={size.source}
        aria-label={`Where size ${n + 1} came from`}
        value={size.source}
        {...pointerChoice}
        onChange={(e) => {
          shelfAdd.setSize(size.uid, { source: e.target.value as AddSource })
          chosen(e.currentTarget)
        }}
      >
        {ADD_SOURCES.map((s) => (
          <option key={s.id} value={s.id}>
            {s.label}
          </option>
        ))}
      </select>
      <button type="button" className="add-clear" aria-label={`Clear size ${n + 1}`} title="Clear this size" onClick={() => shelfAdd.removeSize(size.uid)}>
        <svg viewBox="0 0 10 10" aria-hidden="true">
          <path d="m2 2 6 6M8 2 2 8" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
        </svg>
      </button>
    </div>
  )
}
