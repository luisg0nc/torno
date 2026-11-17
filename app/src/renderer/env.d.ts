import type { TornoBridge } from '../shared/bridge'
import type { Camera, LookRequest, LookResult } from '../shared/view'
import type { TornoState } from './state/store'
import type { Hit } from './viewport/picking'
import type { ScanHit, ScanLayerState } from './viewport/scans'
import type { ScanTints } from './viewport/scanTints'

declare global {
  interface Window {
    /** Exposed by the preload script; see src/shared/bridge.ts. */
    torno: TornoBridge
    /** Only when main runs with TORNO_TEST=1: what the e2e tests read and the pictures they take. */
    /** Only under test: how many times the chat has drawn each of its items, by id. */
    __tornoChatRenders?: Record<string, number>
    /** Only under test: how many times the board's layer of cards has been drawn. A pan or a zoom must not add one. */
    __tornoBoardRenders?: number
    /** Only under test: how many times the layer of a tracing's sheet has been drawn. A pan or a zoom must not add one. */
    __tornoTracingRenders?: number
    /** Only under test: where the tracing's sheet stands, while a tracing is shown; `ratio` is 1 at 1:1. */
    __tornoTracingSheet?: () => { x: number; y: number; k: number; ratio: number }
    /** The line-up's panes under test: where a photo pixel or a point of the tracing is on the page, and the clicks so far. */
    __tornoLineup?: { client(side: 'photo' | 'tracing', at: readonly [number, number]): [number, number]; clicks(): { photo: number[][]; tracing: Array<{ uv: number[]; snap?: unknown }> } }
    /** Only under test: where the board's camera stands, while the board is shown. */
    __tornoBoardCamera?: () => { x: number; y: number; k: number }
    __tornoTest?: {
      state(): TornoState
      /** Whether the view draws nothing for now: the board is shown in its place. */
      paused(): boolean
      look(req: LookRequest): Promise<LookResult>
      camera(): Camera
      /** Opens the sheet of a view note over the note, as the list of marks will (`ui/drawing/make.ts` `openNote`); rejects with why not. */
      openNote(objectId: string, id: string): Promise<void>
      /** What the pointer is on in the chat and the viewport lights for it (a ref chip's refs); none when it is on nothing. */
      peeked(): string[]
      /** What a point of the canvas is on; `fx` and `fy` are fractions of its width and height, from the top left. */
      pickAt(fx: number, fy: number, opts?: { edges?: boolean; partsOnly?: boolean }): Hit | null
      /** How long `count` picks spread over the canvas take, as a pointer move makes them: the mean and the worst, in milliseconds, and how many were on a part. */
      timePicks(count?: number, opts?: { edges?: boolean }): { count: number; hits: number; meanMs: number; worstMs: number }
      /** What drawing the view as it is costs, over `count` frames: the mean and the worst, in milliseconds. */
      timeFrames(count?: number): { count: number; meanMs: number; worstMs: number }
      /** Where a point of the object frame is drawn on the canvas, as such fractions; with `part`, where it is drawn as a point of that part, which may be drawn apart from where it is (explode). */
      project(point: [number, number, number], part?: string): [number, number]
      /** Whether the viewport draws the parts apart now, or is on its way there or back. */
      exploded(): boolean
      /** Whether the parts are drawn faded (older than the latest build attempt, and that has run a while or failed). */
      faded(): boolean
      /** The keys (`layout:name`) of the parts the old edges and the new are drawn for after a build landed; empty once they are gone. */
      ghosts(): string[]
      /** The keys of the parts of the earlier build drawn over the current one (Compare); empty when there is none. */
      earlier(): string[]
      /** The keys of the parts of the build that stands in for the live one while a compare's later build is not the live build; empty when the live build is drawn. */
      later(): string[]
      /** Starts comparing the kept build `from` with `to` as the chat's turns do (`actions.compare`), for a test that has no turn to press. */
      compare(from: string, to: string, prompt?: number): void
      /** Keeps the ghosts of the builds that land after this until a key or a click (for a capture of the window). */
      holdGhosts(held: boolean): void
      /** The tracings the model view draws, each with whether it has its outline and its photo, and how many layers: what a hidden window cannot be read for. */
      tracings(): Array<{ id: string; layout: string; outline: boolean; photo: boolean; layers: number }>
      /** Where the label of a mark is drawn, as such fractions, and whether it is in view; null for a mark that is not drawn. */
      markScreen(id: string): { x: number; y: number; visible: boolean } | null
      /** The mark whose chip the viewport rings as pointed at (its row or its chip hovered); null for none. */
      hoveredMark(): string | null
      /** The refs each layer of highlights is drawn for: `point` (in the accent) for what a chip, a row or a ref of the chat points at, `agent` for what the agent points at. */
      highlighted(): Record<'hover' | 'selection' | 'agent' | 'userMark' | 'userDont' | 'agentMark' | 'point' | 'set', readonly string[]>
      /** The mark whose chip is drawn at a point of the canvas, in fractions of it: a press there is the chip's, whatever tool is in hand. Null for none. */
      chipAt(fx: number, fy: number): string | null
      /** What the pointer is making, drawn now: a pending measurement, or the last one held (`held` is its value); null for none. */
      draft(): { kind: string; from?: [number, number, number]; to?: [number, number, number] | null; held?: string } | null
      /** What a thumbnail of the build on show (or of a scene given, with its meshes) costs, drawn `count` times off screen as a card's picture is: the mean and the worst, in milliseconds, and the size of the PNG. */
      timeThumbnail(count?: number, given?: { scene: import('../shared/scene').Scene; blob: ArrayBuffer }): Promise<{ count: number; meanMs: number; worstMs: number; bytes: number }>
      /** The scans of the open object as the viewport has them: whether each mesh has come, where it stands, how it is drawn. */
      scans(): ScanLayerState[]
      /** What is tinted on the scans: the regions kept, each with how many triangles it draws and in which colour, and the set being painted. */
      regions(): ReturnType<ScanTints['state']>
      /** What a drawing on the view is told lies under a point of the canvas (fractions, as `pickAt`): what `ViewHost.under` says. */
      underAt(fx: number, fy: number): import('./ui/drawing/under').Under
      /** What a point of the canvas is on of the scans drawn, as `pickAt` is of the parts. */
      pickScanAt(fx: number, fy: number): ScanHit | null
      /** Where a point of a scan, in the scan's own frame, is drawn: fractions of the canvas, as `project`. */
      projectScan(id: string, local: [number, number, number]): [number, number]
      /** What `count` picks of the scans cost, at points spread over the canvas, and how each tree was made. */
      timeScanPicks(count?: number): { count: number; hits: number; meanMs: number; worstMs: number; how: Record<string, 'worker' | 'main'> }
    }
    /** Only with TORNO_TEST=1: what the terminal of the open object shows, as text. */
    __tornoTerm?: {
      text(): string
      size(): { cols: number; rows: number } | null
      theme(): { background?: string; foreground?: string }
      /** The colour of the terminal's inset in the pane, and the terminal's own ground: both the agent's, when it paints one. */
      ground(): { inset: string | null; theme?: string }
      renderer(): 'webgl' | 'dom' | null
    }
  }
}
