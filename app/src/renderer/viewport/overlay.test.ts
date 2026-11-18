import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MONO_FACE, UI_FACE } from '../../shared/fonts'
import { DEVIATION_RAMP, BAR_SIDE, NARROW_BELOW, PERSPECTIVE_NOTE, SCALE_BAR_MAX, SCREEN_UNIT, TRIAD_CLEAR, chipSize, drawDeviationLegend, drawFrameCues, drawLabels, drawOverlay, bindPane, onPaneDrawn, paneRect, projectToPane, type LabelStyle } from './overlay'

/** A canvas context that keeps what was drawn on it: each text with how opaque it was, and each stroke with its colour and its moves. */
function recorder() {
  const texts: Array<{ text: string; alpha: number }> = []
  const strokes: Array<{ colour: string; moves: number; lines: number }> = []
  const fills: Array<{ colour: string; alpha: number }> = []
  let moves = 0
  let lines = 0
  const ctx = {
    globalAlpha: 1,
    strokeStyle: '',
    fillStyle: '',
    font: '',
    lineWidth: 1,
    save: () => {},
    restore: () => {},
    measureText: (text: string) => ({ width: 7 * text.length }),
    beginPath: () => {
      moves = 0
      lines = 0
    },
    moveTo: () => void (moves += 1),
    lineTo: () => void (lines += 1),
    roundRect: () => {},
    arc: () => {},
    clip: () => {},
    fillRect: () => {},
    fill: () => void fills.push({ colour: ctx.fillStyle, alpha: ctx.globalAlpha }),
    stroke: () => void strokes.push({ colour: ctx.strokeStyle, moves, lines }),
    fillText: (text: string) => {
      texts.push({ text, alpha: ctx.globalAlpha })
      fills.push({ colour: ctx.fillStyle, alpha: ctx.globalAlpha })
    }
  }
  return { ctx: ctx as unknown as CanvasRenderingContext2D, texts, strokes, fills }
}

const STYLE: LabelStyle = { user: '#cf3f2c', agent: '#2b8a5c', paper: '#ffffff', surface: '#f4f4f2', ink: '#1c1d1f', fail: '#c0392b', ok: '#2b8a5c' }
const label = (value: { text: string; verdict?: 'pass' | 'fail'; stale?: true; off?: string } | undefined) => ({ id: 'M1', text: 'M1', author: 'user' as const, x: 100, y: 100, visible: true, box: { x: 100, y: 90, w: 90, h: 17 }, value })

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('the ring of a chip', () => {
  const ringed = (active: string | null, hovered: string | null) => {
    const { ctx, fills } = recorder()
    drawLabels(ctx, [label(undefined)], STYLE, 1, active, hovered)
    return fills.filter((f) => f.colour === STYLE.ink)
  }

  it('is in ink round the active mark, and fainter round the one pointed at; none round any other', () => {
    expect(ringed(null, null)).toEqual([])
    expect(ringed('M1', null)).toEqual([{ colour: STYLE.ink, alpha: 1 }])
    const hovered = ringed(null, 'M1')
    expect(hovered).toHaveLength(1)
    expect(hovered[0].alpha).toBeGreaterThan(0)
    expect(hovered[0].alpha).toBeLessThan(1)
    // The active one keeps its own ring while it is pointed at.
    expect(ringed('M1', 'M1')).toEqual([{ colour: STYLE.ink, alpha: 1 }])
    expect(ringed('M2', 'M3')).toEqual([])
  })
})

