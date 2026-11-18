// The two faces of torno, named once: Instrument Sans for the interface, Martian Mono for every number, ref, file
// name, key cap and code. The stylesheets read them from `--font-ui` and `--font-mono` (`renderer/styles/tokens.css`),
// which carry the same names; what is drawn on a canvas or set in a terminal takes them from here, never a family of
// its own (`fonts.test.ts` holds it).

export const UI_FACE = 'Instrument Sans'
export const MONO_FACE = 'Martian Mono'

/** The stacks, as the stylesheets say them. */
export const UI_STACK = `'${UI_FACE}', system-ui, sans-serif`
export const MONO_STACK = `'${MONO_FACE}', ui-monospace, monospace`

/** A canvas `font` of a face: `canvasFont(12, 500, true)` is `500 12px "Martian Mono", ui-monospace, monospace`. */
export function canvasFont(px: number, weight: 400 | 500 | 600 = 400, mono = false): string {
  return mono ? `${weight} ${px}px "${MONO_FACE}", ui-monospace, monospace` : `${weight} ${px}px "${UI_FACE}", system-ui, sans-serif`
}
