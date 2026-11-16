import { useEffect, useRef, useState } from 'react'
import { MAX_REFERENCE_COMMENT, MOST_NOTE_REFERENCES } from '../../../shared/marks'
import { MAX_PHOTO_BYTES } from '../../../shared/objectName'
import { HEIC_REASON, prepareImage } from '../onboard/images'
import { type RefItem, addable } from './referenceImages'

/** The endings of the pictures a note takes: a PNG, a JPEG or a WebP (which is scaled into a PNG or a JPEG). */
const IMAGE_ENDINGS = ['.png', '.jpg', '.jpeg', '.webp']
const isImage = (name: string): boolean => IMAGE_ENDINGS.some((end) => name.toLowerCase().endsWith(end))

let next = 1

/** Reads a picture the person gave and scales it as a prompt takes it: a PNG or a JPEG of at most 1280 px. Rejects with why not. */
async function taken(bytes: Uint8Array, name: string): Promise<RefItem> {
  const prepared = await prepareImage(bytes, name)
  return { uid: next++, comment: '', old: null, image: { bytes: prepared.image, mediaType: prepared.type }, url: URL.createObjectURL(new Blob([prepared.image as BlobPart], { type: prepared.type })) }
}

const basename = (path: string): string => path.split(/[\\/]/).pop() ?? path

interface ReferencesProps {
  objectId: string
  /** The note being edited: its own references are shown from its files. Null for a new note. */
  noteId: string | null
  items: RefItem[]
  onChange: (items: RefItem[]) => void
  busy: boolean
}

/**
 * The reference pictures of a view note: those it has, those added now, each with its comment, and a way to add one: a
 * dialog of main's own ("Add a reference") or a picture dropped on the list. What is given is read here, scaled to 1280
 * px (`prepareImage`) and held as bytes: the window names no file, and main names every one it keeps.
 */
export function References({ objectId, noteId, items, onChange, busy }: ReferencesProps) {
  const [said, setSaid] = useState<string | null>(null)
  const [reading, setReading] = useState(0)
  const [over, setOver] = useState(false)
  const now = useRef(items)
  now.current = items
  const room = addable(items.length)

  // The pictures a note already has are shown from its own files, which main reads: one that is not on this computer has none to show.
  const [shown, setShown] = useState<Record<number, string | null>>({})
  useEffect(() => {
    if (noteId === null) return
    let gone = false
    const urls: string[] = []
    for (const item of items) {
      if (item.old === null || item.old in shown) continue
      const index = item.old
      void window.torno.notes
        .picture(objectId, noteId, index)
        .then((bytes) => {
          if (gone) return
          const url = bytes ? URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'image/*' })) : null
          if (url) urls.push(url)
          setShown((s) => ({ ...s, [index]: url }))
        })
        .catch(() => !gone && setShown((s) => ({ ...s, [index]: null })))
    }
    return () => {
      gone = true
    }
    // Once for each reference the note has.
  }, [objectId, noteId])
  useEffect(
    () => () => {
      for (const url of Object.values(shown)) if (url) URL.revokeObjectURL(url)
      for (const item of now.current) if (item.url) URL.revokeObjectURL(item.url)
    },
    // Only when the sheet is put away: what was added is let go of with it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  )

  async function take(sources: Array<{ name: string; bytes: () => Promise<Uint8Array> }>): Promise<void> {
    setSaid(null)
    const problems: string[] = []
    const added: RefItem[] = []
    setReading((n) => n + sources.length)
    for (const source of sources.slice(0, room)) {
      try {
        added.push(await taken(await source.bytes(), source.name))
      } catch (e) {
        problems.push(e instanceof Error ? e.message : String(e))
      }
      setReading((n) => n - 1)
    }
    setReading((n) => n - Math.max(0, sources.length - room))
    if (sources.length > room) problems.push(`${sources.length - room} left out: a note has at most ${MOST_NOTE_REFERENCES} references.`)
    if (added.length > 0) onChange([...now.current, ...added].slice(0, MOST_NOTE_REFERENCES))
    if (problems.length > 0) setSaid(problems.join(' '))
  }

  async function choose(): Promise<void> {
    const paths = await window.torno.objects.pickPhotos().catch(() => [] as string[])
    await take(paths.map((path) => ({ name: basename(path), bytes: () => window.torno.objects.readPhoto(path) })))
  }
  function dropped(list: FileList): void {
    const files = [...list]
    const problems: string[] = []
    const sources: Array<{ name: string; bytes: () => Promise<Uint8Array> }> = []
    for (const file of files) {
      if (/\.(heic|heif)$/i.test(file.name)) problems.push(`${file.name}: ${HEIC_REASON}`)
      else if (!isImage(file.name)) problems.push(`${file.name} is not a PNG, JPEG or WebP picture.`)
      else if (file.size > MAX_PHOTO_BYTES) problems.push(`${file.name} is over ${MAX_PHOTO_BYTES / (1024 * 1024)} MB.`)
      else sources.push({ name: file.name, bytes: async () => new Uint8Array(await file.arrayBuffer()) })
    }
    if (problems.length > 0) setSaid(problems.join(' '))
    if (sources.length > 0) void take(sources).then(() => problems.length > 0 && setSaid((s) => [...problems, ...(s ? [s] : [])].join(' ')))
  }

  const remove = (item: RefItem): void => {
    if (item.url) URL.revokeObjectURL(item.url)
    onChange(items.filter((i) => i !== item))
  }

  return (
    <section
      className="note-refs"
      aria-label="References"
      data-over={over ? '' : undefined}
      onDragOver={(e) => {
        if (![...e.dataTransfer.types].includes('Files')) return
        e.preventDefault()
        setOver(true)
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        setOver(false)
        if (e.dataTransfer.files.length === 0) return
        e.preventDefault()
        if (!busy) dropped(e.dataTransfer.files)
      }}
    >
      <div className="note-refs-head">
        <h3>References</h3>
        <button type="button" className="button button-quiet" disabled={busy || room === 0 || reading > 0} onClick={() => void choose()}>
          Add a reference
        </button>
        <span className="note-refs-hint">
          {items.length === 0 ? (
            'A photo or a picture to go with the note. You can drop one here.'
          ) : (
            <>
              <span className="num">{items.length}</span> of <span className="num">{MOST_NOTE_REFERENCES}</span>
            </>
          )}
        </span>
      </div>
      {said !== null && (
        <p className="board-problem" role="status">
          {said}
        </p>
      )}
      {items.length > 0 && (
        <ul className="note-refs-list">
          {items.map((item, n) => {
            const url = item.url ?? (item.old !== null ? (shown[item.old] ?? null) : null)
            return (
              <li key={item.uid} className="note-ref" data-old={item.old !== null ? '' : undefined}>
                {url ? <img src={url} alt={`Reference ${n + 1}`} /> : <span className="note-ref-none">{item.old !== null && item.old in shown ? 'Not on this computer' : ''}</span>}
                {item.old === null ? (
                  <input
                    className="note-field"
                    data-board-field=""
                    aria-label={`Comment on reference ${n + 1}`}
                    placeholder="What it shows"
                    maxLength={MAX_REFERENCE_COMMENT}
                    value={item.comment}
                    disabled={busy}
                    onChange={(e) => onChange(items.map((i) => (i === item ? { ...i, comment: e.target.value.replace(/[\r\n]+/g, ' ') } : i)))}
                  />
                ) : (
                  <span className="note-ref-comment">{item.comment || 'No comment'}</span>
                )}
                <button type="button" className="button button-quiet" disabled={busy} aria-label={`Remove reference ${n + 1}`} onClick={() => remove(item)}>
                  Remove
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
