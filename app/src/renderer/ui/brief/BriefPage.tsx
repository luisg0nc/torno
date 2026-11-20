import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { type Card } from '../../../shared/board'
import { briefSections, rulesSaid } from '../../../shared/brief'
import type { DimensionMark } from '../../../shared/marks'
import { sizesTold, tallyReadings, tieReading } from '../../../shared/ties'
import type { SizeFact } from '../../../shared/size'
import { boardActions, useBoard } from '../../state/board'
import { actions, useStore } from '../../state/store'
import { tyingActions } from '../../state/tying'
import { ChecksBlock, MarksBlock } from './Held'
import { HEIC_REASON, isHeic, prepareImage } from '../onboard/images'
import { addNote, addPicture, addRule, addSize, editSize, editText, removeCard, restoreCard, tieSize, unhideCard } from './ops'
import { TiePanel } from './TiePanel'
import { PictureView } from './PictureView'
import { NoteRow, PictureTile, ReferenceLine, RuleRow, SizeRow } from './Rows'
import { SizeForm } from './SizeForm'
import { TextForm } from './TextForm'

// The brief in the view's place, read like an inspection sheet: what we are making with its pictures beside it, a ledger of
// sizes, the rules the same way, then the notes. Each size and rule has a column for what the build on show says of it; until
// something checks them every one reads "nothing checks this". The cards are the board's (`board.json`), changed only by main.

const isImage = (f: File): boolean => f.type === 'image/png' || f.type === 'image/jpeg' || f.type === 'image/webp' || /\.heic$/i.test(f.name)
const wordsOf = (e: unknown): string => (e instanceof Error ? e.message : String(e)).replace(/^Error invoking remote method '[^']*': (?:Error: )?/, '')

/** The text of the project's brief.md, read again when the board changes (a card's change is the one thing that says the project did). Null: there is none; undefined: not read yet. */
function useBrief(objectId: string, wanted: boolean, board: unknown): string | null | undefined {
  const [brief, setBrief] = useState<{ of: string; text: string | null } | undefined>(undefined)
  useEffect(() => {
    if (!wanted) return
    let live = true
    window.torno.board.brief(objectId).then(
      (text) => live && setBrief((was) => (was?.of === objectId && was.text === text ? was : { of: objectId, text })),
      () => {}
    )
    return () => {
      live = false
    }
  }, [objectId, wanted, board])
  return wanted && brief?.of === objectId ? brief.text : undefined
}

type Adding = 'size' | 'rule' | 'note' | null

