import { useStore as useZustand } from 'zustand'
import { createStore } from 'zustand/vanilla'
import { hint, NO_SCAN_YET, SCAN_TOOLS, stepOf, TOOL_KEYS } from '../../shared/keys'
import { windowStorage } from './column'
import type { ToolName } from './tools'

/**
 * What the caption at the pointer says (`ui/ToolHint.tsx`): what the tool in hand waits for next; and what the hint at
 * the foot of the view says (`ui/view/Hint.tsx`): the first time an object is drawn in this install, how the pointer
 * turns, pans and zooms the view, and while a sketch is open how it snaps. All of it is the window's: nothing of it is
 * written in a workspace.
 */

interface StepState {
  /** Whether the Measure tool has its first end and waits for the second. Set by the tool once per click, never per move. */
  stage: 'first' | 'second'
  /** Whether the pointer hint is still to be shown: until the person has moved the camera once (and then in this window's storage, for good). */
  due: boolean
}

/** The key of the window's storage that holds that the pointer hint was seen. */
export const HINT_KEY = 'torno.pointerHint'

/** Whether the pointer hint was not seen yet. A storage that is not there or refuses says it was not, so the hint shows again. */
export function pointerHintDue(storage: Pick<Storage, 'getItem'> | null): boolean {
  try {
    return storage?.getItem(HINT_KEY) !== 'seen'
  } catch {
    return true
  }
}

export function rememberPointerHint(storage: Pick<Storage, 'setItem'> | null): void {
  try {
    storage?.setItem(HINT_KEY, 'seen')
  } catch {
    // A storage that refuses (a private window, blocked site data): the hint shows again next time, which is all.
  }
}

export const stepStore = createStore<StepState>(() => ({ stage: 'first', due: pointerHintDue(windowStorage()) }))

/** The Measure tool has a first end, or has none. */
export function setStage(stage: StepState['stage']): void {
  if (stepStore.getState().stage !== stage) stepStore.setState({ stage })
}

/** The camera was moved by the person: the pointer hint is done with, here and in the next window. */
export function pointerMoved(): void {
  if (!stepStore.getState().due) return
  stepStore.setState({ due: false })
  rememberPointerHint(windowStorage())
}

export function useStep<T>(pick: (s: StepState) => T): T {
  return useZustand(stepStore, pick)
}

/** Whether a tool is one of the scan's and the object is known to have no scan (`scans` is the count, null until main has said). */
export function scanless(tool: ToolName, scans: number | null): boolean {
  return scans === 0 && SCAN_TOOLS.includes(tool)
}

/**
 * What the tool in hand waits for, as a sentence; null for Select. A scan tool with no scan waits for one. Pin, put
 * to move a mark, waits for the part it goes to.
 */
export function stepFor(tool: ToolName, stage: StepState['stage'], replacing: string | null, scans: number | null): string | null {
  if (scanless(tool, scans)) return `${TOOL_KEYS.find((t) => t.name === tool)!.label}: ${NO_SCAN_YET.toLowerCase()}`
  if (tool === 'pin' && replacing !== null) return `Pin: click the part where ${replacing} should be`
  return stepOf(tool, tool === 'measure' ? stage : 'first')
}

/** What the caption and the hint hold: the tool's step (the caption's) in place of the pointer hint, the hint (the foot's) with none in hand, or nothing. */
export type HintLine = { kind: 'step'; text: string } | { kind: 'pointer' } | null

export function hintLine(of: { tool: ToolName; stage: StepState['stage']; replacing: string | null; scans: number | null; due: boolean }): HintLine {
  const text = stepFor(of.tool, of.stage, of.replacing, of.scans)
  if (text !== null) return { kind: 'step', text }
  return of.due ? { kind: 'pointer' } : null
}

/** How many uses of a tool the caption shows at once for; after them it shows only where the pointer rests. */
export const CAPTION_USES = 10
/** How long the pointer is still before the caption shows, once the first uses are past. */
export const CAPTION_PAUSE_MS = 500
/** The key of the window's storage that counts the uses of the tools. */
export const TOOL_USES_KEY = 'torno.toolUses'

/** How many times a tool was taken in this install. A storage that is not there or refuses, or holds no count, says none. */
export function toolUses(storage: Pick<Storage, 'getItem'> | null): number {
  try {
    const n = Number(storage?.getItem(TOOL_USES_KEY))
    return Number.isInteger(n) && n > 0 ? n : 0
  } catch {
    return 0
  }
}

/** A tool with a step was taken. */
export function countToolUse(storage: Pick<Storage, 'getItem' | 'setItem'> | null): void {
  try {
    storage?.setItem(TOOL_USES_KEY, String(toolUses(storage) + 1))
  } catch {
    // A storage that refuses: the caption shows at once again next time, which is all.
  }
}

/** Whether the words of the caption are shown at the pointer: at once for the first uses of a tool, then once the pointer has rested (they are in the live region either way). */
export function captionShows(uses: number, stillMs: number): boolean {
  return uses < CAPTION_USES || stillMs >= CAPTION_PAUSE_MS
}

/** What a sketch's standing line at the foot of the view says: whether it snaps and how to drop it, and where x-ray is. */
export function sketchLine(of: { snapping: boolean; xray: boolean }): { snap: string; xray: string; cap: string } {
  return { snap: of.snapping ? `Snapping on, hold ${hint('sketch.snap')} to drop it.` : 'Snapping off.', xray: of.xray ? 'X-ray on' : 'X-ray', cap: hint('sketch.xray') }
}
