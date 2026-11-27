import { useMemo } from 'react'
import type { HistoryEntry } from '../../../shared/history'
import { openRoundNow, useReview } from '../../state/review'
import { useStore } from '../../state/store'
import { numbersOf } from '../chat/historyJoin'
import { usePrompts } from '../chat/usePrompts'
import { useHistory } from '../useHistory'
import { liveBy, stripNodes, type StripLive, type StripNode } from './strip'

/** The nodes of the open project's builds (`stripNodes`) as the window knows them, with the history entries they come from, by id, and the numbers of the project's prompts, by id. Empty until main has answered. */
export function useStripNodes(): { nodes: StripNode[]; entries: ReadonlyMap<string, HistoryEntry>; numbering: Map<string, number>; loaded: boolean } {
  const build = useStore((s) => s.build)
  const reviewing = useReview((s) => openRoundNow(s)?.build)
  const history = useHistory(true)
  const rows = usePrompts(true, `${history?.entries.at(-1)?.id ?? ''}:${build?.status ?? ''}`)
  const numbering = useMemo(() => numbersOf(rows ?? [], []), [rows])

  const live = useMemo<StripLive>(() => {
    const onShow = build && build.revision > 0 && history ? (history.entries.findLast((e) => !e.failed && e.run === history.run && e.revision === build.revision)?.id ?? null) : null
    const status = build?.status ?? 'idle'
    return { status, onShow, ...(status === 'failed' && onShow !== null ? { failedAfter: onShow } : {}), ...(reviewing !== undefined ? { reviewing } : {}), ...liveBy(build ?? undefined, numbering) }
  }, [build?.status, build?.revision, build?.reason, build?.made, history, reviewing, numbering])
  const nodes = useMemo(() => stripNodes(history?.entries ?? [], live, numbering), [history, live, numbering])
  const entries = useMemo(() => new Map((history?.entries ?? []).map((e) => [e.id, e])), [history])
  return { nodes, entries, numbering, loaded: history !== undefined && history !== null }
}
