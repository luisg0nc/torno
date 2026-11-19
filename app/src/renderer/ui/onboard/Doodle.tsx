import { useEffect, useRef, useState } from 'react'
import type { PhotoDraft, Stroke } from '../../state/onboard'
import { InkPad } from '../ink/InkPad'
import { BOARD, OVER_PICTURE, doodlePng } from '../ink/strokes'

/** The ink as the theme has it now: the board's strokes are drawn in it; the PNG is made in its own. */
const inkNow = (): string => getComputedStyle(document.documentElement).getPropertyValue('--ink').trim() || '#20242B'

/**
 * The doodle board of a new object: 1200 x 800 board pixels on the panel's ground with a light grid, in the theme's ink, or
 * on one of the draft's `photos` ("Draw over"), fitted whole. "Done" gives the strokes back with the PNG made of them
 * (`doodlePng`: dark on white whatever the theme, the photo under the ink) and the `uid` of the photo it is over, if any.
 * Over a photo the ink is the PNG's dark ink with a light halo (`OVER_PICTURE`): it shows on a white photo and a dark one, in both themes.
 */
export function Doodle({
  initial,
  photos,
  over: opened,
  onDone,
  onCancel
}: {
  initial: Stroke[]
  /** The photos of the draft, to draw over. */
  photos: PhotoDraft[]
  /** The photo this doodle was drawn over, when it is opened again to change. */
  over?: string
  onDone: (strokes: Stroke[], png: Uint8Array, over: string | undefined) => void
  onCancel: () => void
}) {
  const [over, setOver] = useState<string | undefined>(opened !== undefined && photos.some((p) => p.uid === opened) ? opened : undefined)
  const [background, setBackground] = useState<ImageBitmap | undefined>(undefined)
  // The photo being decoded, so that "Done" waits for it rather than make the PNG on the grid.
  const decoding = useRef<Promise<ImageBitmap | undefined>>(Promise.resolve(undefined))
  const photo = photos.find((p) => p.uid === over)

  useEffect(() => {
    setBackground(undefined)
    if (!photo) {
      decoding.current = Promise.resolve(undefined)
      return
    }
    let gone = false
    const made = createImageBitmap(new Blob([photo.image as BlobPart])).then(
      (bitmap) => {
        if (gone) bitmap.close()
        else setBackground(bitmap)
        return bitmap
      }
    )
    decoding.current = made
    return () => {
      gone = true
      void made.then((bitmap) => bitmap.close()).catch(() => {})
    }
  }, [photo?.image])

  const choice = (
    <label className="board-over">
      <span>Draw over</span>
      <select className="new-select" aria-label="Draw over" value={over ?? ''} onChange={(e) => setOver(e.target.value === '' ? undefined : e.target.value)}>
        <option value="">Nothing, the grid</option>
        {photos.map((p, n) => (
          <option key={p.uid} value={p.uid}>
            {`Photo ${n + 1}, ${p.file}`}
          </option>
        ))}
      </select>
    </label>
  )

  return (
    <InkPad
      title="Doodle"
      label="Doodle board"
      hint={photo ? 'Draw on the photo: outline a part, point at where it goes, put a size by it. Hold Shift for a straight line.' : 'Draw what you mean: a shape, where it goes, a size. Hold Shift for a straight line.'}
      size={BOARD}
      background={background}
      grid={!photo}
      tools={photos.length > 0 ? choice : undefined}
      foot="Claude gets this as a picture, with your note."
      look={() => (photo ? OVER_PICTURE : { ink: inkNow() })}
      changed={over !== (opened !== undefined && photos.some((p) => p.uid === opened) ? opened : undefined)}
      initial={initial}
      discard={{ label: 'Discard this doodle?', text: 'Discard this doodle? What was drawn since it was opened is not kept.' }}
      onDone={async (strokes) => {
        let ground: ImageBitmap | undefined
        try {
          ground = await decoding.current
        } catch {
          throw new Error('The photo could not be read to draw over it.')
        }
        onDone(strokes, await doodlePng(strokes, true, ground), photo?.uid)
      }}
      onCancel={onCancel}
    />
  )
}
