import { useStore } from '../state/store'
import { checkRow, checksSaid, noteLines } from './checkRows'
import { numbered } from './numbered'
import { PinButton } from './projectBoard/PinButton'
import { SectionTitle } from './SectionTitle'

/**
 * The checks the model declares in its `checks(p)`, as the kernel measured them at the last build: a row for each,
 * in the model's order, with how it stands in a word, what was measured and what was wanted (numbers in the monospace
 * face). They are the model's own, in the agent's colour: the person's dimensions are marks, and no check here
 * resolves or replaces one. Read only. A reading from sampling or approximate says so, and a pass is only what was
 * measured. Under the rows, what the agent made easier to pass or took out since it was first declared. A model with
 * no checks, or a kernel that does not read them, has no section.
 */
export function ChecksPanel() {
  const scene = useStore((s) => s.scene)
  const checks = scene?.checks
  if (!checks || checks.length === 0) return null
  const notes = noteLines(scene.checkNotes ?? [])
  return (
    <section className="section checks" aria-label="Checks">
      <SectionTitle title="Checks" said={checksSaid(checks)}>
        <PinButton what={{ kind: 'checks' }} title="Put the checks on the board as a card that stays up to date" />
      </SectionTitle>
      <ul className="rows">
        {checks.map((check) => {
          const row = checkRow(check)
          return (
            <li key={check.name} className="check-row" data-check={check.name} data-standing={row.standing} title={row.title}>
              <span className="check-line">
                <span className="check-name">{row.name}</span>
                <span className="check-standing">{row.standing}</span>
              </span>
              <span className="check-detail">
                <span className="num">{numbered(row.reading)}</span>
                {row.wanted && <span>{numbered(row.wanted)}</span>}
                {row.caution && <span>{row.caution}</span>}
              </span>
            </li>
          )
        })}
      </ul>
      {notes.length > 0 && (
        <div className="check-notes" role="note">
          <p className="check-notes-head">Made easier to pass, or removed</p>
          <ul>
            {notes.map((line) => (
              <li key={line}>{numbered(line)}</li>
            ))}
          </ul>
        </div>
      )}
    </section>
  )
}
