import { useEffect, useRef } from 'react'
import { hint } from '../../shared/keys'
import { CaptionAt } from '../viewport/captionAt'
import { countToolUse, hintLine, toolUses, useStep, type HintLine } from '../state/step'
import { windowStorage } from '../state/column'
import { useStore } from '../state/store'
import { toolStore, useTool } from '../state/tools'
import { useStore as useZustand } from 'zustand'
import { numbered } from './numbered'

/** What the tool in hand and the window say now: the step (the caption's), the pointer hint (the foot's), or nothing. */
export function useHintLine(): HintLine {
  const tool = useTool()
  const stage = useStep((s) => s.stage)
  const due = useStep((s) => s.due)
  const replacing = useZustand(toolStore, (s) => s.replacing?.id ?? null)
  const scans = useStore((s) => (s.scansKnown ? s.scans.length : null))
  return hintLine({ tool, stage, replacing, scans, due })
}

/**
 * The caption: an ink pill by the pointer that says what the tool in hand waits for next (`stepFor`), and that Esc
 * steps back. It is put by the pointer outside React (`CaptionAt`, which also says when it is shown: at once for a tool's
 * first ten uses, then where the pointer rests); the words are always in the live region, shown or not, so that what
 * comes into it is read out. It takes no pointer, and changes once per step: the tools tell it through the store, never
 * per move. With no tool in hand the hint at the foot of the view says the pointer's way (`ui/view/Hint.tsx`).
 */
export function ToolHint() {
  const tool = useTool()
  const line = useHintLine()
  const step = line?.kind === 'step' ? line : null
  const live = useRef<HTMLDivElement>(null)
  const at = useRef<CaptionAt | null>(null)

  useEffect(() => {
    const pane = live.current?.closest<HTMLElement>('.viewport-pane')
    if (!pane) return
    const made = new CaptionAt(pane, () => live.current?.querySelector<HTMLElement>('.tool-hint') ?? null)
    at.current = made
    return () => {
      made.dispose()
      at.current = null
    }
  }, [])

  // A tool with a step was taken: one use more, and the pause counts from here.
  const taken = step !== null
  useEffect(() => {
    if (!taken) return
    countToolUse(windowStorage())
    at.current?.taken(toolUses(windowStorage()))
  }, [tool, taken])

  // The words changed (Measure's second end): shown as the rule says, and put in place.
  const words = step?.text
  useEffect(() => at.current?.update(), [words])

  return (
    // The region is always there, so that what comes into it is read out.
    <div className="tool-hint-live" aria-live="polite" ref={live}>
      {step && (
        <p className="tool-hint" data-kind="step">
          <span className="tool-hint-text">{numbered(step.text)}</span>
          <span className="tool-hint-stop">
            <kbd className="num">{hint('escape')}</kbd>
            <span className="tool-hint-sr"> steps back</span>
          </span>
        </p>
      )}
    </div>
  )
}
