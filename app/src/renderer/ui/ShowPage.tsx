import { ARROWS_CAP, domKey, hint, keyName, pressed, which } from '../../shared/keys'
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import type { ObjectCard } from '../../shared/show'
import { actions, store, useStore } from '../state/store'
import { SHELVES_GAP, cellWidth, figureOf, packRows, pageScale, shelvesOf, stepAcross, type BenchMode, type Figure, type Order } from './bench'
import { BEHIND, buildLine, cardChips, matching, pictureLine, sizeLine, stepCard, waitedFor, workLine } from './cards'
import { focusAsk } from './sessionSign'
import { EmptyWorkspace } from './EmptyWorkspace'
import { numbered } from './numbered'
import { GitText } from './GitText'
import { gitFilesSaid } from '../../shared/git'
import { openNewObject } from './onboard/NewObject'
import { TYPING } from './typing'

/** The key that brings the page of objects up from an object's view. On the page, Escape goes back. */
export const PAGE_KEY = hint('page')

/**
 * `W` outside any field shows the page of objects over the object that is open. The way back is the page's own
 * (Escape, or a card): on the page a letter is typed into its filter. Not while a button of the pointer is
 * held: the page would take the view from under a drag that is not over yet.
 */
export function usePageKey(): void {
  useEffect(() => {
    let held = 0
    const onPointer = (e: PointerEvent): void => void (held = e.buttons)
    const onKey = (e: KeyboardEvent): void => {
      if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey || !pressed(e, 'page')) return
      if (e.target instanceof Element && e.target.closest(TYPING)) return
      if (held !== 0 || store.getState().page !== 'object') return
      actions.showPage('objects')
      e.preventDefault()
    }
    const pointers = ['pointerdown', 'pointerup', 'pointercancel'] as const
    for (const type of pointers) window.addEventListener(type, onPointer, true)
    window.addEventListener('keydown', onKey)
    return () => {
      for (const type of pointers) window.removeEventListener(type, onPointer, true)
      window.removeEventListener('keydown', onKey)
    }
  }, [])
}

/** What asks a question of its own beside the page, or lies over it: the build's error, a confirm of the left column. */
const OVER = '[role="dialog"], [role="alertdialog"]'

/** The topmost of those that is there to be seen: not one of the view under the page, which is put away with it. */
function topmostOver(page: HTMLElement): HTMLElement | null {
  const found = [...document.querySelectorAll<HTMLElement>(OVER)].filter((one) => !page.contains(one) && !one.closest('[inert]'))
  return found[found.length - 1] ?? null
}

/**
 * The page of objects: a card for each object of the workspace, with the picture it has on file, how its build
 * stands and what is open on it. It lies over the 3D view, which stays as it is underneath. Looking at it costs
 * what reading a few small files costs: nothing is built, started or loaded for a card, and a picture is asked
 * for only once its card comes into view.
 *
 * By the keys: the arrows go from card to card, Enter opens the one in focus, `/` or any letter filters by name,
 * Escape empties the filter and then goes back to the object that was open.
 */
const ORDERS: [Order, string][] = [['name', 'By name'], ['recent', 'Recently changed']]

/** The order of the rest, kept for each workspace in this window's storage (never in the workspace); a storage that is not there is no memory. The newest first unless a person chose by name. */
function useOrder(root: string | undefined): [Order, (order: Order) => void] {
  const key = `torno.show.order:${root ?? ''}`
  const read = (): Order => {
    try {
      return globalThis.localStorage?.getItem(key) === 'name' ? 'name' : 'recent'
    } catch {
      return 'recent'
    }
  }
  const [order, set] = useState<Order>(read)
  useEffect(() => set(read()), [key]) // eslint-disable-line react-hooks/exhaustive-deps
  return [
    order,
    (next) => {
      set(next)
      try {
        globalThis.localStorage?.setItem(key, next)
      } catch {
        // No storage: the choice lasts while the page does.
      }
    }
  ]
}

const MODES: [BenchMode, string][] = [['scale', 'True scale'], ['grid', 'Grid']]

