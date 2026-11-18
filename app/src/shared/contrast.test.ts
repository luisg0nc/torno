import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { contrast } from './contrast'
import { LAYER_COLOURS } from './tracings'
import { LAYER_INKS } from './tracingSvg'

it('is the ratio WCAG gives', () => {
  expect(contrast('#000000', '#ffffff')).toBeCloseTo(21, 5)
  expect(contrast('#ffffff', '#ffffff')).toBe(1)
  expect(contrast('#777777', '#ffffff')).toBeCloseTo(4.478, 2)
  expect(contrast('#22252A', '#F1EFEA')).toBeGreaterThan(12)
})

const css = readFileSync(resolve(__dirname, '../renderer/styles/tokens.css'), 'utf8')
const dark = css.indexOf('@media (prefers-color-scheme: dark)')
const tokens = (block: string): Record<string, string> => Object.fromEntries([...block.matchAll(/(--[a-z0-9-]+)\s*:\s*(#[0-9a-fA-F]{6})\s*;/g)].map((m) => [m[1], m[2]]))

/** How far apart two colours are in hue, in degrees: 0 to 180. */
function hueApart(a: string, b: string): number {
  const hue = (hex: string): number => {
    const [r, g, bl] = [1, 3, 5].map((at) => parseInt(hex.slice(at, at + 2), 16) / 255)
    const max = Math.max(r, g, bl)
    const span = max - Math.min(r, g, bl)
    if (span === 0) return 0
    const h = max === r ? (g - bl) / span : max === g ? 2 + (bl - r) / span : 4 + (r - g) / span
    return (h * 60 + 360) % 360
  }
  const d = Math.abs(hue(a) - hue(b))
  return Math.min(d, 360 - d)
}

describe.each([['light', tokens(css.slice(0, dark))], ['dark', { ...tokens(css.slice(0, dark)), ...tokens(css.slice(dark)) }]])('%s', (_theme, t) => {
  it('holds text on the new grounds', () => {
    for (const g of ['--raise', '--warn-wash', '--fail-wash']) {
      expect([g, contrast(t['--ink'], t[g]) >= 7]).toEqual([g, true])
      for (const f of ['--muted', '--accent', '--ok', '--warn', '--fail']) expect([f, g, contrast(t[f], t[g]) >= 4.5]).toEqual([f, g, true])
    }
  })
  it('holds text on the accent, the dye and the marks', () => {
    expect(contrast(t['--on-accent'], t['--accent'])).toBeGreaterThanOrEqual(4.5)
    expect(contrast(t['--on-dye'], t['--dye'])).toBeGreaterThanOrEqual(4.5)
    expect(contrast(t['--on-dye-muted'], t['--dye'])).toBeGreaterThanOrEqual(4.5)
    expect(contrast(t['--on-mark'], t['--user-mark'])).toBeGreaterThanOrEqual(4.5)
    expect(contrast(t['--on-mark'], t['--agent-mark'])).toBeGreaterThanOrEqual(4.5)
    expect(contrast(t['--scribe'], t['--dye'])).toBeGreaterThanOrEqual(3)
    expect(contrast(t['--field-edge'], t['--raise'])).toBeGreaterThanOrEqual(3)
  })
  it('holds the round sign on the solid core of its hatch, and the stripes of the hatch apart from what is between them', () => {
    // `.sign-disc[data-sign="-"]`: 2 px stripes of --user-mark, between them it mixed 70 % toward white; the `−` sits on a core of --user-mark.
    expect(contrast(t['--on-mark'], t['--user-mark'])).toBeGreaterThanOrEqual(4.5)
    const channel = (hex: string, at: number): number => parseInt(hex.slice(at, at + 2), 16)
    const pale = '#' + [1, 3, 5].map((at) => Math.round(0.3 * channel(t['--user-mark'], at) + 0.7 * 255).toString(16).padStart(2, '0')).join('')
    expect(contrast(t['--user-mark'], pale)).toBeGreaterThanOrEqual(2)
    // The plus is on solid --agent-mark.
    expect(contrast(t['--on-mark'], t['--agent-mark'])).toBeGreaterThanOrEqual(4.5)
  })
  it('draws the route and the band as hairlines', () => {
    const r = contrast(t['--route'], t['--panel'])
    expect(r).toBeGreaterThanOrEqual(1.15)
    expect(r).toBeLessThanOrEqual(2)
    const h = contrast(t['--hairline'], t['--raise'])
    expect(h).toBeGreaterThanOrEqual(1.15)
    expect(h).toBeLessThanOrEqual(2)
    expect(contrast(t['--band-edge'], t['--band'])).toBeGreaterThanOrEqual(2)
    expect(contrast(t['--ok'], t['--band'])).toBeGreaterThanOrEqual(3)
    expect(contrast(t['--fail'], t['--band'])).toBeGreaterThanOrEqual(3)
  })
  it('has the dye as the accent\'s hue: the same value in light, a deep blue in dark', () => {
    if (_theme === 'light') expect(t['--dye']).toBe(t['--accent'])
    else expect(t['--dye']).not.toBe(t['--accent'])
  })
  it('reads: ink and muted text on both grounds, the accent on the panel', () => {
    for (const ground of ['--surface', '--panel']) {
      expect(contrast(t['--ink'], t[ground])).toBeGreaterThanOrEqual(7)
      expect(contrast(t['--muted'], t[ground])).toBeGreaterThanOrEqual(4.5)
    }
    expect(contrast(t['--accent'], t['--panel'])).toBeGreaterThanOrEqual(4.5)
  })
  it('reads wherever a colour is text: the verdicts on both grounds, what is chosen on its wash, the primary button, the terminal', () => {
    // A verdict is said in words in its colour (the status line, a chip, a card): text, not only a sign.
    for (const name of ['--ok', '--warn', '--fail']) for (const ground of ['--surface', '--panel']) expect([name, ground, contrast(t[name], t[ground]) >= 4.5]).toEqual([name, ground, true])
    // The row that is chosen is the accent on its wash, and ink on it; the primary button --on-accent on the accent.
    expect(contrast(t['--accent'], t['--accent-wash'])).toBeGreaterThanOrEqual(4.5)
    expect(contrast(t['--ink'], t['--accent-wash'])).toBeGreaterThanOrEqual(7)
    expect(contrast(t['--on-accent'], t['--accent'])).toBeGreaterThanOrEqual(4.5)
    expect(contrast(t['--accent'], t['--surface'])).toBeGreaterThanOrEqual(4.5)
    // A mark's number is --on-mark on the person's red; the three axes are letters beside their fields.
    expect(contrast(t['--on-mark'], t['--user-mark'])).toBeGreaterThanOrEqual(4.5)
    // The agent's is its own colour on the panel, outlined.
    expect(contrast(t['--agent-mark'], t['--panel'])).toBeGreaterThanOrEqual(4.5)
    for (const name of ['--axis-x', '--axis-y', '--axis-z']) expect([name, contrast(t[name], t['--panel']) >= 4.5]).toEqual([name, true])
    // Whatever an agent's CLI writes is text on the panel, in any of the sixteen colours but the dark theme's black, which is the ground's own.
    const ansi = Object.keys(t).filter((name) => name.startsWith('--ansi-'))
    expect(ansi).toHaveLength(16)
    for (const name of ansi) {
      if (_theme === 'dark' && name === '--ansi-black') continue
      expect([name, contrast(t[name], t['--panel']) >= 4.5]).toEqual([name, true])
    }
  })
  it('keeps the two mark colours for marks: a verdict is a colour of its own, to the eye, in both themes', () => {
    // Not by name only: a failing dimension of the person's has a cross beside a chip in their colour, and the
    // two are told apart (1.5:1 at least between a verdict and the mark colour of its hue).
    expect(contrast(t['--fail'], t['--user-mark'])).toBeGreaterThanOrEqual(1.5)
    expect(contrast(t['--ok'], t['--agent-mark'])).toBeGreaterThanOrEqual(1.5)
    expect(t['--user-mark']).not.toBe(t['--agent-mark'])
    // Nor is an axis a mark's colour: X is no red pencil, Y no agent's green.
    for (const axis of ['--axis-x', '--axis-y', '--axis-z']) for (const mark of ['--user-mark', '--agent-mark']) expect([axis, mark, t[axis] === t[mark]]).toEqual([axis, mark, false])
  })
  it('reads on the wash of the row that is chosen or pointed at: muted words and the three verdicts', () => {
    for (const name of ['--muted', '--ok', '--warn', '--fail']) expect([name, contrast(t[name], t['--accent-wash']) >= 4.5]).toEqual([name, true])
  })
  it('reads an edit as a diff: ink and the signs on both washes, and the washes are no mark\'s colour and no verdict\'s', () => {
    // Removed lines are struck through in ink beside a "−" in the muted colour; added ones have a "+": the sign and the strike
    // carry the meaning, the wash only groups. A step of the hairline on the panel, and the accent's wash.
    for (const wash of ['--diff-removed-wash', '--diff-added-wash']) {
      expect([wash, contrast(t['--ink'], t[wash]) >= 7]).toEqual([wash, true])
      expect([wash, contrast(t['--muted'], t[wash]) >= 4.5]).toEqual([wash, true])
    }
    expect(t['--diff-added-wash']).toBe(t['--accent-wash'])
    expect(t['--diff-removed-wash']).not.toBe(t['--panel'])
    // The removed wash lies between the panel and the hairline, as a grey: no hue to take for a mark or a verdict.
    const between = contrast(t['--panel'], t['--diff-removed-wash']) < contrast(t['--panel'], t['--hairline'])
    expect(between).toBe(true)
    const chroma = (hex: string): number => Math.max(...[1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16))) - Math.min(...[1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)))
    expect(chroma(t['--diff-removed-wash'])).toBeLessThanOrEqual(16)
    // The added wash is the accent's blue, 60 degrees from the red and the green of the marks, and from the verdicts.
    for (const other of ['--user-mark', '--agent-mark', '--ok', '--fail']) expect([other, hueApart(t['--diff-added-wash'], t[other]) >= 60]).toEqual([other, true])
  })
  it('draws a mark\'s line on a casing in the panel\'s colour, against which it reads, and which stands off every part', () => {
    // The pair that is adjacent: the line and its casing.
    for (const mark of ['--user-mark', '--agent-mark']) expect([mark, contrast(t[mark], t['--panel']) >= 3]).toEqual([mark, true])
    // The casing against the parts. In dark it is 3:1 against every one of them. In light the parts are pastels
    // on a near-white panel, and no casing in the panel's colour can be 3:1 against them (2.18 to 3.79): it is
    // held to 2:1 there, which is a visible edge, where the bare line was 1.2 to 2.1.
    const parts = Object.keys(t).filter((name) => /^--part-\d$/.test(name))
    expect(parts).toHaveLength(8)
    for (const part of parts) expect([part, contrast(t['--panel'], t[part]) >= (_theme === 'dark' ? 3 : 2)]).toEqual([part, true])
  })
  it('draws the person\'s ink on a picture of the view in a colour of its own, which reads on its casing and on the ground', () => {
    // Drawn, not read: 3:1, as a mark's line is, on its casing in the panel's colour and on the ground.
    for (const ground of ['--panel', '--surface']) expect([ground, contrast(t['--drawing-ink'], t[ground]) >= 3]).toEqual([ground, true])
    // In the same picture as the marks: no mark's colour, nor near one in hue; and no axis's, the accent's or a scan's distance.
    for (const mark of ['--user-mark', '--agent-mark']) expect([mark, hueApart(t['--drawing-ink'], t[mark]) >= 30]).toEqual([mark, true])
    for (const other of ['--axis-x', '--axis-y', '--axis-z', '--accent', '--deviation-near']) expect([other, t['--drawing-ink'] === t[other]]).toEqual([other, false])
  })
  it('shows where a list is scrolled to: the thumb of a scrollbar is 3:1 on the panel and on the ground', () => {
    for (const ground of ['--panel', '--surface']) expect([ground, contrast(t['--scroll-thumb'], t[ground]) >= 3]).toEqual([ground, true])
    expect(contrast(t['--scroll-thumb'], t['--panel'])).toBeLessThan(contrast(t['--muted'], t['--panel']))
  })
  it('tells a field from its ground: the edge of an input is 3:1 on the panel and on the ground', () => {
    for (const ground of ['--panel', '--surface']) expect([ground, contrast(t['--field-edge'], t[ground]) >= 3]).toEqual([ground, true])
    expect(t['--field-edge']).not.toBe(t['--hairline'])
  })
  it('reads what is selected in the terminal: it is set in ink on the selection, whatever colour it had', () => {
    expect(contrast(t['--ink'], t['--term-selection'])).toBeGreaterThanOrEqual(7)
    const pane = readFileSync(resolve(__dirname, '../renderer/ui/SessionPane.tsx'), 'utf8')
    expect(pane).toContain("selectionForeground: token('--ink')")
    // And the dark theme's black, which is the ground's own, is lifted by the terminal itself wherever it is text.
    expect(pane).toContain('minimumContrastRatio: 4.5')
  })
  it('keeps the letters of the triad readable on the ground of a picture, and the three axes apart from the marks', () => {
    for (const name of ['--axis-x', '--axis-y', '--axis-z']) expect([name, contrast(t[name], t['--surface']) >= 4.5]).toEqual([name, true])
  })
  it('is no amber on near black: the warning of the dark theme is an ochre', () => {
    if (_theme === 'dark') expect(t['--warn']).toBe('#CBAA6A')
  })
  it('has eight colours for named sets: 3:1 on the ground, 30 degrees of hue at least from either mark colour, no red or green, each its own', () => {
    const sets = Array.from({ length: 8 }, (_v, n) => `--set-${n + 1}`)
    expect(sets.every((name) => /^#[0-9A-F]{6}$/i.test(t[name] ?? ''))).toBe(true)
    for (const name of sets) {
      expect([name, 'ground', contrast(t[name], t['--surface']) >= 3]).toEqual([name, 'ground', true])
      for (const mark of ['--user-mark', '--agent-mark']) expect([name, mark, hueApart(t[name], t[mark]) >= 30]).toEqual([name, mark, true])
      // No verdict's hue either, which is the mark colour's.
      for (const other of ['--ok', '--fail']) expect([name, other, hueApart(t[name], t[other]) >= 30]).toEqual([name, other, true])
    }
    expect(new Set(sets.map((name) => t[name].toUpperCase())).size).toBe(8)
  })
  it('has eight colours for the layers of a tracing: 3:1 on the paper and the panel, told from the ink, no red or green, each its own', () => {
    const layers = LAYER_COLOURS.map((name) => `--layer-${name}`)
    expect(layers).toHaveLength(8)
    expect(layers.every((name) => /^#[0-9A-F]{6}$/i.test(t[name] ?? ''))).toBe(true)
    for (const name of layers) {
      // A layer is drawn: 3:1 on the sheet it is drawn on, and on the panel its swatch is in.
      for (const ground of ['--surface', '--panel']) expect([name, ground, contrast(t[name], t[ground]) >= 3]).toEqual([name, ground, true])
      // The outline is in ink, and a layer's line over it is told from it.
      expect([name, 'ink', contrast(t[name], t['--ink']) >= 1.5]).toEqual([name, 'ink', true])
      // Red and green are the person's and Claude's: no layer within 30 degrees of hue of either mark colour, or of a verdict's.
      for (const other of ['--user-mark', '--agent-mark', '--ok', '--fail']) expect([name, other, hueApart(t[name], t[other]) >= 30]).toEqual([name, other, true])
    }
    expect(new Set(layers.map((name) => t[name].toUpperCase())).size).toBe(8)
  })
  it('shows its marks and its verdicts on the ground, and keeps its hairlines quiet', () => {
    for (const name of ['--user-mark', '--agent-mark', '--ok', '--warn', '--fail']) expect([name, contrast(t[name], t['--surface']) >= 3]).toEqual([name, true])
    const hairline = contrast(t['--hairline'], t['--surface'])
    expect(hairline).toBeGreaterThanOrEqual(1.15)
    expect(hairline).toBeLessThanOrEqual(2)
  })
})

it('has the light tokens written out where no stylesheet is read, as the stylesheet has them', async () => {
  // The viewport's fallback theme, the sheet a section is drawn on for the agent, the window's ground in main, and the exported page.
  const light = tokens(css.slice(0, dark))
  const night = tokens(css.slice(dark))
  const { LIGHT_THEME } = await import('../renderer/viewport/theme')
  const { SHEET } = await import('../renderer/viewport/sectionDrawing')
  expect({ surface: LIGHT_THEME.surface, hairline: LIGHT_THEME.hairline, ink: LIGHT_THEME.ink, muted: LIGHT_THEME.muted, accent: LIGHT_THEME.accent, panel: LIGHT_THEME.panel, user: LIGHT_THEME.user, agent: LIGHT_THEME.agent }).toEqual({
    surface: light['--surface'],
    hairline: light['--hairline'],
    ink: light['--ink'],
    muted: light['--muted'],
    accent: light['--accent'],
    panel: light['--panel'],
    user: light['--user-mark'],
    agent: light['--agent-mark']
  })
  expect(LIGHT_THEME.sets).toEqual(Array.from({ length: 8 }, (_v, n) => light[`--set-${n + 1}`]))
  expect(Array.from({ length: 8 }, (_v, n) => night[`--set-${n + 1}`])).toHaveLength(8)
  // What a layer's colour is in an exported file, where no stylesheet is: the light token of each, as the sheet is white.
  expect(LAYER_INKS).toEqual(Object.fromEntries(LAYER_COLOURS.map((name) => [name, light[`--layer-${name}`]])))
  // The viewport draws a tracing's layers in the same.
  expect(LIGHT_THEME.layers).toEqual(LAYER_INKS)
  expect(LAYER_COLOURS.map((name) => night[`--layer-${name}`]).every((hex) => /^#[0-9A-F]{6}$/i.test(hex ?? ''))).toBe(true)
  expect(SHEET).toEqual({ paper: light['--surface'], ink: light['--ink'], muted: light['--muted'], hairline: light['--hairline'] })
  const frame = readFileSync(resolve(__dirname, '../main/frame.ts'), 'utf8')
  expect(frame).toContain(`export const SURFACE = { light: '${light['--surface']}', dark: '${night['--surface']}' }`)
  expect(frame).toContain(`const MUTED = { light: '${light['--muted']}', dark: '${night['--muted']}' }`)
  const { AXIS_COLOURS } = await import('../renderer/viewport/overlay')
  expect([...AXIS_COLOURS]).toEqual([light['--axis-x'], light['--axis-y'], light['--axis-z']])
  expect([LIGHT_THEME.axisX, LIGHT_THEME.axisY, LIGHT_THEME.axisZ]).toEqual([...AXIS_COLOURS])
  // The ink of a drawing on the view and its casing, where the stylesheet could not be read.
  const make = readFileSync(resolve(__dirname, '../renderer/ui/drawing/make.ts'), 'utf8')
  expect(make).toContain(`token('--drawing-ink', '${light['--drawing-ink']}')`)
  expect(make).toContain(`token('--panel', '${light['--panel']}')`)
  // The terminal's plain white is the muted grey, in light.
  expect(light['--ansi-white']).toBe(light['--muted'])
  // The redesign's values, as the spec's table has them.
  expect([light['--ink'], light['--muted'], night['--muted'], night['--field-edge']]).toEqual(['#20242B', '#62666D', '#9EA3AA', '#747A82'])
  expect(css).toMatch(/--text-size:\s*13\.5px/)
  expect(css).toMatch(/--text-leading:\s*1\.42/)
})
