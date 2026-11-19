import { useMemo } from 'react'
import { checksOf } from '../../../shared/dimension'
import { checksCount } from '../../../shared/modelChecks'
import { useStore } from '../../state/store'
import { Checks } from '../card/Checks'
import { groupMarks } from '../markGroups'
import { MarksPanel } from '../MarksPanel'

/** What the checks block says of itself in its head: how many there are, and how many fail. `{ said: '5 checks', bad: '1 fails' }`. */
export function checksSaid(total: number, failing: number): { said: string; bad: string | null } {
  return { said: total === 0 ? 'none' : `${total} ${total === 1 ? 'check' : 'checks'}`, bad: failing > 0 ? `${failing} ${failing === 1 ? 'fails' : 'fail'}` : null }
}

/** What the marks block says of itself: the open ones, the sketches among them and those that go with the next prompt. */
export function marksSaid(open: number, sketches: number, toSend: number): string {
  if (open === 0) return 'none open'
  return [`${open} open`, sketches > 0 && `${sketches} ${sketches === 1 ? 'sketch' : 'sketches'}`, toSend > 0 && `${toSend} to send`].filter((p): p is string => p !== false).join(', ')
}

/** Checks (the model's own and the dimensions with something expected, one list) as a block of the Brief page. */
export function ChecksBlock() {
  const scene = useStore((s) => s.scene)
  const marks = useStore((s) => s.marks)
  const revision = useStore((s) => (s.scene ? s.revision : 0))
  const facts = useMemo(() => {
    const model = scene?.checks ?? []
    const dims = checksOf(marks, revision)
    return checksSaid(model.length + dims.failing.length + dims.unmeasured.length + dims.passing.length, checksCount(model).fail + dims.failing.length)
  }, [scene, marks, revision])
  return (
    <section className="brief-block brief-held" aria-label="Checks" data-section="checks" data-needs={facts.bad !== null ? '' : undefined}>
      <div className="brief-block-head">
        <h2>Checks</h2>
        <span className="brief-said num">
          {facts.said}
          {facts.bad !== null && (
            <>
              {', '}
              <span className="brief-said-fail">{facts.bad}</span>
            </>
          )}
        </span>
      </div>
      <Checks />
    </section>
  )
}

/** The marks of the project (to send, with the agent, from the agent, resolved) and Review this build, as a block of the Brief page. */
export function MarksBlock() {
  const marks = useStore((s) => s.marks)
  const revision = useStore((s) => (s.scene ? s.revision : 0))
  const said = useMemo(() => {
    const open = marks.filter((m) => m.status !== 'resolved')
    return marksSaid(open.length, open.filter((m) => m.kind === 'sketch').length, groupMarks(marks, revision).toSend.length)
  }, [marks, revision])
  return (
    <section className="brief-block brief-held" aria-label="Marks" data-section="marks">
      <div className="brief-block-head">
        <h2>Marks</h2>
        <span className="brief-said num">{said}</span>
      </div>
      <MarksPanel />
    </section>
  )
}
