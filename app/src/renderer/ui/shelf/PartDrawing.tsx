import { useId } from 'react'
import { layoutPart, type Dim, type DimStyle, type Placed } from '../../state/partDrawing'
import type { ShelfPart } from '../../../shared/shelf'

// The drawing of an opened part: the kernel's section through a panel at its hole, the keep-out, the cutout from above, and the
// four dimensions, each in the line style of the size it measures (`state/partDrawing.ts` lays it out; this only draws). The one
// loud thing on the page, so it is where the care is: a body in the shelf's metal, a panel hatched as a cut material is, the
// keep-out dashed in the accent and nothing else in it that is.

/** A coordinate as a short number: the layout's are in full. */
const r2 = (v: number): number => Math.round(v * 100) / 100

const CLASS: Record<DimStyle, string> = { so: 'dim', plain: 'dim', ck: 'dim me', as: 'dim as', mo: 'dim mo' }

/** A dimension's extension lines, its line, an oblique tick at each end and its words; a checked one has the ring tick after them. */
function Line({ dim, at }: { dim: Dim; at: Placed }) {
  const { line, ext, text, mark } = at
  const ticks = `M${r2(line.x1 - 3)} ${r2(line.y1 + 3)}l6 -6M${r2(line.x2 - 3)} ${r2(line.y2 + 3)}l6 -6`
  return (
    <g className={CLASS[dim.style]} data-dim={dim.kind} data-style={dim.style} data-param={dim.param ?? undefined}>
      {ext.map((e, n) => (
        <path key={n} className="ext" d={`M${r2(e.x1)} ${r2(e.y1)}L${r2(e.x2)} ${r2(e.y2)}`} />
      ))}
      <path d={`M${r2(line.x1)} ${r2(line.y1)}L${r2(line.x2)} ${r2(line.y2)}`} />
      <path className="tk" d={ticks} />
      <text x={r2(text.x)} y={r2(text.y)} textAnchor={text.anchor}>
        {dim.text}
      </text>
      {mark && (
        <g className="okmark" transform={`translate(${r2(mark.x)} ${r2(mark.y)})`}>
          <circle r="6" />
          <path d="M-2.6 .2l1.8 1.8 3.4-3.6" />
        </g>
      )}
    </g>
  )
}

/** What the drawing says in words, for a reader that cannot see it. */
function describe(part: ShelfPart, dims: Dim[]): string {
  const said = dims.map((d) => ({ cutout: `cutout ${d.text}`, above: `${d.text} above the panel`, below: `${d.text} below it`, width: `${d.text} wide` })[d.kind])
  return `${part.name}, through a panel: ${said.join(', ')}`
}

export function PartDrawing({ part }: { part: ShelfPart }) {
  const hatch = useId()
  if (part.error) {
    return (
      <pre className="part-error selectable" role="alert">
        {part.error}
      </pre>
    )
  }
  const layout = layoutPart(part)
  if (!layout) return <p className="part-none">Nothing to draw: the part has no body.</p>
  const { plan } = layout
  return (
    <svg className="part-drawing" viewBox={`0 0 ${layout.width} ${layout.height}`} role="img" aria-label={describe(part, layout.dims)} data-scale={r2(layout.scale)}>
      <defs>
        <pattern id={hatch} width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <path d="M0 0V5" className="hatch" />
        </pattern>
      </defs>
      <g className="panel">
        {layout.panels.map((r, n) => (
          <g key={n}>
            <rect x={r2(r.x)} y={r2(r.y)} width={r2(r.w)} height={r2(r.h)} />
            <rect x={r2(r.x)} y={r2(r.y)} width={r2(r.w)} height={r2(r.h)} fill={`url(#${hatch})`} className="panel-hatch" />
          </g>
        ))}
      </g>
      <text className="plab" x={r2(layout.panelLabel.x)} y={r2(layout.panelLabel.y)}>
        panel
      </text>
      {layout.keep && <path className="keep" d={layout.keep} fillRule="evenodd" />}
      {layout.keepLabel && (
        <text className="klab" x={r2(layout.keepLabel.x)} y={r2(layout.keepLabel.y)}>
          keep clear
        </text>
      )}
      <path className="body" d={layout.body} fillRule="evenodd" />
      {layout.dims.map((d) => (d.side ? <Line key={d.kind} dim={d} at={d.side} /> : null))}
      {plan && (
        <g className="cutplan">
          <text className="plab" x={r2(plan.label.x)} y={r2(plan.label.y)} textAnchor="middle">
            the cutout, from above
          </text>
          <rect className="sheet" x={r2(plan.sheet.x)} y={r2(plan.sheet.y)} width={r2(plan.sheet.w)} height={r2(plan.sheet.h)} rx="3" />
          {plan.keep && <path className="keep" d={plan.keep} fillRule="evenodd" />}
          <path className="hole" d={plan.cutout} fillRule="evenodd" />
          {plan.lines.map((l, n) => (
            <path key={n} className="cl" d={`M${r2(l.x1)} ${r2(l.y1)}L${r2(l.x2)} ${r2(l.y2)}`} />
          ))}
          {layout.dims.map((d) => (d.plan ? <Line key={d.kind} dim={d} at={d.plan} /> : null))}
        </g>
      )}
    </svg>
  )
}

/** What the line styles say, under the drawing. */
export function PartLegend() {
  return (
    <div className="part-legend" aria-label="What the lines say">
      <span>
        <i className="lgd" />
        datasheet, listing, standard
      </span>
      <span>
        <i className="lgd me" />
        <svg className="tick-ok" viewBox="0 0 12 12" aria-hidden="true">
          <circle cx="6" cy="6" r="5.25" fill="none" stroke="currentColor" strokeWidth="1.2" />
          <path d="M3.6 6.2l1.6 1.6 3.2-3.4" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        measured on the part
      </span>
      <span>
        <i className="lgd as" />
        assumed
      </span>
      <span>
        <i className="lgd mo" />
        worked out from the others
      </span>
    </div>
  )
}
