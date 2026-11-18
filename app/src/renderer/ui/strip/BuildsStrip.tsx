import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { HistoryEntry } from '../../../shared/history'
import { useThumb } from '../chat/useThumb'
import { useStruckNodes } from '../../state/goBackAsk'
import { usePromptsInSight } from '../../state/inSight'
import { actions, explodeNow, store, useStore } from '../../state/store'
import { useElapsed } from '../useElapsed'
import { bracketOf, stripFolded, stripSays, ticksOf, type StripNode } from './strip'
import { setFailedAnchor } from './failedAnchor'
import { useStripNodes } from './useStripNodes'

/** A node and its neighbour are this far apart, and the track starts this far in (`strip.css`). */
const NODE_W = 62
const STEP = 72
const GUTTER = 16

/** How many ticks the folded strip holds. */
const FOLDED_TICKS = 24

const STAR = 'M8 1.8l1.9 3.9 4.3.6-3.1 3 .7 4.3L8 11.6l-3.8 2 .7-4.3-3.1-3 4.3-.6z'

/** What a node is told as to a screen reader and the pointer. A failed one is not worded as "Build failed": that is the status line's button. */
function nodeTitle(node: StripNode): string {
  const what = node.kind === 'failed' ? (node.after ? `Failed build after ${node.after}` : 'Failed build') : node.kind === 'running' ? 'Running build' : node.id
  const more = [node.by, node.onShow ? 'on show' : '', node.reviewing ? 'under review' : '', node.starred ? 'starred' : ''].filter((part) => part !== '')
  return [what, ...more].join(', ')
}

/** The picture of a build: the one kept with it, its id alone when none was; `failed` on a hatch; the seconds of the one that runs. */
function Pic({ objectId, node, entry, seconds }: { objectId: string; node: StripNode; entry: HistoryEntry | undefined; seconds: number }) {
  const url = useThumb(objectId, entry)
  if (node.kind === 'failed') return <span className="strip-pic">failed</span>
  if (node.kind === 'running') {
    return (
      <span className="strip-pic">
        <span className="num">{seconds} s</span>
      </span>
    )
  }
  return (
    <span className="strip-pic">
      {url ? <img src={url} alt="" /> : <span className="strip-pic-id num">{node.id}</span>}
      {node.starred && (
        <svg className="strip-star" viewBox="0 0 16 16" fill="currentColor" role="img" aria-label="Starred: it is never let go">
          <path d={STAR} />
        </svg>
      )}
    </span>
  )
}

/** What a node and a tick of the strip are given to say what a press on them does. */
interface Picks {
  /** A click: the menu of a build, or the error of one that failed. */
  pick: (node: StripNode, anchor: HTMLElement) => void
  /** A double click: compares the build with the live one. */
  compare: (node: StripNode) => void
  /** The element of the build that failed now, which its error stands from. */
  failed: (el: HTMLElement | null) => void
  /** The id of that build's node. */
  failedId: string | undefined
}

/** The ref of the element that stands for the failed build: put with it when it is drawn, taken away when it goes. */
function failedRef(picks: Picks, node: StripNode): ((el: HTMLButtonElement | null) => void) | undefined {
  return node.id === picks.failedId ? picks.failed : undefined
}

