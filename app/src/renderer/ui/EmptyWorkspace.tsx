import { useEffect, useRef, useState, type ReactNode } from 'react'
import { pressed } from '../../shared/keys'
import { moduleName, MOST_REFERENCES, objectNameProblem } from '../../shared/objectName'
import { actions, useStore } from '../state/store'
import { onboard, onboarding, useOnboard, type Stroke } from '../state/onboard'
import { numbered } from './numbered'
import { attachPhotos, attachScan, attachStep } from './onboard/attach'
import { Doodle } from './onboard/Doodle'
import { liveMakeDeps } from './onboard/liveDeps'
import { makeObject } from './onboard/make'
import { openNewObject } from './onboard/NewObject'
import { SlotGlyph } from './onboard/Slot'
import { folderFromWords } from './plate/folderFromWords'
import { Plate } from './plate/Plate'
import { Readiness } from './Readiness'

/** The picture of a photo, as small as the glyphs of the slots beside it. */
function PhotoGlyph() {
  return (
    <svg className="slot-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="2" y="3.5" width="12" height="9" rx="1.5" />
      <circle cx="6" cy="7.5" r="1.2" />
      <path d="m3 12 3.5-3 2.5 2 2-1.5 3 2.5" />
    </svg>
  )
}

/**
 * A folder with no project in it: the dyed plate at the left (the vise with nothing in it yet, `? mm`), and at the right
 * the composer. "What are we making?": the words in a box, the chips that add a photo, a doodle, a bought part or a scan
 * (the pickers of the page of a new project), the folder the project will have, offered from the words and editable, and
 * Start, which makes the project and starts Claude Code with the words as its first prompt (`makeObject`, as the page of a
 * new project does). Under the box are the way to that page (it takes over what was typed), the example, what torno needs,
 * and, in a fold, the way for models a person already has. The words and what is added are the draft's (`state/onboard.ts`),
 * so the page of a new project has them as they are. torno runs no `uv` command here: the fold names them for the person to run.
 */
