import { useMemo } from 'react'
import { actions, layerOf, useStore } from '../state/store'
import { colorFor, colorsByName } from '../../shared/palette'
import { groupsIn, groupVisibility } from '../../shared/groups'
import type { Part, PartGroup } from '../../shared/scene'
import type { LayerSettings } from '../../shared/scenefile'

/**
 * The parts of the layout shown: colour, name, an opacity slider that appears
 * on hover, and a switch for visibility. A setting belongs to the part's name,
 * so it holds in every layout. The model's groups (`groups(p)`) come first, each
 * a header that folds, hides or shows its parts, or shows only them; the parts
 * in no group follow, in the model's order.
 */
export function Layers() {
  const scene = useStore((s) => s.scene)
  const layout = useStore((s) => s.layout)
  const layers = useStore((s) => s.layers)
  const folded = useStore((s) => s.folded)
  // The same assignment as the viewport's, so a swatch matches its part.
  const colors = useMemo(() => colorsByName((scene?.parts ?? []).map((p) => p.name)), [scene])
  if (!scene) return null
  const parts = scene.parts.filter((p) => p.layout === layout)
  const groups = groupsIn(scene, layout)
  const grouped = new Set(groups.flatMap((g) => g.parts))
  const byName = new Map(parts.map((p) => [p.name, p]))
  const row = (part: Part, inGroup?: string) => <LayerRow key={part.key} part={part} layer={layerOf(layers, part.name)} color={colors.get(part.name)} inGroup={inGroup} />

  return (
    <section className="section layers" aria-label="Layers">
      <h2 className="section-title">Layers</h2>
      {parts.length === 0 && <p className="section-note">This layout has no parts.</p>}
      <ul className="rows">
        {groups.map((group) => {
          const isFolded = folded.includes(group.name)
          return [
            <GroupRow key={`group:${group.name}`} group={group} layout={layout} layers={layers} folded={isFolded} />,
            ...(isFolded ? [] : group.parts.map((name) => row(byName.get(name)!, group.name)))
          ]
        })}
        {parts.filter((p) => !grouped.has(p.name)).map((part) => row(part))}
      </ul>
    </section>
  )
}

function GroupRow({ group, layout, layers, folded }: { group: PartGroup; layout: string; layers: Record<string, LayerSettings>; folded: boolean }) {
  const { name, parts } = group
  const seen = groupVisibility(parts, layers)
  return (
    <li className="row layer-group" data-group={name} data-seen={seen} data-folded={folded ? '' : undefined}>
      <button
        type="button"
        className="icon-button layer-fold"
        aria-expanded={!folded}
        aria-label={`${folded ? 'Unfold' : 'Fold'} ${name}`}
        title={folded ? 'Unfold' : 'Fold'}
        onClick={() => actions.setFolded(name, !folded)}
      >
        <ChevronIcon open={!folded} />
      </button>
      <span className="row-name num">{name}</span>
      <span className="layer-count num">{parts.length === 1 ? '1 part' : `${parts.length} parts`}</span>
      <button
        type="button"
        className="icon-button layer-solo"
        aria-label={`Show only ${name}`}
        title="Show only this group"
        onClick={() => actions.soloLayers(layout, parts)}
      >
        <SoloIcon />
      </button>
      <button
        type="button"
        className="icon-button layer-group-eye"
        aria-pressed={seen === 'all' ? true : seen === 'none' ? false : 'mixed'}
        aria-label={`${seen === 'none' ? 'Show' : 'Hide'} ${name}`}
        title={seen === 'none' ? 'Show' : 'Hide'}
        onClick={() => actions.setLayers(parts, { visible: seen === 'none' })}
      >
        <EyeIcon open={seen !== 'none'} />
      </button>
    </li>
  )
}

function LayerRow({ part, layer, color, inGroup }: { part: Part; layer: LayerSettings | undefined; color: string | undefined; inGroup?: string }) {
  const { name } = part
  const visible = layer?.visible !== false
  const opacity = layer?.opacity ?? 1
  return (
    <li className="row layer-row" data-layer={name} data-in-group={inGroup} data-hidden={visible ? undefined : ''}>
      <span className="swatch" style={{ background: layer?.color ?? color ?? colorFor(name, -1) }} aria-hidden="true" />
      <span className="row-name num">{name}</span>
      <input
        type="range"
        className="layer-opacity"
        data-set={opacity < 1 ? '' : undefined}
        min={0.1}
        max={1}
        step={0.05}
        value={opacity}
        aria-label={`Opacity of ${name}`}
        title={`Opacity ${Math.round(opacity * 100)} %`}
        onChange={(e) => actions.setLayer(name, { opacity: Number(e.target.value) })}
      />
      <button
        type="button"
        className="icon-button"
        aria-pressed={visible}
        aria-label={`Show ${name}`}
        title={visible ? 'Hide' : 'Show'}
        onClick={() => actions.setLayer(name, { visible: !visible })}
      >
        <EyeIcon open={visible} />
      </button>
    </li>
  )
}

export function EyeIcon({ open }: { open: boolean }) {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" aria-hidden="true">
      <path d="M1.75 8S4 3.75 8 3.75 14.25 8 14.25 8 12 12.25 8 12.25 1.75 8 1.75 8Z" />
      <circle cx="8" cy="8" r="1.75" />
      {!open && <path d="M3 13 13 3" />}
    </svg>
  )
}

/** A target: show only what it is next to. */
function SoloIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" aria-hidden="true">
      <circle cx="8" cy="8" r="5.25" />
      <circle cx="8" cy="8" r="1.75" />
    </svg>
  )
}

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={open ? 'M4.5 6.25 8 9.75l3.5-3.5' : 'M6.25 4.5 9.75 8l-3.5 3.5'} />
    </svg>
  )
}
