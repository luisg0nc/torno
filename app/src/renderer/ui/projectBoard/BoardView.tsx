import { useEffect, useRef, useState, type DragEvent, type PointerEvent } from 'react'
import type { Card } from '../../../shared/board'
import { hint, pressed, viewKey } from '../../../shared/keys'
import { boardActions, boardStore, memoryEpoch, onBoardForgotten, useBoard, type BoardTool } from '../../state/board'
import { pictureStore } from '../../state/boardPictures'
import { actions } from '../../state/store'
import { InkPad } from '../ink/InkPad'
import { BOARD, doodlePng, doodlePngOver } from '../ink/strokes'
import { HEIC_REASON, isHeic, prepareImage } from '../onboard/images'
import { TYPING } from '../typing'
import { Arrows } from './Arrows'
import { AttachBar } from './AttachBar'
import { Camera, type View } from './Camera'
import { carryOut } from './carry'
import { Cards } from './Cards'
import { Editor } from './Editor'
import { boardBox, cardsTouching, frameAt, pictureSize } from './geometry'
import { HiddenCards } from './HiddenCards'
import { Minimap } from './Minimap'
import { doubleClickOf } from './opens'
import { addPictureCard, drawArrow, moveCards, redrawSketch, removeThings, undo, type Move } from './ops'
import { BOARD_TOOLS, Palette } from './Palette'
import { PictureView } from './PictureView'

// The board in place of the view: a stage with one layer, which the camera moves and scales by a transform it sets
// itself. Panning and zooming are handled here on the elements and never go through React state, so no card is drawn
// again for them (the layer of cards counts its own draws under test: `__tornoBoardRenders`). The tools too work on the
// elements while the pointer is down (a card dragged, a box drawn, an arrow pulled) and tell main only when it is let go.

/** Where each project's camera was left, so that the board comes back as it was in this window. */
const left = new Map<string, View>()
onBoardForgotten(() => left.clear())

/** Dots of the ground, every this many board units: more apart once the board is zoomed far out, so that they never crowd. */
const DOT_STEP = 24
const DOT_STEP_FAR = 96

/** Pixels a wheel notch of each kind is worth. */
const wheelPixels = (e: WheelEvent): number => (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1)

const underTest = typeof location !== 'undefined' && new URLSearchParams(location.search).has('test')


/** The smallest a card is made by its handles, in board units. */
const MIN_W = 80
const MIN_H = 48
/** A frame drawn smaller than this is no frame. */
const FRAME_MIN = { w: 60, h: 40 }
/** Pixels a pointer moves before a press is a drag. */
const SLOP = 4
/** The size a new text card is made at, and a sketch card. */
const TEXT_SIZE = { w: 280, h: 160 }
const SKETCH_SIZE = { w: 300, h: 200 }
/** The size a new size card is made at: main's own (`MADE_SIZE.size`). */
const SIZE_CARD = { w: 240, h: 120 }

const inkNow = (): string => getComputedStyle(document.documentElement).getPropertyValue('--ink').trim() || '#22252A'

interface Item {
  id: string
  el: HTMLElement
  x: number
  y: number
}

interface Rect {
  x: number
  y: number
  w: number
  h: number
}

type Gesture =
  | { kind: 'move'; start: { x: number; y: number }; items: Item[]; followers: Item[]; moved: boolean; pressed: string; shift: boolean; was: boolean }
  | { kind: 'resize'; start: { x: number; y: number }; id: string; el: HTMLElement; corner: string; rect: Rect }
  | { kind: 'box'; start: { x: number; y: number }; shift: boolean; frame: boolean }
  | { kind: 'arrow'; start: { x: number; y: number }; from: string }
  | { kind: 'place'; start: { x: number; y: number } }

/** What the board takes of what is dropped, pasted or chosen: a picture the window can read (a WebP is made a JPEG, and a phone's HEIC is told why not). */
const isImage = (f: File): boolean => f.type === 'image/png' || f.type === 'image/jpeg' || f.type === 'image/webp' || /\.heic$/i.test(f.name)

const wordsOf = (e: unknown): string => (e instanceof Error ? e.message : String(e)).replace(/^Error invoking remote method '[^']*': (?:Error: )?/, '')

