import { useState } from 'react'
import { hint, pressed } from '../../../shared/keys'
import { number } from '../../../shared/format'
import { isExploded } from '../../../shared/explode'
import { tracingName, type LayerColour, type Tracing, type TracingCut } from '../../../shared/tracings'
import { layerOf, actions, useStore } from '../../state/store'
import { boardStore } from '../../state/board'
import { nextPartsOf, buildName, referencePhotos, traceTarget, tracingActions, useTracings, type TracingTool } from '../../state/tracings'
import { useHistory } from '../useHistory'
import { giveKeysBack } from '../typing'
import { LayerRows } from './LayerRows'
import { AddPhoto, PhotoRows } from './PhotoRows'
import { INK_PENS, type InkPen } from './inkTool'
import { TRACE_MODES, type TraceMode } from './traceTool'

export interface TracingPanelProps {
  tracing: Tracing
  /** The outline on the build it was cut on; null while there is none to show. */
  cut: TracingCut | null
  /** The parts offered: those switched on in the model, and any the tracing names. */
  parts: readonly string[]
  /** The build the outline was cut on, as the person names it (`h57`); null with no cut. */
  built: string | null
  building: boolean
  /** The layout is drawn with its parts apart: the tracing is cut where they are not. */
  spread: boolean
  /** Why main refused the last thing, in its words. */
  refused?: string | null
  onRename?: (name: string) => void
  /** A part switched on or off in the tracing. */
  onPart?: (name: string, on: boolean) => void
  onRemove?: () => void
  onExport?: () => void
  /** The tracing is drawn in the 3D view now, and the switch that draws it there or takes it away. */
  shownIn3D?: boolean
  onShowIn3D?: (on: boolean) => void
  /** The person's layer the Trace tool draws into. */
  into?: number | null
  onInto?: (layer: number) => void
  onHide?: (layer: number, hidden: boolean) => void
  onRemoveLayer?: (layer: number) => void
  onAddLayer?: (name: string, colour: LayerColour) => void
  /** The layer the person removed last, which Undo puts back. */
  layerRemoved?: { name: string } | null
  onUndoLayer?: () => void
  /** The tool in hand on the sheet; with Trace, the panel says what it draws and its keys. */
  tool?: TracingTool
  /** The pen Ink draws with. */
  inkPen?: InkPen
  onInkPen?: (pen: InkPen) => void
  traceMode?: TraceMode
  onTraceMode?: (mode: TraceMode) => void
  /** The photo's picture (an object URL), and whether its file is on this computer. */
  photoThumb?: string | null
  photoHere?: boolean
  /** The photos of the project's `reference/`, to take one from. */
  references?: readonly string[]
  /** A photo is being kept: Add photo waits. */
  addingPhoto?: boolean
  onAddPhoto?: () => void
  onReferencePhoto?: (file: string) => void
  /** The fade as the slider moves (the drawing follows), and where it is let go (sent once). */
  onFade?: (fade: number) => void
  onFadeCommit?: (fade: number) => void
  onHidePhoto?: (hidden: boolean) => void
  onLineUp?: () => void
  onSwapPhoto?: () => void
  onRemovePhoto?: () => void
}

/** `1200 mm²`, with `≈` where the kernel's area is not exact; `not cut` for a part the plane does not meet. */
function cutOf(cut: TracingCut, name: string): { said: string; cut: boolean } {
  const part = cut.cut.parts.find((p) => p.part === name)
  if (part === undefined || part.loops.length === 0) return { said: 'not cut', cut: false }
  if (part.area === null || part.open > 0) return { said: 'open: it bounds no area', cut: true }
  return { said: `${part.areaExact ? '' : '≈ '}${number(part.area)} mm²`, cut: true }
}

/** Whether the outline is the kernel's cut of the B-rep all through: every part it cut has an exact area. */
function exactOutline(cut: TracingCut): boolean {
  const cutParts = cut.cut.parts.filter((p) => p.loops.length > 0)
  return cutParts.length > 0 && cutParts.every((p) => p.areaExact)
}

/**
 * The panel of the tracing open, in the Tracings section of the card under its row while the Tracing view shows: its name, its plane and the build it was redrawn for, "Model outline"
 * with its parts, the layers, and what can be done with it. Pure, so that it is drawn the same from any state.
 */
