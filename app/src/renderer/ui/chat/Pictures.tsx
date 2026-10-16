import { useContext, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { pressed } from '../../../shared/keys'
import type { ChatImage } from '../../../shared/chat'
import { referenceUrl } from '../../state/chat'
import { numbered } from '../numbered'
import { AskSession } from './AskCard'
import { goneText } from './gone'

/** Only a picture's own kinds are put in an `img`. */
const SAFE_TYPE = /^image\/(png|jpeg|gif|webp)$/
const hasData = (image: ChatImage): boolean => image.data !== undefined && image.data !== '' && SAFE_TYPE.test(image.mediaType)
/** A reference whose data is gone: shown from its file in `reference/`, which main reads again. */
const fromFile = (image: ChatImage): string | undefined => (hasData(image) ? undefined : image.file)
const baseName = (file: string): string => file.slice(file.lastIndexOf('/') + 1)

/** The object URLs of the references among the pictures, by picture id: a string once read, null when not there, absent while asked. */
function useReferences(images: ChatImage[]): Record<string, string | null> {
  const sessionId = useContext(AskSession)
  const [urls, setUrls] = useState<Record<string, string | null>>({})
  const wanted = images.flatMap((image) => (fromFile(image) ? [`${image.id}=${image.file}`] : [])).join('|')
  useEffect(() => {
    if (wanted === '') return
    let live = true
    for (const image of images) {
      const file = fromFile(image)
      if (!file) continue
      const got = sessionId ? referenceUrl(sessionId, file) : Promise.resolve(null)
      void got.then((url) => live && setUrls((was) => (was[image.id] === url ? was : { ...was, [image.id]: url })))
    }
    return () => {
      live = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, wanted])
  return urls
}

/**
 * The pictures of a message or of a tool's result, as thumbnails in a row; one is shown large over the pane when
 * it is clicked, until Escape or another click. A picture whose data is no longer kept says so.
 */
export function Pictures({ images, what }: { images: ChatImage[]; what: string }) {
  const [open, setOpen] = useState<number | null>(null)
  const back = useRef<HTMLButtonElement | null>(null)
  const layer = useRef<HTMLDivElement>(null)
  const root = useRef<HTMLDivElement>(null)
  const urls = useReferences(images)
  useEffect(() => {
    if (open !== null) layer.current?.focus()
  }, [open])
  if (images.length === 0) return null

  const src = (image: ChatImage): string | undefined => (hasData(image) ? `data:${image.mediaType};base64,${image.data}` : (urls[image.id] ?? undefined))
  const shows = (image: ChatImage): boolean => src(image) !== undefined

  const close = (): void => {
    setOpen(null)
    // The focus goes back to the thumbnail it was taken from.
    requestAnimationFrame(() => back.current?.focus())
  }
  const shown = open === null ? undefined : images[open]
  // Over the transcript, not inside the group it is in: a group is contained (`content-visibility`), and would clip it.
  const host = shown ? root.current?.closest('.chat-scroll') : null

  return (
    <div className="chat-pictures" ref={root}>
      {images.map((image, n) =>
        shows(image) ? (
          <button
            key={image.id}
            type="button"
            className="chat-thumb"
            title={image.file && !hasData(image) ? baseName(image.file) : undefined}
            aria-label={`${what}: picture ${n + 1} of ${images.length}, larger`}
            onClick={(e) => {
              back.current = e.currentTarget
              setOpen(n)
            }}
          >
            <img src={src(image)} alt="" draggable={false} />
          </button>
        ) : fromFile(image) && urls[image.id] === undefined ? (
          // Asked of main: the frame, empty, until the picture comes.
          <span key={image.id} className="chat-thumb chat-thumb-loading" aria-busy="true" />
        ) : (
          <span key={image.id} className="chat-thumb-gone">
            {image.file && goneText(image, what).startsWith(image.file) ? (
              <>
                <span className="num">{image.file}</span>
                {goneText(image, what).slice(image.file.length)}
              </>
            ) : (
              numbered(goneText(image, what))
            )}
          </span>
        )
      )}
      {shown && shows(shown) && host &&
        createPortal(
        <div
          ref={layer}
          className="chat-picture"
          role="dialog"
          aria-modal="true"
          aria-label={`${what}: picture ${open! + 1} of ${images.length}`}
          tabIndex={-1}
          onClick={close}
          onKeyDown={(e) => {
            // One thing to be on: Tab stays where it is.
            if (pressed(e, 'sheet.round')) e.preventDefault()
            if (!pressed(e, 'chat.close')) return
            e.stopPropagation()
            close()
          }}
        >
          <img src={src(shown)} alt="" title={shown.file && !hasData(shown) ? baseName(shown.file) : undefined} />
          {shown.width && shown.height ? <p className="chat-picture-size">{numbered(`${shown.width} × ${shown.height} px`)}</p> : null}
        </div>,
        host
        )}
    </div>
  )
}
