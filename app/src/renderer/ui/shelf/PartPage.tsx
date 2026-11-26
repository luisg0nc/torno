import { askAboutText } from '../../state/partLedger'
import { useShelf } from '../../state/shelf'
import { actions, useStore } from '../../state/store'
import { askClaude } from './askClaude'
import { PartDrawing, PartLegend } from './PartDrawing'
import { PartLedger } from './PartLedger'

/**
 * A part of the shelf opened in the main area, in the view's place as the brief is (#352): its name, what it is and its file, what can
 * be done with it, the drawing of it through a panel with every size dimensioned in the style of its source, the legend of those styles, and
 * the ledger of its sizes, where "I measured it…" writes the day into the part's `.torno/checked.json` and asks Claude to change the value.
 * The page shows what the kernel read: nothing here is a size of ours. Closed by the `×` of its tab, or when the part leaves the shelf.
 */
export function PartPage() {
  const id = useStore((s) => s.shelfOpen)
  const part = useShelf((s) => s.parts.find((p) => p.id === id))
  if (id === null) return null
  if (!part) {
    // The shelf is not read yet, or the part is gone and the window is about to close this page.
    return (
      <section className="part-page" aria-label={id} data-part-page={id}>
        <p className="part-none">{id} is not on the shelf.</p>
      </section>
    )
  }
  const what = part.what.replace(/\s+/g, ' ').trim()
  return (
    <section className="part-page" aria-label={part.name} data-part-page={part.id}>
      <header className="part-head">
        <h1>{part.name}</h1>
        <p className="part-meta">
          {what !== '' && <span>{what} </span>}
          <span className="file">{part.file}</span>
        </p>
        <div className="part-acts">
          {/* Placing is the next piece (#353): the button is here, says so, and does nothing meanwhile. */}
          <button type="button" className="button button-primary part-place" aria-disabled="true" title="Placing comes next" onClick={() => actions.startPlacing(part.id)}>
            Place on the model
          </button>
          <button type="button" className="button" onClick={() => askClaude(askAboutText(part.id))}>
            Ask Claude about it
          </button>
          {part.files.map((file) => (
            <span key={file} className="part-file" title={`${file}, in ${part.file.replace(/part\.py$/, '')}`}>
              <svg viewBox="0 0 12 12" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round">
                <path d="M2.5 1.5h4.5l2.5 2.5v6.5h-7z" />
                <path d="M7 1.5V4h2.5" />
              </svg>
              <span className="file">{file}</span>
            </span>
          ))}
        </div>
      </header>
      <div className="part-body">
        <PartDrawing part={part} />
        {!part.error && <PartLegend />}
        <PartLedger key={part.id} part={part} />
      </div>
    </section>
  )
}
