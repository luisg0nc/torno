import { useEffect, useState } from 'react'
import type { HistoryEntry } from '../../../shared/history'

/** The picture kept with a build, as an object URL revoked when it is let go; null while it comes, when none was kept, and for a build that failed. */
export function useThumb(objectId: string, entry: Pick<HistoryEntry, 'id' | 'thumb' | 'failed'> | undefined): string | null {
  const [url, setUrl] = useState<string | null>(null)
  const id = entry?.id
  const has = entry?.thumb === true && entry.failed !== true
  useEffect(() => {
    if (id === undefined || !has) return setUrl(null)
    let current = true
    let made: string | null = null
    window.torno.history.thumbnail(objectId, id).then(
      (png) => {
        if (!current || !png) return
        made = URL.createObjectURL(new Blob([png], { type: 'image/png' }))
        setUrl(made)
      },
      () => {}
    )
    return () => {
      current = false
      if (made) URL.revokeObjectURL(made)
    }
  }, [objectId, id, has])
  return url
}
