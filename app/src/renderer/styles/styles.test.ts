import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { expect, it } from 'vitest'
import { CARD_DEFAULT, CARD_NARROW, RAIL_W } from '../state/column'
import { DOCK_DEFAULT, DOCK_NARROW, NARROW_WINDOW } from '../state/dock'

// What the stylesheets are held to beyond their tokens' contrasts (`shared/contrast.test.ts`): nothing in the
// window or in an exported page animates without end, and no text is made fainter than its colour by `opacity`.

/** The stylesheets of the window by area, in the order `app.css` imports them: the order of the cascade. */
const AREAS = [...readFileSync(resolve(__dirname, 'app.css'), 'utf8').matchAll(/^@import '\.\/([a-z-]+\.css)';$/gm)].map((match) => match[1])

const SHEETS: Record<string, string> = { ...Object.fromEntries(AREAS.map((name) => [name, resolve(__dirname, name)])), 'tokens.css': resolve(__dirname, 'tokens.css'), 'page.css': resolve(__dirname, '../../export/page.css') }

it('app.css is the list of the stylesheets by area and nothing else: every one of the folder, once, in the order of the cascade', () => {
  const index = readFileSync(resolve(__dirname, 'app.css'), 'utf8')
  // Nothing but imports: a rule here would come after every area's, whatever it was meant to follow.
  expect(index).toBe(AREAS.map((name) => `@import './${name}';\n`).join(''))
  expect(new Set(AREAS).size).toBe(AREAS.length)
  const there = readdirSync(__dirname).filter((name) => name.endsWith('.css') && name !== 'app.css' && name !== 'tokens.css')
  expect([...AREAS].sort()).toEqual(there.sort())
  // The shell first, and last what was found late and must win over the areas it mends.
  expect([AREAS[0], AREAS.at(-1)]).toEqual(['layout.css', 'late.css'])
})

