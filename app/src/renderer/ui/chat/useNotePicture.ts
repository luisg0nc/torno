import { useEffect, useState } from 'react'

/**
 * The picture with the ink of a view note, as an object URL revoked when it is let go. `missing` is a note whose file is
 * not on this computer (the pictures are not in git); it is asked again when the note's file is another (an edit made a
 * new one) and when the row is drawn anew.
 */
export function useNotePicture(objectId: string, id: string, file: string): { state: 'loading' | 'ready' | 'missing'; url: string | null } {
  const [got, setGot] = useState<{ state: 'loading' | 'ready' | 'missing'; url: string | null }>({ state: 'loading', url: null })
  useEffect(() => {
    let current = true
    let made: string | null = null
    setGot({ state: 'loading', url: null })
    window.torno.notes.picture(objectId, id, 'ink').then(
      (png) => {
        if (!current) return
        if (!png) return setGot({ state: 'missing', url: null })
        made = URL.createObjectURL(new Blob([png as BlobPart], { type: 'image/png' }))
        setGot({ state: 'ready', url: made })
      },
      () => current && setGot({ state: 'missing', url: null })
    )
    return () => {
      current = false
      if (made) URL.revokeObjectURL(made)
    }
  }, [objectId, id, file])
  return got
}