/** How the pictures are drawn, kept for each workspace in this window's storage (never in the workspace); a storage that is not there is no memory. */
function useMode(root: string | undefined): [BenchMode, (mode: BenchMode) => void] {
  const key = `torno.show.mode:${root ?? ''}`
  const read = (): BenchMode => {
    try {
      return globalThis.localStorage?.getItem(key) === 'grid' ? 'grid' : 'scale'
    } catch {
      return 'scale'
    }
  }
  const [mode, set] = useState<BenchMode>(read)
  useEffect(() => set(read()), [key]) // eslint-disable-line react-hooks/exhaustive-deps
  return [
    mode,
    (next) => {
      set(next)
      try {
        globalThis.localStorage?.setItem(key, next)
      } catch {
        // No storage: the choice lasts while the page does.
      }
    }
  ]
}

/**
 * The width of the bench's room, in the bench's own pixels (what `zoom` takes away is not counted), kept as the window changes.
 * The bench is not there until the cards are, so its element is handed over by a callback.
 */
function useWidth(): [(el: HTMLDivElement | null) => void, number, boolean] {
  const [el, setEl] = useState<HTMLDivElement | null>(null)
  const [width, setWidth] = useState(1100)
  const [measured, setMeasured] = useState(false)
  useLayoutEffect(() => {
    if (!el) return
    const measure = (): void => {
      setWidth(el.offsetWidth > 0 ? el.offsetWidth : 1100)
      setMeasured(true)
    }
    measure()
    const seen = new ResizeObserver(measure)
    seen.observe(el)
    return () => seen.disconnect()
  }, [el])
  return [setEl, width, measured]
}

/** The time, as the minutes a question has waited are told; moved on every half minute while there is one. */
function useNow(on: boolean): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!on) return
    setNow(Date.now())
    const timer = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(timer)
  }, [on])
  return now
}

