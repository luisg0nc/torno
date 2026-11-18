import { useMemo } from 'react'
import type { HistoryEntry } from '../../../shared/history'
import { openRoundNow, useReview } from '../../state/review'
import { runningSession, useStore } from '../../state/store'
import { numbersOf } from '../chat/historyJoin'
import { usePrompts } from '../chat/usePrompts'
import { useHistory } from '../useHistory'
import { stripNodes, type StripLive, type StripNode } from './strip'

/** The nodes of the open project's builds (`stripNodes`) as the window knows them, with the history entries they come from, by id, and the numbers of the project's prompts, by id. Empty until main has answered. */
export function useStripNodes(): { nodes: StripNode[]; entries: ReadonlyMap<string, HistoryEntry>; numbering: Map<string, number>; loaded: boolean } {
  const build = useStore((s) => s.build)
  const reviewing = useReview((s) => openRoundNow(s)?.build)
  const working = useStore((s) => {
    const status = runningSession(s)?.status
    return status === 'working' || status === 'needs_input'
  })
  const history = useHistory(true)
  const rows = usePrompts(true, `${history?.entries.at(-1)?.id ?? ''}:${build?.status ?? ''}`)

  const live = useMemo<StripLive>(() => {
    const onShow = build && build.revision > 0 && history ? (history.entries.findLast((e) => !e.failed && e.run === history.run && e.revision === build.revision)?.id ?? null) : null
    const status = build?.status ?? 'idle'
    // The build that runs for a prompt of Claude Code's is the last prompt's; with no session at work it is nobody's to say.
    const prompt = working && rows && rows.length > 0 ? rows[rows.length - 1]!.number : undefined
    return { status, onShow, ...(status === 'failed' && onShow !== null ? { failedAfter: onShow } : {}), ...(reviewing !== undefined ? { reviewing } : {}), ...(prompt !== undefined ? { prompt } : {}) }
  }, [build?.status, build?.revision, history, reviewing, working, rows])
  const numbering = useMemo(() => numbersOf(rows ?? [], []), [rows])
  const nodes = useMemo(() => stripNodes(history?.entries ?? [], live, numbering), [history, live, numbering])
  const entries = useMemo(() => new Map((history?.entries ?? []).map((e) => [e.id, e])), [history])
  return { nodes, entries, numbering, loaded: history !== undefined && history !== null }
}