describe('the round sign beside a chip', () => {
  it('makes room for the disc, 18 px and its gap, for a mark with a sign and for none without one', () => {
    const size = chipSize(recorder().ctx, 1)
    expect(size('M1', undefined, '-').w).toBe(size('M1').w + 21)
    expect(size('M1', { text: '40 mm' }, '+').w).toBe(size('M1', { text: '40 mm' }).w + 21)
  })

  it('draws a plus solid in the agent’s colour and a minus hatched in the person’s, each with its sign, beside the number', () => {
    const want = recorder()
    drawLabels(want.ctx, [{ ...label(undefined), sign: '+' as const, box: { x: 100, y: 90, w: 51, h: 17 } }], STYLE, 1)
    expect(want.texts.map((t) => t.text)).toEqual(['M1', '+'])
    expect(want.fills.some((f) => f.colour === STYLE.agent)).toBe(true)
    const dont = recorder()
    drawLabels(dont.ctx, [{ ...label(undefined), sign: '-' as const, box: { x: 100, y: 90, w: 51, h: 17 } }], STYLE, 1)
    expect(dont.texts.map((t) => t.text)).toEqual(['M1', '−'])
    expect(dont.fills.some((f) => f.colour === STYLE.user)).toBe(true)
    // No sign, no disc: the number alone.
    const plain = recorder()
    drawLabels(plain.ctx, [label(undefined)], STYLE, 1)
    expect(plain.texts.map((t) => t.text)).toEqual(['M1'])
  })
})

describe('the chips of marks not in the review round', () => {
  it('are mixed toward the ground, by colour and never by opacity', () => {
    const { ctx, fills, strokes, texts } = recorder()
    drawLabels(ctx, [label(undefined)], STYLE, 1, null, null, new Set(['M1']))
    expect(fills.filter((f) => f.colour.startsWith('color-mix(')).length).toBeGreaterThan(0)
    expect(strokes.every((s) => s.colour.startsWith('color-mix('))).toBe(true)
    expect(texts.every((t) => t.alpha === 1)).toBe(true)
    expect(fills.every((f) => f.alpha === 1)).toBe(true)
    expect(fills.some((f) => f.colour.includes(STYLE.surface) && f.colour.includes('30%'))).toBe(true)
    // A chip of the round is drawn as ever.
    const round = recorder()
    drawLabels(round.ctx, [label(undefined)], STYLE, 1, null, null, new Set(['M2']))
    expect(round.fills.some((f) => f.colour.startsWith('color-mix('))).toBe(false)
  })
})

describe('the chip of a dimension’s value', () => {
  it('has room for the glyph of its verdict, a tick or a cross, and for none without one', () => {
    const size = chipSize(recorder().ctx, 1)
    const plain = size('M1', { text: '⌀ 8 mm' }).w
    expect(size('M1', { text: '⌀ 8 mm', verdict: 'pass' }).w).toBe(plain + 13)
    expect(size('M1', { text: '⌀ 8 mm', verdict: 'fail' }).w).toBe(plain + 11)
    expect(size('M1', { text: '⌀ 8 mm', stale: true }).w).toBe(plain)
  })

  it('has room for how far a failing one misses, after its cross', () => {
    const size = chipSize(recorder().ctx, 1)
    const failing = size('M3', { text: '40 mm', verdict: 'fail' }).w
    // Seven letters of 7 px, and the gap after the cross.
    expect(size('M3', { text: '40 mm', verdict: 'fail', off: '2 under' }).w).toBe(failing + 7 * 7 + 4)
  })

  it('writes how far a failing one misses after its cross, in the colour of failure', () => {
    const { ctx, texts, fills } = recorder()
    drawLabels(ctx, [label({ text: '40 mm', verdict: 'fail', off: '2 under' })], STYLE, 1)
    expect(texts.map((t) => t.text)).toEqual(['M1', '40 mm', '2 under'])
    expect(fills.at(-1)).toEqual({ colour: STYLE.fail, alpha: 1 })
  })

  it('one that fails has a cross after it, in the colour of failure: the ring alone is the colour of the person’s marks', () => {
    const { ctx, strokes } = recorder()
    drawLabels(ctx, [label({ text: '⌀ 8 mm', verdict: 'fail' })], STYLE, 1)
    // Two strokes of a cross: two moves, two lines, drawn at once.
    expect(strokes.filter((s) => s.moves === 2 && s.lines === 2)).toEqual([{ colour: '#c0392b', moves: 2, lines: 2 }])
    const passing = recorder()
    drawLabels(passing.ctx, [label({ text: '⌀ 8 mm', verdict: 'pass' })], STYLE, 1)
    expect(passing.strokes.filter((s) => s.moves === 2)).toEqual([])
    expect(passing.strokes.at(-1)).toEqual({ colour: '#2b8a5c', moves: 1, lines: 2 })
  })

  it('a value of another build is written faint, with neither glyph', () => {
    const { ctx, texts, strokes } = recorder()
    drawLabels(ctx, [label({ text: '⌀ 8 mm', stale: true })], STYLE, 1)
    expect(texts).toEqual([{ text: 'M1', alpha: 1 }, { text: '⌀ 8 mm', alpha: 0.45 }])
    expect(strokes.filter((s) => s.moves > 0)).toEqual([])
    const current = recorder()
    drawLabels(current.ctx, [label({ text: '⌀ 8 mm' })], STYLE, 1)
    expect(current.texts[1]).toEqual({ text: '⌀ 8 mm', alpha: 1 })
  })

  it('reads the colours of the verdicts from the page once, and again when the colours of the labels change', () => {
    let scheme = 'light'
    const read = vi.fn(() => ({ getPropertyValue: (name: string) => `${scheme}${name}` }))
    vi.stubGlobal('document', { documentElement: {} })
    vi.stubGlobal('getComputedStyle', read)
    const { fail: _fail, ok: _ok, ...bare } = STYLE
    const draw = (style: LabelStyle): string => {
      const { ctx, strokes } = recorder()
      drawLabels(ctx, [label({ text: '⌀ 8 mm', verdict: 'fail' })], style, 1)
      return strokes.find((s) => s.moves === 2)!.colour
    }
    expect(draw(bare)).toBe('light--fail')
    expect(draw(bare)).toBe('light--fail')
    expect(read).toHaveBeenCalledTimes(1)
    // The colour scheme changed: the labels are given other colours, and the tokens are read again.
    scheme = 'dark'
    expect(draw({ ...bare, ink: '#eeeeee', paper: '#111111' })).toBe('dark--fail')
    expect(read).toHaveBeenCalledTimes(2)
    // A style that says both is asked nothing of the page.
    expect(draw(STYLE)).toBe('#c0392b')
    expect(read).toHaveBeenCalledTimes(2)
  })
})

