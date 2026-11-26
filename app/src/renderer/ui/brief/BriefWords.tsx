import { Fragment, memo, useMemo, type ReactNode } from 'react'
import { linksIn } from '../../../shared/board'
import { linkLabel } from '../../../shared/brief'
import { type Block, type Inline, parseMarkdown } from '../chat/markdown'
import { boardActions } from '../../state/board'

// `brief.md` set as a page (#338): headings, paragraphs, lists with hanging indents, numbers in the face of numbers, and a
// web address as a link with its host, never the address broken over lines. Nothing is html: every piece is a text node.
// A link opens in the browser through main, by its place among the file's addresses (`linksIn`): no address goes from here.

const ADDRESS = /https?:\/\/\S+/i

const wordsOf = (e: unknown): string => (e instanceof Error ? e.message : String(e)).replace(/^Error invoking remote method '[^']*': (?:Error: )?/, '')

/** The arrow out of the page, drawn small beside a link. */
function Out() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
      <path d="M7 1.5h3.5V5M10.5 1.5 5.5 6.5M9 7.5V10H2V3h2.5" />
    </svg>
  )
}

interface Drawing {
  objectId: string
  cardId: string
  /** The place among the file's addresses of the next link drawn whose address is `url`. */
  nth(url: string): number
}

function WebLink({ draw, url, text }: { draw: Drawing; url: string; text?: string }) {
  const { label, host } = linkLabel(url)
  const nth = draw.nth(url)
  if (nth < 0) return <span className="brief-weblink-off">{text ?? url}</span>
  return (
    <a
      className="brief-weblink"
      href={url}
      title={`Open in your browser: ${host || url}`}
      onClick={(e) => {
        e.preventDefault()
        window.torno.board.openLink(draw.objectId, draw.cardId, nth).catch((error: unknown) => boardActions.say(wordsOf(error)))
      }}
    >
      <Out />
      <span className="brief-weblink-label">{text ?? label}</span>
      {host !== '' && <span className="brief-weblink-host">{host}</span>}
    </a>
  )
}

/** A number of the person's words, in the face of numbers: one on its own or before a unit (`16mm`), never one inside a name (`ESP32`, `MTS-101-F1`). */
const NUMBER = /((?<![\p{L}\p{N}_\-/.])\d+(?:[.,]\d+)?(?![\p{N}\-]|[.,]\d|\p{L}+\p{N}))/u

function numbers(text: string): ReactNode[] {
  return text.split(NUMBER).map((piece, n) =>
    n % 2 === 1 ? (
      <span key={n} className="num">
        {piece}
      </span>
    ) : (
      piece
    )
  )
}

/** Plain words, with each bare address as a link and each number in the face of numbers. */
function plain(text: string, key: string, draw: Drawing): ReactNode[] {
  const out: ReactNode[] = []
  let rest = text
  let n = 0
  for (let m = ADDRESS.exec(rest); m; m = ADDRESS.exec(rest)) {
    const url = linksIn(m[0])[0] ?? m[0]
    if (m.index > 0) out.push(<Fragment key={`${key}t${n}`}>{numbers(rest.slice(0, m.index))}</Fragment>)
    out.push(<WebLink key={`${key}a${n}`} draw={draw} url={url} />)
    rest = rest.slice(m.index + url.length)
    n += 1
  }
  if (rest !== '') out.push(<Fragment key={`${key}t${n}`}>{numbers(rest)}</Fragment>)
  return out
}

function inlines(of: Inline[], key: string, draw: Drawing): ReactNode[] {
  return of.map((piece, n) => {
    const k = `${key}.${n}`
    switch (piece.t) {
      case 'text':
        return <Fragment key={k}>{plain(piece.text, k, draw)}</Fragment>
      case 'code':
        return (
          <code key={k} className="num">
            {piece.text}
          </code>
        )
      case 'bold':
        return <strong key={k}>{inlines(piece.of, k, draw)}</strong>
      case 'italic':
        return <em key={k}>{inlines(piece.of, k, draw)}</em>
      case 'link':
        return /^https?:\/\//i.test(piece.url) ? <WebLink key={k} draw={draw} url={piece.url} text={piece.text} /> : <Fragment key={k}>{plain(piece.text, k, draw)}</Fragment>
    }
  })
}

function list(block: Extract<Block, { t: 'list' }>['list'], key: string, draw: Drawing): ReactNode {
  const Tag = block.ordered ? 'ol' : 'ul'
  return (
    <Tag key={key}>
      {block.items.map((item, n) => (
        <li key={n}>
          {inlines(item.of, `${key}.${n}`, draw)}
          {item.list && list(item.list, `${key}.${n}l`, draw)}
        </li>
      ))}
    </Tag>
  )
}

function block(b: Block, key: string, draw: Drawing): ReactNode {
  switch (b.t) {
    case 'p':
      return <p key={key}>{inlines(b.of, key, draw)}</p>
    case 'heading':
      return <h3 key={key}>{inlines(b.of, key, draw)}</h3>
    case 'quote':
      return <blockquote key={key}>{inlines(b.of, key, draw)}</blockquote>
    case 'rule':
      return <hr key={key} />
    case 'code':
      return (
        <pre key={key} className="num">
          {b.text}
        </pre>
      )
    case 'list':
      return list(b.list, key, draw)
    case 'table':
      return (
        <table key={key}>
          <thead>
            <tr>
              {b.head.map((c, n) => (
                <th key={n}>{inlines(c, `${key}h${n}`, draw)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {b.rows.map((row, r) => (
              <tr key={r}>
                {row.map((c, n) => (
                  <td key={n}>{inlines(c, `${key}r${r}c${n}`, draw)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      )
  }
}

/** The words of `brief.md` (`words`, as `briefWords` gives them), set; `full` is the file's text, whose addresses main numbers. */
export const BriefWords = memo(function BriefWords({ objectId, cardId, words, full }: { objectId: string; cardId: string; words: string; full: string }) {
  const blocks = useMemo(() => parseMarkdown(words), [words])
  const links = useMemo(() => linksIn(full), [full])
  // The links are drawn in the order of the file, so each takes the next of its address from where the last one was.
  let cursor = 0
  const draw: Drawing = {
    objectId,
    cardId,
    nth(url) {
      const at = links.indexOf(url, cursor)
      // An address main would not read the same is no link: it is never opened as another.
      if (at < 0) return -1
      cursor = at + 1
      return at
    }
  }
  return <div className="brief-words">{blocks.map((b, n) => block(b, `b${n}`, draw))}</div>
})
