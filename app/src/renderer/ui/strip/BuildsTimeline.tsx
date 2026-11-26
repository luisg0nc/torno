import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { hint } from '../../../shared/keys'
import type { HistoryEntry } from '../../../shared/history'
import { inModel, useBoard } from '../../state/board'
import { useStruckNodes } from '../../state/goBackAsk'
import { actions, explodeNow, store, useStore } from '../../state/store'
import { timelineActions, useTimeline } from '../../state/timeline'
import { Chevron } from '../Chevron'
import { useThumb } from '../chat/useThumb'
import { useElapsed } from '../useElapsed'
import { setFailedAnchor } from './failedAnchor'
import { NodePopover } from './NodePopover'
import { chipCost, groupCount, groupTitle, stripGroups, stripSays, type StripGroup, type StripNode } from './strip'
import { useProjectUsage } from '../../state/usage'
import { useStripNodes } from './useStripNodes'

const STAR = 'M8 1.8l1.9 3.9 4.3.6-3.1 3 .7 4.3L8 11.6l-3.8 2 .7-4.3-3.1-3 4.3-.6z'

function Star({ className }: { className: string }) {
  return (
    <svg className={className} viewBox="0 0 16 16" fill="currentColor" role="img" aria-label="Starred: it is never let go">
      <path d={STAR} />
    </svg>
  )
}

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
      {node.starred && <Star className="strip-star" />}
    </span>
  )
}

/** What the elements of the timeline are given to say what a press on them does. */
interface Picks {
  /** A click on a build: its menu, or the error of the one that failed now. */
  pick: (node: StripNode, anchor: HTMLElement) => void
  /** A double click: compares the build with the live one. */
  compare: (node: StripNode) => void
  /** The element that stands for the build that failed now, which its error stands from. */
  failed: (el: HTMLElement | null) => void
}

/** A build in the drawer: its picture, its id, and whether it is on show or under review. */
function Node({ objectId, node, entry, seconds, index, landing, struck, anchor, picks }: { objectId: string; node: StripNode; entry: HistoryEntry | undefined; seconds: number; index: number; landing: boolean; struck: boolean; anchor: boolean; picks: Picks }) {
  const id = node.kind === 'failed' ? (node.after ? `after ${node.after}` : 'failed') : node.kind === 'running' ? 'building' : node.id
  const state = node.reviewing ? 'reviewing' : node.onShow ? 'on show' : ''
  return (
    <button
      ref={anchor ? picks.failed : undefined}
      type="button"
      className="strip-node"
      style={{ '--i': index } as React.CSSProperties}
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
      <span className="strip-id num">{id}</span>
      <span className="strip-by">{state}</span>
    </button>
  )
}

/** A group of several builds, folded: its last build's picture on a pile of the others. A click shows them all. */
function Pile({ objectId, group, entry, seconds, struck, anchor, picks, title }: { objectId: string; group: StripGroup; entry: HistoryEntry | undefined; seconds: number; struck: boolean; anchor: boolean; picks: Picks; title: string }) {
  const shown = group.nodes.find((node) => node.onShow)
  const under = group.reviewing ? 'reviewing' : shown ? (shown === group.last ? 'on show' : `${shown.id} on show`) : ''
  return (
    <button
      ref={anchor ? picks.failed : undefined}
      type="button"
      className="strip-node tl-pile"
      data-kind={group.last.kind}
      data-on-show={group.onShow ? '' : undefined}
      data-reviewing={group.reviewing ? '' : undefined}
      data-struck={struck ? '' : undefined}
      aria-expanded={false}
      aria-label={`${group.label}, ${groupCount(group)} builds: show them all`}
      title={title}
      onClick={() => timelineActions.toggleGroup(group.id)}
    >
      <Pic objectId={objectId} node={{ ...group.last, starred: group.starred }} entry={entry} seconds={seconds} />
      <span className="strip-id num">{group.last.kind === 'running' ? 'building' : group.last.kind === 'failed' ? 'failed' : group.last.id}</span>
      <span className="strip-by">{under}</span>
    </button>
  )
}

/**
 * The builds timeline (#332): a slim bar across the foot of the 3D view, above the status line, with one chip for each group of
 * builds (`stripGroups`: a prompt's builds, the person's Parameters between two prompts, their saves...), and a drawer that opens
 * upward from it with the pictures. A group of several builds shows its last one on a pile and a count; a click on it shows every
 * build in it. A build is a button: its click opens its menu (`NodePopover`), a double click compares it with the one on show (not
 * with a section or an explode on). The build that failed now is the exception: its click opens or puts away its error, the one the
 * status line's "Build failed" opens too (`errorOpen`), which stands from its element (`failedAnchor`): its node or pile in the open
 * drawer, its group's chip in the bar (whose click then opens or puts away the error too; any other chip opens the drawer at its
 * group). Open or shut is the window's (`state/timeline`), by the toggle at the left of the bar or the key.
 */
