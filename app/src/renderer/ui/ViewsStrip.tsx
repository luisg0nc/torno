import { pressed, which } from '../../shared/keys'
import { type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent, type ReactNode, useEffect, useRef, useState } from 'react'
import type { Scene } from '../../shared/scene'
import { type SavedView, MAX_VIEW_NAME, findView, goneText, holdsText, viewGone, viewNameRefusal } from '../../shared/views'
import { stripChips, viewMatches } from '../state/savedViews'
import { actions, store, useStore } from '../state/store'
import type { Viewport } from '../viewport/Viewport'
import { numbered } from './numbered'
import { pinToBoard } from './projectBoard/pin'

/** Which way a popover hangs under what opened it: from its left edge, or from its right when that is past the middle of the strip. */
type Side = 'left' | 'right'
/** What is open under the strip: the field a name is typed in (for a new view, or for one that gets another name), the actions of a view, or the list of all the views. */
type Open = { kind: 'save' } | { kind: 'rename'; view: string; side: Side } | { kind: 'menu'; view: string; deleting: boolean; side: Side } | { kind: 'list'; side: Side } | null

/** How long what could not be done stays said under the strip. */
const SAID_FOR_MS = 4000

/**
 * The saved views of the open object, in a strip under the view bar: a chip each, to put that view on screen, and
 * at the end "Save view", which keeps what is on screen under a name. A view the agent proposed says so and
 * waits to be kept or discarded; a view of a layout the model no longer has stays and cannot be applied; parts
 * and scans a view names that are gone are passed over, and the chip says how many.
 *
 * Six chips at most (`stripChips`): with more views the others are behind a chip that says how many, which
 * opens the list of all of them. The strip never grows past two rows over the view.
 *
 * Applying a view changes how the object is looked at and nothing else: no geometry, no mark, no measurement.
 */
