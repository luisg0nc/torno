import { useEffect, useRef, useState } from 'react'
import { pressed } from '../../shared/keys'
import { actions, useStore } from '../state/store'
import { numbered } from './numbered'
import { allReady, foldedLine, glyphOf, lacking, readinessLines, type Line, type Piece, type Tone } from './readyLines'

/** Pieces of a line: words with their numbers set in the face of numbers, and a path, a version or a command whole. */
function Pieces({ of }: { of: Piece[] }) {
  return (
    <>
      {of.map((piece, n) =>
        typeof piece === 'string' ? (
          <span key={n}>{numbered(piece)}</span>
        ) : (
          <span key={n} className="num ready-set">
            {piece.num}
          </span>
        )
      )}
    </>
  )
}

/** Main is asked once the window is up, and tells whenever the kernel or the making of the environment changes. */
export function useReadyFeed(): void {
  useEffect(() => {
    let live = true
    void window.torno.ready.check().then(
      (ready) => live && actions.setReady(ready),
      () => {} // a main that cannot say leaves the block out: nothing is claimed
    )
    const off = window.torno.ready.onChanged((ready) => actions.setReady(ready))
    return () => {
      live = false
      off()
    }
  }, [])
}

/** Asks again, the CLI included: for the person who fixed something. */
function checkAgain(): void {
  void window.torno.ready.check(true).then(actions.setReady, () => {})
}

/** ✓ in the ok colour, ! in the warn one, × in the fail one: the sign at the head of a line, and of the folded one. */
function Glyph({ tone }: { tone: Tone }) {
  return (
    <span className="ready-glyph" data-tone={tone} aria-hidden="true">
      {glyphOf(tone)}
    </span>
  )
}

function LineRow({ line, onMake, problem }: { line: Line; onMake: () => void; problem: string | null }) {
  return (
    <li className="ready-line" data-line={line.id} data-tone={line.tone}>
      <Glyph tone={line.tone} />
      <span className="ready-label">{line.label}</span>
      <span className="ready-text">
        <Pieces of={line.text} />
        {line.action === 'make' && (
          <button type="button" className="button button-quiet ready-make" onClick={onMake}>
            {line.tone === 'fail' ? 'Try again' : 'Make it now'}
          </button>
        )}
      </span>
      {line.note && (
        <span className="ready-note" title={line.note.map((p) => (typeof p === 'string' ? p : p.num)).join('')}>
          <Pieces of={line.note} />
        </span>
      )}
      {line.progress && line.progress.length > 0 && (
        <span className="ready-progress num" aria-live="off">
          {line.progress.slice(-3).map((p, n) => (
            <span key={n}>{p}</span>
          ))}
        </span>
      )}
      {problem !== null && line.action === 'make' && (
        <span className="ready-problem" role="alert">
          {problem}
        </span>
      )}
    </li>
  )
}

/**
 * What torno needs, said before anything fails: a line for Claude Code, for uv when it is missing, for the kernel's
 * Python environment and for a folder's own. When everything is ready the block folds to one line and stays out of the
 * way (it opens with a click). Three places show it: `block`, the first screen's and the empty workspace's (folded when
 * all is well); `missing`, the page of a new object's, which has only the lines that say something is amiss and is
 * not there when none does; `sheet`, the dialog of the folder menu, always whole. Nothing is claimed until main has said.
 */
export function Readiness({ variant }: { variant: 'block' | 'missing' | 'sheet' }) {
  const ready = useStore((s) => s.ready)
  const [open, setOpen] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  if (ready === null) return null

  const lines = readinessLines(ready)
  const make = (): void => {
    setProblem(null)
    window.torno.ready.make().catch((e: unknown) => setProblem(e instanceof Error ? e.message : String(e)))
  }

  if (variant === 'missing') {
    const amiss = lacking(lines)
    if (amiss.length === 0) return null
    const claudeAmiss = amiss.some((l) => l.id === 'claude' && l.tone === 'fail')
    return (
      <section className="ready" data-variant="missing" aria-label="What torno needs">
        <ul className="ready-lines">
          {amiss.map((line) => (
            <LineRow key={line.id} line={line} onMake={make} problem={problem} />
          ))}
        </ul>
        {claudeAmiss && <p className="ready-after">The project will be made, but Claude Code cannot start in it until this is put right.</p>}
      </section>
    )
  }

  const folds = variant === 'block' && allReady(lines)
  const shown = !folds || open
  return (
    <section className="ready" data-variant={variant} data-folded={folds && !open ? '' : undefined} aria-label="What torno needs">
      {folds ? (
        <button type="button" className="ready-fold" aria-expanded={open} onClick={() => setOpen(!open)}>
          <Glyph tone="ok" />
          {numbered(foldedLine(ready, lines))}
        </button>
      ) : (
        variant === 'block' && <h2 className="section-title ready-title">Ready to work</h2>
      )}
      {shown && (
        <ul className="ready-lines" aria-label={folds ? undefined : 'What torno needs'}>
          {lines.map((line) => (
            <LineRow key={line.id} line={line} onMake={make} problem={problem} />
          ))}
        </ul>
      )}
      {shown && variant === 'sheet' && (
        <div className="ready-actions">
          <button type="button" className="button button-quiet" onClick={checkAgain}>
            Check again
          </button>
        </div>
      )}
    </section>
  )
}

/** The dialog the folder menu opens: every line whole, asked afresh when it comes up. Over the whole window; Escape puts it away. */
export function ReadinessSheet({ onClose }: { onClose: () => void }) {
  const ready = useStore((s) => s.ready)
  const sheet = useRef<HTMLElement>(null)
  const done = useRef(onClose)
  done.current = onClose

  useEffect(() => {
    const before = document.activeElement
    sheet.current?.focus()
    checkAgain()
    const onKey = (e: KeyboardEvent): void => {
      if (pressed(e, 'sheet.close') && !e.defaultPrevented) done.current()
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      const now = document.activeElement
      if (before instanceof HTMLElement && before.isConnected && (now === null || now === document.body || !now.isConnected)) before.focus()
    }
  }, [])

  return (
    <div className="workspace-layer" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <section
        ref={sheet}
        className="workspace-question ready-sheet"
        role="dialog"
        aria-modal="true"
        aria-label="What torno needs"
        tabIndex={-1}
        onKeyDown={(e) => {
          // The sheet's own, all of them: no tool of the view under it is handed a key.
          e.stopPropagation()
          if (pressed(e, 'sheet.close')) {
            e.preventDefault()
            onClose()
            return
          }
          if (!pressed(e, 'sheet.round')) return
          const stops = [...sheet.current!.querySelectorAll<HTMLElement>('button:not(:disabled)')]
          const at = stops.indexOf(document.activeElement as HTMLElement)
          if (e.shiftKey ? at <= 0 : at === stops.length - 1) {
            e.preventDefault()
            stops[e.shiftKey ? stops.length - 1 : 0]?.focus()
          }
        }}
      >
        <h2>What torno needs</h2>
        {ready === null ? <p>Looking…</p> : <Readiness variant="sheet" />}
        <div className="ready-actions">
          <button type="button" className="button" onClick={onClose}>
            Close
          </button>
        </div>
      </section>
    </div>
  )
}

