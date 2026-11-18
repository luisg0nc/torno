import { useEffect, useMemo, useRef } from 'react'
import { peek } from '../state/agent'
import { actions, layerOf, useStore } from '../state/store'
import { colorFor, colorsOfParts } from '../../shared/palette'
import { groupsIn, groupVisibility } from '../../shared/groups'
import type { Part, PartGroup } from '../../shared/scene'
import type { LayerSettings } from '../../shared/scenefile'
import { DEFECT_MEANS, partDefects } from '../../shared/sanity'
import { type PartMarks, marksByPart } from './layerMarks'
import { giveKeysBack } from './typing'
import { setsOfLayout, useSets } from '../state/sets'
import { NamedSets, SetRowView } from './sets/SetRows'
import { setRows } from './sets/rows'
import { useLitPart } from './card/useLit'

/**
 * The parts of the layout shown: colour, name, an opacity slider that appears
 * on hover, and a switch for visibility. A setting belongs to the part's name,
 * so it holds in every layout. The model's groups (`groups(p)`) come first, each
 * a header that folds, hides or shows its parts, or shows only them; the parts
 * in no group follow, in the model's order. A part whose build says its shape is broken (`partDefects`) has the
 * first defect in a word beside its name, and every one in its title.
 *
 * For a model of ten parts or twenty the row is also the way to the part: the pointer on it lights the part in the
 * view (`peek`, as a mention in the chat does; no highlight of the agent's), a click on its name selects it as a
 * ref, a double click brings it into view, "Show only" shows it alone, and the count of open marks on it lists
 * only those in the Marks panel. When parts are switched off the title says how many, with "Show all". A part the pointer is on in
 * the view (or that a ref points at) has its row lit (`data-lit`: the accent wash and a bar), as its marks' and checks' rows are
 * (`useLitRows`, `litRows`). A part that is off says "hidden" at the right of its row, its swatch at 40 %.
 */
