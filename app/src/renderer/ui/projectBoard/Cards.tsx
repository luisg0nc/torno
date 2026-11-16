import { memo, useEffect, useMemo, useState } from 'react'
import type { Card } from '../../../shared/board'
import type { HistoryEntry } from '../../../shared/history'
import { boardActions, useBoard } from '../../state/board'
import { ensurePicture, pictureOf, usePictureUrl } from '../../state/boardPictures'
import { useStore } from '../../state/store'
import { useHistory } from '../useHistory'
import { type Facts, faceOf, refPieces } from './faces'

// The cards of the board, drawn read-only. This layer is drawn again when a card, what a card shows, or the selection
// changes, and never for a pan or a zoom: the camera moves the layer's transform and nothing in React hears of it.

/** Under test only: how many times this layer has been drawn, for the check that a pan draws it no more. */
const counted = typeof location !== 'undefined' && new URLSearchParams(location.search).has('test')

const same = (a: Facts, b: Facts): boolean => (Object.keys(a) as Array<keyof Facts>).length === (Object.keys(b) as Array<keyof Facts>).length && (Object.keys(a) as Array<keyof Facts>).every((k) => Object.is(a[k], b[k]))

/** The corners a card is resized by. */
export const CORNERS = ['nw', 'ne', 'sw', 'se'] as const

interface CardProps {
  objectId: string
  card: Card
  facts: Facts
  selected: boolean
  /** Whether the card shows its handles to be resized by: when it is the one selected. */
  handles: boolean
}

function Pieces({ text }: { text: string }) {
  return (
    <>
      {refPieces(text).map((p, i) =>
        p.ref ? (
          <span key={i} className="num">
            {p.text}
          </span>
        ) : (
          p.text
        )
      )}
    </>
  )
}

