import { valueAgainstExpected } from '../../../shared/dimension'
import type { ModelCheck } from '../../../shared/modelChecks'
import { actions, useStore } from '../../state/store'
import { goToRow } from '../BuildStatus'
import { checkRow } from '../checkRows'
import { groupMarks, splitMarkGroups } from '../markGroups'
import { useMarkRows } from '../markRows'
import { done } from '../rowsSaid'
import { numbered } from '../numbered'
import { ResolvedSummary } from '../ResolvedSummary'

/** Brings a model check's row under Checks into sight: its section is unfolded first, and the row once it is drawn. */
function showModelCheck(name: string): void {
  actions.showSection('checks')
  const scroll = (): void => document.querySelector(`[data-check="${CSS.escape(name)}"]`)?.scrollIntoView({ block: 'nearest' })
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => requestAnimationFrame(scroll))
  else scroll()
}

/** One check that fails, as a line that points at its row under Checks: the person's dimension by its chip, the model's by a bar in the agent's colour. */
function CheckPointer({ chip, words, title, onGo }: { chip: string | null; words: string; title: string; onGo: () => void }) {
  return (
    <li className="needs-check">
      <button type="button" className="needs-check-go" title={title} onClick={onGo}>
        {chip === null ? <span className="needs-check-bar" aria-hidden="true" /> : <span className="mark-chip num" data-author="user">{chip}</span>}
        <span className="needs-check-words">{numbered(words)}</span>
        <span className="needs-check-verdict">fails</span>
      </button>
    </li>
  )
}

/**
 * What waits on the person, from three sources in this order: the marks the agent resolved and they have not judged (a row each,
 * what the agent did, OK and Reopen…, and over them Review and OK all, which walk them), the marks the agent left for them (read
 * them, or answer in chat), and the checks that fail, model and dimension both, as pointers to their rows under Checks. The
 * section's head says how many wait; with none it is shut (`useFacts`).
 */
export function NeedsYou() {
  const objectId = useStore((s) => s.objectId)
  const marks = useStore((s) => s.marks)
  const revision = useStore((s) => (s.scene ? s.revision : 0))
  const model = useStore((s) => s.scene?.checks)
  const row = useMarkRows('needs')
  if (!objectId) return null
  const { needs } = splitMarkGroups(groupMarks(marks, revision))
  const failingModel: ModelCheck[] = (model ?? []).filter((c) => c.status === 'fail')
  return (
    <div className="needs" data-part="needs">
      <ResolvedSummary key={objectId} marks={needs.toReview} row={row} acknowledgeAll={() => done('needs', window.torno.marks.acknowledge(objectId, needs.toReview.map((m) => m.id)))} />
      {needs.fromAgent.length > 0 && (
        <ul className="mark-rows" aria-label="From the agent">
          {needs.fromAgent.map((m) => row(m, { source: 'from Claude' }))}
        </ul>
      )}
      {needs.failingChecks.length + failingModel.length > 0 && (
        <ul className="needs-checks" aria-label="Checks that fail">
          {needs.failingChecks.map((m) => (
            <CheckPointer key={m.id} chip={m.id} words={[m.note, valueAgainstExpected(m, revision)].filter(Boolean).join(': ') || m.id} title={`Not what was expected on r${revision}. Go to its row under Checks`} onGo={() => goToRow(m.id)} />
          ))}
          {failingModel.map((c) => {
            const r = checkRow(c)
            return <CheckPointer key={c.name} chip={null} words={[r.name, [r.reading, r.wanted].filter(Boolean).join(', ')].filter(Boolean).join(' ')} title={`${r.title}. Go to its row under Checks`} onGo={() => showModelCheck(c.name)} />
          })}
        </ul>
      )}
    </div>
  )
}
