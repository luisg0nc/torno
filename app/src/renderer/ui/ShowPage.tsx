import { ARROWS_CAP, domKey, hint, keyName, pressed } from '../../shared/keys'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { ObjectCard } from '../../shared/show'
import { actions, store, useStore } from '../state/store'
import { BEHIND, buildLine, cardChips, matching, ordered, pictureLine, stepCard, type Order } from './cards'
import { EmptyWorkspace } from './EmptyWorkspace'
import { Logo } from './Logo'
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

/** How many cards stand in the first row of the grid, as it is laid out now. */
function columnsOf(cards: HTMLElement[]): number {
  if (cards.length === 0) return 1
  const top = cards[0].offsetTop
  const n = cards.findIndex((card) => card.offsetTop !== top)
  return n < 0 ? cards.length : n
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

/** The order of the cards, kept for each workspace in this window's storage (never in the workspace); a storage that is not there is no memory. */
function useOrder(root: string | undefined): [Order, (order: Order) => void] {
  const key = `torno.show.order:${root ?? ''}`
  const read = (): Order => {
    try {
      return globalThis.localStorage?.getItem(key) === 'recent' ? 'recent' : 'name'
    } catch {
      return 'name'
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

export function ShowPage({ onOpen, onExample, notes }: { onOpen: (id: string) => void; onExample: () => void; notes?: ReactNode }) {
  const workspace = useStore((s) => s.workspace)
  const openId = useStore((s) => s.objectId)
  const [cards, setCards] = useState<ObjectCard[] | null>(null)
  const [typed, setTyped] = useState('')
  const page = useRef<HTMLElement>(null)
  const field = useRef<HTMLInputElement>(null)
  const filter = useRef(typed)
  filter.current = typed
  const root = workspace?.root
  const [order, chooseOrder] = useOrder(root)
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
    if (focused.current || !cards || cards.length === 0) return
    focused.current = true
    // Not from under someone who went somewhere else while the cards were on their way (a field, a slider of
    // the left column): only from where the focus was when the page came up, or from nothing.
    const active = document.activeElement
    if (active !== null && active !== document.body && active !== cameWith.current) return
    if (active instanceof Element && active.closest(TYPING)) return
    const found = [...page.current!.querySelectorAll<HTMLElement>('.card')]
    ;(found.find((card) => card.dataset.object === store.getState().objectId) ?? found[0])?.focus()
  }, [cards])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.ctrlKey || e.metaKey || e.altKey) return
      const target = e.target instanceof Element ? e.target : null
      const here = target !== null && page.current!.contains(target)
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
      const to = stepCard(e, found.indexOf(document.activeElement as HTMLElement), found.length, columnsOf(found))
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

  const shown = cards ? ordered(matching(cards, typed), order) : []
  const name = root ? root.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || root : ''

  return (
    <section ref={page} className="show" aria-label={`Projects of ${name}`}>
      <header className="show-head">
        <div className="show-title">
          <h2>Projects</h2>
          {cards && cards.length > 0 && (
            <p className="show-count">
              {typed.trim() !== '' && (
                <>
                  <span className="num">{shown.length}</span> of{' '}
                </>
              )}
              <span className="num">{cards.length}</span> in {name}
            </p>
          )}
        </div>
        {cards && cards.length > 0 && (
          <button type="button" className="button show-new" title="Make a new project: say what it is and give what you have" onClick={openNewObject}>
            New project
          </button>
        )}
        {cards && cards.length > 0 && (
          <button type="button" className="button show-export" title="Export projects to one HTML file that opens by itself, or one of them to a STEP, STL or 3MF file" onClick={() => actions.exportSheet('all')}>
            Export…
          </button>
        )}
        {cards && cards.length > 1 && (
          <div className="show-order" role="group" aria-label="Order of the projects">
            {ORDERS.map(([value, label]) => (
              <button key={value} type="button" aria-pressed={order === value} onClick={() => chooseOrder(value)}>
                {label}
              </button>
            ))}
          </div>
        )}
        {cards && cards.length > 0 && (
          <label className="show-filter">
            <input ref={field} type="text" value={typed} placeholder="Filter by name" aria-label="Filter the projects by name" spellCheck={false} onChange={(e) => setTyped(e.target.value)} />
            <kbd aria-hidden="true">{hint('page.filter')}</kbd>
          </label>
        )}
      </header>
      {/* What is to be said of the folder: the example is a temporary copy; a folder that would not open. */}
      {notes}
      {cards && cards.length === 0 && <EmptyWorkspace name={name} hasProject={hasProject} hasExample={hasExample} onNew={openNewObject} onExample={onExample} />}
      {cards && cards.length > 0 && shown.length === 0 && (
        <p className="show-none">
          No project is named like <span className="show-typed">{typed.trim()}</span>. Escape shows them all.
        </p>
      )}
      {shown.length > 0 && (
        <div className="cards">
          {shown.map((card) => (
            <Card key={card.id} card={card} open={card.id === openId} onOpen={onOpen} />
          ))}
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

function Card({ card, open, onOpen }: { card: ObjectCard; open: boolean; onOpen: (id: string) => void }) {
  // A picture its facts speak of that main did not hand over (it is gone, or is not the one they are of) is no picture: nothing is said of it.
  const [missing, setMissing] = useState(false)
  const pictured = missing ? { ...card, thumb: null } : card
  const build = buildLine(card)
  const picture = pictureLine(pictured)
  const chips = cardChips(card)
  // The status wins over the picture: one of a build that is no longer what the model makes is dimmed.
  const failed = card.opened && card.build?.status === 'failed'
  // Its last build of this run can go into a file by itself: nothing is built for that.
  const exportable = card.opened && card.build !== undefined && card.build.revision > 0
  return (
    <div className="card-cell">
    <button type="button" className="card" data-object={card.id} aria-current={open ? 'true' : undefined} data-problem={card.problem !== undefined ? '' : undefined} onClick={() => onOpen(card.id)}>
      <Picture card={pictured} of={card.thumb?.at} dimmed={failed} onMissing={setMissing} />
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
        {picture?.behind && (
          <span className="card-line" data-part="behind" data-tone="warn">
            {BEHIND}
          </span>
        )}
        {card.git && (
          <span className="card-line" data-part="git" title={card.git.changed > 0 ? gitFilesSaid(card.git) : undefined}>
            <GitText git={card.git} />
          </span>
        )}
        {chips.length > 0 && (
          <span className="card-chips">
            {chips.map((chip) => (
              <span key={chip.text} className="card-chip" data-tone={chip.tone}>
                {numbered(chip.text)}
              </span>
            ))}
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
 * The picture a card has on file, on the ground of the 3D view. It is asked of main only once the card is in
 * view or near it, and again when another was made (`of`: when the one on file was). A card with none says so,
 * and what makes one; so does a card whose facts speak of a picture main does not hand over (`onMissing`).
 */
function Picture({ card, of, dimmed, onMissing }: { card: ObjectCard; of: string | undefined; dimmed: boolean; onMissing: (missing: boolean) => void }) {
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

  return (
    <span ref={holder} className="card-picture" data-dimmed={dimmed && url ? '' : undefined} data-empty={!url && card.thumb === null ? '' : undefined}>
      {url ? (
        <img src={url} alt="" width={480} height={360} draggable={false} />
      ) : card.thumb === null ? (
        <span className="card-nopicture">
          <Logo plain />
          <span>No picture yet</span>
          {card.problem === undefined && <span className="card-nopicture-how">{card.opened ? 'One is made when it builds' : 'Open it to make one'}</span>}
        </span>
      ) : null}
    </span>
  )
}
