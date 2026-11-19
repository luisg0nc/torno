import { useMemo, useState } from 'react'
import { checksOf, valueAgainstExpected } from '../../../shared/dimension'
import { briefSections } from '../../../shared/brief'
import { checksCount } from '../../../shared/modelChecks'
import { boardActions, useBoard } from '../../state/board'
import { useOpenAsk } from '../../state/asks'
import { actions, store, useStore } from '../../state/store'
import { checkRow } from '../checkRows'
import { goToRow } from '../BuildStatus'
import { insertIntoSession } from '../insertIntoSession'
import { groupMarks, splitMarkGroups } from '../markGroups'
import { numbered } from '../numbered'
import { bakeText, paramRow, tried } from '../paramRows'
import { useStripNodes } from '../strip/useStripNodes'
import { onBlock, type OnInput, type OnRow } from './onRows'

/** Brings a model check's row under Checks into sight: its section is unfolded first, and the row once it is drawn. */
function showModelCheck(name: string): void {
  actions.showSection('checks')
  const scroll = (): void => document.querySelector(`[data-check="${CSS.escape(name)}"]`)?.scrollIntoView({ block: 'nearest' })
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => requestAnimationFrame(scroll))
  else scroll()
}

/** What the block is made of, from the window's state: the build on show's verdict and what waits on the person. */
function useOnInput(): OnInput | null {
  const objectId = useStore((s) => s.objectId)
  const scene = useStore((s) => s.scene)
  const marks = useStore((s) => s.marks)
  const revision = useStore((s) => (s.scene ? s.revision : 0))
  const board = useBoard((s) => s.board)
  const ask = useOpenAsk(objectId)
  return useMemo(() => {
    if (!objectId || !scene) return null
    const { needs } = splitMarkGroups(groupMarks(marks, revision))
    const model = scene.checks ?? []
    const dims = checksOf(marks, revision)
    const words = (m: { id: string; note?: string; kind: string }): string => m.note?.trim() || m.kind
    return {
      ask: ask ? { text: ask.question } : null,
      failing: [
        ...needs.failingChecks.map((m) => ({ id: m.id, chip: m.id, words: m.note?.trim() || m.id, reading: valueAgainstExpected(m, revision) ?? '' })),
        ...model.filter((c) => c.status === 'fail').map((c) => {
          const r = checkRow(c)
          return { id: c.name, chip: null, words: r.name, reading: r.reading }
        })
      ],
      pass: checksCount(model).pass + dims.passing.length,
      unchecked: board ? briefSections(board).sizes.length : 0,
      review: needs.toReview.map((m) => ({ id: m.id, words: m.resolvedNote?.trim() || words(m) })),
      fromAgent: needs.fromAgent.map((m) => ({ id: m.id, words: words(m) })),
      tried: (scene.params ?? []).filter(tried).map((p) => {
        const r = paramRow(p)
        return { name: p.name, value: String(r.current ?? ''), file: r.file ?? '' }
      })
    }
  }, [objectId, scene, marks, revision, board, ask])
}