export function TracingPanelView({ tracing, cut, parts, built, building, spread, refused, onRename, onPart, onRemove, onExport, shownIn3D, onShowIn3D, into, onInto, onHide, onRemoveLayer, onAddLayer, layerRemoved, onUndoLayer, tool, traceMode, onTraceMode, inkPen, onInkPen, photoThumb, photoHere, references, addingPhoto, onAddPhoto, onReferencePhoto, onFade, onFadeCommit, onHidePhoto, onLineUp, onSwapPhoto, onRemovePhoto }: TracingPanelProps) {
  const [renaming, setRenaming] = useState(false)
  const drawn = new Set(tracing.parts ?? parts)
  const only = parts.filter((p) => drawn.has(p)).length <= 1
  return (
    <section className="tr-panel" aria-label="Tracing" data-tracing={tracing.id}>
      <header className="tr-panel-head">
        {renaming ? (
          <input
            className="tr-rename"
            aria-label="Name of the tracing"
            defaultValue={tracing.name}
            placeholder={tracingName(tracing)}
            maxLength={80}
            autoFocus
            onBlur={(e) => {
              setRenaming(false)
              if (e.currentTarget.value.trim() !== tracing.name) onRename?.(e.currentTarget.value.trim())
            }}
            onKeyDown={(e) => {
              const keep = pressed(e, 'field.keep')
              if (keep || pressed(e, 'field.leave')) {
                if (!keep) e.currentTarget.value = tracing.name
                e.preventDefault()
                e.stopPropagation()
                e.currentTarget.blur()
                giveKeysBack(e.currentTarget)
              }
            }}
          />
        ) : (
          <h3 className="tr-name">{tracingName(tracing)}</h3>
        )}
        {tracing.name !== '' && <span className="tr-id num">{tracing.id}</span>}
      </header>
      <p className="tr-plane num">{tracing.plane.label}</p>
      <p className="tr-built" data-building={building ? '' : undefined}>
        {cut === null || built === null ? (
          'not drawn yet'
        ) : building ? (
          <>
            of build <span className="num">{built}</span>; building…
          </>
        ) : (
          <>
            redrawn for <span className="num">{built}</span>
          </>
        )}
      </p>
      {tracing.lost !== undefined && (
        <p className="tr-lost" role="status">
          {tracing.lost}
        </p>
      )}

      <div className="tr-section">
        <div className="section-head">
          <h4 className="tr-heading">
            Model outline{' '}
            {cut !== null && (
              <span className="tr-exact" data-exact={exactOutline(cut)} title={exactOutline(cut) ? 'Cut from the B-rep by the kernel' : 'The kernel cut it, and could not hold the areas to the B-rep'}>
                {exactOutline(cut) ? 'exact' : 'not exact'}
              </span>
            )}
          </h4>
        </div>
        <ul className="tr-parts">
          {parts.map((name) => {
            const on = drawn.has(name)
            const found = cut !== null && on ? cutOf(cut, name) : null
            return (
              <li key={name} className="tr-part-row" data-part={name} data-cut={found?.cut}>
                <label className="tr-part">
                  <input type="checkbox" checked={on} disabled={on && only} title={on && only ? 'A tracing draws at least one part' : undefined} onChange={(e) => onPart?.(name, e.currentTarget.checked)} />
                  <span className="tr-part-name">{name}</span>
                </label>
                {found !== null && <span className="tr-part-said num">{found.said}</span>}
              </li>
            )
          })}
        </ul>
        {spread && <p className="tr-note">This layout is shown spread; the tracing is cut unspread</p>}
      </div>

      <div className="tr-section">
        <div className="section-head">
          <h4 className="tr-heading">Layers</h4>
        </div>
        <LayerRows layers={tracing.layers} into={into ?? null} onInto={onInto} onHide={onHide} onRemove={onRemoveLayer} onAdd={onAddLayer} removed={layerRemoved} onUndo={onUndoLayer} />
      </div>

      <div className="tr-section" data-part="photo">
        <div className="section-head">
          <h4 className="tr-heading">Photo</h4>
        </div>
        {tracing.photo === undefined ? (
          <AddPhoto references={references ?? []} busy={addingPhoto} onChoose={onAddPhoto} onReference={onReferencePhoto} />
        ) : (
          <PhotoRows photo={tracing.photo} thumb={photoThumb ?? null} here={photoHere !== false} onFade={onFade} onFadeCommit={onFadeCommit} onHide={onHidePhoto} onLineUp={onLineUp} onSwap={onSwapPhoto} onRemove={onRemovePhoto} />
        )}
      </div>

      {tool === 'trace' && (
        <div className="tr-section" data-part="trace">
          <div className="section-head">
            <h4 className="tr-heading">Trace</h4>
          </div>
          <div className="segmented tr-trace-modes" role="group" aria-label="Trace draws">
            {TRACE_MODES.map((m) => (
              <button key={m.mode} type="button" title={m.title} aria-pressed={m.mode === (traceMode ?? 'line')} onClick={() => onTraceMode?.(m.mode)}>
                {m.label}
              </button>
            ))}
          </div>
          <p className="tr-note">
            Into the layer ringed above. Corners and hole centres of the cut are taken within 10 px; <kbd className="num">{hint('tracing.nosnap')}</kbd> held turns that off. <kbd className="num">{hint('tracing.end')}</kbd> ends a line, <kbd className="num">{hint('tracing.back')}</kbd> takes a point back, <kbd className="num">{hint('tracing.leave')}</kbd> gives it up.
          </p>
        </div>
      )}

      {tool === 'pin' && (
        <div className="tr-section" data-part="pin">
          <div className="section-head">
            <h4 className="tr-heading">Pin</h4>
          </div>
          <p className="tr-note">
            Click a point, then type its note where it is: <kbd className="num">{hint('field.keep')}</kbd> keeps it, <kbd className="num">{hint('tracing.leave')}</kbd> gives it up. On the outline the pin is tied to the face under it; elsewhere it is a point in the plane. A pin goes to Claude with your next prompt, like any mark.
          </p>
        </div>
      )}

      {tool === 'ink' && (
        <div className="tr-section" data-part="ink">
          <div className="section-head">
            <h4 className="tr-heading">Ink</h4>
          </div>
          <div className="segmented tr-trace-modes" role="group" aria-label="Ink draws">
            {INK_PENS.map((p) => (
              <button key={p.pen} type="button" title={p.title} aria-pressed={p.pen === (inkPen ?? 'free')} onClick={() => onInkPen?.(p.pen)}>
                {p.label}
              </button>
            ))}
          </div>
          <p className="tr-note">
            A sketch in this plane, rough by nature. Corners and hole centres of the cut are taken within 10 px; <kbd className="num">{hint('tracing.nosnap')}</kbd> held turns that off. <kbd className="num">{hint('tracing.ink')}</kbd> takes the next pen, <kbd className="num">{hint('tracing.end')}</kbd> ends a point to point line, <kbd className="num">{hint('tracing.undoInk')}</kbd> takes a stroke back. Leaving Ink keeps the sketch.
          </p>
        </div>
      )}

      {refused !== undefined && refused !== null && (
        <p className="tr-refused" role="status">
          {refused}
        </p>
      )}
      <div className="tr-actions">
        <button
          type="button"
          className="bar-button"
          aria-pressed={shownIn3D === true}
          onClick={() => onShowIn3D?.(shownIn3D !== true)}
          title={shownIn3D === true ? 'Take the tracing out of the 3D view' : 'Show the tracing, its layers and its photo in the 3D view, in their plane'}
        >
          Show in 3D
        </button>
        <button type="button" className="bar-button" onClick={onExport} title="Keep a drawing of this tracing at true scale">
          Export
        </button>
        <span className="tr-spacer" />
        <button type="button" className="link-button" onClick={() => setRenaming(true)}>
          Rename
        </button>
        <button type="button" className="link-button" onClick={onRemove}>
          Remove
        </button>
      </div>
    </section>
  )
}

