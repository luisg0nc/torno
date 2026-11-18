import { useEffect, useRef, useState } from 'react'
import { pressed } from '../../../shared/keys'
import type { Scene } from '../../../shared/scene'
import { type SavedView, MAX_VIEW_NAME, findView, goneText, holdsText, viewGone, viewNameRefusal } from '../../../shared/views'
import { viewMatches } from '../../state/savedViews'
import { actions, store, useStore } from '../../state/store'
import type { Viewport } from '../../viewport/Viewport'
import { numbered } from '../numbered'
import { pinToBoard } from '../projectBoard/pin'
import { type Fold, compassViews } from './compass'
import { PopMenu } from './PopMenu'

/** The saved views of the project, and the one that is on: the one last put on screen or saved from it, while the screen still shows what it holds. */
export function useSavedViews(): { views: SavedView[]; active: string | null } {
  const views = useStore((s) => s.views)
  const active = useStore((s) => {
    const view = s.activeView === null ? undefined : findView(s.views, s.activeView)
    return view && viewMatches(s, view) ? view.name : null
  })
  return { views, active }
}

/** What is open under the pills: the field a name is typed in (for a new view, or for one that gets another name), the actions of a view, or the list of all the views. */
type Open = { kind: 'save' } | { kind: 'rename'; view: string } | { kind: 'menu'; view: string; deleting: boolean } | { kind: 'list' } | null

/** How long what could not be done stays said under the pills. */
const SAID_FOR_MS = 4000

/**
 * The saved views of the open project, at the foot of the compass: stacked as pills, or folded to one. Stacked, they are the
 * view that is on, the first proposal of the agent's with "Keep" and "Discard", and "+ Save view" with "N more", which opens
 * the list of all of them. Folded (a tool with tags in hand, explode open, or a stack that would meet a tag), one pill
 * "Saved views 5" opens that list, which then holds "Save view" too. A view of a layout the model no longer has stays and
 * cannot be applied; parts and scans a view names that are gone are passed over, and the pill says how many.
 *
 * Applying a view changes how the project is looked at and nothing else: no geometry, no mark, no measurement.
 */
