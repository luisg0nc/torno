import { captionPlace } from '../../shared/captionPlace'
import { CAPTION_PAUSE_MS, captionShows } from '../state/step'

/**
 * Puts the caption (`ui/ToolHint.tsx`) by the pointer: written straight on its element on every move of the pointer
 * over the pane, so that nothing of a pointer move reaches React. It is shown by the pause rule (`captionShows`): at
 * once for the first uses of a tool, then once the pointer has rested; its words are in the live region either way.
 * It stands beyond the readout of what is under the pointer when that is there, and goes when the pointer leaves.
 */
export class CaptionAt {
  private pointer: [number, number] | null = null
  private since = 0
  private uses = 0
  private timer = 0
  private frame = 0

  constructor(
    private readonly pane: HTMLElement,
    private readonly element: () => HTMLElement | null
  ) {
    pane.addEventListener('pointermove', this.moved, true)
    pane.addEventListener('pointerleave', this.left)
  }

  /** A tool with a step was taken, the `uses`th time: the pause counts from now. */
  taken(uses: number): void {
    this.uses = uses
    this.since = performance.now()
    this.update()
  }

  /** What the caption holds changed, or came: shown or put away as the rule says, and put in its place. */
  update(): void {
    window.clearTimeout(this.timer)
    const el = this.element()
    if (!el) return
    const still = performance.now() - this.since
    const shown = this.pointer !== null && captionShows(this.uses, still)
    el.toggleAttribute('data-shown', shown)
    if (shown) this.place(el)
    else if (this.pointer !== null) this.timer = window.setTimeout(() => this.update(), Math.max(0, CAPTION_PAUSE_MS - still))
  }

  dispose(): void {
    window.clearTimeout(this.timer)
    cancelAnimationFrame(this.frame)
    this.pane.removeEventListener('pointermove', this.moved, true)
    this.pane.removeEventListener('pointerleave', this.left)
  }

  private readonly moved = (e: PointerEvent): void => {
    const box = this.pane.getBoundingClientRect()
    this.pointer = [e.clientX - box.left, e.clientY - box.top]
    this.since = performance.now()
    this.update()
  }

  private readonly left = (): void => {
    this.pointer = null
    this.update()
  }

  /** In the next frame, so that the readout that the tools write on the same move is the one the caption stands beyond. */
  private place(el: HTMLElement): void {
    cancelAnimationFrame(this.frame)
    this.frame = requestAnimationFrame(() => {
      if (!this.pointer) return
      const box = this.pane.getBoundingClientRect()
      const readout = this.pane.querySelector<HTMLElement>('.pick-readout:not([hidden])')
      const [x, y] = captionPlace(this.pointer, { width: el.offsetWidth, height: el.offsetHeight }, box, readout?.offsetHeight ?? 0)
      el.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`
    })
  }
}