function Row({ row, objectId }: { row: OnRow; objectId: string }) {
  switch (row.kind) {
    case 'ask':
      return (
        <li className="on-row" data-kind="ask">
          <span className="on-dot" aria-hidden="true" />
          <span className="on-words">Claude asks: {row.text}</span>
          <button type="button" className="link-button" onClick={() => actions.setDockOpen(true)}>
            in the chat
          </button>
        </li>
      )
    case 'check':
      return (
        <li className="on-row" data-kind="check">
          <button type="button" className="on-go" title={`${row.words}: ${row.reading}`} onClick={() => (row.chip === null ? showModelCheck(row.id) : goToRow(row.id))}>
            {row.chip === null ? <span className="needs-check-bar" aria-hidden="true" /> : <span className="mark-chip num" data-author="user">{row.chip}</span>}
            <span className="on-words">{numbered(row.words)}</span>
            <span className="on-reading num">{row.reading}</span>
          </button>
        </li>
      )
    case 'sizes':
      return (
        <li className="on-row" data-kind="sizes">
          <span className="on-dot" data-empty="" aria-hidden="true" />
          <span className="on-words">{numbered(`${row.count} brief ${row.count === 1 ? 'size' : 'sizes'} nothing checks`)}</span>
          <button type="button" className="button button-quiet" title="Open the Brief page, where a size is tied to a check" onClick={() => boardActions.show('brief')}>
            Brief
          </button>
        </li>
      )
    case 'review':
      return (
        <li className="on-row" data-kind="review">
          <span className="mark-chip num" data-author="agent">{row.mark.id}</span>
          <span className="on-words" title={row.mark.words}>{row.mark.words}</span>
          <button type="button" className="button button-quiet" title="Seen: move it to the resolved marks" onClick={() => void window.torno.marks.acknowledge(objectId, [row.mark.id]).catch(() => {})}>
            OK
          </button>
          <button type="button" className="link-button" title="Reopen as a draft" onClick={() => void window.torno.marks.update(objectId, row.mark.id, { status: 'draft' }).catch(() => {})}>
            Reopen
          </button>
        </li>
      )
    case 'fromAgent':
      return (
        <li className="on-row" data-kind="fromAgent">
          <button type="button" className="on-go" title="Go to its row under Marks" onClick={() => goToRow(row.mark.id)}>
            <span className="mark-chip num" data-author="agent">{row.mark.id}</span>
            <span className="on-words">{row.mark.words}</span>
            <span className="on-reading">from Claude</span>
          </button>
        </li>
      )
    case 'tried':
      return (
        <li className="on-row" data-kind="tried">
          <span className="on-dot" data-tried="" aria-hidden="true" />
          <span className="on-words" title={row.tried.map((t) => `${t.name} ${t.value}, the model has ${t.file}`).join('\n')}>
            {row.tried.length === 1 ? numbered(`${row.tried[0]!.name} tried at ${row.tried[0]!.value}, the model has ${row.tried[0]!.file}`) : numbered(`${row.tried.length} tried values, not in the model`)}
          </span>
          <button
            type="button"
            className="link-button"
            onClick={() => {
              const params = store.getState().scene?.params ?? []
              actions.setDockOpen(true)
              insertIntoSession(bakeText(params.filter(tried)), { later: true })
            }}
          >
            Ask Claude to keep
          </button>
        </li>
      )
  }
}

/**
 * "On h18": the build on show's verdict in a line (`2 fail, 5 pass`) and what waits on the person as one-line rows that act where
 * they stand: Claude's question (a pointer to the chat), the checks that fail with their value, the brief's sizes nothing checks, the
 * marks Claude resolved (OK, Reopen), the marks it left, the values tried. At most four, then "N more", which opens the rest.
 */
export function OnBlock() {
  const input = useOnInput()
  const strip = useStripNodes()
  const revision = useStore((s) => (s.scene ? s.revision : 0))
  const objectId = useStore((s) => s.objectId)
  const [opened, setOpened] = useState(false)
  if (!input || !objectId) return null
  const build = strip.nodes.find((n) => n.onShow)?.id ?? (revision > 0 ? `r${revision}` : 'the build')
  const { said, rows, more } = onBlock(input, opened)
  const failing = input.failing.length > 0
  return (
    <section className="on-block" aria-label={`On ${build}`} data-part="on">
      <h3 className="on-head">
        On <span className="num">{build}</span>
        <span className="on-said" data-fail={failing ? '' : undefined}>
          {numbered(said)}
        </span>
      </h3>
      {rows.length > 0 && (
        <ul className="on-rows">
          {rows.map((row, i) => (
            <Row key={`${row.kind}${'id' in row ? row.id : 'mark' in row ? row.mark.id : i}`} row={row} objectId={objectId} />
          ))}
        </ul>
      )}
      {more > 0 && (
        <button type="button" className="link-button on-more" aria-expanded={opened} onClick={() => setOpened(!opened)}>
          {opened ? 'Fewer' : `${more} more`}
        </button>
      )}
    </section>
  )
}