/**
 * The parts the panel offers: those of the layout that are switched on in the model, and any the tracing names (so that one
 * switched off since can be put away). A tracing of every part draws them all, so it offers them all.
 */
export function offeredParts(tracing: Pick<Tracing, 'parts'>, inLayout: readonly string[], switchedOn: (name: string) => boolean): string[] {
  const named = tracing.parts
  return [...inLayout.filter((name) => named === undefined || named.includes(name) || switchedOn(name)), ...(named ?? []).filter((name) => !inLayout.includes(name))]
}

/** The photo's fade as the slider moves: written on the drawing's image, not sent. The change main is told once, where the slider is let go. */
function liveFade(fade: number): void {
  for (const image of document.querySelectorAll('.tr-drawing image[data-photo]')) image.setAttribute('opacity', String(fade))
}

/** The panel of the tracing that is open, with what the window has of it. */
export function TracingPanel() {
  const objectId = useStore((s) => s.objectId)
  const scene = useStore((s) => s.scene)
  const layers = useStore((s) => s.layers)
  const explode = useStore((s) => s.explode)
  const open = useTracings((s) => (s.open === null ? undefined : s.file?.tracings.find((t) => t.id === s.open)))
  const cut = useTracings((s) => (s.open === null ? null : (s.cuts[s.open] ?? null)))
  const shownIn3D = useStore((s) => open !== undefined && s.tracingsShown.includes(open.id))
  const building = useTracings((s) => s.building)
  const refused = useTracings((s) => s.refused)
  const into = useTracings((s) => traceTarget(s)?.id ?? null)
  const tool = useTracings((s) => s.tool)
  const traceMode = useTracings((s) => s.trace)
  const inkPen = useTracings((s) => s.ink)
  const layerRemoved = useTracings((s) => (s.layerRemoved !== null && s.layerRemoved.tracing === s.open ? s.layerRemoved.layer : null))
  const photoEntry = useTracings((s) => (s.open === null ? undefined : s.photos[s.file?.tracings.find((t) => t.id === s.open)?.photo?.file ?? '']))
  const cards = boardStore.getState().board?.cards
  const history = useHistory(cut !== null)
  if (open === undefined) return null
  const inLayout = (scene?.parts ?? []).filter((p) => p.layout === open.layout).map((p) => p.name)
  const offered = offeredParts(open, inLayout, (name) => layerOf(layers, name)?.visible !== false)
  return (
    <TracingPanelView
      tracing={open}
      cut={cut}
      parts={offered}
      built={cut === null ? null : buildName(history, cut.revision)}
      building={building}
      spread={isExploded(explode[open.layout])}
      refused={refused}
      onRename={(name) => void tracingActions.rename(open.id, name)}
      onPart={(name, on) => {
        const next = nextPartsOf(open.parts, inLayout.length > 0 ? inLayout : offered, name, on)
        if (next === 'last') return tracingActions.say('A tracing draws at least one part')
        void tracingActions.setParts(open.id, next)
      }}
      onRemove={() => void tracingActions.remove(open.id)}
      onExport={() => objectId !== null && actions.exportSheet([objectId], open.id)}
      shownIn3D={shownIn3D}
      onShowIn3D={(on) => actions.setTracingShown(open.id, on)}
      into={into}
      onInto={tracingActions.setInto}
      onHide={(layer, hidden) => void tracingActions.hideLayer(layer, hidden)}
      onRemoveLayer={(layer) => void tracingActions.removeLayer(layer)}
      onAddLayer={(name, colour) => void tracingActions.addLayer(name, colour)}
      layerRemoved={layerRemoved}
      onUndoLayer={() => void tracingActions.undoRemoveLayer()}
      tool={tool}
      traceMode={traceMode}
      onTraceMode={tracingActions.setTrace}
      inkPen={inkPen}
      onInkPen={tracingActions.setInk}
      photoThumb={photoEntry !== undefined && 'url' in photoEntry ? photoEntry.url : null}
      photoHere={photoEntry === undefined || 'url' in photoEntry}
      references={referencePhotos(cards ?? [])}
      onAddPhoto={() => void tracingActions.choosePhoto()}
      onReferencePhoto={(file) => void tracingActions.addReference(file)}
      onFade={liveFade}
      onFadeCommit={(fade) => void tracingActions.setFade(fade)}
      onHidePhoto={(hidden) => void tracingActions.setHidden(hidden)}
      onLineUp={tracingActions.startLineUp}
      onSwapPhoto={() => void tracingActions.choosePhoto()}
      onRemovePhoto={() => void tracingActions.removePhoto()}
    />
  )
}