export function BriefPage() {
  const objectId = useBoard((s) => s.objectId)
  const board = useBoard((s) => s.board)
  const lit = useBoard((s) => s.selected)
  const problem = useBoard((s) => s.problem)
  const fileProblem = useBoard((s) => s.fileProblem)
  const fileAside = useBoard((s) => s.fileAside)
  const asideAsk = useBoard((s) => s.asideAsk)
  const putBack = useBoard((s) => s.putBack)
  // "Brief put back. Undo" stays for ten seconds, as a removal's does.
  useEffect(() => {
    if (!putBack) return
    const timer = setTimeout(() => boardActions.endPutBack(), 10_000)
    return () => clearTimeout(timer)
  }, [putBack])
  const attached = useBoard((s) => s.attached)
  const [adding, setAdding] = useState<Adding>(null)
  const [menu, setMenu] = useState(false)
  const [editing, setEditing] = useState<string | null>(null)
  const [tying, setTying] = useState<string | null>(null)
  const marks = useStore((s) => s.marks)
  const build = useStore((s) => (s.scene ? s.revision : undefined))
  const [viewing, setViewing] = useState<{ url: string; label: string } | null>(null)
  const [removed, setRemoved] = useState<{ id: string; what: string } | null>(null)
  const page = useRef<HTMLElement>(null)
  const files = useRef<HTMLInputElement>(null)
  const sections = useMemo(() => (board ? briefSections(board) : null), [board])
  // What each tied size reads: the verdict of its dimension on the build on show (the same the Checks section reads).
  const readings = useMemo(() => {
    const dims = new Map(marks.filter((m): m is DimensionMark => m.kind === 'dimension').map((m) => [m.id, m]))
    return new Map((sections?.sizes ?? []).map((c) => [c.id, tieReading(c.size!, c.size!.tie ? dims.get(c.size!.tie.mark) : undefined, build)]))
  }, [sections, marks, build])
  const brief = useBrief(objectId ?? '', objectId !== null && sections?.hasWhat === true, board)

  // What main refused is said for a few seconds, and a removal can be taken back for a while.
  useEffect(() => {
    if (problem === null) return
    const timer = setTimeout(() => boardActions.say(null), 7000)
    return () => clearTimeout(timer)
  }, [problem])
  useEffect(() => {
    if (removed === null) return
    const timer = setTimeout(() => setRemoved(null), 10000)
    return () => clearTimeout(timer)
  }, [removed])

  // A ref in the chat lit a card: it is brought into view.
  useEffect(() => {
    const id = lit[0]
    if (id !== undefined) page.current?.querySelector(`[data-card="${id}"]`)?.scrollIntoView({ block: 'center' })
  }, [lit])

  if (objectId === null || sections === null) return <section className="brief-page" aria-label="Brief" data-brief="" ref={page} />
  const id = objectId

  const empty = sections.pictures.length + sections.sizes.length + sections.rules.length + sections.notes.length + sections.references.length === 0 && !sections.hasWhat

  async function take(list: readonly File[]): Promise<void> {
    for (const file of list.filter(isImage)) {
      let prepared
      try {
        const bytes = new Uint8Array(await file.arrayBuffer())
        if (isHeic(bytes)) throw new Error(`${file.name}: ${HEIC_REASON}`)
        prepared = await prepareImage(bytes, file.name)
      } catch (e) {
        boardActions.say(wordsOf(e))
        continue
      }
      await addPicture(id, prepared.image)
    }
  }

  async function remove(card: Card, what: string): Promise<void> {
    if (await removeCard(id, card.id)) setRemoved({ id: card.id, what })
  }

  const acts = (card: Card, what: string, edit = card.by === 'person') => ({
    ...(edit ? { onEdit: () => setEditing(card.id) } : {}),
    onRemove: () => void remove(card, what)
  })
  const isLit = (card: Card): boolean => lit.includes(card.id)
  const done = (): void => {
    setAdding(null)
    setEditing(null)
  }
  const keepSize = (card: Card | null) => async (size: SizeFact): Promise<void> => {
    if (await (card ? editSize(id, card.id, size) : addSize(id, size))) done()
  }
  const keepText = (card: Card | null, rule: boolean) => async (text: string): Promise<void> => {
    if (await (card ? editText(id, card.id, text) : rule ? addRule(id, text) : addNote(id, text))) done()
  }

  return (
    <section ref={page} className="brief-page" aria-label="Brief" data-brief="" onDragOver={(e) => e.dataTransfer.types.includes('Files') && e.preventDefault()} onDrop={(e) => {
      if (!e.dataTransfer.files.length) return
      e.preventDefault()
      void take([...e.dataTransfer.files])
    }}>
      <header className="brief-head">
        <h1>What we are making</h1>
        <span className="grow" />
        <button type="button" className="button button-quiet" aria-pressed={attached?.ids === 'all'} title="Put the whole brief in the chat, to go with your next prompt" onClick={() => {
          boardActions.attachAll()
          actions.setDockOpen(true)
        }}>
          Send with the next prompt
        </button>
        <span className="brief-add">
          <button type="button" className="button" aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu(!menu)}>
            Add
          </button>
          {menu && (
            <div className="brief-menu" role="menu" onMouseLeave={() => setMenu(false)}>
              {(['size', 'rule', 'note'] as const).map((what) => (
                <button key={what} type="button" role="menuitem" onClick={() => { setMenu(false); setEditing(null); setAdding(what) }}>
                  {what === 'size' ? 'A size' : what === 'rule' ? 'A rule' : 'A note'}
                </button>
              ))}
              <button type="button" role="menuitem" onClick={() => { setMenu(false); files.current?.click() }}>
                A picture
              </button>
            </div>
          )}
        </span>
      </header>

      {(problem !== null || fileProblem !== null || removed !== null || putBack) && (
        <div className="brief-notices">
          {problem !== null && <p className="brief-problem" role="status">{problem}</p>}
          {fileProblem !== null && (
            <p className="brief-problem selectable" role="status">
              {fileProblem}{' '}
              {fileAside && asideAsk === null && (
                <>
                  <button type="button" className="link-button" title="Use the copy kept aside as the brief, once it reads whole" onClick={() => void boardActions.useAside()}>
                    Put the copy back
                  </button>{' '}
                  <button type="button" className="link-button" title="Delete the copy kept aside" onClick={() => void boardActions.letGoAside()}>
                    Let it go
                  </button>{' '}
                </>
              )}
              {fileAside && asideAsk !== null && (
                <>
                  <strong>{asideAsk === 1 ? 'The brief has 1 card made since.' : `The brief has ${asideAsk} cards made since.`} Replace {asideAsk === 1 ? 'it' : 'them'} with the copy?</strong>{' '}
                  <button type="button" className="link-button" onClick={() => void boardActions.useAside(true)}>
                    Replace
                  </button>{' '}
                  <button type="button" className="link-button" onClick={() => boardActions.keepThisOne()}>
                    Keep this one
                  </button>{' '}
                </>
              )}
              <button type="button" className="link-button" onClick={() => {
                boardActions.dismissFileProblem()
                void window.torno.board.dismissProblem(id).catch(() => {})
              }}>
                Dismiss
              </button>
            </p>
          )}
          {putBack && (
            <p className="brief-removed" role="status">
              Brief put back.{' '}
              <button type="button" className="link-button" onClick={() => void boardActions.undoAside()}>
                Undo
              </button>
            </p>
          )}
          {removed !== null && (
            <p className="brief-removed" role="status">
              Removed {removed.what}.{' '}
              <button type="button" className="link-button" onClick={() => void restoreCard(id, removed.id).then(() => setRemoved(null))}>
                Undo
              </button>
            </p>
          )}
        </div>
      )}

      <div className="brief-making">
        <div>
          {sections.hasWhat ? (
            <>
              <p className="brief-words">{brief === undefined ? '' : (brief ?? 'There is no brief.md in this project.')}</p>
              <p className="brief-by">
                Your words, from{' '}
                <button type="button" className="link-button num" title="Open brief.md in your editor" onClick={() => void window.torno.board.open(id, { kind: 'brief' }).catch((e: unknown) => boardActions.say(wordsOf(e)))}>
                  brief.md
                </button>
              </p>
            </>
          ) : (
            <p className="brief-by">{empty ? 'Nothing in the brief yet. Add a size, a rule, a note or a picture.' : 'This project has no brief.md.'}</p>
          )}
          {sections.references.map((c) => (
            <ReferenceLine key={c.id} objectId={id} card={c} />
          ))}
        </div>
        {sections.pictures.length > 0 && (
          <div className="brief-tiles">
            {sections.pictures.map((c) => (
              <PictureTile key={c.id} objectId={id} card={c} lit={isLit(c)} onOpen={(url, label) => setViewing({ url, label })} acts={acts(c, 'the picture', false)} />
            ))}
          </div>
        )}
      </div>

      {sections.hidden.length > 0 && (
        <p className="brief-hidden">
          Put away:{' '}
          {sections.hidden.map((c) => (
            <span key={c.id}>
              <span className="num">{c.kind === 'brief' ? 'brief.md' : (c.source ?? c.id).replace(/^reference\//, '')}</span>{' '}
              <button type="button" className="link-button" onClick={() => void unhideCard(id, c.id)}>
                Show
              </button>{' '}
            </span>
          ))}
        </p>
      )}

      <section className="brief-block" aria-label="Sizes">
        <div className="brief-block-head">
          <h2>Sizes</h2>
          <span className="brief-said num">{sizesTold(sections.sizes.length, tallyReadings([...readings.values()]))}</span>
          <button type="button" className="link-button" onClick={() => { setEditing(null); setAdding('size') }}>
            Add a size
          </button>
        </div>
        {(sections.sizes.length > 0 || adding === 'size') && (
          <div className="brief-ledger">
            {sections.sizes.length > 0 && (
              <div className="brief-row brief-headrow" aria-hidden="true">
                <span>Size</span>
                <span>What it measures, from where</span>
                <span className="brief-against">Against the build on show</span>
              </div>
            )}
            {sections.sizes.map((c) =>
              editing === c.id ? (
                <SizeForm key={c.id} was={c.size} onKeep={keepSize(c)} onCancel={done} />
              ) : (
                <Fragment key={c.id}>
                  <SizeRow card={c} lit={isLit(c)} acts={acts(c, c.size?.what ?? 'the size')} reading={readings.get(c.id) ?? { state: 'none' }} build={build} tying={tying === c.id} onTie={() => setTying(tying === c.id ? null : c.id)} />
                  {tying === c.id && (
                    <TiePanel
                      card={c}
                      marks={marks}
                      sizes={sections.sizes}
                      revision={build}
                      onMeasure={build === undefined ? null : () => tyingActions.begin(id, c)}
                      onClose={() => setTying(null)}
                      onTie={(mark, tolerance) => void tieSize(id, c.id, mark, tolerance).then((ok) => ok && setTying(null))}
                      onUntie={() => void tieSize(id, c.id, null).then((ok) => ok && setTying(null))}
                    />
                  )}
                </Fragment>
              )
            )}
            {adding === 'size' && <SizeForm onKeep={keepSize(null)} onCancel={done} />}
          </div>
        )}
      </section>

      <ChecksBlock />

      <section className="brief-block" aria-label="Rules">
        <div className="brief-block-head">
          <h2>Rules</h2>
          <span className="brief-said num">{rulesSaid(sections.rules.length)}</span>
          <button type="button" className="link-button" onClick={() => { setEditing(null); setAdding('rule') }}>
            Add a rule
          </button>
        </div>
        {(sections.rules.length > 0 || adding === 'rule') && (
          <div className="brief-ledger">
            {sections.rules.map((c) => (editing === c.id ? <TextForm key={c.id} initial={c.text} label="Rule" onKeep={keepText(c, true)} onCancel={done} /> : <RuleRow key={c.id} objectId={id} card={c} lit={isLit(c)} acts={acts(c, 'the rule')} />))}
            {adding === 'rule' && <TextForm label="New rule" onKeep={keepText(null, true)} onCancel={done} />}
          </div>
        )}
      </section>

      <section className="brief-block" aria-label="Notes">
        <div className="brief-block-head">
          <h2>Notes</h2>
          <button type="button" className="link-button" onClick={() => { setEditing(null); setAdding('note') }}>
            Add a note
          </button>
        </div>
        <div className="brief-notes">
          {sections.notes.map((c) => (editing === c.id ? <TextForm key={c.id} initial={c.text} label="Note" onKeep={keepText(c, false)} onCancel={done} /> : <NoteRow key={c.id} objectId={id} card={c} lit={isLit(c)} acts={acts(c, 'the note')} />))}
          {adding === 'note' && <TextForm label="New note" onKeep={keepText(null, false)} onCancel={done} />}
        </div>
      </section>

      <MarksBlock />

      <input ref={files} type="file" accept="image/png,image/jpeg" multiple hidden data-board-files="" onChange={(e) => {
        void take([...(e.currentTarget.files ?? [])])
        e.currentTarget.value = ''
      }} />
      {viewing && <PictureView url={viewing.url} label={viewing.label} onClose={() => setViewing(null)} />}
    </section>
  )
}