export function ViewsStrip({ viewport }: { viewport: Viewport }) {
  const views = useStore((s) => s.views)
  const scene = useStore((s) => s.scene)
  const scans = useStore((s) => (s.scansKnown ? s.scans : null))
  // The view that is on: the one last put on screen or saved from it, while the screen still shows what it holds.
  const active = useStore((s) => {
    const view = s.activeView === null ? undefined : findView(s.views, s.activeView)
    return view && viewMatches(s, view) ? view.name : null
  })
  const [open, setOpen] = useState<Open>(null)
  const [said, setSaid] = useState<string | null>(null)
  const strip = useRef<HTMLDivElement>(null)

  // A press anywhere else, or Escape, puts away what is open.
  useEffect(() => {
    if (open === null) return
    const close = (e: Event): void => {
      if (e instanceof KeyboardEvent ? pressed(e, 'menu.close') : !(e.target instanceof Element && e.target.closest('.view-popover, [aria-haspopup]') && strip.current?.contains(e.target))) setOpen(null)
    }
    window.addEventListener('pointerdown', close)
    window.addEventListener('keydown', close)
    return () => {
      window.removeEventListener('pointerdown', close)
      window.removeEventListener('keydown', close)
    }
  }, [open])

  // A view that is gone (removed, renamed, another object) has nothing open.
  const named = open !== null && (open.kind === 'menu' || open.kind === 'rename') ? open.view : null
  useEffect(() => {
    if (named !== null && !findView(views, named)) setOpen(null)
  }, [views, named])

  // The list is of more views than the strip shows: with none behind it, it is not there.
  const listed = views.length
  useEffect(() => {
    if (open?.kind === 'list' && stripChips(views, null).more === 0) setOpen(null)
  }, [listed, open, views])

  useEffect(() => {
    if (said === null) return
    const timer = setTimeout(() => setSaid(null), SAID_FOR_MS)
    return () => clearTimeout(timer)
  }, [said])

  if (!scene) return null

  /** Puts away what is open and gives the focus back to what opened it, or to what is left of it: the keys go on being the strip's, not the tools'. */
  const shut = (to: string): void => {
    setOpen(null)
    // Once what was open is gone from the page.
    requestAnimationFrame(() => (strip.current?.querySelector<HTMLElement>(to) ?? strip.current?.querySelector<HTMLElement>('.view-add'))?.focus({ preventScroll: true }))
  }
  /** Which way a popover opened by this press hangs: to the left when the chip is past the middle of the strip. */
  const sideOf = (e: ReactMouseEvent<HTMLElement>): Side => {
    const item = e.currentTarget.closest('.view-item')?.getBoundingClientRect()
    const all = strip.current?.getBoundingClientRect()
    return item && all && item.left + item.width / 2 > all.left + all.width / 2 ? 'right' : 'left'
  }
  const apply = (view: SavedView): void => {
    const applied = actions.applyView(view.name)
    // The camera goes there once the store has the rest: the viewport follows the store as it is set.
    if (typeof applied !== 'object') return
    // A view that draws the parts apart was framed for where they went when it was saved; where they go now may
    // be elsewhere (along z they go up from the lowest). The camera is the view's, at once, and is fitted only
    // if a part would be out of sight (`keepApartInView`, the rule of `E`).
    const apart = applied.explode !== undefined && applied.explode !== null && applied.explode.amount > 0 && !applied.section
    viewport.setView(applied.camera, !apart)
    if (apart) viewport.keepApartInView()
  }
  const actionsOf = (name: string): string => `[data-actions="${CSS.escape(name)}"]`
  /** The focus, once the button that was pressed is gone from the page: on the first of these there is, else on "Save view". */
  const focusOn = (...to: string[]): void => {
    requestAnimationFrame(() => {
      const found = to.map((one) => strip.current?.querySelector<HTMLElement>(one)).find((one) => one)
      ;(found ?? strip.current?.querySelector<HTMLElement>('.view-add'))?.focus({ preventScroll: true })
    })
  }
  const LIST_ITEM = '.view-list [role="menuitem"]'
  const keep = (view: SavedView): void => {
    const why = actions.keepView(view.name)
    setSaid(why)
    // Kept, its "Keep" is gone: the focus stays with the view.
    if (why === null) focusOn(`.view-list [data-row="${CSS.escape(view.name)}"]`, actionsOf(view.name))
  }
  const discard = (view: SavedView): void => {
    actions.removeView(view.name)
    focusOn(LIST_ITEM)
  }

  const { shown, more } = stripChips(views, active)

  return (
    <div className="viewstrip" role="toolbar" aria-label="Saved views" ref={strip}>
      {shown.map((view) => {
        const fits = fitOf(view, scene, scans)
        const menu = open?.kind === 'menu' && open.view === view.name ? open : null
        const renaming = open?.kind === 'rename' && open.view === view.name ? open : null
        return (
          <div key={view.name} className="view-item" data-proposed={view.proposed ? '' : undefined} data-active={active === view.name ? '' : undefined}>
            <button
              type="button"
              className="view-chip"
              data-view={view.name}
              aria-pressed={active === view.name}
              aria-disabled={fits.gone.layout ? true : undefined}
              title={fits.title}
              onClick={() => {
                if (!fits.gone.layout) apply(view)
              }}
            >
              <span className="view-name">{numbered(view.name)}</span>
              {view.proposed && <span className="view-note">proposed</span>}
              {fits.quiet !== '' && <span className="view-note view-gone">{numbered(fits.quiet)}</span>}
            </button>
            {view.proposed ? (
              <>
                <button type="button" className="view-act" aria-label={`Keep ${view.name}`} title="Keep this view the agent proposed" onClick={() => keep(view)}>
                  Keep
                </button>
                <button type="button" className="view-act view-discard" aria-label={`Discard ${view.name}`} title="Discard this view the agent proposed" onClick={() => discard(view)}>
                  Discard
                </button>
              </>
            ) : (
              <button
                type="button"
                className="view-act view-more"
                data-actions={view.name}
                aria-label={`Actions for ${view.name}`}
                title="Rename, update, pin to the board or delete"
                aria-haspopup="menu"
                aria-expanded={menu !== null}
                onClick={(e) => setOpen(menu ? null : { kind: 'menu', view: view.name, deleting: false, side: sideOf(e) })}
              >
                <DotsIcon />
              </button>
            )}
            {menu && !menu.deleting && (
              <Menu label={`Actions for ${view.name}`} side={menu.side} close={() => shut(actionsOf(view.name))}>
                <button type="button" role="menuitem" className="menu-item" onClick={() => setOpen({ kind: 'rename', view: view.name, side: menu.side })}>
                  Rename
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className="menu-item"
                  title="Keep what is on screen now under this name"
                  onClick={() => {
                    // Where the camera is going, when it is on its way: not a camera in flight.
                    setSaid(actions.saveView(view.name, viewport.cameraGoal()))
                    shut(actionsOf(view.name))
                  }}
                >
                  Update to what is on screen
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className="menu-item"
                  data-pin="view"
                  title="Put this view on the board as a card, to go back to it from there"
                  onClick={() => {
                    const id = store.getState().objectId
                    if (id !== null) void pinToBoard(id, { kind: 'view', name: view.name }).then(setSaid)
                    shut(actionsOf(view.name))
                  }}
                >
                  Pin to board
                </button>
                <button type="button" role="menuitem" className="menu-item" onClick={() => setOpen({ ...menu, deleting: true })}>
                  Delete
                </button>
              </Menu>
            )}
            {menu?.deleting && (
              <div
                className="menu view-popover view-confirm"
                data-side={menu.side}
                role="alertdialog"
                aria-label={`Delete the view ${view.name}?`}
                onKeyDown={(e) => {
                  if (!pressed(e, 'sheet.close')) return
                  // Its own to end: the pane's Escape, which puts a tool down, is not meant.
                  e.preventDefault()
                  e.stopPropagation()
                  shut(actionsOf(view.name))
                }}
              >
                <p>Delete {numbered(`"${view.name}"`)}?</p>
                <div className="view-confirm-buttons">
                  <button
                    type="button"
                    className="button view-delete"
                    onClick={() => {
                      actions.removeView(view.name)
                      shut('.view-add')
                    }}
                  >
                    Delete
                  </button>
                  {/* Where the focus goes: Enter leaves the view as it is. */}
                  <button type="button" className="button" autoFocus onClick={() => shut(actionsOf(view.name))}>
                    Cancel
                  </button>
                </div>
              </div>
            )}
            {renaming && (
              <NameField
                key={`rename ${view.name}`}
                label="Rename"
                first={view.name}
                side={renaming.side}
                refusal={(name) => viewNameRefusal(name, store.getState().views, 'user', view.name)}
                keep={(name) => actions.renameView(view.name, name)}
                done={(name) => shut(actionsOf(name ?? view.name))}
              />
            )}
          </div>
        )
      })}
      {more > 0 && (
        <div className="view-item view-item-list">
          <button type="button" className="view-chip view-list-button" aria-haspopup="menu" aria-expanded={open?.kind === 'list'} title="Every saved view" onClick={(e) => setOpen(open?.kind === 'list' ? null : { kind: 'list', side: sideOf(e) })}>
            <span className="num">{more}</span> more
          </button>
          {open?.kind === 'list' && (
            <Menu label="Every saved view" side={open.side} className="view-list" close={() => shut('.view-list-button')}>
              {views.map((view) => {
                const fits = fitOf(view, scene, scans)
                return (
                  <div key={view.name} className="view-row" data-active={active === view.name ? '' : undefined}>
                    <button
                      type="button"
                      role="menuitem"
                      className="menu-item view-row-apply"
                      data-row={view.name}
                      aria-current={active === view.name ? 'true' : undefined}
                      aria-disabled={fits.gone.layout ? true : undefined}
                      title={fits.title}
                      onClick={() => {
                        if (fits.gone.layout) return
                        apply(view)
                        shut('.view-list-button')
                      }}
                    >
                      <span className="view-name">{numbered(view.name)}</span>
                      <span className="view-row-holds">{numbered([view.proposed ? 'proposed' : '', fits.quiet || holdsText(view)].filter(Boolean).join(' · '))}</span>
                    </button>
                    {view.proposed && (
                      <>
                        <button type="button" role="menuitem" className="view-act" aria-label={`Keep ${view.name}`} onClick={() => keep(view)}>
                          Keep
                        </button>
                        <button type="button" role="menuitem" className="view-act view-discard" aria-label={`Discard ${view.name}`} onClick={() => discard(view)}>
                          Discard
                        </button>
                      </>
                    )}
                  </div>
                )
              })}
            </Menu>
          )}
        </div>
      )}
      <div className="view-item view-item-add">
        <button type="button" className="view-chip view-add" aria-haspopup="dialog" aria-expanded={open?.kind === 'save'} title="Keep what is on screen under a name: camera, layout, parts, section or explode, scans" onClick={() => setOpen(open?.kind === 'save' ? null : { kind: 'save' })}>
          + Save view
        </button>
        {open?.kind === 'save' && (
          <NameField
            label={(name) => (findView(views, name) ? 'Replace' : 'Save')}
            first=""
            side="right"
            refusal={(name) => viewNameRefusal(name, store.getState().views, 'user')}
            // Where the camera is going, when it is on its way: not a camera in flight.
            keep={(name) => actions.saveView(name, viewport.cameraGoal())}
            done={() => shut('.view-add')}
          />
        )}
      </div>
      {said !== null && (
        <p className="viewstrip-said" role="status">
          <span className="view-refusal">{numbered(said)}</span>
        </p>
      )}
    </div>
  )
}

