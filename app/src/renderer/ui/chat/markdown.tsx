import { Fragment, memo, useMemo, type ReactNode } from 'react'
import { refsIn } from '../../../shared/chat'
import { useSetSlugs } from '../../state/sets'
import { numbered } from '../numbered'
import { RefChip } from './RefChip'

// The subset of markdown the agent writes, drawn by torno's own hand: paragraphs, headings (bold lines, no larger
// sizes), lists nested by indent, fenced code, inline code, bold, italic, links (their text, and the address in the
// monospace face: nothing to click), tables of pipes, quotes and rules. Never raw html: everything is a React text
// node. No library.

export type Inline = { t: 'text'; text: string } | { t: 'code'; text: string } | { t: 'bold' | 'italic'; of: Inline[] } | { t: 'link'; text: string; url: string }

interface Item {
  of: Inline[]
  /** A list nested under this item. */
  list?: List
}
interface List {
  ordered: boolean
  items: Item[]
}
export type Block =
  | { t: 'p'; of: Inline[] }
  | { t: 'heading'; of: Inline[] }
  | { t: 'quote'; of: Inline[] }
  | { t: 'rule' }
  | { t: 'code'; text: string }
  | { t: 'list'; list: List }
  | { t: 'table'; head: Inline[][]; rows: Inline[][][] }

// Backticks, bold, italic (an underscore only at the edge of a word, so `snake_case` stays whole) and links.
const INLINE = /(`+)([\s\S]*?[^`])\1(?!`)|\*\*(?=\S)([\s\S]+?)\*\*|__(?=\S)([\s\S]+?)__|\*(?=[^\s*])([\s\S]*?[^\s*])\*|(?<![\p{L}\p{N}_])_(?=[^\s_])([\s\S]*?[^\s_])_(?![\p{L}\p{N}_])|\[([^\]\n]+)\]\(([^)\s]+)\)/u

/**
 * The most a line is read for markers: the scan for the end of a marker that never comes costs the square of the
 * line, so a longer one (nothing a person writes, or a log pasted in) is drawn as the plain text it is.
 */
const MAX_INLINE = 4000

/** A line of text in pieces. Nothing nests deeper than bold over italic over code, which is a few levels at most. */
function inlines(text: string, depth = 0): Inline[] {
  if (text.length > MAX_INLINE) return [{ t: 'text', text }]
  const found: Inline[] = []
  let rest = text
  while (rest !== '') {
    const m = depth > 4 ? null : INLINE.exec(rest)
    if (!m) {
      found.push({ t: 'text', text: rest })
      break
    }
    if (m.index > 0) found.push({ t: 'text', text: rest.slice(0, m.index) })
    if (m[1] !== undefined) found.push({ t: 'code', text: m[2].replace(/^ (.*) $/, '$1') })
    else if (m[3] !== undefined || m[4] !== undefined) found.push({ t: 'bold', of: inlines(m[3] ?? m[4], depth + 1) })
    else if (m[5] !== undefined || m[6] !== undefined) found.push({ t: 'italic', of: inlines(m[5] ?? m[6], depth + 1) })
    else found.push({ t: 'link', text: m[7], url: m[8] })
    rest = rest.slice(m.index + m[0].length)
  }
  return found
}

const FENCE = /^\s{0,3}(```+|~~~+)/
const HEADING = /^\s{0,3}#{1,6}\s+(.*)$/
const BULLET = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/
const RULE = /^\s{0,3}([-*_])(\s*\1){2,}\s*$/
const QUOTE = /^\s{0,3}>\s?(.*)$/
const TABLE_SEPARATOR = /^\s*\|?\s*:?-{1,}:?\s*(\|\s*:?-{1,}:?\s*)*\|?\s*$/

/** A heading's text without the closing hashes (`## Title ##`) and the blanks round it, with no regex that backtracks. */
function headingText(rest: string): string {
  let end = rest.trimEnd().length
  let hashes = end
  while (hashes > 0 && rest[hashes - 1] === '#') hashes -= 1
  // Hashes are closing ones only when a blank stands before them.
  if (hashes < end && hashes > 0 && /\s/.test(rest[hashes - 1])) end = hashes
  return rest.slice(0, end).trimEnd().trimStart()
}

const cells = (line: string): string[] => line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim())

const startsBlock = (line: string): boolean => FENCE.test(line) || HEADING.test(line) || BULLET.test(line) || RULE.test(line) || QUOTE.test(line)

/** Folds the flat lines of a list into lists inside lists, by how far each is indented. */
function listOf(lines: Array<{ indent: number; ordered: boolean; text: string }>): List {
  const root: List = { ordered: lines[0].ordered, items: [] }
  const stack: Array<{ indent: number; list: List }> = [{ indent: lines[0].indent, list: root }]
  for (const line of lines) {
    while (stack.length > 1 && line.indent < stack[stack.length - 1].indent) stack.pop()
    let top = stack[stack.length - 1]
    if (line.indent > top.indent) {
      const parent = top.list.items[top.list.items.length - 1]
      if (parent) {
        parent.list = { ordered: line.ordered, items: [] }
        top = { indent: line.indent, list: parent.list }
        stack.push(top)
      }
    }
    top.list.items.push({ of: inlines(line.text) })
  }
  return root
}

