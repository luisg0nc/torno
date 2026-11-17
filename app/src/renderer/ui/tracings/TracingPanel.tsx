import { useState } from 'react'
import { hint, pressed } from '../../../shared/keys'
import { number } from '../../../shared/format'
import { isExploded } from '../../../shared/explode'
import { tracingName, type LayerColour, type Tracing, type TracingCut } from '../../../shared/tracings'
import { layerOf, actions, useStore } from '../../state/store'
import { nextPartsOf, buildName, traceTarget, tracingActions, useTracings } from '../../state/tracings'
import { useHistory } from '../useHistory'
import { giveKeysBack } from '../typing'
import { LayerRows } from './LayerRows'
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
  tool?: 'select' | 'trace'
  traceMode?: TraceMode
  onTraceMode?: (mode: TraceMode) => void
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
 * The panel of the tracing shown, top left of its sheet: its name, its plane and the build it was redrawn for, "Model outline"
 * with its parts, the layers, and what can be done with it. Pure, so that it is drawn the same from any state.
 */
export function TracingPanelView({ tracing, cut, parts, built, building, spread, refused, onRename, onPart, onRemove, onExport, into, onInto, onHide, onRemoveLayer, onAddLayer, layerRemoved, onUndoLayer, tool, traceMode, onTraceMode }: TracingPanelProps) {
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
          <h2 className="tr-name">{tracingName(tracing)}</h2>
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
          <h3 className="tr-heading">
            Model outline{' '}
            {cut !== null && (
              <span className="tr-exact" data-exact={exactOutline(cut)} title={exactOutline(cut) ? 'Cut from the B-rep by the kernel' : 'The kernel cut it, and could not hold the areas to the B-rep'}>
                {exactOutline(cut) ? 'exact' : 'not exact'}
              </span>
            )}
          </h3>
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
          <h3 className="tr-heading">Layers</h3>
        </div>
        <LayerRows layers={tracing.layers} into={into ?? null} onInto={onInto} onHide={onHide} onRemove={onRemoveLayer} onAdd={onAddLayer} removed={layerRemoved} onUndo={onUndoLayer} />
      </div>

      {tool === 'trace' && (
        <div className="tr-section" data-part="trace">
          <div className="section-head">
            <h3 className="tr-heading">Trace</h3>
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

      {refused !== undefined && refused !== null && (
        <p className="tr-refused" role="status">
          {refused}
        </p>
      )}
      <div className="tr-actions">
        <button type="button" className="bar-button" disabled title="Line the photo up with the outline">
          Line up
        </button>
        <button type="button" className="bar-button" disabled title="Show the tracing in the 3D view">
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

/** The panel of the tracing that is open, with what the window has of it. */
export function TracingPanel() {
  const objectId = useStore((s) => s.objectId)
  const scene = useStore((s) => s.scene)
  const layers = useStore((s) => s.layers)
  const explode = useStore((s) => s.explode)
  const open = useTracings((s) => (s.open === null ? undefined : s.file?.tracings.find((t) => t.id === s.open)))
  const cut = useTracings((s) => (s.open === null ? null : (s.cuts[s.open] ?? null)))
  const building = useTracings((s) => s.building)
  const refused = useTracings((s) => s.refused)
  const into = useTracings((s) => traceTarget(s)?.id ?? null)
  const tool = useTracings((s) => s.tool)
  const traceMode = useTracings((s) => s.trace)
  const layerRemoved = useTracings((s) => (s.layerRemoved !== null && s.layerRemoved.tracing === s.open ? s.layerRemoved.layer : null))
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
    />
  )
}