describe('the legend of a scan drawn by its distance to a part', () => {
  /** A context that keeps the rectangles filled, each with what it was filled with, the stops of its gradients, and the texts. */
  function sheet() {
    const fills: Array<{ style: unknown; x: number; y: number; w: number; h: number }> = []
    const texts: string[] = []
    const stops: Array<[number, string]> = []
    const gradient = { addColorStop: (at: number, colour: string) => void stops.push([at, colour]) }
    const ctx = {
      fillStyle: '' as unknown,
      strokeStyle: '',
      font: '',
      lineWidth: 1,
      textAlign: '',
      textBaseline: '',
      save: () => {},
      restore: () => {},
      createLinearGradient: (x0: number, _y0: number, x1: number) => Object.assign(gradient, { from: x0, to: x1 }),
      fillRect: (x: number, y: number, w: number, h: number) => void fills.push({ style: ctx.fillStyle, x, y, w, h }),
      strokeText: () => {},
      fillText: (text: string) => void texts.push(text)
    }
    return { ctx: ctx as unknown as CanvasRenderingContext2D, fills, texts, stops, gradient: gradient as typeof gradient & { from: number; to: number } }
  }
  const SHEET = { width: 1280, height: 960, ink: '#22252a', surface: '#f1efea' }

  it('is a ramp 120 px long from the colour at the part to the colour at the range, with 0 and the range, and a swatch of what is inside', () => {
    const { ctx, fills, texts, stops, gradient } = sheet()
    drawDeviationLegend(ctx, SHEET, { near: '#8A4594', far: '#D3D8DF', inside: '#22252A', range: 20, title: 'S1 to tub' })
    expect(stops).toEqual([[0, '#8A4594'], [1, '#D3D8DF']])
    expect(gradient.to - gradient.from).toBe(DEVIATION_RAMP)
    expect(fills.find((fill) => fill.style === gradient)).toMatchObject({ w: 120 })
    expect(fills.filter((fill) => fill.style === '#22252A')).toHaveLength(1)
    expect(texts).toEqual(['S1 to tub', '0', '20 mm', 'inside'])
  })

  it('has no swatch for a part that is no solid, and keeps its share of a larger picture', () => {
    const { ctx, fills, texts, gradient } = sheet()
    drawDeviationLegend(ctx, { ...SHEET, width: 2000, height: 1500 }, { near: '#8A4594', far: '#D3D8DF', inside: null, range: 2.5, title: 'S1 to shell' })
    expect(texts).toEqual(['S1 to shell', '0', '2.5 mm'])
    expect(fills.find((fill) => fill.style === gradient)!.w).toBeCloseTo(187.5, 6)
  })
})