export function ShowPage({ onOpen, onExample, notes }: { onOpen: (id: string) => void | Promise<void>; onExample: () => void; notes?: ReactNode }) {
  const workspace = useStore((s) => s.workspace)
  const openId = useStore((s) => s.objectId)
  const [cards, setCards] = useState<ObjectCard[] | null>(null)
  const [typed, setTyped] = useState('')
  const page = useRef<HTMLElement>(null)
  const field = useRef<HTMLInputElement>(null)
  const filter = useRef(typed)
  filter.current = typed
  const root = workspace?.root
  const [mode, chooseMode] = useMode(root)
  const [order, chooseOrder] = useOrder(root)
  const [benchRef, width, measured] = useWidth()
  const hasProject = workspace?.hasProject ?? true
  const [hasExample, setHasExample] = useState(false)
  useEffect(() => {
    let live = true
    void window.torno.workspace.hasExample().then(
      (has) => live && setHasExample(has),
      () => {}
    )
    return () => {
      live = false
    }
  }, [])

  // The cards, asked for again whenever main says one may say something else.
  useEffect(() => {
    let live = true
    let asked = 0
    const ask = (): void => {
      const mine = ++asked
      window.torno.show.cards().then(
        (found) => {
          if (live && mine === asked) setCards(found)
        },
        () => {}
      )
    }
    ask()
    const off = window.torno.show.onChanged(ask)
    return () => {
      live = false
      off()
    }
  }, [root])

  // What had the focus when the page came up has it again when the page goes, if it is still there to take it.
  const cameWith = useRef<Element | null>(null)
  useEffect(() => {
    const before = document.activeElement
    cameWith.current = before
    return () => {
      // Not from under someone who has gone elsewhere meanwhile: only when the focus would be left on nothing.
      const now = document.activeElement
      if (before instanceof HTMLElement && before.isConnected && (now === null || now === document.body || !now.isConnected)) before.focus()
    }
  }, [])

  // The keys are the page's while it is up: the card of the open object has the focus, or the first.
  const focused = useRef(false)
  useEffect(() => {
    // Not before the shelves are laid out for the room there is: a card that moves to another shelf is another element, and has not the focus.
    if (focused.current || !cards || cards.length === 0 || !measured) return
    focused.current = true
    // Not from under someone who went somewhere else while the cards were on their way (a field, a slider of
    // the left column): only from where the focus was when the page came up, or from nothing.
    const active = document.activeElement
    if (active !== null && active !== document.body && active !== cameWith.current) return
    if (active instanceof Element && active.closest(TYPING)) return
    const found = [...page.current!.querySelectorAll<HTMLElement>('.card')]
    ;(found.find((card) => card.dataset.object === store.getState().objectId) ?? found[0])?.focus()
  }, [cards, measured])

  // A card whose shelf changes (the window was resized, a project was saved) is a new element: the focus goes to it.
  const lastFocus = useRef<HTMLElement | null>(null)
  useEffect(() => {
    const on = (e: FocusEvent): void => {
      if (e.target instanceof HTMLElement && e.target.matches('.card')) lastFocus.current = e.target
    }
    page.current?.addEventListener('focusin', on)
    const root = page.current
    return () => root?.removeEventListener('focusin', on)
  }, [])
  useLayoutEffect(() => {
    const was = lastFocus.current
    if (!was || was.isConnected) return
    const active = document.activeElement
    if (active !== null && active !== document.body) return
    const now = [...page.current!.querySelectorAll<HTMLElement>('.card')].find((one) => one.dataset.object === was.dataset.object)
    lastFocus.current = now ?? null
    now?.focus({ preventScroll: true })
  })

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.ctrlKey || e.metaKey || e.altKey) return
      const target = e.target instanceof Element ? e.target : null
      const here = target !== null && page.current!.contains(target)
      // The empty folder's composer has its own fields and keys.
      if (target?.closest('.empty-folder')) return
      // Somewhere else to type: the session's terminal, a field of the left column. A slider or a tick box there
      // keeps its keys, and so does whatever asks a question of its own (the build's error, a confirm).
      if (!here && target?.closest(`${TYPING}, input, ${OVER}`)) return
      // The sheet of keys is asked for here as everywhere, outside a field.
      if (pressed(e, 'keys') && !target?.closest(TYPING)) return
      // Whatever else is pressed is the page's: no tool of the view under it is handed a key.
      e.stopPropagation()
      if (pressed(e, 'page.tab')) return
      const found = [...page.current!.querySelectorAll<HTMLElement>('.card')]
      if (pressed(e, 'page.back')) {
        e.preventDefault()
        // Escape goes to what is on top: a sheet or a question first, as if it had been pressed there; then the page.
        const over = topmostOver(page.current!)
        if (over) {
          over.dispatchEvent(new KeyboardEvent('keydown', { key: domKey(hint('sheet.close')), bubbles: true, cancelable: true }))
          return
        }
        if (filter.current !== '') {
          setTyped('')
          if (target === field.current) (found[0] ?? field.current)?.focus()
        } else actions.showPage('object')
        return
      }
      if (target === field.current) {
        // In the field the keys are the field's, but for the two that leave it: down to the cards, Enter for the first of them.
        const first = pressed(e, 'filter.first')
        if (!first && !pressed(e, 'filter.down')) return
        e.preventDefault()
        if (first) found[0]?.click()
        else found[0]?.focus()
        return
      }
      if (pressed(e, 'page.filter')) {
        e.preventDefault()
        field.current?.focus()
        field.current?.select()
        return
      }
      const at = found.indexOf(document.activeElement as HTMLElement)
      // Up and down go by the shelves: to the nearest card on the line above or below. The rest is by the cards in their order.
      const move = which(e, 'page.move')
      const to =
        move === 2 || move === 3
          ? stepAcross(
              move === 2 ? 'up' : 'down',
              at,
              found.map((one) => {
                const box = one.getBoundingClientRect()
                return { line: Number(one.dataset.line), x: box.left + box.width / 2 }
              })
            )
          : stepCard(e, at, found.length, 1)
      if (to !== null) {
        e.preventDefault()
        const next = to === 'field' ? field.current : found[to]
        next?.focus()
        next?.scrollIntoView({ block: 'nearest' })
        return
      }
      // A letter or a figure starts a name: it goes into the field, which takes it from here. Enter and the space bar are the button's in focus.
      if (keyName(e).length === 1) field.current?.focus()
    }
    // Before anything else hears of the key: the tools' own listeners are on the window too.
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [])

  const shown = cards ? matching(cards, typed) : []
  const name = root ? root.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || root : ''
  const shelves = shelvesOf(shown, openId, order)
  const scale = pageScale(shelves, width, mode)
  const now = useNow(shelves.needs.some((one) => one.waiting !== undefined))
  // The shelves cut into rows that fit; the two on top stand side by side, each with its rows, and the rest under them.
  const half = shelves.needs.length > 0 && shelves.working.length > 0 ? (width - SHELVES_GAP) / 2 : width
  const rowsOf = (list: ObjectCard[], room: number): ObjectCard[][] => packRows(list, room, scale, mode)
  const needsRows = rowsOf(shelves.needs, half)
  const workingRows = rowsOf(shelves.working, half)
  const restRows = rowsOf(shelves.rest, width)
  const top = Math.max(needsRows.length, workingRows.length)
  const group = { mode, scale, openId, onOpen }

  // A folder with no project in it is the empty folder's screen, in place of the page: the dyed plate and the composer.
  if (cards && cards.length === 0)
    return (
      <section ref={page} className="show show-bare" aria-label={`Projects of ${name}`}>
        {notes}
        <EmptyWorkspace name={name} hasProject={hasProject} hasExample={hasExample} onOpen={async (id) => void (await onOpen(id))} onExample={onExample} />
      </section>
    )

  return (
    <section ref={page} className="show" aria-label={`Projects of ${name}`}>
      <header className="show-head">
        <div className="show-title">
          <h2>{name}</h2>
          {cards && cards.length > 0 && (
            <p className="show-count" title={root}>
              {typed.trim() !== '' && (
                <>
                  <span className="num">{shown.length}</span> of{' '}
                </>
              )}
              <span className="num">{cards.length}</span> {cards.length === 1 ? 'project' : 'projects'} in <span className="num">{root}</span>
            </p>
          )}
        </div>
        {cards && cards.length > 0 && (
          <label className="show-filter">
            <input ref={field} type="text" value={typed} placeholder="Filter by name" aria-label="Filter the projects by name" spellCheck={false} onChange={(e) => setTyped(e.target.value)} />
            <kbd aria-hidden="true">{hint('page.filter')}</kbd>
          </label>
        )}
        {cards && cards.length > 1 && (
          <div className="show-mode" role="group" aria-label="How the projects are drawn">
            {MODES.map(([value, label]) => (
              <button key={value} type="button" aria-pressed={mode === value} title={value === 'scale' ? 'Every picture at one scale, so that sizes can be compared' : 'Every picture fitted to a box of the same size'} onClick={() => chooseMode(value)}>
                {label}
              </button>
            ))}
          </div>
        )}
        {cards && cards.length > 1 && (
          <div className="show-mode show-order" role="group" aria-label="Order of the projects">
            {ORDERS.map(([value, label]) => (
              <button key={value} type="button" aria-pressed={order === value} onClick={() => chooseOrder(value)}>
                {label}
              </button>
            ))}
          </div>
        )}
        {cards && cards.length > 0 && (
          <button type="button" className="button show-export" title="Export projects to one HTML file that opens by itself, or one of them to a STEP, STL or 3MF file" onClick={() => actions.exportSheet('all')}>
            Export…
          </button>
        )}
        {cards && cards.length > 0 && (
          <button type="button" className="button button-primary show-new" title="Make a new project: say what it is and give what you have" onClick={() => openNewObject()}>
            <svg viewBox="0 0 12 12" width="11" height="11" aria-hidden="true">
              <path d="M6 1.5v9M1.5 6h9" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" fill="none" />
            </svg>
            New project
          </button>
        )}
      </header>
      {/* What is to be said of the folder: the example is a temporary copy; a folder that would not open. */}
      {notes}
      {cards && cards.length > 0 && shown.length === 0 && (
        <p className="show-none">
          No project is named like <span className="show-typed">{typed.trim()}</span>. Escape shows them all.
        </p>
      )}
      {shown.length > 0 && (
        <div ref={benchRef} className="bench" data-mode={mode}>
          {top > 0 && (
            <div className="bench-top" data-both={shelves.needs.length > 0 && shelves.working.length > 0 ? '' : undefined}>
              {shelves.needs.length > 0 && <Group tone="needs" title="Needs you" count={shelves.needs.length} rows={needsRows} first={0} now={now} {...group} />}
              {shelves.working.length > 0 && <Group tone="working" title="Working" count={shelves.working.length} rows={workingRows} first={0} now={now} {...group} />}
            </div>
          )}
          {shelves.rest.length > 0 && (
            <Group
              tone="rest"
              title="The rest"
              note={`${order === 'recent' ? 'most recently changed first' : 'by name'}, ${mode === 'scale' ? 'all at the same scale' : 'each in a box of the same size'}`}
              count={shelves.rest.length}
              rows={restRows}
              first={top}
              now={now}
              {...group}
            />
          )}
        </div>
      )}
      {cards && cards.length > 0 && (
        <p className="show-keys">
          <kbd>{ARROWS_CAP}</kbd> move · <kbd>{hint('page.open')}</kbd> opens · <kbd>{hint('page.filter')}</kbd> or a letter filters
          {openId !== null && (
            <>
              {' '}
              · <kbd>{hint('page.back')}</kbd> back to {openId}
            </>
          )}
        </p>
      )}
    </section>
  )
}

