import { useEffect, useRef, useState } from 'react'
import { megabytes } from '../../shared/exportdata'
import { keptStore, letGo, useKept } from '../state/exportSaved'
import { useStore } from '../state/store'
import { Checked } from './export/Checked'
import { fileNameOf } from './export/exportWords'
import { Popover } from './Popover'

/** How long the read-back stands over the chip when the file lands: it shows once, and on the pointer after that. */
const SHOWN_MS = 7000

/**
 * The file an export wrote, in the status line where Export… was (spec 2026-11-18, "Export, on the bench"): "✓ intake.html 1.7 MB
 * Show in folder" on the accent wash. What was read back stands in a popover above it, once as the file lands and on the pointer or
 * the focus after. "Open in browser" is in it for a page. The file stays until the next build or a minute; the person may let it go.
 */
export function SavedFile() {
  const file = useKept((s) => s.file)
  const name = useStore((s) => s.workspace?.objects.find((o) => o.id === (file?.objectId ?? null))?.name ?? file?.objectId ?? null)
  const [open, setOpen] = useState(false)
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  const [error, setError] = useState<string | null>(null)
  const leaving = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const n = file?.n
  // It shows once, as the file lands.
  useEffect(() => {
    if (n === undefined) return
    setOpen(true)
    setError(null)
    const timer = setTimeout(() => setOpen(false), SHOWN_MS)
    return () => clearTimeout(timer)
  }, [n])
  if (!file) return null
  const { saved } = file
  const pointed = (): void => {
    clearTimeout(leaving.current)
    setOpen(true)
  }
  // A moment's grace, to cross the gap between the chip and its popover.
  const left = (): void => {
    clearTimeout(leaving.current)
    leaving.current = setTimeout(() => setOpen(false), 250)
  }
  const page = !file.kept && (saved.checked?.format ?? 'html') === 'html'
  const after = async (done: Promise<void>): Promise<void> => {
    try {
      await done
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setOpen(true)
    }
  }
  return (
    <span className="status-saved" ref={setAnchor} role="status" data-part="saved-file" onMouseEnter={pointed} onMouseLeave={left} onFocus={() => setOpen(true)}>
      <span className="status-saved-tick" aria-hidden="true">
        ✓
      </span>
      <span className="num">{fileNameOf(saved.path)}</span>
      <span className="num status-saved-size">{megabytes(saved.bytes)}</span>
      <button type="button" className="link-button" onClick={() => void after(window.torno.export.reveal())}>
        Show in folder
      </button>
      <button type="button" className="status-saved-away" aria-label="Dismiss" title="Let go of this file in the status line" onClick={() => letGo()}>
        <svg viewBox="0 0 16 16" width="10" height="10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true">
          <path d="m4 4 8 8M12 4l-8 8" />
        </svg>
      </button>
      {open && (
        <Popover anchor={anchor} side="above" width={330} role="status" aria-label="What was checked" onClose={() => setOpen(false)}>
          <div className="saved-pop">
            <h4>
              Saved <span className="num">{fileNameOf(saved.path)}</span>
            </h4>
            {saved.checked && <Checked checked={saved.checked} />}
            <p className="saved-pop-where">
              {name !== null && <>{name}, </>}
              <span className="num">{megabytes(saved.bytes)}</span>
              {saved.revision !== undefined && (
                <>
                  , of <span className="num">r{saved.revision}</span>
                </>
              )}
            </p>
            {saved.notOpened && <p data-tone="warn">It could not be opened: {saved.notOpened}</p>}
            {error !== null && <p data-tone="fail">{error}</p>}
            {page && (
              <button type="button" className="button" onClick={() => void after(window.torno.export.openSaved())}>
                Open in browser
              </button>
            )}
          </div>
        </Popover>
      )}
    </span>
  )
}

/** The window had no bridge, or the file is let go with the next build: for the status line, which calls it when a build begins. */
export function letGoOnBuild(): void {
  if (keptStore.getState().file !== null) letGo()
}