describe('the axes and the scale on the person’s screen', () => {
  /** A context that keeps the arms drawn (each with the colour it was stroked in and where it ends), the dots, the texts with their faces, and the bar's strokes. */
  function frame() {
    const arms: Array<{ colour: string; from: [number, number]; to: [number, number] }> = []
    const dots: Array<{ colour: string; at: [number, number] }> = []
    const texts: Array<{ text: string; font: string; colour: unknown }> = []
    let path: Array<[number, number]> = []
    const ctx = {
      globalAlpha: 1,
      strokeStyle: '',
      fillStyle: '' as unknown,
      font: '',
      lineWidth: 1,
      textAlign: '',
      textBaseline: '',
      lineCap: '',
      lineJoin: '',
      save: () => {},
      restore: () => {},
      beginPath: () => void (path = []),
      moveTo: (x: number, y: number) => void path.push([x, y]),
      lineTo: (x: number, y: number) => void path.push([x, y]),
      arc: (x: number, y: number) => void dots.push({ colour: ctx.fillStyle as string, at: [x, y] }),
      fill: () => {},
      stroke: () => {
        if (path.length === 2) arms.push({ colour: ctx.strokeStyle, from: path[0], to: path[1] })
      },
      strokeText: () => {},
      fillText: (text: string) => void texts.push({ text, font: ctx.font, colour: ctx.fillStyle })
    }
    return { ctx: ctx as unknown as CanvasRenderingContext2D, arms, dots, texts }
  }
  const AXES = ['#9A3350', '#457528', '#2E5FA9']
  const [X, Y, Z] = AXES
  const BASE = { width: 900, height: 600, mmPerPx: null, ink: '#22252a', muted: '#555a63', surface: '#f1efea' }
  const looking = (right: [number, number, number], up: [number, number, number]) => ({ ...BASE, right, up })
  const origin = (unit: number): [number, number] => [26 * unit + 38 * unit, 600 - 26 * unit - 38 * unit]

  it('draws each axis that lies across the view as an arm from the corner, in its own colour, and the one along the view as a dot', () => {
    // Looking along +Y (the front view): X runs right, Z up, Y into the screen.
    const front = frame()
    drawFrameCues(front.ctx, looking([1, 0, 0], [0, 0, 1]), { unit: SCREEN_UNIT })
    const [cx, cy] = origin(SCREEN_UNIT)
    const arm = 38 * SCREEN_UNIT
    expect(front.arms).toHaveLength(2)
    expect(front.arms.find((a) => a.colour === X)).toMatchObject({ from: [cx, cy], to: [cx + arm, cy] })
    expect(front.arms.find((a) => a.colour === Z)).toMatchObject({ from: [cx, cy], to: [cx, cy - arm] })
    expect(front.dots.map((d) => d.colour)).toEqual([Y])
    expect(front.texts.map((t) => t.text).filter((t) => t.length === 1).sort()).toEqual(['X', 'Y', 'Z'])
  })

  it('does so for a camera looking along each axis: the arms are the two the view does not look along', () => {
    const cases: Array<{ along: string; right: [number, number, number]; up: [number, number, number]; arms: string[]; dot: string; right_: string; up_: string }> = [
      // Looking along -X (the right view): Y runs right, Z up.
      { along: 'X', right: [0, 1, 0], up: [0, 0, 1], arms: [Y, Z], dot: X, right_: Y, up_: Z },
      // Looking along -Z (the top view): X runs right, Y up.
      { along: 'Z', right: [1, 0, 0], up: [0, 1, 0], arms: [X, Y], dot: Z, right_: X, up_: Y },
      // Looking along -Y (seen from behind): X runs left, Z up.
      { along: 'Y', right: [-1, 0, 0], up: [0, 0, 1], arms: [X, Z], dot: Y, right_: X, up_: Z }
    ]
    for (const c of cases) {
      const { ctx, arms, dots } = frame()
      drawFrameCues(ctx, looking(c.right, c.up), { unit: 1 })
      const [cx, cy] = origin(1)
      expect(arms.map((a) => a.colour).sort(), c.along).toEqual([...c.arms].sort())
      expect(dots.map((d) => d.colour), c.along).toEqual([c.dot])
      // The arm that runs right ends right of the corner (X seen from behind: left of it), the one that runs up above it.
      const toRight = arms.find((a) => a.colour === c.right_)!
      const toUp = arms.find((a) => a.colour === c.up_)!
      if (c.along === 'Y') expect(toRight.to[0]).toBeLessThan(cx)
      else expect(toRight.to[0]).toBeGreaterThan(cx)
      expect(toUp.to[1]).toBeLessThan(cy)
    }
  })

  it('takes the axes from the stylesheet when it is given them, and the light theme’s when not', () => {
    const given = frame()
    drawFrameCues(given.ctx, { ...looking([1, 0, 0], [0, 0, 1]), axes: ['#aa0001', '#00aa02', '#0003aa'] }, { unit: 1 })
    expect(given.arms.map((a) => a.colour).sort()).toEqual(['#0003aa', '#aa0001'])
    expect(given.dots.map((d) => d.colour)).toEqual(['#00aa02'])
  })

  it('in perspective says the grid’s step, in the monospace face; in an orthographic view draws the scale bar instead', () => {
    const persp = frame()
    drawFrameCues(persp.ctx, looking([1, 0, 0], [0, 0, 1]), { unit: SCREEN_UNIT, gridStep: 5 })
    const step = persp.texts.find((t) => t.text === 'grid 5 mm')
    expect(step?.font).toContain(MONO_FACE)
    expect(persp.texts.map((t) => t.text)).not.toContain(PERSPECTIVE_NOTE)

    const small = frame()
    drawFrameCues(small.ctx, looking([1, 0, 0], [0, 0, 1]), { unit: SCREEN_UNIT, gridStep: 0.5 })
    expect(small.texts.map((t) => t.text)).toContain('grid 0.5 mm')

    const ortho = frame()
    drawFrameCues(ortho.ctx, { ...looking([1, 0, 0], [0, 0, 1]), mmPerPx: 0.25 }, { unit: SCREEN_UNIT, gridStep: 5 })
    // 0.25 mm a pixel and a quarter of 900 px at most: 50 mm.
    expect(ortho.texts.map((t) => t.text)).toContain('50 mm')
    expect(ortho.texts.map((t) => t.text).some((t) => t.startsWith('grid'))).toBe(false)
  })

  it('leaves the note of a picture as it is: no grid, a note in the face of text', () => {
    const { ctx, texts } = frame()
    drawOverlay(ctx, looking([1, 0, 0], [0, 0, 1]))
    expect(texts.map((t) => t.text)).toContain(PERSPECTIVE_NOTE)
    expect(texts.find((t) => t.text === PERSPECTIVE_NOTE)?.font).toContain(UI_FACE)
  })

  it('keeps the strip of the Measure tool and the bars at the bottom clear of the triad and the scale: the stylesheet’s sizes are these', () => {
    const layout = readFileSync(resolve(__dirname, '../styles/layout.css'), 'utf8')
    expect(layout).toContain(`--triad-clear: ${TRIAD_CLEAR}px;`)
    expect(layout).toContain(`--bar-side: ${BAR_SIDE}px;`)
    // The triad's corner, its arms, the letter beyond the tip of the longest and half the letter's height.
    expect(TRIAD_CLEAR).toBeGreaterThanOrEqual(Math.ceil((26 + 2 * 38 + 11 + 6) * SCREEN_UNIT))
    // The bars stand in from the side by as much as the triad reaches across (its corner, its arm, its letter and half of it), and the scale bar.
    expect(BAR_SIDE).toBeGreaterThanOrEqual(Math.ceil((26 + 2 * 38 + 11 + 6) * SCREEN_UNIT))
    expect(BAR_SIDE).toBeGreaterThanOrEqual(Math.ceil(26 * SCREEN_UNIT + SCALE_BAR_MAX))
    // Every bar at the bottom is held in from both sides, and lifted by the same amount where the view is narrow.
    for (const sheet of ['overlays.css', 'align.css', 'regions.css']) {
      const css = readFileSync(resolve(__dirname, '../styles', sheet), 'utf8')
      expect(css, sheet).not.toMatch(/bottom: (var\(--space-3\)|calc\(var\(--space-3\) \+ \d+px\));/)
      expect(css, sheet).not.toContain('2 * var(--space-3)')
    }
    expect(layout).toMatch(/\.viewport-pane\[data-narrow\] \{[^}]*--bar-floor: calc\(var\(--triad-clear\) \+ var\(--space-1\)\)/)
    // The hint at the foot of the view stands on that floor and the bars stand above it, a row (40 px, as the bars stand over one another) up: the line never meets a bar.
    expect(layout).toContain('--bar-lift: calc(var(--bar-floor) + var(--hint-lift));')
    expect(layout).toMatch(/\.viewport-pane:has\(\.view-hint\) \{[^}]*--hint-lift: 40px/)
    expect(readFileSync(resolve(__dirname, '../styles/caption.css'), 'utf8')).toMatch(/\.view-hints \{[^}]*bottom: calc\(var\(--space-3\) \+ var\(--bar-floor\)\)/)
    // Where the view is as wide as the widest bar and both sides, the bars are not lifted.
    expect(NARROW_BELOW).toBe(560 + 2 * BAR_SIDE)
  })

  it('draws the scale bar no longer than the screen allows, and a picture’s a quarter of its width', () => {
    const wide = frame()
    drawFrameCues(wide.ctx, { ...looking([1, 0, 0], [0, 0, 1]), width: 2000, mmPerPx: 0.25 }, { unit: SCREEN_UNIT, barMax: SCALE_BAR_MAX })
    // 100 px at 0.25 mm: 25 mm, 20 at most, not the 100 a quarter of 2000 px would allow.
    expect(wide.texts.map((t) => t.text)).toContain('20 mm')
    const picture = frame()
    drawOverlay(picture.ctx, { ...looking([1, 0, 0], [0, 0, 1]), width: 2000, mmPerPx: 0.25 })
    expect(picture.texts.map((t) => t.text)).toContain('100 mm')
  })
})