function Node({ objectId, node, entry, seconds, landing, struck, picks }: { objectId: string; node: StripNode; entry: HistoryEntry | undefined; seconds: number; landing: boolean; struck: boolean; picks: Picks }) {
  const id = node.kind === 'failed' ? (node.after ? `after ${node.after}` : 'failed') : node.id
  const by = node.reviewing ? 'reviewing' : node.onShow ? 'on show' : node.by
  return (
    <button
      ref={failedRef(picks, node)}
      type="button"
      className="strip-node"
      data-build={node.id}
      data-kind={node.kind}
      data-on-show={node.onShow ? '' : undefined}
      data-reviewing={node.reviewing ? '' : undefined}
      data-saved={node.saved ? '' : undefined}
      data-starred={node.starred ? '' : undefined}
      data-landing={landing ? '' : undefined}
      data-struck={struck ? '' : undefined}
      aria-label={nodeTitle(node)}
      title={entry?.failed && entry.error ? `${nodeTitle(node)}: ${entry.error}` : nodeTitle(node)}
      onClick={(e) => picks.pick(node, e.currentTarget)}
      onDoubleClick={() => picks.compare(node)}
    >
      <Pic objectId={objectId} node={node} entry={entry} seconds={seconds} />
      <span className="strip-id num">{node.kind === 'running' ? 'building' : id}</span>
      <span className="strip-by">{node.kind === 'running' ? node.by : by}</span>
    </button>
  )
}

/** A tick of the folded strip: the build as a small bar, the one on show taller and in the accent. */
function Tick({ node, struck, picks }: { node: StripNode; struck: boolean; picks: Picks }) {
  return <button ref={failedRef(picks, node)} type="button" className="strip-tick" data-kind={node.kind} data-on-show={node.onShow ? '' : undefined} data-saved={node.saved ? '' : undefined} data-struck={struck ? '' : undefined} aria-label={nodeTitle(node)} title={nodeTitle(node)} onClick={(e) => picks.pick(node, e.currentTarget)} onDoubleClick={() => picks.compare(node)} />
}

/**
 * The builds strip: the project's builds, oldest at the left, on top of the dock in every mode (spec 2026-11-18, section 2).
 * The nodes are `stripNodes` over the history; the bracket under them is the prompts in sight in the conversation
 * (`state/inSight`, told by the chat as it scrolls); a build that lands slides in; the track scrolls sideways, by the wheel too,
 * and keeps the build on show in sight. Under `STRIP_FOLD_BELOW` of dock height it folds to its head line and a row of ticks.
 * A click on a node says which, and from what element, to `onPick` (the owner draws its menu, `NodePopover`), and a double click
 * which, compares it with the one on show (as "Compare with live" of its menu does; not where the view is cut or drawn apart). The build that failed now is the exception: its click opens or puts away its error, the one the status
 * line's "Build failed" and the chat's "Show error" open too (`errorOpen`), which stands from this node (`failedAnchor`).
 */