export function BuildsTimeline() {
  const objectId = useStore((s) => (s.page === 'object' ? s.objectId : null))
  const name = useStore((s) => s.workspace?.objects.find((o) => o.id === s.objectId)?.name ?? s.objectId)
  const build = useStore((s) => s.build)
  const exporting = useStore((s) => s.exportOf !== null)
  const errorOpen = useStore((s) => s.errorOpen)
  const inView = useBoard((s) => inModel(s.shown))
  const open = useTimeline((s) => s.open)
  const expanded = useTimeline((s) => s.expanded)
  const struck = useStruckNodes()
  const { nodes, entries, loaded } = useStripNodes()
  const groups = useMemo(() => stripGroups(nodes), [nodes])
  const usage = useProjectUsage()
  const elapsed = useElapsed(build?.status === 'building' ? build.startedAt : undefined)
  const [picked, setPicked] = useState<{ node: StripNode; anchor: HTMLElement } | null>(null)

  // The build that failed now: the last node, when it failed and the state of the build says so.
  const failedId = build?.status === 'failed' ? nodes.findLast((n) => n.kind === 'failed')?.id : undefined
  const failedGroup = failedId === undefined ? undefined : groups.find((g) => g.nodes.some((n) => n.id === failedId))?.id
  const picks: Picks = {
    pick: (node, anchor) => {
      if (node.id === failedId) actions.setErrorOpen(!errorOpen)
      else if (node.kind !== 'running') setPicked({ node, anchor })
    },
    compare: (node) => {
      const live = nodes.find((n) => n.onShow)
      const now = store.getState()
      if (node.kind !== 'built' || node.onShow || !live || now.section !== null || explodeNow(now) !== null) return
      actions.compare(node.id, live.id)
      // The click that began the double click opened its menu: the compare is the answer.
      setPicked(null)
    },
    failed: setFailedAnchor
  }

  const drawer = useRef<HTMLDivElement>(null)
  const track = useRef<HTMLDivElement>(null)
  const chips = useRef<HTMLDivElement>(null)

  // What was not there when the timeline was last drawn lands: not what the history was read as, and not another project's.
  const seen = useRef<{ of: string | null; ids: Set<string> } | null>(null)
  const landing = new Set<string>()
  if (loaded && seen.current && seen.current.of === objectId) for (const node of nodes) if (node.kind !== 'running' && !seen.current.ids.has(node.id)) landing.add(node.id)
  useEffect(() => {
    if (loaded) seen.current = { of: objectId, ids: new Set(nodes.map((n) => n.id)) }
  }, [loaded, objectId, nodes])

  // The wheel turns the track and the chips sideways. Not passive: a row that scrolls takes the wheel from the view.
  useEffect(() => {
    const rows = [track.current, chips.current].filter((el): el is HTMLDivElement => el !== null)
    const wheel = (e: WheelEvent): void => {
      const el = e.currentTarget as HTMLElement
      if (el.scrollWidth <= el.clientWidth || Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return
      e.preventDefault()
      el.scrollLeft += e.deltaY
    }
    for (const el of rows) el.addEventListener('wheel', wheel, { passive: false })
    return () => rows.forEach((el) => el.removeEventListener('wheel', wheel))
  }, [objectId, inView])

  // The newest in sight when one lands, and the build on show in sight whatever else is: it wins where both cannot be.
  const onShowKey = groups.find((g) => g.onShow)?.id
  const newest = nodes.at(-1)?.id
  useLayoutEffect(() => {
    for (const [el, selector] of [
      [track.current, '[data-on-show]'],
      [chips.current, '.tl-chip[data-on-show]']
    ] as const) {
      if (!el) continue
      el.scrollLeft = el.scrollWidth
      const shown = el.querySelector<HTMLElement>(selector)
      if (!shown) continue
      const box = el.getBoundingClientRect()
      const at = shown.getBoundingClientRect()
      const [left, right] = [at.left - box.left + el.scrollLeft, at.right - box.left + el.scrollLeft]
      if (left < el.scrollLeft + 16) el.scrollLeft = left - 16
      else if (right > el.scrollLeft + el.clientWidth - 16) el.scrollLeft = right - el.clientWidth + 16
    }
  }, [onShowKey, newest, open, expanded.length, groups.length === 0])

  // Another project, or the view put away: nothing of the last one's stays pointed at.
  useEffect(() => setPicked(null), [objectId, inView])

  if (objectId === null || !inView) return null

  const says = stripSays({ nodes, exporting })
  const kept = nodes.filter((n) => n.kind === 'built').length
  const struckGroup = (g: StripGroup): boolean => g.nodes.length > 0 && g.nodes.every((n) => struck.has(n.id))
  const reveal = (id: string): void => {
    timelineActions.reveal(id)
    requestAnimationFrame(() => drawer.current?.querySelector<HTMLElement>(`.tl-group[data-group="${CSS.escape(id)}"]`)?.scrollIntoView({ block: 'nearest', inline: 'nearest' }))
  }

  return (
    <section className="timeline" data-open={open ? '' : undefined} aria-label="Builds" data-region="builds">
      <div ref={drawer} id="timeline-drawer" className="timeline-drawer" inert={!open} aria-hidden={!open}>
        <div className="timeline-sheet">
          <div className="timeline-head">
            <b>Builds of {name}</b>
            <span className="num">{kept}</span> kept
            <span className="timeline-says" aria-live="polite">
              {says}
            </span>
          </div>
          <div ref={track} className="timeline-track">
            {groups.length === 0 ? (
              <p className="timeline-empty">No build kept yet</p>
            ) : (
              groups.map((group) => {
                const many = group.nodes.length > 1
                const all = !many || expanded.includes(group.id)
                const title = groupTitle(group, entries)
                const anchorHere = open && group.id === failedGroup
                return (
                  <div key={group.id} className="tl-group" role="group" aria-label={group.label} data-group={group.id} data-expanded={many && all ? '' : undefined} data-saved={group.saved ? '' : undefined}>
                    {many ? (
                      <button type="button" className="tl-group-head" aria-expanded={all} title={title} onClick={() => timelineActions.toggleGroup(group.id)}>
                        <span className="tl-group-label">{group.label}</span>
                        <span className="num">({groupCount(group)})</span>
                      </button>
                    ) : (
                      <span className="tl-group-head" title={title}>
                        <span className="tl-group-label">{group.label}</span>
                      </span>
                    )}
                    <div className="tl-group-builds">
                      {all ? (
                        group.nodes.map((node, i) => (
                          <Node key={node.id} objectId={objectId} node={node} entry={entries.get(node.id)} seconds={elapsed} index={i} landing={landing.has(node.id)} struck={struck.has(node.id)} anchor={anchorHere && node.id === failedId} picks={picks} />
                        ))
                      ) : (
                        <Pile objectId={objectId} group={group} entry={entries.get(group.last.id)} seconds={elapsed} struck={struckGroup(group)} anchor={anchorHere} picks={picks} title={title} />
                      )}
                    </div>
                  </div>
                )
              })
            )}
          </div>
        </div>
      </div>
      <div className="timeline-bar">
        <button type="button" className="timeline-toggle" aria-expanded={open} aria-controls="timeline-drawer" aria-keyshortcuts={hint('builds.toggle')} title={`${open ? 'Fold the builds' : 'Show the builds'} (${hint('builds.toggle')})`} onClick={() => timelineActions.toggle()}>
          <span className="timeline-chevron" data-open={open ? '' : undefined}>
            <Chevron />
          </span>
          Builds
          <span className="num">{kept}</span>
        </button>
        <div ref={chips} className="timeline-chips" role="list" aria-label="Builds by what made them, newest at the right">
          {groups.length === 0 ? (
            <span className="timeline-empty">No build kept yet</span>
          ) : (
            groups.map((group) => (
              <span key={group.id} role="listitem" className="tl-chip-item">
                <button
                  ref={!open && group.id === failedGroup ? setFailedAnchor : undefined}
                  type="button"
                  className="tl-chip"
                  data-group={group.id}
                  data-state={group.state}
                  data-on-show={group.onShow ? '' : undefined}
                  data-reviewing={group.reviewing ? '' : undefined}
                  data-saved={group.saved ? '' : undefined}
                  data-struck={struckGroup(group) ? '' : undefined}
                  data-landing={group.nodes.some((n) => landing.has(n.id)) && group.nodes.every((n) => landing.has(n.id) || n.kind === 'running') ? '' : undefined}
                  title={groupTitle(group, entries)}
                  onClick={() => (group.id === failedGroup && group.last.id === failedId ? actions.setErrorOpen(!errorOpen) : reveal(group.id))}
                >
                  {group.saved && <span className="tl-chip-dot" aria-hidden="true" />}
                  <span className="tl-chip-label">{group.label}</span>
                  {groupCount(group) > 1 && <span className="num tl-chip-count">({groupCount(group)})</span>}
                  {group.state === 'running' && <span className="num tl-chip-count">{elapsed} s</span>}
                  {(() => {
                    const cost = chipCost(group, usage)
                    return cost && <span className="num tl-chip-cost" data-large={cost.large ? '' : undefined} title={cost.large ? "What the prompt cost: a large turn, 3 times this project's usual one or more" : 'What the prompt cost'}>{cost.text}</span>
                  })()}
                  {group.starred && <Star className="tl-chip-star" />}
                </button>
              </span>
            ))
          )}
        </div>
      </div>
      {picked && <NodePopover key={picked.node.id} node={picked.node} anchor={picked.anchor} onClose={() => setPicked(null)} />}
    </section>
  )
}