/** How a view fits the model as it is: what of it is gone, that in a few words for the chip, and all of it for the tooltip, which begins with the name in full. */
function fitOf(view: SavedView, scene: Scene, scans: readonly { id: string }[] | null): { gone: ReturnType<typeof viewGone>; quiet: string; title: string } {
  const parts = scene.parts.filter((part) => part.layout === view.layout)
  const gone = viewGone(view, { layouts: scene.layouts, parts: parts.map((part) => part.name), boxes: parts, ...(scans ? { scans: scans.map((scan) => scan.id) } : {}) })
  const lost = [...gone.parts, ...gone.scans]
  const title = gone.layout
    ? [view.name, `Layout ${view.layout} is no longer in the model`].join(' · ')
    : [
        view.name,
        holdsText(view),
        view.note,
        lost.length > 0 ? `${lost.join(', ')} ${lost.length === 1 ? 'is' : 'are'} no longer there: passed over` : '',
        gone.explode ? (gone.explode === 'one part' ? 'one part now: drawn together' : 'its parts share a centre now: drawn together') : ''
      ]
        .filter(Boolean)
        .join(' · ')
  return { gone, quiet: goneText(gone), title }
}

/**
 * A menu under a chip. The focus goes into it when it opens; the arrows, Home and End move among what can be
 * chosen; Escape and Tab put it away, and the focus goes back to what opened it (`close`).
 */
