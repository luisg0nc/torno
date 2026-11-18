import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { MAX_FILE_BYTES, type FileChange, type TurnChanges } from '../../../shared/changes'
import { pressed } from '../../../shared/keys'
import { drawable } from '../../../shared/history'
import { actions, store, useStore } from '../../state/store'
import { withRefs } from '../CompareBar'
import { numbered } from '../numbered'
import { changeTags, subjectPoint, type ChangeTag } from '../view/changeTags'
import { Tag } from '../view/Tag'
import { compareBlocked } from './compareBlocked'
import { Diff } from './Diff'
import type { JoinedTurn } from './historyJoin'
import { countLines, diffText } from './lineDiff'
import type { TurnSummary } from './turnSummary'

type Loaded = { state: 'loading' } | { state: 'kept'; changes: TurnChanges } | { state: 'not-kept' }

/** What main has of a turn's changes, asked once when the sheet opens. A refusal or a failure is "not kept". */
function useChanges(sessionId: string | undefined, turnId: string): Loaded {
  const [loaded, setLoaded] = useState<Loaded>({ state: 'loading' })
  useEffect(() => {
    let live = true
    if (!sessionId) {
      setLoaded({ state: 'not-kept' })
      return
    }
    void window.torno.chat.changes(sessionId, turnId).then(
      (changes) => live && setLoaded(changes ? { state: 'kept', changes } : { state: 'not-kept' }),
      () => live && setLoaded({ state: 'not-kept' })
    )
    return () => {
      live = false
    }
  }, [sessionId, turnId])
  return loaded
}

/** What happened to a file in the turn, in a word. */
export const fileWord = (f: FileChange): string => (f.tooLarge ? 'changed' : f.before === null ? 'new' : f.after === null ? 'removed' : 'changed')

/** The file as it is now, read only, in the monospace face. Nothing of it is run, searched for refs or written. */
function WholeFile({ file }: { file: FileChange }) {
  if (file.tooLarge) return <p className="changes-note">{numbered(`Too large to show: torno keeps files of up to ${Math.round(MAX_FILE_BYTES / 1000)} KB.`)}</p>
  if (file.after === null) return <p className="changes-note">The file was removed in this turn.</p>
  return <pre className="chat-pre changes-whole selectable">{file.after}</pre>
}

/** A file's diff, with the numbers of its lines: the hunk of what the turn did to it, or none for a file too large to be compared. */
const hunkOf = (file: FileChange) => (file.tooLarge ? undefined : diffText(file.before ?? '', file.after ?? '', true))

/** What a file's tab says after its name: the lines added and removed, or only that it is new, removed or too large to count. */
export function tabWords(file: FileChange): string {
  const hunk = hunkOf(file)
  if (!hunk) return fileWord(file)
  const { added, removed } = countLines(hunk)
  return `+${added} −${removed}`
}

/** The most tags the sheet writes on the parts; the rest are said in a line. */
const MOST_TAGS = 4

/**
 * What the build before and the build after look like in the view above: `h40` / `h41`, through Compare (`actions.compare`,
 * the earlier build drawn alone), when the history has the build the turn began from. Only the view changes; nothing is written.
 */
function Scrubber({ joined }: { joined: JoinedTurn }) {
  const last = joined.entries.findLast(drawable)
  const from = joined.from
  const before = useStore((s) => s.compare !== null && s.compare.from === from?.id && s.compare.to === last?.id)
  const blocked = useStore(compareBlocked)
  if (!from || !last || from.id === last.id) return null
  const show = (earlier: boolean): void => {
    if (earlier === before) return
    if (!earlier) return actions.endCompare()
    actions.compare(from.id, last.id, joined.number > 0 ? joined.number : undefined)
    actions.compareMode('before')
  }
  return (
    <div className="changes-scrub" role="group" aria-label="Build shown">
      <button type="button" className="num" aria-pressed={before} disabled={!before && blocked !== null} title={before ? `${from.id} is drawn` : (blocked ?? `Draw ${from.id}, the build this turn began from`)} onClick={() => show(true)}>
        {from.id}
      </button>
      <button type="button" className="num" aria-pressed={!before} title={`${last.id}, the build this turn made`} onClick={() => show(false)}>
        {last.id}
      </button>
    </div>
  )
}

/** The tags of the parts the turn changed, written from the digests of its builds, standing on the parts as the view shows them. */
function PartTags({ summary }: { summary: TurnSummary }) {
  const scene = useStore((s) => s.scene)
  const marks = useStore((s) => s.marks)
  const { tags, rest } = changeTags(summary, MOST_TAGS)
  // A part that is gone from the build on show, or a mark that was deleted, has nothing to stand on: it is said in the line.
  const placed = tags.flatMap((tag) => {
    const at = subjectPoint(tag.subject, scene?.parts ?? [], marks)
    return at ? [{ tag, at }] : []
  })
  const listed: ChangeTag[] = [...tags.filter((t) => !placed.some((p) => p.tag === t)), ...rest]
  return (
    <>
      {placed.map(({ tag, at }) => (
        <Tag key={tag.subject} id={`changes-${tag.subject}`} subject={at} prefer="above">
          <span className="change-tag" data-subject={tag.subject}>
            {withRefs(tag.text)}
          </span>
        </Tag>
      ))}
      {listed.length > 0 && (
        <p className="changes-rest" data-part="changes-rest">
          {withRefs(`${placed.length > 0 ? 'and ' : ''}${listed.length} more: ${listed.map((t) => t.text).join(' · ')}`)}
        </p>
      )}
    </>
  )
}

