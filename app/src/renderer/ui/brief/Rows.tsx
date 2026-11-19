import { memo, useEffect, useState } from 'react'
import { type Card, firstLink } from '../../../shared/board'
import { sizeSource, sizeValue } from '../../../shared/brief'
import { boardActions } from '../../state/board'
import { ensurePicture, pictureOf, usePictureUrl } from '../../state/boardPictures'
import { number } from '../../../shared/format'
import type { TieReading } from '../../../shared/ties'
import { Gauge } from '../card/Gauge'
import { refPieces } from './refPieces'

// The pieces of the sheet. A row is drawn again only when its card or whether it is lit changes.

const by = (card: Card): string => (card.by === 'agent' ? 'Claude' : card.by === 'torno' ? 'torno' : 'you')

/** What a size or a rule reads against the build on show: nothing, until something checks it. A dashed, empty gauge, a gap to fill and not a failure. */
export function Unchecked({ rule, gone }: { rule?: boolean; gone?: string }) {
  return (
    <div className="brief-against" data-none="">
      <span className="brief-verdict">nothing checks this</span>
      <span className="brief-reading num">{rule ? 'a judgement: no measure says it' : gone !== undefined ? `${gone} is gone: tie it to another` : ''}</span>
      <svg className="brief-gauge" width="64" height="16" viewBox="0 0 64 16" role="img" aria-label="not checked">
        <line x1="2" y1="8" x2="62" y2="8" stroke="var(--hairline)" strokeWidth="1" />
        <rect x="14" y="5" width="36" height="6" rx="1" fill="none" stroke="var(--field-edge)" strokeWidth="1" strokeDasharray="3 2" />
      </svg>
    </div>
  )
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
function Words({ objectId, card }: { objectId: string; card: Card }) {
  const text = card.text ?? ''
  const link = firstLink(text)
  const at = link === null ? -1 : text.indexOf(link)
  if (link === null || at < 0) return <Pieces text={text} />
  return (
    <>
      <Pieces text={text.slice(0, at)} />
      <a
        className="brief-link num"
        href={link}
        title="Open in your browser"
        onClick={(e) => {
          e.preventDefault()
          window.torno.board.openLink(objectId, card.id).catch((error: unknown) => boardActions.say(error instanceof Error ? error.message.replace(/^Error invoking remote method '[^']*': (?:Error: )?/, '') : String(error)))
        }}
      >
        {link}
      </a>
      <Pieces text={text.slice(at + link.length)} />
    </>
  )
}

interface Acts {
  onEdit?: () => void
  onRemove: () => void
}

function Buttons({ acts, what }: { acts: Acts; what: string }) {
  return (
    <span className="brief-acts">
      {acts.onEdit && (
        <button type="button" className="link-button" aria-label={`Edit ${what}`} onClick={acts.onEdit}>
          Edit
        </button>
      )}
      <button type="button" className="link-button" aria-label={`Remove ${what}`} onClick={acts.onRemove}>
        Remove
      </button>
    </span>
  )
}

/** What a tied size reads against the build on show: the dimension's verdict, what it reads, and its gauge, as the Checks section draws it. */
export function Tied({ reading, build }: { reading: Exclude<TieReading, { state: 'none' }>; build: number | undefined }) {
  const word = reading.state === 'holds' ? 'holds' : reading.state === 'fails' ? 'fails' : 'not measured'
  return (
    <div className="brief-against" data-state={reading.state}>
      <span className="brief-verdict" data-verdict={reading.state}>
        {word}
        {build !== undefined && build > 0 && <span className="num"> on r{build}</span>}
      </span>
      <span className="brief-reading num">{reading.reading}</span>
      <span className="brief-gauge-slot">
        <Gauge value={reading.value} lo={reading.lo} hi={reading.hi} verdict={reading.state === 'fails' ? 'fails' : undefined} />
      </span>
    </div>
  )
}

export const SizeRow = memo(function SizeRow({ card, lit, acts, reading, build, tying, onTie }: { card: Card; lit: boolean; acts: Acts; reading: TieReading; build: number | undefined; tying: boolean; onTie: () => void }) {
  const size = card.size!
  const checked = reading.state !== 'none'
  return (
    <div className="brief-row" data-card={card.id} data-by={card.by} data-lit={lit ? '' : undefined} data-none={checked ? undefined : ''} data-state={reading.state}>
      <div className="brief-value num">
        {sizeValue(size)}
        <span className="brief-unit">{size.unit}</span>
      </div>
      <div className="brief-what">
        <b>{size.what}</b>
        <span className="brief-source">{sizeSource(size)}</span>
        <span className="brief-id num">{card.id}</span>
        <button type="button" className="link-button brief-tie-button" aria-expanded={tying} aria-label={`${checked ? 'Change what checks' : 'Tie'} ${size.what}`} onClick={onTie}>
          {reading.state !== 'none' ? `${reading.mark} · ± ${number(size.tie?.tolerance ?? 0)}` : 'Tie…'}
        </button>
        <Buttons acts={acts} what={size.what} />
      </div>
      {reading.state !== 'none' ? <Tied reading={reading} build={build} /> : <Unchecked gone={reading.gone} />}
    </div>
  )
})

export const RuleRow = memo(function RuleRow({ objectId, card, lit, acts }: { objectId: string; card: Card; lit: boolean; acts: Acts }) {
  return (
    <div className="brief-row brief-rule" data-card={card.id} data-by={card.by} data-lit={lit ? '' : undefined} data-none="">
      <div className="brief-what">
        <p>
          <Words objectId={objectId} card={card} />
        </p>
        <span className="brief-id num">{card.id}</span>
        <Buttons acts={acts} what="the rule" />
      </div>
      <Unchecked rule />
    </div>
  )
})

export const NoteRow = memo(function NoteRow({ objectId, card, lit, acts }: { objectId: string; card: Card; lit: boolean; acts: Acts }) {
  return (
    <div className="brief-note" data-card={card.id} data-by={card.by} data-lit={lit ? '' : undefined}>
      <span className="brief-note-text">
        <Words objectId={objectId} card={card} />
      </span>
      <small>{by(card)}</small>
      <span className="brief-id num">{card.id}</span>
      <Buttons acts={acts} what="the note" />
    </div>
  )
})

/** A photo or doodle as a tile: its file or caption under it, large on a click. */
export function PictureTile({ objectId, card, lit, onOpen, acts }: { objectId: string; card: Card; lit: boolean; onOpen: (url: string, label: string) => void; acts: Acts }) {
  const file = pictureOf(card)
  useEffect(() => {
    if (file) ensurePicture(objectId, file)
  }, [objectId, file?.from, file?.file]) // eslint-disable-line react-hooks/exhaustive-deps
  const url = usePictureUrl(file)
  const name = card.source?.replace(/^reference\//, '') ?? card.picture ?? card.id
  const label = card.kind === 'sketch' ? 'doodle' : card.caption ?? name
  return (
    <figure className="brief-tile" data-card={card.id} data-by={card.by} data-lit={lit ? '' : undefined}>
      {url ? (
        <button type="button" className="brief-photo" aria-label={`Open ${name} large`} onClick={() => onOpen(url, label)}>
          <img src={url} alt="" draggable={false} />
        </button>
      ) : (
        <div className="brief-photo" data-missing="">
          {url === null ? 'picture not on this computer' : ''}
        </div>
      )}
      <figcaption>
        <span className="num">{name}</span>
        {card.caption !== undefined && card.caption !== '' && <small>{card.caption}</small>}
        <span className="brief-id num">{card.id}</span>
        <Buttons acts={{ onRemove: acts.onRemove }} what={name} />
      </figcaption>
    </figure>
  )
}

/** A bought part's STEP or a PDF: its name and a line to show it in its folder. */
export function ReferenceLine({ objectId, card }: { objectId: string; card: Card }) {
  const file = card.source ?? ''
  const [said, setSaid] = useState<string | null>(null)
  const kind = /\.pdf$/i.test(file) ? 'a PDF' : "a bought part's STEP"
  return (
    <div className="brief-ref" data-card={card.id}>
      <span className="num">{file.replace(/^reference\//, '')}</span>
      <small>{kind}{card.caption ? ` · ${card.caption}` : ''}</small>
      <button type="button" className="link-button" onClick={() => window.torno.board.open(objectId, { kind: 'reference', file }).then(() => setSaid(null), (e: unknown) => setSaid(e instanceof Error ? e.message : String(e)))}>
        Show in folder
      </button>
      {said !== null && <small role="status">{said}</small>}
    </div>
  )
}