export function Layers() {
  const scene = useStore((s) => s.scene)
  const layout = useStore((s) => s.layout)
  const layers = useStore((s) => s.layers)
  const folded = useStore((s) => s.folded)
  const marks = useStore((s) => s.marks)
  const revision = useStore((s) => (s.scene ? s.revision : 0))
  const onPart = useStore((s) => s.marksOnPart)
  // The same assignment as the viewport's, so a swatch matches its part.
  const colors = useMemo(() => colorsOfParts(scene?.parts ?? []), [scene])
  const named = useSets((s) => s.sets)
  const lit = useLitPart()
  // The named sets of the layout: each under its part when it is of one part, the rest in a section of their own.
  const sets = useMemo(() => setRows(setsOfLayout(named, layout), (scene?.parts ?? []).filter((p) => p.layout === layout), marks), [named, layout, scene, marks])
  if (!scene) return null
  const parts = scene.parts.filter((p) => p.layout === layout)
  const groups = groupsIn(scene, layout)
  const grouped = new Set(groups.flatMap((g) => g.parts))
  const byName = new Map(parts.map((p) => [p.name, p]))
  const counts = marksByPart(marks, layout, revision)
  const hidden = parts.filter((p) => layerOf(layers, p.name)?.visible === false)
  const row = (part: Part, inGroup?: string) => [
    <LayerRow key={part.key} part={part} layout={layout} layer={layerOf(layers, part.name)} color={colors.get(part.name)} inGroup={inGroup} marks={counts.get(part.name)} listed={onPart === part.name} lit={lit === part.name} />,
    ...(sets.byPart[part.name] ?? []).map((set) => <SetRowView key={`set:${set.id}`} row={set} layout={layout} indent />)
  ]

  return (
    <div className="section layers">
      {hidden.length > 0 && (
        <div className="route-tools">
          <span className="layers-hidden">
            <span className="num">{hidden.length}</span> hidden ·{' '}
            <button
              type="button"
              className="link-button"
              title="Switch every part of this layout on"
              onClick={(e) => {
                actions.setLayers(parts.map((p) => p.name), { visible: true })
                if (e.detail > 0) giveKeysBack(e.currentTarget)
              }}
            >
              Show all
            </button>
          </span>
        </div>
      )}
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
      <NamedSets rows={sets.across} layout={layout} />
    </div>
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

function LayerRow({ part, layout, layer, color, inGroup, marks, listed, lit: pointed }: { part: Part; layout: string; layer: LayerSettings | undefined; color: string | undefined; inGroup?: string; marks: PartMarks | undefined; listed: boolean; lit: boolean }) {
  const { name } = part
  const selected = useStore((s) => s.selection.includes(name))
  // The pointer or the keys' focus on the row lights its part in the view; a row that goes while it does takes the light with it.
  const peeking = useRef(false)
  const light = (on: boolean): void => {
    peeking.current = on
    peek(on ? [name] : [])
  }
  useEffect(
    () => () => {
      if (peeking.current) peek([])
    },
    []
  )
  const visible = layer?.visible !== false
  const opacity = layer?.opacity ?? 1
  const defects = partDefects(part)
  return (
    <li
      className="row layer-row"
      data-layer={name}
      data-in-group={inGroup}
      data-hidden={visible ? undefined : ''}
      data-selected={selected ? '' : undefined}
      data-lit={pointed ? '' : undefined}
      onPointerEnter={() => light(true)}
      onPointerLeave={() => light(false)}
      onFocus={(e) => {
        if (e.target.matches(':focus-visible')) light(true)
      }}
      onBlur={(e) => {
        if (!(e.relatedTarget instanceof Node && e.currentTarget.contains(e.relatedTarget))) light(false)
      }}
    >
      <span className="swatch" style={{ background: layer?.color ?? color ?? colorFor(name, -1) }} aria-hidden="true" />
      <button
        type="button"
        className="row-name layer-name num"
        aria-pressed={selected}
        title="Select this part. Double click to bring it into view"
        onClick={(e) => {
          actions.setSelection([name])
          if (e.detail > 0) giveKeysBack(e.currentTarget)
        }}
        onDoubleClick={() => actions.framePart(name)}
      >
        {name}
      </button>
      {part.role === 'reference' && (
        <span className="layer-bought" data-part="reference" title="A bought part, put in the model to see and to check against. It is not printed, weighed or exported as a part">
          bought
        </span>
      )}
      {defects.length > 0 && (
        <span className="layer-defect" data-part="defect" title={defects.map((d) => `${d[0].toUpperCase()}${d.slice(1)}: ${DEFECT_MEANS[d]}`).join('. ')}>
          {defects[0]}
          {defects.length > 1 && (
            <>
              {' '}+<span className="num">{defects.length - 1}</span>
            </>
          )}
        </span>
      )}
      {marks && (
        <button
          type="button"
          className="layer-marks num"
          data-failing={marks.failing ? '' : undefined}
          aria-pressed={listed}
          aria-label={`${marks.open} open ${marks.open === 1 ? 'mark' : 'marks'} on ${name}${marks.failing ? ', one of them a check that fails' : ''}`}
          title={listed ? 'Show the marks on every part' : `${marks.failing ? 'A check that fails is among them. ' : ''}List only the marks on ${name}`}
          onClick={(e) => {
            actions.listMarksOnPart(listed ? null : name)
            if (e.detail > 0) giveKeysBack(e.currentTarget)
          }}
        >
          {marks.open}
        </button>
      )}
      {!visible && <span className="layer-off">hidden</span>}
      <span className="layer-controls">
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
          className="icon-button layer-solo"
          aria-label={`Show only ${name}`}
          title="Show only this part"
          onClick={(e) => {
            actions.soloLayers(layout, [name])
            if (e.detail > 0) giveKeysBack(e.currentTarget)
          }}
        >
          <SoloIcon />
        </button>
        <button
          type="button"
          className="icon-button layer-eye"
          aria-pressed={visible}
          aria-label={`Show ${name}`}
          title={visible ? 'Hide' : 'Show'}
          onClick={() => actions.setLayer(name, { visible: !visible })}
        >
          <EyeIcon open={visible} />
        </button>
      </span>
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
