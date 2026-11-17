import * as THREE from 'three'

// The colours the viewport draws in, as the stylesheet has them now.

export interface Theme {
  surface: string
  hairline: string
  ink: string
  muted: string
  accent: string
  agent: string
  user: string
  panel: string
  /** A scan drawn plain. */
  scan: string
  /** The three axes of the gizmo. */
  axisX: string
  axisY: string
  axisZ: string
}

/** The light values of styles/tokens.css, used where no stylesheet is loaded. */
export const LIGHT_THEME: Theme = { surface: '#F1EFEA', hairline: '#DAD6CE', ink: '#22252A', muted: '#646970', accent: '#1D46B8', agent: '#288156', user: '#CF3F2C', panel: '#FAF9F6', scan: '#B4AFA5', axisX: '#9A3350', axisY: '#457528', axisZ: '#2E5FA9' }

/** The theme as the stylesheet says it now; the light one where there is no stylesheet. */
export function themeOf(): Theme {
  const css = typeof document !== 'undefined' ? getComputedStyle(document.documentElement) : null
  const read = (name: string, fallback: string) => css?.getPropertyValue(name).trim() || fallback
  return {
    surface: read('--surface', LIGHT_THEME.surface),
    hairline: read('--hairline', LIGHT_THEME.hairline),
    ink: read('--ink', LIGHT_THEME.ink),
    muted: read('--muted', LIGHT_THEME.muted),
    accent: read('--accent', LIGHT_THEME.accent),
    agent: read('--agent-mark', LIGHT_THEME.agent),
    user: read('--user-mark', LIGHT_THEME.user),
    panel: read('--panel', LIGHT_THEME.panel),
    scan: read('--scan-plain', LIGHT_THEME.scan),
    axisX: read('--axis-x', LIGHT_THEME.axisX),
    axisY: read('--axis-y', LIGHT_THEME.axisY),
    axisZ: read('--axis-z', LIGHT_THEME.axisZ)
  }
}

/** How opaque the parts are drawn while x-ray is on in a sketch: what a stroke inside a part is seen through. Never above a part's own opacity. */
export const XRAY_OPACITY = 0.28

export function markColours(theme: Theme): { user: string; agent: string; reference: string; casing: string; ink: string } {
  // The casing of a mark's lines is the panel's colour, as the border of its chip is.
  return { user: toHex(theme.user), agent: toHex(theme.agent), reference: toHex(theme.muted), casing: toHex(theme.panel), ink: toHex(theme.ink) }
}

/** Any CSS colour as #RRGGBB. */
export function toHex(color: string): string {
  return `#${new THREE.Color(color).getHexString()}`
}
