import { useEffect, useRef } from 'react'
import { dollars, tokens } from '../../../shared/format'
import { PLAN_NOTE, largeTimes, whyLarge, type ProjectUsage, type UsageRow } from '../../../shared/usage'
import { useStore } from '../../state/store'
import { usageActions, useProjectUsage, useUsage, type UsageRange } from '../../state/usage'
import { WhyLarge } from '../chat/TurnUsage'
import { numbered } from '../numbered'
import { type Bucket, buckets, byPictures, type ConversationUsage, conversationsOf, daySpan, ledgerLead, pageLead, pictureCount, rangeStart, rowsIn, shareOf, tokenKinds, unknownCost } from './usageView'

// The Usage page (#371, direction A of #357): in the view's place, beside Model and Brief. The range as a sentence, its days,
// where the tokens went, the turns by their pictures and the conversations; a conversation opens to its prompts as a ledger,
// with why a large one was large. Every number is the CLI's or a sum of them; a cost not known is said, never guessed.

const RANGES: Array<{ range: UsageRange; label: string }> = [
  { range: 'week', label: 'Week' },
  { range: 'month', label: 'Month' },
  { range: 'all', label: 'All' }
]

const UNKNOWN_NOTE = "? marks prompts whose cost is not known: a terminal's, which records no usage, or the first turn after a resume."

/** The cost a day (or a week): one column each, the value over the columns that have one, `?` where a cost is not known. */
function DaysChart({ cols, weekly }: { cols: Bucket[]; weekly: boolean }) {
  const w = 340
  const h = 168
  const top = 24
  const base = 134
  const max = Math.max(...cols.map((c) => c.cost), 0)
  const step = w / Math.max(cols.length, 1)
  const bw = Math.max(3, Math.min(22, step * 0.62))
  const few = cols.length <= 8
  const most = cols.reduce((m, c, i) => (c.cost > (cols[m]?.cost ?? 0) ? i : m), 0)
  const every = few ? 1 : Math.ceil(cols.length / 7)
  return (
    <svg className="usage-days" viewBox={`0 0 ${w} ${h}`} role="img" aria-label={`Cost a ${weekly ? 'week' : 'day'}`}>
      <path className="usage-days-base" d={`M0 ${base + 0.5}H${w}`} />
      {cols.map((c, i) => {
        const x = i * step + (step - bw) / 2
        const ht = max > 0 && c.cost > 0 ? Math.max(3, ((base - top) * c.cost) / max) : 0
        const r = Math.min(4, bw / 2, ht)
        const said = `${daySpan(c.start, c.end - 1)}: ${dollars(c.cost)}${c.unknown > 0 ? `, and ${c.unknown} of unknown cost` : ''}`
        const label = few || i === most
        return (
          <g key={c.start}>
            <title>{said}</title>
            {/* What the pointer finds: the whole column, not the bar alone. */}
            <rect className="usage-days-hit" x={i * step} y={0} width={step} height={base} />
            {ht > 0 && <path className="usage-days-col" d={`M${x} ${base}V${base - ht + r}q0 ${-r} ${r} ${-r}h${bw - 2 * r}q${r} 0 ${r} ${r}V${base}Z`} />}
            {ht > 0 && label && (
              <text className="usage-days-val" x={x + bw / 2} y={base - ht - 6} textAnchor="middle">
                {dollars(c.cost)}
              </text>
            )}
            {ht === 0 && c.unknown > 0 && <rect className="usage-days-unknown" x={x + 0.5} y={base - 26} width={bw - 1} height={26} rx={Math.min(3, bw / 2)} />}
            {c.unknown > 0 && (
              <text className="usage-days-lab" x={x + bw / 2} y={ht > 0 ? base - ht - (label ? 18 : 6) : base - 32} textAnchor="middle">
                {ht > 0 ? `+ ${c.unknown} ?` : '?'}
              </text>
            )}
            {i % every === 0 && (
              <>
                <text className="usage-days-lab usage-days-wd" x={x + bw / 2} y={base + 15} textAnchor="middle">
                  {c.top}
                </text>
                <text className="usage-days-val" x={x + bw / 2} y={base + 28} textAnchor="middle">
                  {c.bottom}
                </text>
              </>
            )}
          </g>
        )
      })}
    </svg>
  )
}

