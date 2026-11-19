import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { CARD_NARROW, VIEWPORT_MIN } from '../renderer/state/column'
import { DOCK_NARROW } from '../renderer/state/dock'
import { drawsControls, frameOptions, MIN_WINDOW, SURFACE } from './frame'

// The window has no native frame (spec 2, "The title bar"): where the platform draws the three controls over the bar
// it is given an overlay of the bar's height; where it does not (Linux), torno draws them itself.

describe('the frame of the window', () => {
  it('cannot be made so narrow that the card and the dock at their defaults leave the view under its minimum', () => {
    expect(MIN_WINDOW).toEqual({ width: 1120, height: 700 })
    expect(MIN_WINDOW.width - CARD_NARROW - DOCK_NARROW).toBeGreaterThanOrEqual(VIEWPORT_MIN)
  })

  it('is hidden, with an overlay of the bar height in the surface colour and --muted, where the platform draws the controls', () => {
    for (const platform of ['win32', 'darwin'] as const) {
      expect(frameOptions(platform, false)).toEqual({
        titleBarStyle: 'hidden',
        titleBarOverlay: { color: '#F1EFEA', symbolColor: '#62666D', height: 40 }
      })
      expect(frameOptions(platform, true)).toEqual({
        titleBarStyle: 'hidden',
        titleBarOverlay: { color: '#1A1C1F', symbolColor: '#9EA3AA', height: 40 }
      })
    }
  })

  it('is hidden with no overlay on Linux, where torno draws the controls', () => {
    for (const dark of [false, true]) {
      const options = frameOptions('linux', dark)
      expect(options.titleBarStyle).toBe('hidden')
      expect(options.titleBarOverlay).toBeUndefined()
    }
  })

  it('says torno draws the controls exactly where no overlay is given', () => {
    for (const platform of ['linux', 'win32', 'darwin', 'freebsd'] as const) {
      expect(drawsControls(platform)).toBe(frameOptions(platform, false).titleBarOverlay === undefined)
    }
    expect(drawsControls('linux')).toBe(true)
    expect(drawsControls('win32')).toBe(false)
  })

  it('holds the surface colours the stylesheet has', () => {
    const tokens = readFileSync(resolve(__dirname, '../renderer/styles/tokens.css'), 'utf8')
    expect(tokens).toContain(`--surface: ${SURFACE.light};`)
    expect(tokens).toContain(`--surface: ${SURFACE.dark};`)
  })
})
