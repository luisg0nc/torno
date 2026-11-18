import type { ReactNode } from 'react'
import { number } from '../../shared/format'
import type { Tracing } from '../../shared/tracings'
import { actions, useStore } from '../state/store'
import { boardActions, useBoard } from '../state/board'
import { tracingActions, useTracings } from '../state/tracings'
import { numbered } from './numbered'
import { giveKeysBack } from './typing'
import { EyeIcon } from './Layers'

/** What a plane is called without its axes: `XZ at y = 0.0`. */
const planeName = (t: Pick<Tracing, 'plane'>): string => t.plane.label.replace(/ \(.*$/, '')

/**
 * What is said under the open or shown tracing: how its photo is lined up, in the person's words, and that the drawing follows the
 * build. A photo not lined up, or none, leaves the second sentence alone.
 */
export function tracingLine(t: Pick<Tracing, 'photo'>): string {
  const photo = t.photo
  const redrawn = 'Redrawn at each build.'
  if (photo === undefined || photo.transform === undefined || photo.scale === undefined || photo.scale <= 0) return redrawn
  const n = photo.pairs.length
  return `Photo lined up by ${n} ${n === 1 ? 'point' : 'points'}, ${number(1 / photo.scale)} mm a pixel. ${redrawn}`
}

export interface TracingRowsViewProps {
  tracings: readonly Tracing[]
  /** The tracing open in the Tracing view. */
  open: string | null
  /** The tracings drawn in the 3D view. */
  shown: readonly string[]
  /** The open tracing's panel, which unfolds under its row while the Tracing view shows; null otherwise. */
  panel?: ReactNode
  onOpen?: (id: string, e: { detail: number; currentTarget: HTMLElement }) => void
  onShow?: (id: string, on: boolean) => void
}

/**
 * One row for each tracing, in the Tracings section of the card: its number (`T1`, mono, 500), its name and, at the right, its
 * photo's file, with the eye that draws it in the 3D view or puts it away. A click on the row opens it in the Tracing view. Under
 * the open or shown one stands the line of its line-up, and under the open one, while the Tracing view shows it, its panel.
 * Marks on a tracing are drawn with the marks, whatever is done here; this is the tracing itself, its photo and its layers.
 * Pure, so that it is drawn the same from any state.
 */
export function TracingRowsView({ tracings, open, shown, panel, onOpen, onShow }: TracingRowsViewProps) {
  return (
    <ul className="rows tracing-rows" data-part="tracings">
      {tracings.map((t) => {
        const here = open === t.id
        const on = shown.includes(t.id)
        return (
          <li key={t.id} className="tracing-row" data-tracing={t.id} data-open={here ? '' : undefined} data-shown={on ? '' : undefined}>
            <div className="tracing-row-line">
              <button type="button" className="tracing-row-open" aria-current={here ? 'true' : undefined} title="Open this tracing" onClick={(e) => onOpen?.(t.id, e)}>
                <span className="tracing-id num">{t.id}</span>
                <span className="tracing-name">{t.name === '' ? planeName(t) : t.name}</span>
                {t.photo !== undefined && <span className="tracing-photo">{t.photo.from?.replace(/^.*\//, '') ?? t.photo.file}</span>}
              </button>
              <button type="button" className="icon-button" aria-pressed={on} aria-label={`${on ? 'Hide' : 'Show'} ${t.id} in 3D`} title={on ? 'Hide in 3D' : 'Show in 3D'} onClick={() => onShow?.(t.id, !on)}>
                <EyeIcon open={on} />
              </button>
            </div>
            {(here || on) && <p className="tracing-line">{numbered(tracingLine(t))}</p>}
            {here && panel}
          </li>
        )
      })}
    </ul>
  )
}

/** The rows of the open project's tracings, with the panel of the open one while the Tracing view shows. */
export function TracingRows({ panel }: { panel?: ReactNode }) {
  const shown = useStore((s) => s.tracingsShown)
  const tracings = useTracings((s) => s.file?.tracings)
  const open = useTracings((s) => s.open)
  const inView = useBoard((s) => s.shown === 'tracing')
  if (tracings === undefined || tracings.length === 0) return null
  return (
    <TracingRowsView
      tracings={tracings}
      open={open}
      shown={shown}
      panel={inView ? panel : null}
      onOpen={(id, e) => {
        tracingActions.open(id)
        boardActions.show('tracing')
        if (e.detail > 0) giveKeysBack(e.currentTarget)
      }}
      onShow={actions.setTracingShown}
    />
  )
}