function Menu({ label, side, className, close, children }: { label: string; side: Side; className?: string; close: () => void; children: ReactNode }) {
  const menu = useRef<HTMLDivElement>(null)
  const items = (): HTMLElement[] => [...(menu.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not([aria-disabled="true"])') ?? [])]

  useEffect(() => {
    items()[0]?.focus({ preventScroll: true })
  }, [])

  const onKeyDown = (e: ReactKeyboardEvent): void => {
    const all = items()
    const at = all.indexOf(document.activeElement as HTMLElement)
    const end = which(e, 'menu.ends')
    if (pressed(e, 'menu.close')) close()
    else if (pressed(e, 'menu.next')) all[(at + 1) % all.length]?.focus()
    else if (pressed(e, 'menu.previous')) all[(at - 1 + all.length) % all.length]?.focus()
    else if (end === 0) all[0]?.focus()
    else if (end === 1) all.at(-1)?.focus()
    else return
    // The menu's own: neither the pane (Escape puts a tool down) nor the view bar (the arrows) is meant.
    e.preventDefault()
    e.stopPropagation()
  }

  return (
    <div ref={menu} className={`menu view-popover${className ? ` ${className}` : ''}`} data-side={side} role="menu" aria-label={label} onKeyDown={onKeyDown}>
      {children}
    </div>
  )
}

/**
 * One field for the name of a view, under what opened it: Enter keeps, Escape puts it away, and a name that will
 * not do is said under the field, where it was typed. `done` is told the name that was kept, or nothing.
 */
function NameField({ label, first, side, refusal, keep, done }: { label: string | ((name: string) => string); first: string; side: Side; refusal: (name: string) => string | null; keep: (name: string) => string | null; done: (kept?: string) => void }) {
  const [name, setName] = useState(first)
  const [refused, setRefused] = useState<string | null>(null)
  const field = useRef<HTMLInputElement>(null)

  useEffect(() => {
    field.current?.focus({ preventScroll: true })
    field.current?.select()
  }, [])

  const submit = (): void => {
    const why = refusal(name) ?? keep(name)
    if (why === null) done(findView(store.getState().views, name)?.name)
    else setRefused(why)
  }

  return (
    <form
      className="menu view-popover view-name-card"
      data-side={side}
      role="dialog"
      aria-label={typeof label === 'string' ? `${label} the view` : 'Save the view on screen'}
      onSubmit={(e) => {
        e.preventDefault()
        submit()
      }}
      onKeyDown={(e) => {
        if (!pressed(e, 'sheet.close')) return
        e.preventDefault()
        e.stopPropagation()
        done()
      }}
    >
      <div className="view-name-row">
        <input
          ref={field}
          className="view-name-field"
          type="text"
          aria-label="Name of the view"
          aria-invalid={refused !== null}
          placeholder="Name of the view"
          maxLength={MAX_VIEW_NAME}
          spellCheck={false}
          value={name}
          onChange={(e) => {
            setName(e.target.value)
            setRefused(null)
          }}
        />
        <button type="submit" className="button">
          {typeof label === 'string' ? label : label(name)}
        </button>
      </div>
      {refused !== null && (
        <p className="view-refusal" role="alert">
          {numbered(refused)}
        </p>
      )}
    </form>
  )
}

function DotsIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <circle cx="3.5" cy="8" r="1.25" />
      <circle cx="8" cy="8" r="1.25" />
      <circle cx="12.5" cy="8" r="1.25" />
    </svg>
  )
}