/** The text of a card with the web address in it as a link: main opens it in the browser, from the card, so no address is ever sent from here. */
function LinkBody({ objectId, cardId, text, link }: { objectId: string; cardId: string; text: string; link: string }) {
  const at = text.indexOf(link)
  if (at < 0) return <Pieces text={text} />
  return (
    <>
      <Pieces text={text.slice(0, at)} />
      <a
        className="pboard-link num"
        href={link}
        data-link=""
        title="Open in your browser"
        onClick={(e) => {
          e.preventDefault()
          window.torno.board.openLink(objectId, cardId).catch((error: unknown) => boardActions.say(error instanceof Error ? error.message.replace(/^Error invoking remote method '[^']*': (?:Error: )?/, '') : String(error)))
        }}
      >
        {link}
      </a>
      <Pieces text={text.slice(at + link.length)} />
    </>
  )
}

/** One card, drawn again only when it, what it shows or whether it is selected changes. */
const CardView = memo(
  function CardView({ objectId, card, facts, selected, handles }: CardProps) {
    const file = pictureOf(card)
    useEffect(() => {
      if (file) ensurePicture(objectId, file)
    }, [objectId, file?.from, file?.file]) // eslint-disable-line react-hooks/exhaustive-deps
    const url = usePictureUrl(file)
    const face = faceOf(card, file ? { ...facts, ...(url === undefined ? {} : { picture: url === null ? ('missing' as const) : ('here' as const) }) } : facts)
    return (
      <article
        className="pboard-card"
        data-card={card.id}
        data-kind={card.kind}
        data-by={card.by}
        data-selected={selected ? '' : undefined}
        style={{ left: card.x, top: card.y, width: card.w, height: card.h }}
      >
        <header className="pboard-head">
          <span className="pboard-kind">{face.label}</span>
          {face.chip !== undefined && face.chip !== '' && (
            <span className={face.chipAuthor ? 'mark-chip num' : 'pboard-chip num'} data-author={face.chipAuthor}>
              {face.chip}
            </span>
          )}
          <span className="pboard-id num">{card.id}</span>
        </header>
        {face.title !== undefined && face.title !== '' && <h3 className="pboard-title">{face.title}</h3>}
        {url && <img className="pboard-picture" src={url} alt="" draggable={false} />}
        {face.note && (
          <p className="pboard-note" data-missing={face.picture === 'missing' || undefined}>
            {face.note}
          </p>
        )}
        {face.body !== undefined && (
          <div className="pboard-body" data-scroll={face.scroll ? '' : undefined}>
            {face.link !== undefined ? <LinkBody objectId={objectId} cardId={card.id} text={face.body} link={face.link} /> : <Pieces text={face.body} />}
          </div>
        )}
        {face.lines.length > 0 && (
          <ul className="pboard-lines">
            {face.lines.map((line, i) => (
              <li key={i} className={line.mono ? 'num' : undefined} data-tone={line.tone} data-big={line.big ? '' : undefined}>
                {line.text}
              </li>
            ))}
          </ul>
        )}
        {handles && CORNERS.map((corner) => <i key={corner} className="pboard-handle" data-handle={corner} aria-hidden="true" />)}
      </article>
    )
  },
  (a, b) => a.objectId === b.objectId && a.card === b.card && a.selected === b.selected && a.handles === b.handles && same(a.facts, b.facts)
)

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

export function Cards({ objectId, cards }: { objectId: string; cards: readonly Card[] }) {
  if (counted) window.__tornoBoardRenders = (window.__tornoBoardRenders ?? 0) + 1
  const selected = useBoard((s) => s.selected)
  const marks = useStore((s) => s.marks)
  const scans = useStore((s) => s.scans)
  const scanViews = useStore((s) => s.scanViews)
  const views = useStore((s) => s.views)
  const params = useStore((s) => s.scene?.params)
  const checks = useStore((s) => s.scene?.checks)
  const hasBrief = cards.some((c) => c.kind === 'brief')
  const hasBuild = cards.some((c) => c.kind === 'build')
  const brief = useBrief(objectId, hasBrief, cards)
  const history = useHistory(hasBuild)

  const markById = useMemo(() => new Map(marks.map((m) => [m.id, m])), [marks])
  const scanById = useMemo(() => new Map(scans.map((s) => [s.id, s])), [scans])
  const entries = useMemo(() => new Map<string, HistoryEntry>((history?.entries ?? []).map((e) => [e.id, e])), [history])
  const chosen = useMemo(() => new Set(selected), [selected])

  const shown = cards.filter((c) => !c.hidden)
  // Frames first, so that they lie under what is in them.
  const ordered = [...shown.filter((c) => c.kind === 'frame'), ...shown.filter((c) => c.kind !== 'frame')]

  function factsOf(card: Card): Facts {
    switch (card.kind) {
      case 'mark': {
        const mark = card.source === undefined ? undefined : markById.get(card.source)
        return mark ? { mark } : {}
      }
      case 'scan': {
        const scan = card.source === undefined ? undefined : scanById.get(card.source)
        return scan ? { scan, scanVisible: scanViews[scan.id]?.visible !== false } : {}
      }
      case 'brief':
        return brief === undefined ? {} : { brief }
      case 'view': {
        const found = views.find((v) => v.name === card.source)
        return { view: found ?? null }
      }
      case 'params':
        return params ? { params } : {}
      case 'checks':
        return checks ? { checks } : {}
      case 'build': {
        if (!history || !card.copy) return {}
        const entry = entries.get(card.copy.id)
        return { buildHere: entry !== undefined && entry.sources === card.copy.sources }
      }
      default:
        return {}
    }
  }

  return (
    <div className="pboard-cards" data-layer="cards">
      {ordered.map((card) => (
        <CardView key={card.id} objectId={objectId} card={card} facts={factsOf(card)} selected={chosen.has(card.id)} handles={chosen.size === 1 && chosen.has(card.id)} />
      ))}
    </div>
  )
}
