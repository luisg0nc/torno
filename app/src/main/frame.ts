import type { BrowserWindowConstructorOptions } from 'electron'

// The window's own background, painted before the renderer's first frame.
// Keep equal to --surface and --muted in src/renderer/styles/tokens.css (shared/contrast.test.ts holds them to it).
export const SURFACE = { light: '#F1EFEA', dark: '#1A1C1F' }
/** The symbols of the platform's controls: --muted of each theme. */
const MUTED = { light: '#62666D', dark: '#9EA3AA' }

/**
 * The least the window may be: the card and the dock at their defaults for a narrow window leave the view its
 * minimum (`VIEWPORT_MIN`, `state/column.ts`: 264 + 384 + 420). `window.test.ts` holds the sum.
 */
export const MIN_WINDOW = { width: 1120, height: 700 }

/** The height of the title bar, which is also the height of the platform's controls. */
export const TITLE_BAR_HEIGHT = 40

/**
 * The window has no native frame. Where the platform draws its own controls over the bar (Windows, macOS) it is given
 * an overlay of the bar's colour and height; where it does not (Linux) the window draws the three controls itself
 * and asks main to minimise, maximise or close (`drawsControls`).
 */
export function frameOptions(
  platform: NodeJS.Platform,
  dark: boolean
): Pick<BrowserWindowConstructorOptions, 'titleBarStyle' | 'titleBarOverlay'> {
  if (platform === 'linux') return { titleBarStyle: 'hidden' }
  const theme = dark ? 'dark' : 'light'
  return {
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: SURFACE[theme], symbolColor: MUTED[theme], height: TITLE_BAR_HEIGHT }
  }
}

/** Whether the window has to draw the three buttons: where no overlay is given. */
export function drawsControls(platform: NodeJS.Platform): boolean {
  return frameOptions(platform, false).titleBarOverlay === undefined
}
