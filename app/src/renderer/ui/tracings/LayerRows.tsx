import { useState } from 'react'
import { count } from '../../../shared/format'
import { pressed } from '../../../shared/keys'
import { LAYER_COLOURS, MAX_LAYER_NAME, MOST_LAYERS, type Layer, type LayerColour } from '../../../shared/tracings'
import { giveKeysBack } from '../typing'
import { EyeIcon } from '../Layers'

// The layers of a tracing as rows in its panel: the colour, the name, how many shapes, `by Claude` on the agent's, a toggle to
// hide or show any of them, Remove on the person's own only, and the one the person traces into. "Add layer" names a new layer of
// the person's and picks its colour. Pure, so that it is drawn the same from any state: what is done goes out by callbacks.

export interface LayerRowsProps {
  layers: readonly Layer[]
  /** The person's layer that the Trace tool puts shapes into; null for none. */
  into: number | null
  onInto?: (id: number) => void
  onHide?: (id: number, hidden: boolean) => void
  onRemove?: (id: number) => void
  onAdd?: (name: string, colour: LayerColour) => void
  /** The layer the person removed last, which Undo puts back. */
  removed?: { name: string } | null
  onUndo?: () => void
  /** The form for a new layer is open from the start (a test, or a person with no layer yet). */
  startAdding?: boolean
}

const shapesText = (layer: Layer): string => (layer.shapes.length === 0 ? 'no shapes' : `${count(layer.shapes.length)} ${layer.shapes.length === 1 ? 'shape' : 'shapes'}`)

/** Whether a layer of the tracing already has this name, case apart (a tracing's layer names are one each). */
export const nameTaken = (layers: readonly Layer[], name: string): boolean => layers.some((l) => l.name.toLowerCase() === name.trim().toLowerCase())

/** The name and the colour a new layer is offered with: `Layer 1`, `Layer 2`, … the first free, and the first colour no layer has (round again when all eight are taken). */
export function newLayerOffer(layers: readonly Layer[]): { name: string; colour: LayerColour } {
  let n = 1
  while (nameTaken(layers, `Layer ${n}`)) n++
  const used = new Set(layers.map((l) => l.colour))
  const colour = LAYER_COLOURS.find((c) => !used.has(c)) ?? LAYER_COLOURS[layers.length % LAYER_COLOURS.length]
  return { name: `Layer ${n}`, colour }
}

const sentence = (word: string): string => word.charAt(0).toUpperCase() + word.slice(1)

function AddLayer({ layers, onAdd, onClose }: { layers: readonly Layer[]; onAdd?: (name: string, colour: LayerColour) => void; onClose: () => void }) {
  const [offer] = useState(() => newLayerOffer(layers))
  const [colour, setColour] = useState<LayerColour>(offer.colour)
  const [problem, setProblem] = useState<string | null>(null)
  return (
    <form
      className="tr-layer-add"
      onSubmit={(e) => {
        e.preventDefault()
        const name = String(new FormData(e.currentTarget).get('name') ?? '').trim()
        if (name === '') return setProblem('Name the layer')
        if (nameTaken(layers, name)) return setProblem(`A layer is already called ${name}`)
        onAdd?.(name, colour)
        onClose()
      }}
    >
      <input
        className="tr-new-name"
        name="name"
        aria-label="Name of the new layer"
        defaultValue={offer.name}
        maxLength={MAX_LAYER_NAME}
        autoFocus
        onFocus={(e) => e.currentTarget.select()}
        onKeyDown={(e) => {
          if (pressed(e, 'field.leave')) {
            e.preventDefault()
            e.stopPropagation()
            onClose()
            giveKeysBack(e.currentTarget)
          }
        }}
      />
      <div className="tr-colours" role="radiogroup" aria-label="Colour of the new layer">
        {LAYER_COLOURS.map((c) => (
          <button key={c} type="button" data-colour={c} role="radio" aria-checked={c === colour} aria-label={sentence(c)} title={sentence(c)} className={`tr-colour tr-layer-${c}`} onClick={() => setColour(c)} />
        ))}
      </div>
      {problem !== null && (
        <p className="tr-refused" role="status">
          {problem}
        </p>
      )}
      <div className="tr-actions">
        <button type="submit" className="bar-button">
          Add
        </button>
        <button type="button" className="link-button" onClick={onClose}>
          Cancel
        </button>
      </div>
    </form>
  )
}

export function LayerRows({ layers, into, onInto, onHide, onRemove, onAdd, removed, onUndo, startAdding }: LayerRowsProps) {
  const [adding, setAdding] = useState(startAdding === true)
  return (
    <>
      {layers.length === 0 ? (
        <p className="tr-note">No layers yet. Claude's and yours appear here.</p>
      ) : (
        <ul className="tr-layers">
          {layers.map((layer) => {
            const own = layer.by === 'person'
            return (
              <li key={layer.id} className={`tr-layer-row tr-layer-${layer.colour}`} data-layer={layer.id} data-by={layer.by} data-hidden={layer.hidden ? '' : undefined}>
                {own ? (
                  <button type="button" className="tr-swatch-pick" aria-pressed={layer.id === into} aria-label={`Trace into ${layer.name}`} title={layer.id === into ? 'The Trace tool draws into this layer' : 'Trace into this layer'} onClick={() => onInto?.(layer.id)}>
                    <span className="tr-swatch" aria-hidden="true" />
                  </button>
                ) : (
                  <span className="tr-swatch" aria-hidden="true" />
                )}
                <span className="tr-layer-name">{layer.name}</span>
                <span className="tr-layer-said">
                  {shapesText(layer)}
                  {own ? '' : ', by Claude'}
                </span>
                <button type="button" className="icon-button" aria-label={`${layer.hidden ? 'Show' : 'Hide'} layer ${layer.name}`} title={layer.hidden ? 'Show' : 'Hide'} onClick={() => onHide?.(layer.id, layer.hidden !== true)}>
                  <EyeIcon open={layer.hidden !== true} />
                </button>
                {own && (
                  <button type="button" className="icon-button tr-layer-remove" aria-label={`Remove layer ${layer.name}`} title="Remove this layer" onClick={() => onRemove?.(layer.id)}>
                    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" aria-hidden="true">
                      <path d="M4 4l8 8M12 4l-8 8" />
                    </svg>
                  </button>
                )}
              </li>
            )
          })}
        </ul>
      )}
      {removed !== null && removed !== undefined && (
        <p className="tr-undo" role="status">
          {removed.name} removed.{' '}
          <button type="button" className="link-button" onClick={onUndo}>
            Undo
          </button>
        </p>
      )}
      {adding ? (
        <AddLayer layers={layers} onAdd={onAdd} onClose={() => setAdding(false)} />
      ) : (
        <div className="tr-actions">
          <button type="button" className="bar-button" disabled={layers.length >= MOST_LAYERS} title={layers.length >= MOST_LAYERS ? `A tracing holds at most ${MOST_LAYERS} layers` : 'A layer of your own to trace into'} onClick={() => setAdding(true)}>
            Add layer
          </button>
        </div>
      )}
    </>
  )
}
