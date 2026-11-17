import type { Mark, SketchMark } from '../../shared/marks'

// The pictures of the cards of the project's sketches that have none: a sketch Claude drew while its project was not on show, or
// one of the person's whose picture was not made. The window draws them (the view from the sketch's camera, strokes included, as
// `look` draws), one at a time and each in a turn of its own, so that the frame loop and the person's pointer are not held for a
// run of them; main names and keeps each (`marks:sketchPicture`).

export interface PictureDeps {
  /** Runs `run` in a turn of its own, after what is happening now (a timer; never inside a frame). */
  later(run: () => void): void
  /** The PNG of a sketch's card as the window would draw it now; null when it cannot be drawn. Rejects when it fails. */
  draw(mark: SketchMark): Promise<Uint8Array | null>
  /** Has main keep it. */
  keep(objectId: string, id: string, png: Uint8Array): Promise<void>
  /** A sketch is being drawn: the pictures wait for its Done, which brings its own marks change. */
  busy(): boolean
}

export class MissingPictures {
  /** The project and marks on show, as last offered. */
  private latest: { objectId: string; marks: readonly Mark[] } | null = null
  /** The sketches that were tried, `<project>/<id>`: one that could not be drawn is not asked for again in this run of the project. */
  private tried = new Set<string>()
  private running = false
  private project: string | null = null

  constructor(private readonly deps: PictureDeps) {}

  /** The project on show and its marks, each time they change (null for none): draws what has no picture, one a turn. */
  offer(objectId: string | null, marks: readonly Mark[]): void {
    if (objectId !== this.project) {
      this.project = objectId
      this.tried.clear()
    }
    this.latest = objectId === null ? null : { objectId, marks }
    // One that has its picture was drawn: if the picture is taken away (its strokes changed), it is drawn again.
    if (objectId !== null) for (const m of marks) if (m.kind === 'sketch' && m.picture !== undefined) this.tried.delete(`${objectId}/${m.id}`)
    if (this.latest && !this.running && this.next() !== undefined) {
      this.running = true
      this.deps.later(() => void this.turn())
    }
  }

  private next(): SketchMark | undefined {
    const now = this.latest
    if (!now) return undefined
    return now.marks
      .filter((m): m is SketchMark => m.kind === 'sketch' && m.picture === undefined && m.strokes.length > 0 && !this.tried.has(`${now.objectId}/${m.id}`))
      .sort((a, b) => Number(a.id.slice(1)) - Number(b.id.slice(1)))[0]
  }

  private async turn(): Promise<void> {
    const now = this.latest
    const mark = this.next()
    if (!now || !mark || this.deps.busy()) {
      this.running = false
      return
    }
    this.tried.add(`${now.objectId}/${mark.id}`)
    try {
      const png = await this.deps.draw(mark)
      // Another project on show meanwhile: the picture is of the one it was drawn in, and is not kept in this.
      if (png && this.project === now.objectId) await this.deps.keep(now.objectId, mark.id, png)
    } catch {
      // The card stays with its placeholder.
    }
    if (this.next() === undefined) {
      this.running = false
      return
    }
    this.deps.later(() => void this.turn())
  }
}
