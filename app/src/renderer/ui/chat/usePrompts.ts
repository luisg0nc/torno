import { useEffect, useState } from 'react'
import type { PromptRow } from '../../../shared/chat'
import { useStore } from '../../state/store'

/**
 * The prompts of the open project, oldest first, numbered across all its conversations (`chat.prompts`, read from
 * `.torno/chat/` and the history by main): asked when the project is opened and again whenever `key` changes (the window says
 * what changed: a prompt was sent, a build was kept). The rows it had stay while the new ones come. Undefined until main has
 * answered.
 */
export function usePrompts(active: boolean, key: string): PromptRow[] | undefined {
  const objectId = useStore((s) => s.objectId)
  const [found, setFound] = useState<{ of: string; rows: PromptRow[] } | undefined>(undefined)
  useEffect(() => {
    if (!active || objectId === null) return
    let current = true
    window.torno.chat.prompts(objectId).then(
      (rows) => current && setFound({ of: objectId, rows }),
      () => current && setFound({ of: objectId, rows: [] })
    )
    return () => {
      current = false
    }
  }, [active, objectId, key])
  return found !== undefined && found.of === objectId ? found.rows : undefined
}
