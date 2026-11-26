/**
 * What Claude Code spent on the open project (#357): the rows main reads from its chat logs (`chat.usage`, `ProjectUsage`),
 * asked when the project is opened, when a turn of one of its sessions ends and when the Usage page is shown; and where
 * the Usage page stands (the range, the conversation open, the prompt lit). Nothing is kept: the page opens on the week.
 */
import { useEffect } from 'react'
import { useStore as useZustand } from 'zustand'
import { createStore } from 'zustand/vanilla'
import type { ProjectUsage } from '../../shared/usage'
import { store, useStore } from './store'

export type UsageRange = 'week' | 'month' | 'all'

interface UsageState {
  /** The project the rows are of; null for none. */
  of: string | null
  usage: ProjectUsage | null
  range: UsageRange
  /** The conversation the page shows as a ledger; null: the project's page. */
  conversation: string | null
  /** The prompt lit in the ledger (its id): the one "Open in Usage" was pressed under. */
  lit: string | null
}

export const usageStore = createStore<UsageState>(() => ({ of: null, usage: null, range: 'week', conversation: null, lit: null }))

export const useUsage = <T>(pick: (s: UsageState) => T): T => useZustand(usageStore, pick)

/** Each ask is numbered: an answer older than the last ask is let go. */
let asked = 0

export const usageActions = {
  /** Asks main again for the rows of the open project. */
  refresh(): void {
    const objectId = store.getState().objectId
    const ask = ++asked
    if (objectId === null) {
      usageStore.setState({ of: null, usage: null, conversation: null, lit: null })
      return
    }
    if (usageStore.getState().of !== objectId) usageStore.setState({ of: objectId, usage: null, conversation: null, lit: null })
    window.torno.chat.usage(objectId).then(
      (usage) => {
        if (ask === asked && store.getState().objectId === objectId) usageStore.setState({ of: objectId, usage })
      },
      () => {}
    )
  },
  setRange(range: UsageRange): void {
    usageStore.setState({ range })
  },
  /** Opens a conversation as a ledger, with a prompt lit; null goes back to the project's page. */
  openConversation(conversation: string | null, lit: string | null = null): void {
    usageStore.setState({ conversation, lit })
  }
}

/** The open project's usage, asked of main once for each project; undefined until it has answered. */
export function useProjectUsage(): ProjectUsage | undefined {
  const objectId = useStore((s) => s.objectId)
  const usage = useUsage((s) => (s.of === objectId ? s.usage : null))
  useEffect(() => {
    if (objectId !== null && usageStore.getState().of !== objectId) usageActions.refresh()
  }, [objectId])
  return usage ?? undefined
}