interface GroupProps {
  tone: 'needs' | 'working' | 'rest'
  title: string
  note?: string
  count: number
  rows: ObjectCard[][]
  /** The line of the first of its rows, among the lines the arrow keys go up and down. */
  first: number
  mode: BenchMode
  scale: number
  openId: string | null
  now: number
  onOpen: (id: string) => void
}

/** A shelf or several (one for each row that fits), under its heading; what those that need you ask, or what is at work, under them. */
function Group({ tone, title, note, count, rows, first, mode, scale, openId, now, onOpen }: GroupProps) {
  const all = rows.flat()
  return (
    <section className="bench-group" data-tone={tone} aria-label={title}>
      <h3 className="grp-h">
        {tone !== 'rest' && <span className="grp-dot" aria-hidden="true" />}
        {title}
        <span className="grp-n num">{count}</span>
        {note && <span className="grp-note">{note}</span>}
      </h3>
      {rows.map((row, r) => {
        const figures = row.map((card) => figureOf(card, mode, scale))
        // The shelf is as tall as its tallest picture, and a little over.
        const height = Math.max(...figures.map((f) => f.h)) + 10
        return (
          <div key={row[0].id} className="shelf" style={{ '--shelf-h': `${height}px` } as CSSProperties}>
            {row.map((card, i) => (
              <Card key={card.id} card={card} figure={figures[i]} mode={mode} scale={scale} line={first + r} open={card.id === openId} onOpen={onOpen} />
            ))}
          </div>
        )
      })}
      {tone === 'needs' &&
        all
          .filter((card) => card.waiting !== undefined)
          .map((card) => (
            <div key={card.id} className="askcard">
              {all.length > 1 && <span className="askcard-for">{card.name}</span>}
              <p>
                <b>Claude asks:</b> {numbered(card.waiting!.question)}
              </p>
              <div className="acts">
                <button
                  type="button"
                  className="button button-primary"
                  title={`Open ${card.name} and answer there`}
                  onClick={() => {
                    actions.setDockOpen(true)
                    // Its object is shown first, and from the page back to the object; the ask is then there to be reached.
                    onOpen(card.id)
                    focusAsk(card.id)
                  }}
                >
                  Answer
                </button>
                <span className="muted">{numbered(waitedFor(now - card.waiting!.since))}</span>
              </div>
            </div>
          ))}
      {tone === 'working' &&
        all.map((card) => (
          <p key={card.id} className="workcard">
            <span className="grp-dot" aria-hidden="true" />
            {all.length > 1 && <span className="workcard-for">{card.name}</span>}
            {numbered(workLine(card))}
          </p>
        ))}
    </section>
  )
}

