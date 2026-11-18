/** The vise's outline in the logo's 64 px frame, as lines (the jaws and slide, the screw, the handle, the base), and the part it holds. */
export const VISE_OUTLINE: readonly string[] = [
  'M8 42V17a3 3 0 0 1 3-3h11v20h14V14h7a3 3 0 0 1 3 3v25Z',
  'M46 26h6v4h-6z',
  'M52 16a2 2 0 0 1 4 0v24a2 2 0 0 1-4 0z',
  'M12 44h30a2 2 0 0 1 0 4H12a2 2 0 0 1 0-4z'
]
export const VISE_PART = { x: 24, y: 18, width: 10, height: 14, rx: 1 } as const

/** The logo as lines in `--on-dye` and no fill (`Logo scribed`): the same drawing as the icons, scribed. */
export function ScribedLogo() {
  return (
    <svg className="logo logo-scribed" viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" aria-hidden="true">
      {VISE_OUTLINE.map((d) => (
        <path key={d} d={d} />
      ))}
      <rect {...VISE_PART} />
    </svg>
  )
}

/**
 * The vise as it is scribed on the dyed plate (spec, Motion): its outline draws itself in 1.6 s, the dimensions in `--scribe`
 * and their numbers in mono `--on-dye-muted` fade in at 1.1 s, and the part fills at 1.4 s. All of it is CSS on the classes
 * below (`styles/plate.css`); with reduced motion it is shown drawn. The numbers are the drawing's own, in the logo's units.
 * `unknown`: nothing is in the vise yet, so the part is a dashed outline that never fills and its width is `? mm`.
 */
export function ScribedVise({ unknown = false }: { unknown?: boolean }) {
  return (
    <svg className="plate-vise" viewBox="0 0 70 54" aria-hidden="true" data-unknown={unknown ? '' : undefined}>
      <g className="vise-lines">
        {VISE_OUTLINE.map((d) => (
          <path key={d} className="vise-o" d={d} pathLength={1} />
        ))}
        <rect className="vise-o vise-part-line" {...VISE_PART} pathLength={1} />
      </g>
      {!unknown && <rect className="vise-fill" {...VISE_PART} />}
      <g className="vise-dim">
        <path d="M24 11v-3M34 11v-3M24 9.5h10" />
        {!unknown && <path d="M37 18h3M37 32h3M38.5 18v14" />}
        <path d="M8 50.5v-1.5M56 50.5v-1.5M8 49.8h48" />
      </g>
      <g className="vise-text">
        <text x="26.4" y="7.4">
          {unknown ? '? mm' : '10'}
        </text>
        {!unknown && (
          <text x="40.6" y="26">
            14
          </text>
        )}
        <text x="29.5" y="53.6">
          48
        </text>
      </g>
    </svg>
  )
}