/** Where the tokens went: the three kinds as one bar, each labelled, then the turns by their pictures. */
function WentTo({ rows }: { rows: UsageRow[] }) {
  const k = tokenKinds(rows)
  const kinds = [
    { kind: 'read', value: k.read, label: 'read again' },
    { kind: 'new', value: k.fresh, label: 'new to the context' },
    { kind: 'out', value: k.written, label: 'written by Claude' }
  ]
  return (
    <div className="usage-went">
      <h2 className="usage-h">
        Where it went <span>{numbered(`${tokens(k.all)} tokens`)}</span>
      </h2>
      {k.all > 0 && (
        <div className="usage-kinds" role="img" aria-label={kinds.map((x) => `${x.label} ${shareOf(x.value, k.all)}`).join(', ')}>
          {kinds.map((x) => (x.value > 0 ? <i key={x.kind} data-kind={x.kind} style={{ flexGrow: x.value }} title={`${x.label}: ${tokens(x.value)}`} /> : null))}
        </div>
      )}
      <div className="usage-legend">
        {kinds.map((x) => (
          <span key={x.kind}>
            <i data-kind={x.kind} aria-hidden="true" />
            {x.label} <span className="num">{shareOf(x.value, k.all)}</span>
          </span>
        ))}
      </div>
      <table className="usage-table">
        <thead>
          <tr>
            <th>Turns, by their pictures</th>
            <th>turns</th>
            <th>calls</th>
            <th>cost</th>
            <th>share</th>
          </tr>
        </thead>
        <tbody>
          {byPictures(rows).map((g) => (
            <tr key={g.label}>
              <td>{g.label}</td>
              <td className="num">{g.turns}</td>
              <td className="num">{g.calls}</td>
              <td className="num">{dollars(g.cost)}</td>
              <td className="num usage-muted">{shareOf(g.share, 1)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="usage-note">Each turn is counted whole, under the pictures it had. Claude Code says what a turn cost, not what each picture cost.</p>
    </div>
  )
}

/** A conversation's prompts as small columns, their height its cost; an outline where it is not known. */
function Spark({ costs, max }: { costs: Array<number | null>; max: number }) {
  return (
    <span className="usage-spark" aria-hidden="true">
      {costs.map((c, i) => (c === null ? <i key={i} data-unknown="" /> : <i key={i} style={{ height: `${Math.max(2, max > 0 ? (18 * c) / max : 2)}px` }} />))}
    </span>
  )
}

function Conversations({ list, max }: { list: ConversationUsage[]; max: number }) {
  return (
    <table className="usage-table usage-convs">
      <thead>
        <tr>
          <th>Conversations</th>
          <th>prompts</th>
          <th>calls</th>
          <th>pictures</th>
          <th>each prompt</th>
          <th>cost</th>
        </tr>
      </thead>
      <tbody>
        {list.map((c) => (
          <tr key={c.id} data-conversation={c.id}>
            <td>
              <button type="button" className="usage-conv" onClick={() => usageActions.openConversation(c.id)} title={c.name}>
                <span className="usage-conv-name">{c.terminal ? 'In a terminal' : c.name}</span>
                <span className="usage-conv-when">{numbered(`${daySpan(c.from, c.to)}${c.resumed ? ', resumed' : ''}`)}</span>
              </button>
            </td>
            <td className="num">{c.prompts}</td>
            {c.terminal ? (
              <td colSpan={4} className="usage-muted">
                not recorded: a terminal session keeps no usage
              </td>
            ) : (
              <>
                <td className="num">{c.calls}</td>
                <td className="num">{c.pictures}</td>
                <td>
                  <Spark costs={c.costs} max={max} />
                </td>
                <td>
                  <span className="num">{dollars(c.cost)}</span>
                  {c.unknown > 0 && <span className="usage-muted num"> + {c.unknown} ?</span>}
                </td>
              </>
            )}
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function Overview({ usage, name }: { usage: ProjectUsage; name: string }) {
  const range = useUsage((s) => s.range)
  const now = Date.now()
  const rows = rowsIn(usage.rows, range, now)
  const lead = pageLead(rows, range)
  const start = rangeStart(range, now) ?? usage.rows[0]?.at ?? now
  const list = conversationsOf(rows)
  const max = Math.max(0, ...rows.map((r) => r.usage?.costUsd ?? 0))
  const cols = buckets(rows, range, now)
  const weekly = cols.length > 0 && cols[0]!.end - cols[0]!.start > 2 * 86_400_000
  return (
    <>
      <header className="usage-head">
        <div>
          <h1>Usage of {name}</h1>
          <p className="usage-sub">{numbered(`${daySpan(start, now)}, as Claude Code said at the end of each turn.`)}</p>
        </div>
        <div className="segmented usage-range" role="group" aria-label="Range">
          {RANGES.map((r) => (
            <button key={r.range} type="button" aria-pressed={range === r.range} onClick={() => usageActions.setRange(r.range)}>
              {r.label}
            </button>
          ))}
        </div>
      </header>
      <p className="usage-lead">
        {numbered(lead.head)}
        {lead.more && <small>{numbered(lead.more)}</small>}
      </p>
      {rows.length > 0 && (
        <>
          <div className="usage-grid">
            <div>
              <h2 className="usage-h">
                Each {weekly ? 'week' : 'day'} <span>cost</span>
              </h2>
              <DaysChart cols={cols} weekly={weekly} />
              {rows.some(unknownCost) && <p className="usage-note">{UNKNOWN_NOTE}</p>}
            </div>
            <WentTo rows={rows} />
          </div>
          <div className="usage-section">
            <Conversations list={list} max={max} />
          </div>
          <p className="usage-note usage-plan">{PLAN_NOTE}</p>
        </>
      )}
    </>
  )
}

function Ledger({ usage, conversation }: { usage: ProjectUsage; conversation: string }) {
  const lit = useUsage((s) => s.lit)
  const litRow = useRef<HTMLTableRowElement>(null)
  const c = conversationsOf(usage.rows.filter((r) => r.conversation === conversation))[0]
  useEffect(() => {
    litRow.current?.scrollIntoView({ block: 'nearest' })
  }, [lit, c !== undefined])
  if (!c) {
    return (
      <p className="usage-lead">
        This conversation has no prompt on file. <button type="button" className="button button-quiet" onClick={() => usageActions.openConversation(null)}>Back to Usage</button>
      </p>
    )
  }
  const max = Math.max(0, ...c.rows.map((r) => r.usage?.costUsd ?? 0))
  const body = c.rows.flatMap((r, i) => {
    const cost = r.usage?.costUsd
    const times = largeTimes(cost, r.number, usage.median)
    const hot = times !== null
    const out = []
    if (r.resumed && i > 0) {
      out.push(
        <tr key={`${r.id}-resumed`} className="usage-ledger-sep">
          <td colSpan={7}>Resumed here, in a new Claude Code process</td>
        </tr>
      )
    }
    out.push(
      <tr key={r.id} ref={r.id === lit ? litRow : undefined} data-prompt={r.id} data-hot={hot ? '' : undefined} data-lit={r.id === lit ? '' : undefined}>
        <td className="usage-ledger-n num">{r.number}</td>
        <td className="usage-ledger-text">{r.text}</td>
        <td className="num">{r.terminal ? '' : (r.usage?.requests ?? '')}</td>
        <td className="num">{r.terminal ? '' : pictureCount(r)}</td>
        <td className="num">{r.terminal ? '' : r.facts.builds.count}</td>
        <td className="usage-ledger-bar">{cost !== undefined ? <div style={{ width: `${max > 0 ? Math.max(2, (100 * cost) / max) : 0}%` }} /> : unknownCost(r) ? <div data-unknown="" title="cost not known" /> : null}</td>
        <td>{cost !== undefined ? <span className="num">{dollars(cost)}</span> : <span className="usage-muted">{r.terminal ? 'not recorded' : r.usage ? 'not known' : 'not counted'}</span>}</td>
      </tr>
    )
    if (hot && r.usage) {
      out.push(
        <tr key={`${r.id}-why`} className="usage-ledger-why">
          <td colSpan={7}>
            <WhyLarge why={whyLarge(r.usage, r.facts, times)} />
          </td>
        </tr>
      )
    }
    return out
  })
  return (
    <>
      <nav className="usage-crumbs" aria-label="Usage">
        <button type="button" className="usage-back" onClick={() => usageActions.openConversation(null)}>
          Usage
        </button>
        <span aria-hidden="true">/</span>
        <span className="usage-crumb-name">{c.terminal ? 'In a terminal' : c.name}</span>
      </nav>
      <header className="usage-head">
        <div>
          <h1 className="usage-conv-title">{c.terminal ? 'In a terminal' : c.name}</h1>
          <p className="usage-sub">{numbered(`${daySpan(c.from, c.to)}, ${c.prompts} ${c.prompts === 1 ? 'prompt' : 'prompts'}${c.resumed ? ', resumed' : ''}.`)}</p>
        </div>
      </header>
      <p className="usage-lead usage-lead-small">{numbered(ledgerLead(c))}</p>
      <table className="usage-ledger">
        <thead>
          <tr>
            <th aria-label="Prompt number" />
            <th>Prompt</th>
            <th>calls</th>
            <th>pictures</th>
            <th>builds</th>
            <th aria-label="Cost against the others" />
            <th>cost</th>
          </tr>
        </thead>
        <tbody>{body}</tbody>
      </table>
    </>
  )
}

/** The Usage page of the open project, in the view's place. */
export function UsagePage() {
  const usage = useProjectUsage()
  const name = useStore((s) => s.workspace?.objects.find((o) => o.id === s.objectId)?.name ?? s.objectId ?? '')
  const conversation = useUsage((s) => s.conversation)
  // Read again whenever the page is shown: a terminal's builds may have come in since.
  useEffect(() => usageActions.refresh(), [])
  return (
    <section className="usage-page" aria-label="Usage" data-region="usage">
      {usage === undefined ? <p className="usage-note">Reading the chat logs…</p> : conversation !== null ? <Ledger usage={usage} conversation={conversation} /> : <Overview usage={usage} name={name} />}
    </section>
  )
}