export function BuildsStrip({ onPick, onCompared }: { onPick?: (node: StripNode, anchor: HTMLElement) => void; onCompared?: () => void }) {
  const objectId = useStore((s) => s.objectId)
  const name = useStore((s) => s.workspace?.objects.find((o) => o.id === s.objectId)?.name ?? s.objectId)
  const build = useStore((s) => s.build)
  const exporting = useStore((s) => s.exportOf !== null)
  const errorOpen = useStore((s) => s.errorOpen)
  const struck = useStruckNodes()
  const { nodes, entries: byId, loaded } = useStripNodes()
  const inSight = usePromptsInSight()
  const elapsed = useElapsed(build?.status === 'building' ? build.startedAt : undefined)
  const bracket = useMemo(() => bracketOf(nodes, inSight), [nodes, inSight])

  // The build that failed now: the last node, when it failed and the state of the build says so.
  const failedId = build?.status === 'failed' ? nodes.findLast((n) => n.kind === 'failed')?.id : undefined
  const picks: Picks = {
    pick: (node, anchor) => {
      if (node.id === failedId) actions.setErrorOpen(!errorOpen)
      else onPick?.(node, anchor)
    },
    compare: (node) => {
      const live = nodes.find((n) => n.onShow)
      const now = store.getState()
      if (node.kind !== 'built' || node.onShow || !live || now.section !== null || explodeNow(now) !== null) return
      actions.compare(node.id, live.id)
      // The click that began the double click opened its menu: the compare is the answer.
      onCompared?.()
    },
    failed: setFailedAnchor,
    failedId
  }

  const root = useRef<HTMLElement>(null)
  const track = useRef<HTMLDivElement>(null)
  const [folded, setFolded] = useState(false)

  // The dock's height decides whether it folds.
  useLayoutEffect(() => {
    const dock = root.current?.closest<HTMLElement>('.dock')
    if (!dock || typeof ResizeObserver === 'undefined') return
    const watch = (): void => setFolded(stripFolded(dock.clientHeight))
    watch()
    const sized = new ResizeObserver(watch)
    sized.observe(dock)
    return () => sized.disconnect()
    // The strip is not drawn while no project is open: the dock is found once it is.
  }, [objectId === null])

  // A node that was not there when the strip was last drawn slides in: not the ones the history was read as, and not another project's.
  const seen = useRef<{ of: string | null; ids: Set<string> } | null>(null)
  const landing = new Set<string>()
  if (loaded && seen.current && seen.current.of === objectId) for (const node of nodes) if (node.kind !== 'running' && !seen.current.ids.has(node.id)) landing.add(node.id)
  useEffect(() => {
    if (loaded) seen.current = { of: objectId, ids: new Set(nodes.map((n) => n.id)) }
  }, [loaded, objectId, nodes])

  // The wheel turns the track sideways. Not passive: a track that scrolls takes the wheel from the page.
  useEffect(() => {
    const el = track.current
    if (!el) return
    const wheel = (e: WheelEvent): void => {
      if (el.scrollWidth <= el.clientWidth || Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return
      e.preventDefault()
      el.scrollLeft += e.deltaY
    }
    el.addEventListener('wheel', wheel, { passive: false })
    return () => el.removeEventListener('wheel', wheel)
  }, [folded, nodes.length === 0])

  // The newest build in sight when one lands, and the build on show in sight whatever else is: it wins where both cannot be.
  const onShowId = nodes.find((n) => n.onShow)?.id
  const newest = nodes.at(-1)?.id
  useLayoutEffect(() => {
    const el = track.current
    if (!el) return
    el.scrollLeft = el.scrollWidth
    const shown = onShowId === undefined ? null : el.querySelector<HTMLElement>('[data-on-show]')
    if (!shown) return
    const [left, right] = [shown.offsetLeft, shown.offsetLeft + shown.offsetWidth]
    if (left < el.scrollLeft + GUTTER) el.scrollLeft = left - GUTTER
    else if (right > el.scrollLeft + el.clientWidth - GUTTER) el.scrollLeft = right - el.clientWidth + GUTTER
  }, [onShowId, newest, folded, nodes.length === 0])

  if (objectId === null) return null
  const says = stripSays({ nodes, exporting })
  const kept = nodes.filter((n) => n.kind === 'built').length
  return (
    <section ref={root} className="strip" data-folded={folded ? '' : undefined} aria-label="Builds" data-region="builds">
      <div className="strip-head">
        <b>Builds of {name}</b>
        <span className="num">{kept}</span> kept
        <span className="strip-says" aria-live="polite">
          {says}
        </span>
      </div>
      {folded ? (
        <div className="strip-ticks" role="group" aria-label="Builds, newest at the right">
          {ticksOf(nodes, FOLDED_TICKS).map((node) => (
            <Tick key={node.id} node={node} struck={struck.has(node.id)} picks={picks} />
          ))}
        </div>
      ) : (
        <div ref={track} className="strip-track">
          {nodes.length === 0 ? (
            <p className="strip-empty">No build kept yet</p>
          ) : (
            <div className="strip-inner">
              {nodes.map((node) => (
                <Node key={node.id} objectId={objectId} node={node} entry={byId.get(node.id)} seconds={elapsed} landing={landing.has(node.id)} struck={struck.has(node.id)} picks={picks} />
              ))}
              {bracket && (
                <div className="strip-bracket" data-part="bracket" style={{ left: GUTTER + bracket.from * STEP, width: (bracket.to - bracket.from) * STEP + NODE_W }}>
                  <span>{bracket.label}</span>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  )
}