export function SavedViews({ viewport, fold }: { viewport: Viewport; fold: Fold }) {
  const { views, active } = useSavedViews()
  const scene = useStore((s) => s.scene)
  const scans = useStore((s) => (s.scansKnown ? s.scans : null))
  const [open, setOpen] = useState<Open>(null)
  const [said, setSaid] = useState<string | null>(null)
  const stack = useRef<HTMLDivElement>(null)

  // A press anywhere else, or Escape, puts away what is open.
  useEffect(() => {
    if (open === null) return
    const close = (e: Event): void => {
      if (e instanceof KeyboardEvent ? pressed(e, 'menu.close') : !(e.target instanceof Element && e.target.closest('.view-popover, [aria-haspopup]') && stack.current?.contains(e.target))) setOpen(null)
    }
    window.addEventListener('pointerdown', close)
    window.addEventListener('keydown', close)
    return () => {
      window.removeEventListener('pointerdown', close)
      window.removeEventListener('keydown', close)
    }
  }, [open])

  // The pills fold or stand out: what was open under them is put away with the pill it hung from.
  useEffect(() => setOpen(null), [fold])

  // A view that is gone (removed, renamed, another project) has nothing open.
  const named = open !== null && (open.kind === 'menu' || open.kind === 'rename') ? open.view : null
  useEffect(() => {
    if (named !== null && !findView(views, named)) setOpen(null)
  }, [views, named])

  // Stacked, the list is of the views the stack does not show: with none behind it, it is not there.
  const listed = views.length
  useEffect(() => {
    if (fold === 'stack' && open?.kind === 'list' && compassViews(views, active).more === 0) setOpen(null)
  }, [listed, open, views, active, fold])

  useEffect(() => {
    if (said === null) return
    const timer = setTimeout(() => setSaid(null), SAID_FOR_MS)
    return () => clearTimeout(timer)
  }, [said])

  if (!scene || fold === 'none') return null

  /** The pill the focus goes back to when there is nothing better: the one that saves, or the folded one. */
  const HOME = '.view-add, .view-fold'
  const within = (to: string): HTMLElement | null | undefined => stack.current?.querySelector<HTMLElement>(to)
  /** Puts away what is open and gives the focus back to what opened it, or to what is left of it: the keys go on being the compass's, not the tools'. */
  const shut = (to: string): void => {
    setOpen(null)
    // Once what was open is gone from the page.
    requestAnimationFrame(() => (within(to) ?? within(HOME))?.focus({ preventScroll: true }))
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
  /** The focus, once the button that was pressed is gone from the page: on the first of these there is, else on the pill that saves. */
  const focusOn = (...to: string[]): void => {
    requestAnimationFrame(() => {
      const found = to.map((one) => within(one)).find((one) => one)
      ;(found ?? within(HOME))?.focus({ preventScroll: true })
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

  const { shown, more } = compassViews(views, active)

  /** What hangs from a view's pill, or from the pill that holds the list when the view has none: its actions, the question before it is deleted, the field for another name. */
  const popups = (view: SavedView) => {
    const menu = open?.kind === 'menu' && open.view === view.name ? open : null
    const renaming = open?.kind === 'rename' && open.view === view.name ? open : null
    return (
      <>
          {menu && !menu.deleting && (
            <PopMenu label={`Actions for ${view.name}`} close={() => shut(actionsOf(view.name))}>
              <button type="button" role="menuitem" className="menu-item" onClick={() => setOpen({ kind: 'rename', view: view.name })}>
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
            </PopMenu>
          )}
          {menu?.deleting && (
            <div
              className="menu view-popover view-confirm"
              data-side="right"
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
                    shut(HOME)
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
              refusal={(name) => viewNameRefusal(name, store.getState().views, 'user', view.name)}
              keep={(name) => actions.renameView(view.name, name)}
              done={(name) => shut(actionsOf(name ?? view.name))}
            />
          )}
      </>
    )
  }
  /** The popups of a view the stack does not show, which was reached from the list: they hang from the pill that holds the list. */
  const unshown = named !== null && !shown.some((view) => view.name === named) ? findView(views, named) : undefined

  const saveField = open?.kind === 'save' && (
    <NameField
      label={(name) => (findView(views, name) ? 'Replace' : 'Save')}
      first=""
      refusal={(name) => viewNameRefusal(name, store.getState().views, 'user')}
      // Where the camera is going, when it is on its way: not a camera in flight.
      keep={(name) => actions.saveView(name, viewport.cameraGoal())}
      done={() => shut(HOME)}
    />
  )

  const list = open?.kind === 'list' && (
    <PopMenu label="Every saved view" className="view-list" close={() => shut('.view-list-button')}>
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
            {!view.proposed && (
              <button type="button" role="menuitem" className="view-act view-more" data-actions={view.name} aria-label={`Actions for ${view.name}`} title="Rename, update, pin to the board or delete" onClick={() => setOpen({ kind: 'menu', view: view.name, deleting: false })}>
                <DotsIcon />
              </button>
            )}
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
      {fold === 'pill' && (
        <button type="button" role="menuitem" className="menu-item view-save-row" title="Keep what is on screen under a name: camera, layout, parts, section or explode, scans" onClick={() => setOpen({ kind: 'save' })}>
          + Save view
        </button>
      )}
    </PopMenu>
  )

  return (
    <div className="viewstrip" role="group" aria-label="Saved views" ref={stack}>
      {fold === 'pill' ? (
        <div className="view-item view-item-fold">
          <button
            type="button"
            className="view-chip view-list-button view-fold"
            aria-haspopup="menu"
            aria-expanded={open?.kind === 'list'}
            title="Every saved view, and the way to save one"
            onClick={() => setOpen(open?.kind === 'list' ? null : { kind: 'list' })}
          >
            Saved views{views.length > 0 && ' '}{views.length > 0 && <span className="num">{views.length}</span>}
          </button>
          {list}
          {saveField}
          {unshown && popups(unshown)}
        </div>
      ) : (
        <>
          {shown.map((view) => {
            const fits = fitOf(view, scene, scans)
            const menu = open?.kind === 'menu' && open.view === view.name ? open : null
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
                  {view.proposed && <span className="view-note view-proposed">proposed</span>}
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
                    onClick={() => setOpen(menu ? null : { kind: 'menu', view: view.name, deleting: false })}
                  >
                    <DotsIcon />
                  </button>
                )}
                {popups(view)}
              </div>
            )
          })}
          <div className="view-item view-item-add">
            <button type="button" className="view-chip view-add" aria-haspopup="dialog" aria-expanded={open?.kind === 'save'} title="Keep what is on screen under a name: camera, layout, parts, section or explode, scans" onClick={() => setOpen(open?.kind === 'save' ? null : { kind: 'save' })}>
              + Save view
            </button>
            {more > 0 && (
              <button type="button" className="view-chip view-list-button" aria-haspopup="menu" aria-expanded={open?.kind === 'list'} title="Every saved view" onClick={() => setOpen(open?.kind === 'list' ? null : { kind: 'list' })}>
                <span className="num">{more}</span> more
              </button>
            )}
            {list}
            {saveField}
            {unshown && popups(unshown)}
          </div>
        </>
      )}
      {said !== null && (
        <p className="viewstrip-said" role="status">
          <span className="view-refusal">{numbered(said)}</span>
        </p>
      )}
    </div>
  )
}

/** How a view fits the model as it is: what of it is gone, that in a few words for the pill, and all of it for the tooltip, which begins with the name in full. */
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
 * One field for the name of a view, under what opened it: Enter keeps, Escape puts it away, and a name that will
 * not do is said under the field, where it was typed. `done` is told the name that was kept, or nothing.
 */
function NameField({ label, first, refusal, keep, done }: { label: string | ((name: string) => string); first: string; refusal: (name: string) => string | null; keep: (name: string) => string | null; done: (kept?: string) => void }) {
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
      data-side="right"
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