/** Every rule of a stylesheet, flat: its selector (with the at-rules it is under) and its declarations. Comments are taken out first. */
export function rules(css: string): Array<{ selector: string; body: string }> {
  const found: Array<{ selector: string; body: string }> = []
  const walk = (text: string, under: string): void => {
    let at = 0
    while (at < text.length) {
      const open = text.indexOf('{', at)
      if (open < 0) return
      let depth = 1
      let close = open + 1
      while (close < text.length && depth > 0) {
        if (text[close] === '{') depth += 1
        else if (text[close] === '}') depth -= 1
        close += 1
      }
      const selector = text.slice(at, open).trim()
      const body = text.slice(open + 1, close - 1)
      if (selector.startsWith('@media') || selector.startsWith('@supports') || selector.startsWith('@container')) walk(body, `${under}${selector} `)
      else found.push({ selector: `${under}${selector}`.replace(/\s+/g, ' '), body })
      at = close
    }
  }
  walk(css.replace(/\/\*[\s\S]*?\*\//g, ''), '')
  return found
}

it('reads a stylesheet rule by rule, also under an at-rule', () => {
  expect(rules('/* a */ .a, .b { color: red; }\n@media (x) { .c { opacity: 0.5 } }\n@keyframes k { to { opacity: 0 } }')).toEqual([
    { selector: '.a, .b', body: ' color: red; ' },
    { selector: '@media (x) .c', body: ' opacity: 0.5 ' },
    { selector: '@keyframes k', body: ' to { opacity: 0 } ' }
  ])
})

it('animates nothing without end: a dot that pulses for ever keeps a window drawing that nobody looks at', () => {
  // Found in the hidden window (the sweep's finding 4): 3.4 MB a second while such a dot pulsed. A build's dot
  // beats with the count of its seconds instead (`BuildStatus`), and a session at work has a still one.
  for (const [name, path] of Object.entries(SHEETS)) {
    const css = readFileSync(path, 'utf8')
    for (const { selector, body } of rules(css)) expect([name, selector, /\binfinite\b/.test(body)]).toEqual([name, selector, false])
    // Nor a set of keyframes left for one: every animation there is runs once.
    for (const { selector, body } of rules(css)) {
      const animated = /animation(?:-iteration-count)?\s*:\s*([^;]+)/.exec(body)?.[1] ?? ''
      expect([name, selector, /\b(?:infinite|\d{3,})\b/.test(animated.replace(/\d+m?s/g, ''))]).toEqual([name, selector, false])
    }
  }
})

/** What may be made fainter: something switched off, hidden or not yet there, and things that are no text. */
const MAY_FADE = [
  /:disabled|\[disabled\]|\[data-disabled\]|\[data-hidden\]|\[aria-disabled/,
  // Not text: a swatch of colour, a picture, a dot, a slider's own track.
  /\.swatch\b|\bimg\b|\.status-dot\b|\.dot\b|::-webkit-slider|\.dock-edge\b/
]

it('dims no text by opacity: what is fainter than its token is under the contrast the token was chosen for', () => {
  const found: string[] = []
  for (const [name, path] of Object.entries(SHEETS)) {
    for (const { selector, body } of rules(readFileSync(path, 'utf8'))) {
      if (selector.startsWith('@keyframes')) continue
      for (const match of body.matchAll(/(?:^|[;\s])opacity\s*:\s*([\d.]+)/g)) {
        const value = Number(match[1])
        // Not there at all until it is pointed at (0), or as it is (1): neither is text made faint.
        if (value === 0 || value >= 1) continue
        if (selector.split(',').every((one) => MAY_FADE.some((allowed) => allowed.test(one)))) continue
        found.push(`${name}: ${selector} { opacity: ${match[1]} }`)
      }
    }
  }
  expect(found).toEqual([])
})

/** The declarations of a property in a stylesheet's rules (the shorthand and the four corners' longhands for a radius). */
function declared(css: string, property: RegExp): Array<{ selector: string; value: string }> {
  const found: Array<{ selector: string; value: string }> = []
  for (const { selector, body } of rules(css)) {
    if (selector.startsWith('@keyframes')) continue
    for (const match of body.matchAll(new RegExp(`(?:^|[;\\s{])(${property.source})\\s*:\\s*([^;]+)`, 'g'))) found.push({ selector, value: match[match.length - 1].trim() })
  }
  return found
}

/** A value's words, split at the spaces and slashes that are not inside a function: `3px var(--a) var(--b)` is three. */
function words(value: string): string[] {
  const out: string[] = []
  let depth = 0
  let word = ''
  for (const ch of value) {
    if (ch === '(') depth += 1
    if (ch === ')') depth -= 1
    if ((ch === ' ' || ch === '/') && depth === 0) {
      if (word) out.push(word)
      word = ''
    } else word += ch
  }
  if (word) out.push(word)
  return out
}

/**
 * Hard radii that stay, because the spec states them as a number: the keyboard's key caps (7) and the corners of the person's
 * words in the chat (12, and a small 3 where it begins). Keyed by stylesheet. Everything else is a token or round: an export
 * tile, the frame round the view it previews and the title block of a tracing (drawn in SVG, not here) are not exceptions.
 */
const HARD_RADII: Record<string, string[]> = { 'keys.css': ['7px'], 'chat.css': ['12px', '3px'] }

it('uses radii from the tokens: a radius is var(--radius-*), 0, 50% or inherited, the key caps and the person\'s words in the chat aside', () => {
  const found: string[] = []
  for (const name of AREAS) {
    for (const { selector, value } of declared(readFileSync(SHEETS[name], 'utf8'), /border(?:-(?:top|bottom|start|end)-(?:left|right|start|end))?-radius/)) {
      for (const word of words(value)) {
        if (/^var\(--radius-[a-z]+\)$/.test(word) || word === '0' || word === '50%' || word === 'inherit' || HARD_RADII[name]?.includes(word)) continue
        found.push(`${name}: ${selector} { border-radius: ${value} }`)
      }
    }
  }
  expect(found).toEqual([])
})

it('has one shadow: a box-shadow with a blur over 4 px is var(--float-shadow); insets and rings are free', () => {
  const found: string[] = []
  for (const [name, path] of Object.entries(SHEETS)) {
    if (name === 'tokens.css') continue
    for (const { selector, value } of declared(readFileSync(path, 'utf8'), /box-shadow/)) {
      if (value === 'var(--float-shadow)' || value === 'none') continue
      // Each layer: drop the colours (functions), then the third length is the blur.
      let layers = ['']
      let depth = 0
      for (const ch of value) {
        if (ch === '(') depth += 1
        if (ch === ')') depth -= 1
        if (ch === ',' && depth === 0) layers.push('')
        else layers[layers.length - 1] += ch
      }
      layers = layers.map((layer) => layer.trim())
      for (const layer of layers) {
        if (/\binset\b/.test(layer)) continue
        const lengths = [...layer.replace(/[\w-]+\([^()]*\)/g, '').matchAll(/-?\d*\.?\d+(?:px)?/g)].map((m) => parseFloat(m[0]))
        if ((lengths[2] ?? 0) > 4) found.push(`${name}: ${selector} { box-shadow: ${value} }`)
      }
    }
  }
  expect(found).toEqual([])
})

it('has no --palette-shadow or --radius-palette left: they became --float-shadow and --radius-float, in the window and the export', () => {
  const found: string[] = []
  for (const [name, path] of Object.entries(SHEETS)) if (/--palette-shadow|--radius-palette/.test(readFileSync(path, 'utf8'))) found.push(name)
  expect(found).toEqual([])
  const tokens = readFileSync(SHEETS['tokens.css'], 'utf8')
  for (const token of ['--radius-inline: 4px', '--radius-control: 6px', '--radius-float: 10px', '--radius-sheet: 14px', '--radius-full: 999px', '--title-h: 40px', '--card-w: 296px', '--status-h: 28px']) expect(tokens).toContain(`${token};`)
})

it('keeps the sizes the code repeats in step with the tokens: the rail, the card, the dock, and their narrow defaults', () => {
  const tokens = readFileSync(SHEETS['tokens.css'], 'utf8')
  expect(tokens).toContain(`--rail-w: ${RAIL_W}px;`)
  expect(tokens).toContain(`--card-w: ${CARD_DEFAULT}px;`)
  expect(tokens).toContain('--panel-w: var(--card-w);')
  expect(tokens).toContain(`--dock-w: ${DOCK_DEFAULT}px;`)
  const narrow = tokens.match(new RegExp(`@media \\(max-width: ${NARROW_WINDOW - 1}px\\) \\{([^}]*)\\}`))
  expect(narrow, 'a media query for a window narrower than 1360px').not.toBeNull()
  expect(narrow![1]).toContain(`--card-w: ${CARD_NARROW}px;`)
  expect(narrow![1]).toContain(`--dock-w: ${DOCK_NARROW}px;`)
})

it('the title bar leaves room for the platform\'s own controls: the overlay area where there is one, the traffic lights on macOS', () => {
  const css = readFileSync(resolve(__dirname, 'titlebar.css'), 'utf8')
  const row = rules(css).filter((r) => r.selector === '.title-row')
  const body = row.map((r) => r.body).join('\n')
  // The Window Controls Overlay's area (Windows, and macOS where Electron sets it): what is left of it on each side is padding.
  expect(body).toMatch(/padding-left:\s*max\([^;]*env\(titlebar-area-x/)
  expect(body).toMatch(/padding-right:\s*calc\([^;]*env\(titlebar-area-x[^;]*env\(titlebar-area-width/)
  // macOS draws its lights at the left whatever the env says; Linux draws its own controls at the right and is left as it was.
  const mac = rules(css).find((r) => /\[data-platform=['"]darwin['"]\]\s+\.title-row$/.test(r.selector))
  expect(mac?.body).toMatch(/padding-left:\s*max\(78px/)
  expect(rules(css).some((r) => /data-platform=['"]linux/.test(r.selector))).toBe(false)
})