/** Text in blocks. A fence never closed (a text still streaming) is code to the end. */
export function parseMarkdown(text: string): Block[] {
  const lines = text.replace(/\r\n?/g, '\n').split('\n')
  const blocks: Block[] = []
  let at = 0
  while (at < lines.length) {
    const line = lines[at]
    if (line.trim() === '') {
      at += 1
      continue
    }
    const fence = FENCE.exec(line)
    if (fence) {
      const body: string[] = []
      at += 1
      while (at < lines.length && !(lines[at].trim().startsWith(fence[1]) && lines[at].trim().replace(/[`~]/g, '') === '')) body.push(lines[at++])
      at += 1
      blocks.push({ t: 'code', text: body.join('\n') })
      continue
    }
    // What is longer than this is no heading, rule or table row: it is a paragraph, whatever it begins with.
    const short = line.length <= MAX_INLINE
    const heading = short ? HEADING.exec(line) : null
    if (heading) {
      blocks.push({ t: 'heading', of: inlines(headingText(heading[1])) })
      at += 1
      continue
    }
    if (short && RULE.test(line) && !BULLET.test(line)) {
      blocks.push({ t: 'rule' })
      at += 1
      continue
    }
    if (short && line.includes('|') && at + 1 < lines.length && lines[at + 1].length <= MAX_INLINE && TABLE_SEPARATOR.test(lines[at + 1]) && lines[at + 1].includes('-')) {
      const head = cells(line).map((c) => inlines(c))
      const rows: Inline[][][] = []
      at += 2
      while (at < lines.length && lines[at].includes('|') && lines[at].trim() !== '') rows.push(cells(lines[at++]).map((c) => inlines(c)))
      blocks.push({ t: 'table', head, rows })
      continue
    }
    if (QUOTE.test(line)) {
      const quoted: string[] = []
      while (at < lines.length && QUOTE.test(lines[at])) quoted.push(QUOTE.exec(lines[at++])![1])
      blocks.push({ t: 'quote', of: inlines(quoted.join(' ')) })
      continue
    }
    if (BULLET.test(line)) {
      const flat: Array<{ indent: number; ordered: boolean; text: string }> = []
      while (at < lines.length) {
        const m = BULLET.exec(lines[at])
        if (m && !RULE.test(lines[at])) flat.push({ indent: m[1].replace(/\t/g, '    ').length, ordered: /\d/.test(m[2]), text: m[3] })
        // A line indented under an item goes on with it.
        else if (flat.length > 0 && lines[at].trim() !== '' && /^\s+\S/.test(lines[at]) && !startsBlock(lines[at])) flat[flat.length - 1].text += ` ${lines[at].trim()}`
        else break
        at += 1
      }
      blocks.push({ t: 'list', list: listOf(flat) })
      continue
    }
    const paragraph: string[] = []
    while (at < lines.length && lines[at].trim() !== '' && (paragraph.length === 0 || !startsBlock(lines[at]))) {
      paragraph.push(lines[at].trim())
      at += 1
    }
    blocks.push({ t: 'p', of: inlines(paragraph.join(' ')) })
  }
  return blocks
}

/** Plain text: refs are chips and numbers are in the monospace face. */
function plain(text: string, key: string): ReactNode {
  return <Plain key={key} text={text} at={key} />
}

/** A run of plain text: its refs are chips, a `#deck` among them when the project has a named set of that name, and numbers are in the monospace face. */
function Plain({ text, at }: { text: string; at: string }) {
  const slugs = useSetSlugs()
  return <>{refsIn(text, slugs).map((piece, n) => (piece.ref !== undefined ? <RefChip key={`${at}${n}`} value={piece.ref} prose /> : <Fragment key={`${at}${n}`}>{numbered(piece.text)}</Fragment>))}</>
}

function drawInlines(of: Inline[], key: string): ReactNode[] {
  return of.map((piece, n) => {
    const k = `${key}.${n}`
    switch (piece.t) {
      case 'text':
        return plain(piece.text, k)
      case 'code':
        return (
          <code key={k} className="md-inline">
            {piece.text}
          </code>
        )
      case 'bold':
        return <strong key={k}>{drawInlines(piece.of, k)}</strong>
      case 'italic':
        return <em key={k}>{drawInlines(piece.of, k)}</em>
      case 'link':
        return (
          <Fragment key={k}>
            {piece.text} <span className="md-url num">{piece.url}</span>
          </Fragment>
        )
    }
  })
}

function drawList({ ordered, items }: List, key: string): ReactNode {
  const Tag = ordered ? 'ol' : 'ul'
  return (
    <Tag key={key}>
      {items.map((item, n) => (
        <li key={n}>
          {drawInlines(item.of, `${key}.${n}`)}
          {item.list && drawList(item.list, `${key}.${n}l`)}
        </li>
      ))}
    </Tag>
  )
}

function drawBlock(block: Block, key: string): ReactNode {
  switch (block.t) {
    case 'p':
      return <p key={key}>{drawInlines(block.of, key)}</p>
    case 'heading':
      return (
        <p key={key} className="md-heading">
          <strong>{drawInlines(block.of, key)}</strong>
        </p>
      )
    case 'quote':
      return (
        <blockquote key={key} className="md-quote">
          {drawInlines(block.of, key)}
        </blockquote>
      )
    case 'rule':
      return <hr key={key} className="md-rule" />
    case 'code':
      return (
        <pre key={key} className="md-code">
          <code>{block.text}</code>
        </pre>
      )
    case 'list':
      return drawList(block.list, key)
    case 'table':
      return (
        <table key={key} className="md-table">
          <thead>
            <tr>
              {block.head.map((c, n) => (
                <th key={n}>{drawInlines(c, `${key}h${n}`)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {block.rows.map((row, r) => (
              <tr key={r}>
                {row.map((c, n) => (
                  <td key={n}>{drawInlines(c, `${key}r${r}c${n}`)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      )
  }
}

/** The agent's text, drawn. */
export const Markdown = memo(function Markdown({ text }: { text: string }) {
  // Parsed once for a text, not again for what else the pane draws meanwhile.
  const blocks = useMemo(() => parseMarkdown(text), [text])
  return <div className="md">{blocks.map((block, n) => drawBlock(block, `b${n}`))}</div>
})
