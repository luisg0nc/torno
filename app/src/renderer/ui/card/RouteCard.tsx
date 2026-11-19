import { useEffect, useRef, type ReactNode, type RefObject } from 'react'
import { actions } from '../../state/store'
import { Layers } from '../Layers'
import { LeftEdge } from '../LeftEdge'
import { MarksPanel } from '../MarksPanel'
import { numbered } from '../numbered'
import { ParamsPanel } from '../ParamsPanel'
import { ImportScan, ScansPanel } from '../ScansPanel'
import { CardSection } from './CardSection'
import { Checks } from './Checks'
import { NeedsYou } from './NeedsYou'
import { NewTracingAction, TracingsBody } from './Tracings'
import { inSight, READING_LINE, SECTIONS, type SectionId, useSectionFacts } from './sections'

/** The body of each section: today's component for it. The card is these in a column, and each section's task restyles its own. */
function Body({ id }: { id: SectionId }): ReactNode {
  switch (id) {
    case 'needs':
      return <NeedsYou />
    case 'parts':
      return <Layers />
    case 'params':
      return <ParamsPanel />
    case 'checks':
      return <Checks />
    case 'marks':
      return <MarksPanel />
    case 'scans':
      return <ScansPanel />
    case 'tracings':
      return <TracingsBody />
  }
}

/**
 * The project read from top to bottom: the card docked at the left, as wide as `--card-w` says. Its head slot (`head`: what
 * is in your hand) is pinned above the scroll; below it the seven sections of `SECTIONS` follow one another down a route line,
 * each folded to its head or open. Which of them is in sight is found by an `IntersectionObserver` on the heads (`inSight`), and
 * `store.sectionHere` has it. Its right edge makes it wider (`LeftEdge`).
 */
export function RouteCard({ head, shell }: { head?: ReactNode; shell: RefObject<HTMLDivElement | null> }) {
  const facts = useSectionFacts()
  const scroll = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const root = scroll.current
    if (!root || typeof IntersectionObserver === 'undefined') return
    const find = (): void => {
      const top = root.getBoundingClientRect().top
      const tops = [...root.querySelectorAll<HTMLElement>('[data-section]')].map((el) => ({ id: el.dataset.section as SectionId, top: el.querySelector('.route-head')!.getBoundingClientRect().top - top }))
      const atEnd = root.scrollHeight > root.clientHeight + 1 && root.scrollTop + root.clientHeight >= root.scrollHeight - 1
      actions.setSectionHere(inSight(tops, root.clientHeight, atEnd))
    }
    // The heads cross the reading line (the top of the scroll down to `READING_LINE` of it) as the card scrolls or its sections fold.
    const seen = new IntersectionObserver(find, { root, rootMargin: `0px 0px -${Math.round((1 - READING_LINE) * 100)}% 0px`, threshold: [0, 1] })
    for (const head of root.querySelectorAll('.route-head')) seen.observe(head)
    // A card that resizes, or whose body grows, moves heads without one crossing: read again.
    const resized = new ResizeObserver(find)
    resized.observe(root)
    root.addEventListener('scroll', find, { passive: true })
    find()
    return () => {
      seen.disconnect()
      resized.disconnect()
      root.removeEventListener('scroll', find)
      actions.setSectionHere(null)
    }
  }, [])

  return (
    <div className="route-card">
      {head && <div className="route-hand">{head}</div>}
      <div className="route-scroll" ref={scroll}>
        {SECTIONS.map(({ id, title }) => {
          const f = facts[id]
          const said = (
            <>
              {f.plain ? f.said : numbered(f.said)}
              {f.bad !== null && (
                <>
                  {f.said !== '' && ', '}
                  <span className="route-said-fail">{numbered(f.bad)}</span>
                </>
              )}
            </>
          )
          return (
            <CardSection key={id} id={id} title={title} said={said} needs={f.needs} empty={f.empty} action={id === 'scans' ? <ImportScan /> : id === 'tracings' ? <NewTracingAction /> : undefined}>
              <Body id={id} />
            </CardSection>
          )
        })}
      </div>
      <LeftEdge shell={shell} />
    </div>
  )
}
