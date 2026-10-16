import { useStore as useZustand } from 'zustand'
import { createStore } from 'zustand/vanilla'
import { GIZMO_KEYS, TOOL_KEYS, type ToolGroup } from '../../shared/keys'
import type { ShapeKind } from '../../shared/marks'
import type { GizmoMode } from '../viewport/Viewport'

export type ToolName = 'select' | 'pin' | 'arrow' | 'draw' | 'shape' | 'section' | 'measure' | 'align' | 'region'

/** The tools of the palette, in its order, each with its key: from the one table of keys. One that is not `ready` is shown, and cannot be chosen yet. */
export const TOOLS: { name: ToolName; label: string; key: string; group: ToolGroup; ready: boolean }[] = TOOL_KEYS.map((t) => ({ name: t.name, label: t.label, key: t.key, group: t.group, ready: true }))

/** The groups of the palette, in its order, each named for the toolbar's `aria-label`: split on screen by a hairline. */
export const TOOL_GROUPS: { group: ToolGroup; label: string }[] = [
  { group: 'inspect', label: 'Inspect' },
  { group: 'mark', label: 'Mark' },
  { group: 'scan', label: 'Scan' }
]

export type { GizmoMode }

/** The shapes the Shape tool places, in the order they are offered. */
export const SHAPES: { kind: ShapeKind; label: string }[] = [
  { kind: 'box', label: 'Box' },
  { kind: 'cylinder', label: 'Cylinder' },
  { kind: 'sphere', label: 'Sphere' },
  { kind: 'plane', label: 'Plane' }
]

/** The ways of the gizmo, each with its key: from the one table of keys. */
export const GIZMO_MODES: { mode: GizmoMode; label: string; key: string }[] = GIZMO_KEYS.map((g) => ({ ...g }))

/** What the Measure tool takes between two picks, and of one round thing: each with the one chosen last. */
export type BetweenMeasure = 'distance' | 'angle'
export type RoundMeasure = 'diameter' | 'radius'
export const BETWEEN: { measure: BetweenMeasure; label: string; title: string }[] = [
  { measure: 'distance', label: 'Distance', title: 'Two clicks measure the distance between the two' },
  { measure: 'angle', label: 'Angle', title: 'Two clicks measure the angle between flat faces, straight edges and the axes of holes and circles' }
]
export const ROUND: { measure: RoundMeasure; label: string; title: string }[] = [
  { measure: 'diameter', label: 'Diameter', title: 'A double click on a hole, a cylinder or a circle measures its diameter' },
  { measure: 'radius', label: 'Radius', title: 'A double click on a hole, a cylinder or a circle measures its radius' }
]

interface ToolState {
  /** Which tool the pointer works as in the viewport. */
  tool: ToolName
  /** The shape the Shape tool places: the one last chosen. */
  shape: ShapeKind
  /** What the gizmo on the active shape does. */
  gizmo: GizmoMode
  /**
   * The mark being put somewhere else: the pin tool is in hand for it, its
   * next click on a part moves that mark there instead of leaving a pin, and
   * `back` is the tool that is taken up again afterwards. Null for none.
   */
  replacing: { objectId: string; id: string; back: ToolName } | null
  /** What two picks of the Measure tool measure. */
  between: BetweenMeasure
  /** What a double click of the Measure tool on a round thing measures. */
  round: RoundMeasure
}

/** What the pointer does in the viewport. It changes on a click or a key, never on a pointer move. */
export const toolStore = createStore<ToolState>(() => ({ tool: 'select', shape: 'box', gizmo: 'translate', replacing: null, between: 'distance', round: 'diameter' }))

export function useTool(): ToolName {
  return useZustand(toolStore, (s) => s.tool)
}

export function useShape(): ShapeKind {
  return useZustand(toolStore, (s) => s.shape)
}

export function useGizmo(): GizmoMode {
  return useZustand(toolStore, (s) => s.gizmo)
}

export function useBetween(): BetweenMeasure {
  return useZustand(toolStore, (s) => s.between)
}

export function useRound(): RoundMeasure {
  return useZustand(toolStore, (s) => s.round)
}

/** Choose what two picks of the Measure tool measure: also of the pair whose second pick is pending. */
export function setBetween(between: BetweenMeasure): void {
  toolStore.setState({ between })
}

/** Choose what a double click of the Measure tool on a round thing measures. */
export function setRound(round: RoundMeasure): void {
  toolStore.setState({ round })
}

/** Choose the shape the Shape tool places from now on. */
export function setShape(shape: ShapeKind): void {
  toolStore.setState({ shape })
}

/** Choose what the gizmo does. */
export function setGizmo(gizmo: GizmoMode): void {
  toolStore.setState({ gizmo })
}

/** Choose a tool. One that is not ready is not chosen. A mark that was being put somewhere else is left where it is. */
export function setTool(tool: ToolName): void {
  if (TOOLS.find((t) => t.name === tool)?.ready) toolStore.setState({ tool, replacing: null })
}

/** The mark being put somewhere else, by its number; null for none. */
export function useReplacing(): string | null {
  return useZustand(toolStore, (s) => s.replacing?.id ?? null)
}

/** Take up the pin tool to put a mark of an object somewhere else with the next click on a part. */
export function startReplace(objectId: string, id: string): void {
  const { tool, replacing } = toolStore.getState()
  toolStore.setState({ tool: 'pin', replacing: { objectId, id, back: replacing?.back ?? tool } })
}

/**
 * The mark has been put somewhere else, or is left where it is: back to the
 * tool that was in hand. Given the mark it is ended for, only while that mark
 * is still the one being moved: another may have been taken up meanwhile.
 */
export function endReplace(id?: string): void {
  const { replacing } = toolStore.getState()
  if (replacing && (id === undefined || replacing.id === id)) toolStore.setState({ tool: replacing.back, replacing: null })
}