describe('the pane the tags stand in', () => {
  const pane = (over: Partial<Parameters<typeof bindPane>[0] & object> = {}) => {
    const drawn = new Set<() => void>()
    return {
      pane: { project: (p: readonly [number, number, number]) => (p[2] < 0 ? null : { x: p[0], y: p[1] }), rect: () => ({ left: 10, top: 20, width: 600, height: 400 }), onDrawn: (cb: () => void) => (drawn.add(cb), () => drawn.delete(cb)), ...over },
      draw: () => drawn.forEach((cb) => cb())
    }
  }

  it('projects nowhere with no view, and null behind the camera', () => {
    expect(projectToPane([1, 2, 3])).toBeNull()
    expect(paneRect()).toBeNull()
    const { pane: view } = pane()
    const off = bindPane(view)
    expect(projectToPane([40, 50, 1])).toEqual({ x: 40, y: 50 })
    expect(projectToPane([40, 50, -1])).toBeNull()
    expect(paneRect()).toEqual({ left: 10, top: 20, width: 600, height: 400 })
    off()
    expect(projectToPane([40, 50, 1])).toBeNull()
  })

  it('tells those listening after each frame, whichever came first, and stops when asked', () => {
    const calls: string[] = []
    const stop = onPaneDrawn(() => calls.push('early'))
    const { pane: view, draw } = pane()
    const off = bindPane(view)
    draw()
    expect(calls).toEqual(['early'])
    stop()
    draw()
    expect(calls).toEqual(['early'])
    off()
    draw()
    expect(calls).toEqual(['early'])
  })
})