export function EmptyWorkspace({ name, hasProject, hasExample, onOpen, onExample }: { name: string; hasProject: boolean; hasExample: boolean; onOpen: (id: string) => Promise<void>; onExample: () => void }) {
  const workspace = useStore((s) => s.workspace)
  const draft = useOnboard((s) => s.draft)
  const words = draft.description
  const ids = workspace?.objects.map((o) => o.id) ?? []
  const [taken, setTaken] = useState<string[]>([])
  const [renamed, setRenamed] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  const [busy, setBusy] = useState(false)
  const [reading, setReading] = useState(false)
  const [said, setSaid] = useState<string | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const [board, setBoard] = useState(false)
  const box = useRef<HTMLTextAreaElement>(null)
  const field = useRef<HTMLInputElement>(null)

  const refreshTaken = (): void => void window.torno.objects.taken().then(setTaken, () => {})
  useEffect(refreshTaken, [])
  useEffect(() => box.current?.focus(), [])
  useEffect(() => {
    if (editing) field.current?.select()
  }, [editing])

  const entries = [...new Set([...ids, ...taken])]
  const folder = renamed ?? folderFromWords(words, entries)
  const nameProblem = objectNameProblem(folder, entries)
  const startable = words.trim() !== '' && nameProblem === null && !busy && !reading
  const held = [
    ...draft.photos.map((p) => ({ kind: 'photos' as const, uid: p.uid, file: p.file })),
    ...draft.doodles.map((d, n) => ({ kind: 'doodles' as const, uid: d.uid, file: `doodle-${n + 1}` })),
    ...draft.steps.map((s) => ({ kind: 'steps' as const, uid: s.uid, file: s.file })),
    ...draft.scans.map((s) => ({ kind: 'scans' as const, uid: s.uid, file: s.file }))
  ]

  async function add(attach: () => Promise<string | null>): Promise<void> {
    setSaid(null)
    setReading(true)
    setSaid(await attach())
    setReading(false)
  }

  async function start(): Promise<void> {
    if (!startable) return
    setBusy(true)
    setProblem(null)
    const outcome = await makeObject({ ...onboard.getState().draft, name: folder }, liveMakeDeps(onOpen), onboard.getState().choice, true)
    if (outcome.kind === 'refused') setProblem(outcome.message)
    else if (outcome.kind === 'made') setProblem(`${outcome.message} It is not made again.`)
    // Made and listed, with another on show: back to the page of projects, where it is.
    else if (outcome.kind === 'done' && outcome.shown === false) actions.showPage('objects')
    setBusy(false)
    refreshTaken()
  }

  const chip = (label: string, glyph: ReactNode, onClick: () => void, off: boolean) => (
    <button type="button" className="compose-chip" disabled={busy || reading || off} onClick={onClick}>
      {glyph}
      {label}
    </button>
  )

  return (
    <div className="empty-folder">
      <Plate
        headline="Nothing in the vise yet"
        drawing="vise-unknown"
        lead={
          <>
            No projects in <span className="num">{name}</span>. Say what you want made and Claude Code writes the model.
          </>
        }
      />
      <section className="compose" aria-label="Start a project">
        <h2 className="compose-title">
          What are we making?
        </h2>
        <p className="compose-lead">Say it plainly. Add photos, a doodle, a bought part or a scan. Nothing is written until you start.</p>
        <div className="compose-box">
          <textarea
            ref={box}
            className="compose-text"
            aria-label="What are we making?"
            rows={4}
            value={words}
            disabled={busy}
            placeholder="A clip that holds a 6 mm cable to the edge of a desk, printed in PETG…"
            onChange={(e) => onboarding.setDescription(e.target.value)}
          />
          <div className="compose-add" role="group" aria-label="Add what you have">
            {chip('Photo', <PhotoGlyph />, () => void add(attachPhotos), draft.photos.length >= MOST_REFERENCES.photos)}
            {chip('Doodle', <SlotGlyph icon="sketch" />, () => setBoard(true), draft.doodles.length >= MOST_REFERENCES.doodles)}
            {chip('Bought part', <SlotGlyph icon="part" />, () => void add(attachStep), draft.steps.length >= MOST_REFERENCES.steps)}
            {chip('Scan', <SlotGlyph icon="scan" />, () => void add(attachScan), draft.scans.length >= MOST_REFERENCES.scans)}
          </div>
          {held.length > 0 && (
            <ul className="compose-held" aria-label="Added">
              {held.map((item) => (
                <li key={item.uid}>
                  <span className="num">{item.file}</span>
                  <button type="button" className="compose-remove" aria-label={`Remove ${item.file}`} disabled={busy} onClick={() => onboarding.remove(item.kind, item.uid)}>
                    ×
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="compose-foot">
            {editing ? (
              <span className="compose-where" data-editing="">
                <label htmlFor="compose-folder">Goes in</label>
                <span className="num compose-parent">{name}/</span>
                <input
                  id="compose-folder"
                  ref={field}
                  className="compose-name num"
                  type="text"
                  value={folder}
                  spellCheck={false}
                  autoComplete="off"
                  aria-invalid={nameProblem !== null}
                  aria-describedby="compose-name-help"
                  onChange={(e) => setRenamed(e.target.value)}
                  onBlur={() => nameProblem === null && setEditing(false)}
                  onKeyDown={(e) => {
                    // Enter keeps what was typed (when the rule takes it); Escape leaves the name as it was offered.
                    if (pressed(e, 'field.keep')) {
                      e.preventDefault()
                      if (nameProblem === null) setEditing(false)
                    } else if (pressed(e, 'field.leave')) {
                      e.preventDefault()
                      e.stopPropagation()
                      setRenamed(null)
                      setEditing(false)
                    }
                  }}
                />
              </span>
            ) : (
              <button type="button" className="compose-where" disabled={busy} title="The folder of the project. Click to change the name" onClick={() => setEditing(true)}>
                Goes in{' '}
                <span className="num">
                  {name}/{folder}
                </span>
                <span aria-hidden="true"> ▾</span>
              </button>
            )}
            <button type="button" className="button button-primary compose-start" disabled={!startable} onClick={() => void start()}>
              {busy ? 'Starting…' : 'Start'}
            </button>
          </div>
        </div>
        {editing && (
          <p id="compose-name-help" className="compose-help" data-tone={nameProblem ? 'fail' : undefined}>
            {nameProblem ?? `The folder's name: letters, digits, - _ (no dots). The model is ${moduleName(folder)}.py.`}
          </p>
        )}
        {!editing && nameProblem !== null && words.trim() !== '' && (
          <p className="compose-help" data-tone="fail">
            {nameProblem}
          </p>
        )}
        {said !== null && (
          <p className="compose-help" data-tone="warn" role="status">
            {numbered(said)}
          </p>
        )}
        {problem !== null && (
          <p className="compose-help" data-tone="fail" role="alert">
            {numbered(problem)}
          </p>
        )}
        <p className="compose-more">
          Or{' '}
          <button type="button" className="compose-link" disabled={busy} onClick={() => openNewObject(words.trim() === '' && renamed === null ? undefined : { words, name: folder })}>
            open the full new project page
          </button>{' '}
          for sizes and rules
          {hasExample ? (
            <>
              , or{' '}
              <button type="button" className="compose-link" title="A small project of torno's own, copied to a temporary folder: nothing of the repository is opened or written" onClick={onExample}>
                open the example
              </button>{' '}
              to look around.
            </>
          ) : (
            '.'
          )}
        </p>
        <Readiness variant="block" />
        <details className="compose-fold">
          <summary>Already have build123d models?</summary>
          <p>
            Make a folder with a Python model in it, for example <span className="num">part/part.py</span>, and it appears here.
          </p>
          {!hasProject && (
            <p>
              This folder has no <span className="num">pyproject.toml</span>: models are built with torno&apos;s own build123d. For your own packages, make it a uv project (<span className="num">uv init</span>, <span className="num">uv add build123d</span>, <span className="num">uv sync</span>) and open it again.
            </p>
          )}
        </details>
        <p className="compose-scope">
          Works best for printed parts and small assemblies. Organic shapes are hard. torno writes only inside each project&apos;s <span className="num">.torno</span> folder, and the new folder when you start.
        </p>
      </section>
      {board && (
        <Doodle
          initial={[]}
          photos={draft.photos}
          onCancel={() => setBoard(false)}
          onDone={(strokes: Stroke[], png: Uint8Array, over: string | undefined) => {
            onboarding.addDoodle({ strokes, png, url: URL.createObjectURL(new Blob([png as BlobPart], { type: 'image/png' })), ...(over === undefined ? {} : { over }) })
            setBoard(false)
          }}
        />
      )}
    </div>
  )
}