/** The pad: a new sketch, or the drawing of a sketch card drawn on again (its picture is the ground, and what is drawn goes over it). */
type Pad = { card?: string; ground?: { url: string; bytes: Uint8Array } }

export function BoardView() {
  const objectId = useBoard((s) => s.objectId)
  const board = useBoard((s) => s.board)
  const tool = useBoard((s) => s.tool)
  const selected = useBoard((s) => s.selected)
  const problem = useBoard((s) => s.problem)
  const fileProblem = useBoard((s) => s.fileProblem)
  const stage = useRef<HTMLDivElement>(null)
  const layer = useRef<HTMLDivElement>(null)
  const boxEl = useRef<HTMLDivElement>(null)
  const ghost = useRef<SVGLineElement>(null)
  const files = useRef<HTMLInputElement>(null)
  const [camera, setCamera] = useState<Camera | null>(null)
  const [sketching, setSketching] = useState<Pad | null>(null)
  /** A picture opened large: its object URL and what it is called. */
  const [viewing, setViewing] = useState<{ url: string; label: string } | null>(null)
  const viewingNow = useRef(false)
  viewingNow.current = viewing !== null
  const cards = useRef<readonly Card[]>([])
  cards.current = board?.cards ?? []
  const fitted = useRef(false)
  const space = useRef(false)
  const panning = useRef<{ x: number; y: number } | null>(null)
  const gesture = useRef<Gesture | null>(null)

  useEffect(() => {
    const stageEl = stage.current!
    // The ground's dots follow the camera through three properties, set where it moves.
    const made: Camera = new Camera(layer.current!, () => {
      const { x, y, k } = made.view
      const step = k >= 0.5 ? DOT_STEP : DOT_STEP_FAR
      stageEl.style.setProperty('--board-dot', `${step * k}px`)
      stageEl.style.setProperty('--board-x', `${x}px`)
      stageEl.style.setProperty('--board-y', `${y}px`)
    })
    const epoch = memoryEpoch()
    const kept = objectId === null ? undefined : left.get(objectId)
    if (kept) {
      made.restore(kept)
      fitted.current = true
    } else made.pan(0, 0)
    setCamera(made)

    const onWheel = (e: WheelEvent): void => {
      // A card that scrolls (the brief) keeps the wheel while it has more to show.
      const scroller = e.target instanceof Element ? e.target.closest('[data-scroll]') : null
      if (!e.ctrlKey && scroller && scroller.scrollHeight > scroller.clientHeight) return
      e.preventDefault()
      const unit = wheelPixels(e)
      if (e.ctrlKey) made.zoomAt(Math.exp((-e.deltaY * unit) / 500), e.clientX, e.clientY)
      else made.pan(-e.deltaX * unit, -e.deltaY * unit)
    }
    stageEl.addEventListener('wheel', onWheel, { passive: false })
    if (underTest) window.__tornoBoardCamera = () => made.view
    return () => {
      stageEl.removeEventListener('wheel', onWheel)
      // Not into a workspace that has been left meanwhile: a project of that name there is another.
      if (objectId !== null && epoch === memoryEpoch()) left.set(objectId, made.view)
      if (underTest) delete window.__tornoBoardCamera
    }
  }, [objectId])

  // The first time a board is shown it is fitted whole.
  useEffect(() => {
    if (!camera || !board || fitted.current) return
    fitted.current = true
    camera.fit(boardBox(board.cards))
  }, [camera, board])

  // What main refused is said for a few seconds.
  useEffect(() => {
    if (problem === null) return
    const timer = setTimeout(() => boardActions.say(null), 7000)
    return () => clearTimeout(timer)
  }, [problem])

  /** A box of the board's size and shape in the middle of what the screen shows. */
  const centred = (size: { w: number; h: number }): Rect => {
    const v = camera?.visible() ?? { x: 0, y: 0, w: 0, h: 0 }
    return { x: Math.round(v.x + v.w / 2 - size.w / 2), y: Math.round(v.y + v.h / 2 - size.h / 2), ...size }
  }

  /** Pictures the person gave (chosen, dropped or pasted) become picture cards, `at` where dropped or in the middle. */
  async function takePictures(list: readonly File[], at?: { x: number; y: number }): Promise<void> {
    if (objectId === null) return
    let n = 0
    for (const file of list.filter(isImage)) {
      // Main takes a PNG or a JPEG of at most 2000 px and 3.75 MB: a phone's photo is scaled down here first.
      let prepared
      try {
        const bytes = new Uint8Array(await file.arrayBuffer())
        if (isHeic(bytes)) throw new Error(`${file.name}: ${HEIC_REASON}`)
        prepared = await prepareImage(bytes, file.name)
      } catch (e) {
        boardActions.say(wordsOf(e))
        continue
      }
      const size = pictureSize(prepared.width, prepared.height)
      const rect = at ? { x: Math.round(at.x - size.w / 2) + n * 24, y: Math.round(at.y - size.h / 2) + n * 24, ...size } : { ...centred(size), x: centred(size).x + n * 24, y: centred(size).y + n * 24 }
      n++
      try {
        await addPictureCard(objectId, prepared.image, 'picture', rect)
      } catch {
        // Main refused it and the board said why.
      }
    }
  }

  /** A tool is chosen: Picture and Sketch do their one thing and Select is in hand again. */
  function choose(next: BoardTool): void {
    if (next === 'picture') {
      boardActions.setTool('select')
      files.current?.click()
    } else if (next === 'sketch') {
      boardActions.setTool('select')
      setSketching({})
    } else boardActions.setTool(next)
  }

  // The keys while the board is shown. The view is under it, and hears nothing.
  const act = useRef({ choose, takePictures })
  act.current = { choose, takePictures }
  useEffect(() => {
    if (!camera) return
    const here = (e: Event): boolean => {
      const target = e.target instanceof Element ? e.target : null
      return !target?.closest(TYPING)
    }
    const onDown = (e: KeyboardEvent): void => {
      if (!here(e) || viewingNow.current) return
      const state = boardStore.getState()
      const stop = (): void => {
        e.preventDefault()
        e.stopPropagation()
      }
      const tool = BOARD_TOOLS.find((t) => pressed(e, t.id))
      if (pressed(e, 'board.fit')) {
        stop()
        camera.fit(boardBox(cards.current))
      } else if (tool) {
        stop()
        act.current.choose(tool.tool)
      } else if (pressed(e, 'board.remove')) {
        if (state.selected.length === 0 || state.objectId === null) return
        stop()
        void removeThings(state.objectId, state.selected)
      } else if (pressed(e, 'board.attach')) {
        // The cards and frames selected go with the next prompt: the chat shows them as a chip above its box.
        if (boardActions.attachSelected()) {
          stop()
          actions.setDockOpen(true)
        }
      } else if (pressed(e, 'board.undoChange')) {
        if (state.objectId === null) return
        stop()
        void undo(state.objectId)
      } else if (pressed(e, 'board.step')) {
        // What is under way ends first, then the tool in hand, then the selection. The press is left to whoever else has Esc.
        if (state.tool !== 'select') boardActions.setTool('select')
        else if (state.selected.length > 0) boardActions.select([])
      } else if (pressed(e, 'board.pan')) {
        // Only where nothing else has the key: a button in focus keeps its Space.
        const target = e.target
        if (!(target === document.body || (target instanceof Node && stage.current?.contains(target)))) return
        e.preventDefault()
        space.current = true
        stage.current?.setAttribute('data-space', '')
      } else if (viewKey(e)) {
        e.stopPropagation()
      }
    }
    const onUp = (e: KeyboardEvent): void => {
      if (!pressed(e, 'board.pan')) return
      space.current = false
      stage.current?.removeAttribute('data-space')
    }
    // A picture pasted from the clipboard (the window reads what is pasted; nothing reads the clipboard by itself).
    const onPaste = (e: ClipboardEvent): void => {
      if (!here(e)) return
      const pasted = [...(e.clipboardData?.files ?? [])].filter(isImage)
      if (pasted.length === 0) return
      e.preventDefault()
      void act.current.takePictures(pasted)
    }
    window.addEventListener('keydown', onDown, true)
    window.addEventListener('keyup', onUp, true)
    window.addEventListener('paste', onPaste)
    return () => {
      window.removeEventListener('keydown', onDown, true)
      window.removeEventListener('keyup', onUp, true)
      window.removeEventListener('paste', onPaste)
    }
  }, [camera])

  const cardOf = (id: string): Card | undefined => boardStore.getState().board?.cards.find((c) => c.id === id)
  const elOf = (id: string): HTMLElement | null => stage.current?.querySelector<HTMLElement>(`[data-card="${id}"]`) ?? null
  const itemOf = (id: string): Item | null => {
    const card = cardOf(id)
    const el = elOf(id)
    return card && el ? { id, el, x: card.x, y: card.y } : null
  }

  /** The box drawn over the ground, in pixels of the stage; hidden when `rect` is null. */
  function showBox(a: { x: number; y: number } | null, b?: { x: number; y: number }): void {
    const el = boxEl.current
    const at = stage.current?.getBoundingClientRect()
    if (!el || !at) return
    if (!a || !b) return void (el.style.display = 'none')
    el.style.display = 'block'
    el.style.left = `${Math.min(a.x, b.x) - at.left}px`
    el.style.top = `${Math.min(a.y, b.y) - at.top}px`
    el.style.width = `${Math.abs(a.x - b.x)}px`
    el.style.height = `${Math.abs(a.y - b.y)}px`
  }

  function onPointerDown(e: PointerEvent<HTMLDivElement>): void {
    if (!camera) return
    const target = e.target instanceof Element ? e.target : null
    if (target?.closest('.pboard-editor')) return
    // A link of a text card is pressed, not dragged: the click opens it.
    if (e.button === 0 && target?.closest('[data-link]')) return
    e.currentTarget.focus({ preventScroll: true })
    if (e.button === 1 || e.button === 2 || (e.button === 0 && space.current)) {
      e.preventDefault()
      panning.current = { x: e.clientX, y: e.clientY }
      e.currentTarget.setPointerCapture(e.pointerId)
      e.currentTarget.setAttribute('data-panning', '')
      return
    }
    if (e.button !== 0) return
    const state = boardStore.getState()
    const start = { x: e.clientX, y: e.clientY }
    const begin = (g: Gesture): void => {
      gesture.current = g
      e.currentTarget.setPointerCapture(e.pointerId)
    }
    const handle = target?.closest<HTMLElement>('[data-handle]')
    const cardEl = target?.closest<HTMLElement>('[data-card]')
    const card = cardEl ? cardOf(cardEl.dataset.card!) : undefined
    if (handle && card && cardEl) {
      begin({ kind: 'resize', start, id: card.id, el: cardEl, corner: handle.dataset.handle!, rect: { x: card.x, y: card.y, w: card.w, h: card.h } })
      return
    }
    if (state.tool === 'arrow') {
      if (card) begin({ kind: 'arrow', start, from: card.id })
      return
    }
    if (state.tool === 'frame') {
      begin({ kind: 'box', start, shift: false, frame: true })
      return
    }
    if (state.tool === 'text' || state.tool === 'size') {
      if (card) boardActions.select([card.id], e.shiftKey)
      else begin({ kind: 'place', start })
      return
    }
    if (card) {
      const was = state.selected.includes(card.id)
      if (e.shiftKey && was) return void boardActions.select(state.selected.filter((id) => id !== card.id))
      if (!was) boardActions.select([card.id], e.shiftKey)
      const chosen = boardStore.getState().selected.filter((id) => cardOf(id) !== undefined)
      const items = chosen.map(itemOf).filter((i): i is Item => i !== null)
      // What is in a frame that is moved goes with it on the screen at once; main moves it too.
      const frames = items.filter((i) => cardOf(i.id)?.kind === 'frame').map((i) => i.id)
      const followers = (boardStore.getState().board?.cards ?? [])
        .filter((c) => c.frame !== undefined && frames.includes(c.frame) && !chosen.includes(c.id))
        .map((c) => itemOf(c.id))
        .filter((i): i is Item => i !== null)
      begin({ kind: 'move', start, items, followers, moved: false, pressed: card.id, shift: e.shiftKey, was })
      return
    }
    const arrowEl = target?.closest<SVGElement>('[data-arrow]')
    if (arrowEl) return void boardActions.select([arrowEl.dataset.arrow!], e.shiftKey)
    if (!e.shiftKey) boardActions.select([])
    begin({ kind: 'box', start, shift: e.shiftKey, frame: false })
  }

  function onPointerMove(e: PointerEvent<HTMLDivElement>): void {
    if (!camera) return
    const from = panning.current
    if (from) {
      camera.pan(e.clientX - from.x, e.clientY - from.y)
      panning.current = { x: e.clientX, y: e.clientY }
      return
    }
    const g = gesture.current
    if (!g) return
    const k = camera.view.k
    if (g.kind === 'move') {
      if (!g.moved && Math.hypot(e.clientX - g.start.x, e.clientY - g.start.y) < SLOP) return
      g.moved = true
      const dx = (e.clientX - g.start.x) / k
      const dy = (e.clientY - g.start.y) / k
      for (const it of [...g.items, ...g.followers]) {
        it.el.style.left = `${it.x + dx}px`
        it.el.style.top = `${it.y + dy}px`
      }
    } else if (g.kind === 'resize') {
      const r = resized(g.rect, g.corner, (e.clientX - g.start.x) / k, (e.clientY - g.start.y) / k)
      g.el.style.left = `${r.x}px`
      g.el.style.top = `${r.y}px`
      g.el.style.width = `${r.w}px`
      g.el.style.height = `${r.h}px`
    } else if (g.kind === 'box') {
      if (Math.hypot(e.clientX - g.start.x, e.clientY - g.start.y) >= SLOP) showBox(g.start, { x: e.clientX, y: e.clientY })
    } else if (g.kind === 'arrow') {
      const line = ghost.current
      const from = cardOf(g.from)
      if (!line || !from) return
      const to = camera.toBoard(e.clientX, e.clientY)
      line.style.display = 'block'
      line.setAttribute('x1', String(from.x + from.w / 2))
      line.setAttribute('y1', String(from.y + from.h / 2))
      line.setAttribute('x2', String(to.x))
      line.setAttribute('y2', String(to.y))
    }
  }

  function onPointerEnd(e: PointerEvent<HTMLDivElement>): void {
    if (panning.current) {
      panning.current = null
      e.currentTarget.removeAttribute('data-panning')
      return
    }
    const g = gesture.current
    gesture.current = null
    if (!g || !camera || objectId === null) return
    const k = camera.view.k
    const dx = (e.clientX - g.start.x) / k
    const dy = (e.clientY - g.start.y) / k
    const near = Math.hypot(e.clientX - g.start.x, e.clientY - g.start.y) < SLOP
    if (g.kind === 'place') {
      if (!near) return
      const at = camera.toBoard(e.clientX, e.clientY)
      const sizing = boardStore.getState().tool === 'size'
      boardActions.edit({ kind: sizing ? 'size' : 'text', x: Math.round(at.x), y: Math.round(at.y), ...(sizing ? SIZE_CARD : TEXT_SIZE) })
    } else if (g.kind === 'move') {
      if (!g.moved) {
        // A press with no drag: on a card among several selected, it is the one that is chosen.
        if (g.was && !g.shift && g.items.length > 1) boardActions.select([g.pressed])
        return
      }
      const all = boardStore.getState().board?.cards ?? []
      const frames = g.items.filter((i) => cardOf(i.id)?.kind === 'frame').map((i) => i.id)
      const moves: Move[] = g.items.map((it) => {
        const c = cardOf(it.id)!
        const x = Math.round(it.x + dx)
        const y = Math.round(it.y + dy)
        const move: Move = { id: it.id, x, y }
        if (c.kind !== 'frame' && !(c.frame !== undefined && frames.includes(c.frame))) {
          const into = frameAt(all, { x, y, w: c.w, h: c.h }, frames)
          if (into !== (c.frame ?? null)) move.frame = into
        }
        return move
      })
      void moveCards(objectId, moves).then((ok) => {
        if (ok) return
        for (const it of [...g.items, ...g.followers]) {
          it.el.style.left = `${it.x}px`
          it.el.style.top = `${it.y}px`
        }
      })
    } else if (g.kind === 'resize') {
      const r = resized(g.rect, g.corner, dx, dy)
      void moveCards(objectId, [{ id: g.id, x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.w), h: Math.round(r.h) }]).then((ok) => {
        if (ok) return
        g.el.style.left = `${g.rect.x}px`
        g.el.style.top = `${g.rect.y}px`
        g.el.style.width = `${g.rect.w}px`
        g.el.style.height = `${g.rect.h}px`
      })
    } else if (g.kind === 'box') {
      showBox(null)
      if (near) return
      const a = camera.toBoard(g.start.x, g.start.y)
      const b = camera.toBoard(e.clientX, e.clientY)
      const rect = { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y) }
      if (g.frame) {
        if (rect.w < FRAME_MIN.w || rect.h < FRAME_MIN.h) return
        boardActions.edit({ kind: 'frame', x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.w), h: Math.round(rect.h) })
      } else boardActions.select(cardsTouching(boardStore.getState().board?.cards ?? [], rect), g.shift)
    } else if (g.kind === 'arrow') {
      if (ghost.current) ghost.current.style.display = 'none'
      const over = document.elementFromPoint(e.clientX, e.clientY)?.closest<HTMLElement>('[data-card]')?.dataset.card
      boardActions.setTool('select')
      if (over !== undefined && over !== g.from) void drawArrow(objectId, g.from, over)
    }
  }

  /** The picture of a card, opened large: the one it shows now (nothing when it is not on this computer). */
  function openLarge(card: Card): void {
    const urls = pictureStore.getState().urls
    const key = card.kind === 'reference' ? `reference:${card.source}` : `board:${card.picture}`
    const url = urls[key]
    if (!url) return void boardActions.say('That picture is not on this computer.')
    const what = card.kind === 'reference' ? (card.source ?? '').replace(/^reference\//, '') : (card.caption ?? card.kind)
    setViewing({ url, label: `Picture ${card.id}: ${what}` })
  }

  /** A sketch drawn on again: its drawing is under the pad's ink, and what is drawn goes over it. */
  async function reopenSketch(card: Card): Promise<void> {
    if (objectId === null || card.picture === undefined) return
    const bytes = await window.torno.board.picture(objectId, card.picture).catch(() => null)
    if (!bytes) return void boardActions.say('That sketch is not on this computer.')
    setSketching({ card: card.id, ground: { url: URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'image/png' })), bytes } })
  }

  function closePad(): void {
    setSketching((pad) => {
      if (pad?.ground) URL.revokeObjectURL(pad.ground.url)
      return null
    })
  }

  function onDoubleClick(e: React.MouseEvent<HTMLDivElement>): void {
    const target = e.target instanceof Element ? e.target : null
    const state = boardStore.getState()
    const arrowId = target?.closest<SVGElement>('[data-arrow]')?.dataset.arrow
    if (arrowId !== undefined) {
      if (state.board?.arrows.find((a) => a.id === arrowId)?.by === 'person') boardActions.edit({ kind: 'word', id: arrowId })
      return
    }
    // A press on a card captures the pointer for the stage, so the event may name the stage: the card is what is under the pointer.
    const card = (target?.closest<HTMLElement>('[data-card]') ?? document.elementFromPoint(e.clientX, e.clientY)?.closest<HTMLElement>('[data-card]'))?.dataset.card
    const found = card === undefined ? undefined : cardOf(card)
    if (!found || objectId === null) return
    // What it does is the card's own (`doubleClickOf`, the table of the spec).
    const opens = doubleClickOf(found)
    if (opens === null) return
    switch (opens.does) {
      case 'edit':
        return boardActions.edit({ kind: 'text', id: found.id, x: found.x, y: found.y, w: found.w, h: found.h })
      case 'rename':
        return boardActions.edit({ kind: 'name', id: found.id })
      case 'size':
        return boardActions.edit({ kind: 'size', id: found.id, x: found.x, y: found.y, w: found.w, h: found.h })
      case 'large':
        return openLarge(found)
      case 'sketch':
        return void reopenSketch(found)
      default:
        void carryOut(objectId, opens).then((why) => {
          if (why !== null) boardActions.say(why)
        })
    }
  }

  function onDrop(e: DragEvent<HTMLDivElement>): void {
    e.preventDefault()
    const dropped = [...e.dataTransfer.files].filter(isImage)
    if (dropped.length === 0 || !camera) return
    void takePictures(dropped, camera.toBoard(e.clientX, e.clientY))
  }

  const empty = board !== null && board.cards.every((c) => c.hidden)

  return (
    <section className="pboard" aria-label="Board" data-board="">
      <div
        ref={stage}
        className="pboard-stage"
        role="region"
        aria-label="Cards of the board"
        aria-description={`Wheel moves around, Ctrl and the wheel zooms, ${hint('board.fit')} fits all the cards`}
        tabIndex={0}
        data-tool={tool}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerEnd}
        onPointerCancel={onPointerEnd}
        onDoubleClick={onDoubleClick}
        onDragOver={(e) => {
          if (e.dataTransfer.types.includes('Files')) e.preventDefault()
        }}
        onDrop={onDrop}
        onContextMenu={(e) => e.preventDefault()}
      >
        <div ref={layer} className="pboard-layer">
          {board && objectId !== null && <Arrows cards={board.cards} arrows={board.arrows} selected={selected} />}
          {board && objectId !== null && <Cards objectId={objectId} cards={board.cards} />}
          <svg className="pboard-ghost" width="1" height="1" aria-hidden="true">
            <line ref={ghost} style={{ display: 'none' }} />
          </svg>
          {objectId !== null && <Editor objectId={objectId} />}
        </div>
        <div ref={boxEl} className="pboard-box" style={{ display: 'none' }} aria-hidden="true" />
      </div>
      {empty && <p className="pboard-empty">Nothing on the board yet. The brief, the photos in reference, marks and scans appear here by themselves.</p>}
      {problem !== null && (
        <p className="pboard-problem" role="status">
          {problem}
        </p>
      )}
      {fileProblem !== null && objectId !== null && (
        <p className="pboard-problem pboard-file-problem selectable" role="status">
          {fileProblem}{' '}
          <button
            type="button"
            className="link-button"
            onClick={() => {
              boardActions.dismissFileProblem()
              void window.torno.board.dismissProblem(objectId).catch(() => {})
            }}
          >
            Dismiss
          </button>
        </p>
      )}
      <Palette onChoose={choose} />
      {board && objectId !== null && <HiddenCards objectId={objectId} cards={board.cards} />}
      <AttachBar />
      {camera && board && <Minimap cards={board.cards} camera={camera} />}
      <input
        ref={files}
        type="file"
        accept="image/png,image/jpeg"
        multiple
        hidden
        data-board-files=""
        onChange={(e) => {
          void takePictures([...(e.currentTarget.files ?? [])])
          e.currentTarget.value = ''
        }}
      />
      {viewing && <PictureView url={viewing.url} label={viewing.label} onClose={() => setViewing(null)} />}
      {sketching && objectId !== null && (
        <InkPad
          title="Sketch"
          label="Sketch for the board"
          hint={sketching.card ? 'Draw over the sketch: what you add goes on top of it.' : 'Draw what you mean: a shape, where it goes, a size. Hold Shift for a straight line.'}
          size={BOARD}
          {...(sketching.ground ? { ground: sketching.ground.url } : {})}
          foot={sketching.card ? 'The card shows the new drawing, and Claude gets it as a picture when you send it.' : 'It becomes a card on the board, and Claude gets it as a picture when you send it.'}
          look={() => ({ ink: inkNow() })}
          initial={[]}
          discard={{ label: 'Discard this sketch?', text: 'Discard this sketch? What was drawn since it was opened is not kept.' }}
          onDone={async (strokes) => {
            if (strokes.length > 0) {
              if (sketching.card && sketching.ground) await redrawSketch(objectId, sketching.card, await doodlePngOver(sketching.ground.bytes, strokes))
              else await addPictureCard(objectId, await doodlePng(strokes, false), 'sketch', centred(SKETCH_SIZE))
            }
            closePad()
          }}
          onCancel={closePad}
        />
      )}
    </section>
  )
}

/** The box of a card resized by one of its corners, moved by `dx` and `dy` board units, and never smaller than the least. */
function resized(r: Rect, corner: string, dx: number, dy: number): Rect {
  let { x, y, w, h } = r
  if (corner.includes('e')) w = Math.max(MIN_W, r.w + dx)
  if (corner.includes('s')) h = Math.max(MIN_H, r.h + dy)
  if (corner.includes('w')) {
    w = Math.max(MIN_W, r.w - dx)
    x = r.x + r.w - w
  }
  if (corner.includes('n')) {
    h = Math.max(MIN_H, r.h - dy)
    y = r.y + r.h - h
  }
  return { x, y, w, h }
}