function Card({ card, figure, mode, scale, line, open, onOpen }: { card: ObjectCard; figure: Figure; mode: BenchMode; scale: number; line: number; open: boolean; onOpen: (id: string) => void }) {
  // A picture its facts speak of that main did not hand over (it is gone, or is not the one they are of) is no picture: nothing is said of it.
  const [missing, setMissing] = useState(false)
  const pictured = missing ? { ...card, thumb: null } : card
  // What stands on the shelf is as wide as it was laid out for; a picture that is not there stands as a dashed box.
  const shown = missing ? figureOf(pictured, mode, scale) : figure
  const build = buildLine(card)
  const picture = pictureLine(pictured)
  const chips = cardChips(card)
  const size = sizeLine(pictured)
  // The status wins over the picture: one of a build that is no longer what the model makes is dimmed.
  const failed = card.opened && card.build?.status === 'failed'
  // Its last build of this run can go into a file by itself: nothing is built for that.
  const exportable = card.opened && card.build !== undefined && card.build.revision > 0
  return (
    <div className="card-cell" style={{ width: cellWidth(figure) }}>
      <button type="button" className="card" data-object={card.id} data-line={line} aria-current={open ? 'true' : undefined} data-problem={card.problem !== undefined ? '' : undefined} onClick={() => onOpen(card.id)}>
        <Picture card={pictured} figure={shown} of={card.thumb?.at} dimmed={failed} open={open} onMissing={setMissing} />
        <span className="card-body">
          <span className="card-head">
            <span className="card-name" title={card.name}>
              {card.name}
            </span>
            {open && <span className="card-open">Open</span>}
          </span>
          <span className="card-line" data-part="build" data-tone={build.tone} data-status={build.standing} title={card.problemAt ?? build.title ?? build.text}>
            {/* Of a build of this run only: the status line's dot, and the line in ink. */}
            {build.standing && <span className="status-dot" aria-hidden="true" />}
            {numbered(build.text)}
          </span>
          {picture?.behind && (
            <span className="card-line" data-part="behind" data-tone="warn">
              {BEHIND}
            </span>
          )}
          {(size || chips.length > 0) && (
            <span className="card-detail" data-part="detail">
              {size && <span className="card-size">{size}</span>}
              {chips.map((chip, i) => (
                <span key={chip.text}>
                  {i > 0 || size ? ', ' : ''}
                  <span className="card-chip" data-tone={chip.tone}>
                    {numbered(chip.text)}
                  </span>
                </span>
              ))}
            </span>
          )}
          {picture && (
            <span className="card-line" data-part="picture">
              {numbered(picture.text)}
            </span>
          )}
          {card.uses && card.uses.length > 0 && (
            <span className="card-line" data-part="uses" title={card.uses.join(', ')}>
              Uses {card.uses.join(', ')}
            </span>
          )}
          {card.git && (
            <span className="card-line" data-part="git" title={card.git.changed > 0 ? gitFilesSaid(card.git) : undefined}>
              <GitText git={card.git} />
            </span>
          )}
        </span>
      </button>
      {exportable && (
        <button type="button" className="card-export" aria-label={`Export ${card.name}`} title={`Export ${card.name}: one HTML file, or a STEP, STL or 3MF file`} onClick={() => actions.exportSheet([card.id])}>
          Export
        </button>
      )}
    </div>
  )
}

