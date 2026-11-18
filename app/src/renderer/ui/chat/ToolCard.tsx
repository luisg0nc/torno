import { memo, useMemo, useState } from 'react'
import { type ChatItem, type ChatWhere, refsIn, shownPath, toolLabel } from '../../../shared/chat'
import { canPointAgain, pointAgain, seeInView } from '../../state/agent'
import { seeToolOf } from '../../state/seeAgain'
import { useSetSlugs } from '../../state/sets'
import { numbered } from '../numbered'
import { Diff } from './Diff'
import { editHunks, type Hunk, limitHunks } from './lineDiff'
import { Pictures } from './Pictures'
import { useChatPlace } from './place'
import { RefChip } from './RefChip'
import { RefText } from './RefText'

type Tool = Extract<ChatItem, { kind: 'tool' }>

/** A tool that went well says nothing: only the others, and one under way, keep their word. */
const STATE_WORD: Record<Tool['state'], string> = { running: 'running', done: '', error: 'failed', stopped: 'stopped', denied: 'denied', cancelled: 'cancelled' }
/** How much of an input or a result is shown before "Show all". */
const SHOWN_LINES = 12
/** Past this, even "Show all" shows no more: the item holds no more than 50,000 characters, and a page of them is slow to lay out. */
const SHOW_ALL_LIMIT = 20_000

function inputText(input: unknown): string {
  if (typeof input === 'string') return input
  if (input === undefined || input === null) return ''
  try {
    return JSON.stringify(input, null, 2) ?? ''
  } catch {
    return String(input)
  }
}

/** Lines of monospace text, the first few, with a way to see them all. */
function Lines({ label, text }: { label: string; text: string }) {
  const [all, setAll] = useState(false)
  if (text === '') return null
  const lines = text.split('\n')
  const more = lines.length > SHOWN_LINES
  const shown = all || !more ? text : lines.slice(0, SHOWN_LINES).join('\n')
  return (
    <div className="chat-lines">
      <p className="chat-lines-label">{label}</p>
      <pre className="chat-pre selectable">
        <RefText text={shown.length > SHOW_ALL_LIMIT ? `${shown.slice(0, SHOW_ALL_LIMIT)}…` : shown} />
      </pre>
      {more && !all && (
        <button type="button" className="chat-more" onClick={() => setAll(true)}>
          Show all {numbered(`${lines.length} lines`)}
        </button>
      )}
    </div>
  )
}

/** What an `Edit` or a `MultiEdit` changed, as lines removed and added: the first few, with a way to see them all. */
function Changes({ hunks, input, where }: { hunks: Hunk[]; input: unknown; where: ChatWhere }) {
  const [all, setAll] = useState(false)
  const path = typeof (input as { file_path?: unknown }).file_path === 'string' ? (input as { file_path: string }).file_path : undefined
  const shown = limitHunks(hunks, SHOWN_LINES, all)
  return (
    <div className="chat-lines">
      <p className="chat-lines-label">Input</p>
      {path !== undefined && (
        <p className="chat-ask-lead selectable" title={path}>
          {shownPath(path, where)}
        </p>
      )}
      <Diff hunks={shown.hunks} />
      {shown.more > 0 && (
        <button type="button" className="chat-more" onClick={() => setAll(true)}>
          Show all {numbered(`${shown.more} more changed lines`)}
        </button>
      )}
    </div>
  )
}

/** A tool's line in three: what stands before the word that carries it, that word in bold, and what follows. `Read` carries its file; torno's tools carry their name; the others their own. */
export function labelParts(name: string, label: string, torno: boolean): [string, string, string] {
  if (torno) {
    const at = label.indexOf(' (')
    return at < 0 ? ['', label, ''] : ['', label.slice(0, at), label.slice(at)]
  }
  if (name === 'Read') {
    const at = label.indexOf(' ')
    return at < 0 ? ['', label, ''] : [label.slice(0, at + 1), label.slice(at + 1), '']
  }
  const word = /^[^\s:]+/.exec(label)?.[0] ?? label
  return ['', word, label.slice(word.length)]
}

/**
 * A tool the agent used, as a chip: what it did, and how it went. It opens to its input and its result. One of
 * torno's own is on the accent wash with its name in the accent, and has its pictures under the chip.
 */
export const ToolCard = memo(function ToolCard({ item, beat }: { item: Tool; beat: boolean }) {
  const [open, setOpen] = useState(false)
  const [said, setSaid] = useState<string | null>(null)
  const where = useChatPlace()
  // A `#deck` in the line is a chip once the project has a named set of that name.
  const slugs = useSetSlugs()
  const label = useMemo(() => toolLabel(item.name, item.input, where), [item.name, item.input, where])
  const full = useMemo(() => toolLabel(item.name, item.input), [item.name, item.input])
  const [lead, strong, tail] = useMemo(() => labelParts(item.name, label, item.torno), [item.name, label, item.torno])
  // Only an open card needs its input as text.
  const hunks = useMemo(() => (open ? editHunks(item.name, item.input) : undefined), [open, item.name, item.input])
  const input = useMemo(() => (open && !hunks ? inputText(item.input) : ''), [open, hunks, item.input])
  // What a finished tool of torno's can do again: go to the view it showed, show it, or point at the refs once more.
  const seen = seeToolOf(item.name)
  const act =
    item.state !== 'done'
      ? null
      : seen !== null
        ? { word: seen === 'show' ? 'Show again' : 'See in view', run: () => seeInView(seen, item.input) }
        : item.name === 'mcp__torno__highlight' && canPointAgain(item.toolUseId)
          ? { word: 'Point again', run: () => pointAgain(item.toolUseId, item.input) }
          : null
  return (
    <div className="chat-item chat-tool" data-kind="tool" data-torno={item.torno ? '' : undefined} data-state={item.state} data-open={open ? '' : undefined}>
      <div className="chat-tool-row">
        <button type="button" className="chat-tool-line" title={full} aria-label={full} aria-expanded={open} onClick={() => setOpen(!open)} />
        <span className="chat-tool-label">
          {lead !== '' && numbered(lead)}
          <b>{numbered(strong)}</b>
          {item.torno ? refsIn(tail, slugs).map((piece, n) => (piece.ref !== undefined ? <RefChip key={n} value={piece.ref} prose /> : <span key={n}>{numbered(piece.text)}</span>)) : numbered(tail)}
        </span>
        {item.steps !== undefined && <span className="chat-tool-steps">{numbered(`${item.steps} ${item.steps === 1 ? 'step' : 'steps'}`)}</span>}
        <span className="chat-tool-state">
          {item.state === 'running' && <span className="chat-dot" data-beat={beat ? undefined : 'off'} aria-hidden="true" />}
          {STATE_WORD[item.state]}
        </span>
        {act && (
          <button type="button" className="chat-more chat-tool-act" onClick={() => setSaid(act.run())}>
            {act.word}
          </button>
        )}
      </div>
      {said !== null && (
        <p className="chat-tool-said" role="status">
          {numbered(said)}
        </p>
      )}
      {item.images.length > 0 && <Pictures images={item.images} what={label} />}
      {open && (
        <div className="chat-tool-body">
          {hunks ? <Changes hunks={hunks} input={item.input} where={where} /> : <Lines label="Input" text={input} />}
          {item.inside !== undefined && item.inside.length > 0 && <Lines label="Inside" text={item.inside.join('\n')} />}
          <Lines label="Result" text={item.result ?? ''} />
          {item.result === undefined && item.state !== 'running' && <p className="chat-lines-label">No result</p>}
        </div>
      )}
    </div>
  )
})
