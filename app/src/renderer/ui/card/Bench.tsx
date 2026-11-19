import { useEffect, useRef, type KeyboardEvent } from 'react'
import { pressed } from '../../../shared/keys'
import { benchTabs, tabShown, type BenchTab } from '../../state/column'
import { actions, store, useStore } from '../../state/store'
import { tried } from '../paramRows'
import { Layers } from '../Layers'
import { ParamsPanel } from '../ParamsPanel'
import { giveKeysBack, TYPING } from '../typing'

const TITLES: Record<BenchTab, string> = { params: 'Parameters', parts: 'Parts' }

/**
 * The bench: Parameters and Parts as two folder tabs that fill the column under the On block. The open one is kept for
 * each project (`store.benchTab`, in the window's storage). The tabs a project has are `benchTabs`: a one-part model
 * shows Parameters alone, a model with no Params Parts alone. The bodies are the Parameters and Parts components, as they
 * were in sections; the tab says how many each holds, and a dot on Parameters says a value is being tried.
 */
export function Bench() {
  const objectId = useStore((s) => s.objectId)
  const kept = useStore((s) => (s.objectId === null ? undefined : s.benchTab[s.objectId]))
  const layout = useStore((s) => s.layout)
  const parts = useStore((s) => (s.scene?.parts ?? []).filter((p) => p.layout === layout).length)
  const params = useStore((s) => s.scene?.params)
  const tryingCount = (params ?? []).filter(tried).length
  const tabs = benchTabs(parts, params?.length ?? 0)
  const open = tabShown(kept, tabs)
  const list = useRef<HTMLDivElement>(null)

  const move = (e: KeyboardEvent<HTMLButtonElement>): void => {
    const to = pressed(e, 'bench.next') ? 1 : pressed(e, 'bench.previous') ? -1 : 0
    if (to === 0 || tabs.length < 2) return
    const next = tabs[(tabs.indexOf(open) + to + tabs.length) % tabs.length]
    actions.setBenchTab(next)
    e.preventDefault()
    requestAnimationFrame(() => list.current?.querySelector<HTMLButtonElement>(`[data-tab="${next}"]`)?.focus())
  }

  return (
    <div className="bench" data-tabs={tabs.length} key={objectId ?? ''}>
      <div className="bench-tabs" role="tablist" aria-label="Parameters and parts" ref={list}>
        {tabs.map((tab) => (
          <button
            key={tab}
            type="button"
            role="tab"
            id={`bench-tab-${tab}`}
            className="bench-tab"
            data-tab={tab}
            aria-selected={tab === open}
            aria-controls="bench-panel"
            tabIndex={tab === open ? 0 : -1}
            onKeyDown={move}
            onClick={(e) => {
              actions.setBenchTab(tab)
              if (e.detail > 0) giveKeysBack(e.currentTarget)
            }}
          >
            {TITLES[tab]} <span className="num">{tab === 'params' ? (params?.length ?? 0) : parts}</span>
            {tab === 'params' && tryingCount > 0 && <span className="bench-tried" title={`${tryingCount} ${tryingCount === 1 ? 'value' : 'values'} being tried`} role="img" aria-label={`${tryingCount} being tried`} />}
          </button>
        ))}
      </div>
      <div className="bench-panel" id="bench-panel" role="tabpanel" aria-labelledby={`bench-tab-${open}`}>
        {open === 'params' ? <ParamsPanel /> : <Layers />}
      </div>
    </div>
  )
}

/** `/` outside a field and the terminal opens the Parameters tab (and the column, if it was hidden) and puts the cursor in its find box. */
export function useFindKey(): void {
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent): void => {
      if (e.defaultPrevented || e.repeat || !pressed(e, 'params.find')) return
      if (e.target instanceof Element && e.target.closest(TYPING)) return
      if ((store.getState().scene?.params ?? []).length === 0) return
      e.preventDefault()
      actions.setBenchTab('params')
      const focus = (): void => document.querySelector<HTMLInputElement>('[data-param-find]')?.focus()
      // Twice: a column that was hidden is drawn by the first frame.
      if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => requestAnimationFrame(focus))
      else focus()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
}