/** How far outside the part of the page in view a card's picture is already asked for. */
const NEAR = '240px'

/**
 * The picture a card has on file, standing on its shelf: cropped to its part at the page's scale, or fitted to a box,
 * or the dashed box of a project whose size is not known. It is asked of main only once the card is in view or near
 * it, and again when another was made (`of`: when the one on file was). A card whose facts speak of a picture main
 * does not hand over is a dashed box too (`onMissing`).
 */
function Picture({ card, figure, of, dimmed, open, onMissing }: { card: ObjectCard; figure: Figure; of: string | undefined; dimmed: boolean; open: boolean; onMissing: (missing: boolean) => void }) {
  const holder = useRef<HTMLSpanElement>(null)
  const [near, setNear] = useState(false)
  const [url, setUrl] = useState<string | null>(null)

  useEffect(() => {
    const seen = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return
        setNear(true)
        seen.disconnect()
      },
      { root: holder.current!.closest('.show'), rootMargin: NEAR }
    )
    seen.observe(holder.current!)
    return () => seen.disconnect()
  }, [])

  useEffect(() => {
    onMissing(false)
    if (!near || of === undefined) {
      setUrl(null)
      return
    }
    let live = true
    let made: string | null = null
    const none = (): void => {
      if (!live) return
      setUrl(null)
      onMissing(true)
    }
    window.torno.show.thumbnail(card.id).then((png) => {
      if (!live) return
      if (!png) return none()
      made = URL.createObjectURL(new Blob([png], { type: 'image/png' }))
      setUrl(made)
    }, none)
    return () => {
      live = false
      if (made) URL.revokeObjectURL(made)
    }
  }, [near, of, card.id, onMissing])

  const { img } = figure
  return (
    <span ref={holder} className="card-picture" data-dimmed={dimmed && url ? '' : undefined} data-look={figure.kind}>
      {/* The project that is open: a bar of the accent under its picture, a little wider than it. */}
      {open && <span className="card-open-bar" style={{ width: figure.w + 16 }} />}
      {figure.kind === 'ghost' ? (
        <span className="bench-ghost" style={{ width: figure.w, height: figure.h }}>
          Size not known until it builds
        </span>
      ) : (
        <span className="bench-fig" style={{ width: figure.w, height: figure.h }}>
          {url && (img ? <img src={url} alt="" width={480} height={360} draggable={false} style={{ width: img.w, height: img.h, left: img.x, top: img.y }} /> : <img src={url} alt="" width={480} height={360} draggable={false} className="bench-tile-img" />)}
        </span>
      )}
    </span>
  )
}