function FileView({ file, whole }: { file: FileChange; whole: boolean }) {
  const hunks = useMemo(() => {
    const hunk = hunkOf(file)
    return hunk ? [hunk] : []
  }, [file])
  if (whole) return <WholeFile file={file} />
  if (file.tooLarge) return <p className="changes-note">{numbered(`Too large to compare: torno keeps files of up to ${Math.round(MAX_FILE_BYTES / 1000)} KB.`)}</p>
  return <Diff hunks={hunks} ofEdit={false} numbers />
}

const FOCUSABLE = 'button:not([disabled]), [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'

/**
 * The model's source as a turn changed it, over the view's area (not the card or the dock): the top half is the view itself, with
 * the parts the turn changed written on as tags and the build before one press away (`Scrubber`); the bottom half is the code, a
 * tab for each `.py` file of the project's folder that differs ("airbox.py +3 −2"), the file at the start of the turn against its
 * end as a diff with the numbers of its lines, or the file as it is now, read only. The builds of the turn taken together (`net`,
 * from the kernel) stand below it. Not a modeller: nothing here edits or runs the file. What it shows is held by main in memory
 * (`chat.changes`), for the last turns only.
 */
export function ChangesSheet({ sessionId, turnId, net, summary, joined, host, onClose }: { sessionId: string | undefined; turnId: string; net: string[]; summary: TurnSummary; joined?: JoinedTurn; host: Element; onClose: () => void }) {
  const loaded = useChanges(sessionId, turnId)
  const layer = useRef<HTMLDivElement>(null)
  const [chosen, setChosen] = useState(0)
  const [whole, setWhole] = useState(false)
  useEffect(() => {
    layer.current?.focus()
    // The sheet puts away the build it drew: the view is the live one again when it is closed.
    return () => {
      const from = joined?.from?.id
      const to = joined?.entries.findLast(drawable)?.id
      const now = store.getState().compare
      if (now && now.from === from && now.to === to) actions.endCompare()
    }
    // Once, for the sheet's own life: `joined` is read as it stands then.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const files = loaded.state === 'kept' ? loaded.changes.files : []
  const file = files[Math.min(chosen, files.length - 1)]

  return createPortal(
    <div
      ref={layer}
      className="changes-sheet"
      role="dialog"
      aria-modal="true"
      aria-label="Changes in this turn"
      tabIndex={-1}
      onKeyDown={(e) => {
        if (pressed(e, 'chat.close')) {
          e.stopPropagation()
          onClose()
          return
        }
        // Tab goes round within the sheet.
        if (!pressed(e, 'sheet.round')) return
        const items = [...(layer.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])]
        if (items.length === 0) return e.preventDefault()
        const at = items.indexOf(document.activeElement as HTMLElement)
        const next = e.shiftKey ? (at <= 0 ? items.length - 1 : at - 1) : at === items.length - 1 ? 0 : at + 1
        e.preventDefault()
        items[next].focus()
      }}
    >
      <div className="changes-top">
        <div className="changes-head">
          <h3 className="changes-title">Changes in this turn</h3>
          <span className="changes-readonly">read only</span>
          {joined && <Scrubber joined={joined} />}
          <button type="button" className="button button-quiet" onClick={onClose}>
            Close
          </button>
        </div>
        <PartTags summary={summary} />
      </div>
      <div className="changes-code">
        {loaded.state === 'kept' && file && (
          <div className="changes-tabs">
            <div className="changes-files" role="group" aria-label="Files changed">
              {files.map((f, n) => (
                <button key={f.file} type="button" className="changes-tab" aria-pressed={file === f} title={`${f.file}, ${fileWord(f)}`} onClick={() => setChosen(n)}>
                  {f.file} <span className="changes-count">{tabWords(f)}</span>
                </button>
              ))}
            </div>
            <div className="changes-modes" role="group" aria-label={`${file.file}: how to show it`}>
              <button type="button" className="button button-quiet" aria-pressed={!whole} onClick={() => setWhole(false)}>
                Changes
              </button>
              <button type="button" className="button button-quiet" aria-pressed={whole} onClick={() => setWhole(true)}>
                Whole file
              </button>
            </div>
          </div>
        )}
        <div className="changes-body">
          {loaded.state === 'loading' && <p className="changes-note">Reading…</p>}
          {loaded.state === 'not-kept' && <p className="changes-note">No change to a model file of this project is kept for this turn. torno holds the last 20 turns of a session, in memory, and only the .py files in the project's folder.</p>}
          {file && <FileView key={file.file} file={file} whole={whole} />}
          {net.length > 0 && (
            <div className="changes-net">
              <p className="changes-name">The builds, taken together</p>
              <ul>
                {net.map((line) => (
                  <li key={line}>{numbered(line)}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>
    </div>,
    host
  )
}
