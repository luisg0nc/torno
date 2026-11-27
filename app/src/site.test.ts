import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { MONO_FACE, UI_FACE } from './shared/fonts'
// @ts-expect-error: a plain .mjs script, without types
import { COPIED } from '../scripts/build-site.mjs'
import { renderPage } from '../scripts/manual-page.mjs'

// The landing page at torno.luisg.me (site/index.html): every local address is a file in git or one that
// app/scripts/build-site.mjs (or build-manual.mjs, for manual/) copies in the Pages build, nothing is loaded
// from another host, and motion is reduced when asked.
const root = resolve(__dirname, '../..')
const site = join(root, 'site')
const html = readFileSync(join(site, 'index.html'), 'utf8')
const css = readFileSync(join(site, 'assets/site.css'), 'utf8')
const copied = COPIED as Record<string, string>

const attrs = (re: RegExp) => [...html.matchAll(re)].map((m) => m[1])
const loaded = [...attrs(/\b(?:src|poster|srcset)="([^"]+)"/g), ...attrs(/<link\b[^>]*\bhref="([^"]+)"/g)]
const links = attrs(/<a\b[^>]*\bhref="([^"]+)"/g)

describe('site/index.html', () => {
  it('loads nothing from another host', () => {
    expect(loaded.filter((u) => /^(https?:)?\/\//.test(u))).toEqual([])
    expect(css).not.toMatch(/url\(\s*['"]?(https?:)?\/\//)
    expect(css).not.toMatch(/@import/)
  })

  it('names only files that are there or that the Pages build copies', () => {
    const local = [...loaded, ...links, ...[...css.matchAll(/url\(([^)]+)\)/g)].map((m) => `assets/${m[1]}`)]
      .filter((u) => !/^([a-z]+:|\/\/|#)/.test(u))
      .map((u) => u.split('#')[0].replace(/\/$/, '/index.html'))
    expect(local.length).toBeGreaterThan(10)
    for (const path of local) {
      if (path.startsWith('manual/')) continue // build-manual.mjs writes manual/index.html
      const there = existsSync(join(site, path)) || path in copied
      expect(there, path).toBe(true)
    }
    for (const from of Object.values(copied)) expect(existsSync(join(root, from)), from).toBe(true)
  })

  it('has no live project, and has the two calls to action', () => {
    expect(links.filter((u) => /demo\//.test(u))).toEqual([])
    expect(links).toContain('#run')
    expect(links.filter((u) => u === 'https://github.com/luisg0nc/torno').length).toBeGreaterThanOrEqual(2)
    expect(html).toContain('Collaborate on GitHub')
    expect(links).toContain('https://github.com/luisg0nc/torno/blob/main/CONTRIBUTING.md')
    expect(links).toContain('https://github.com/luisg0nc/torno/issues')
  })

  it('says who made torno, with a link to luisg.me, near the foot of the page', () => {
    const section = /<section[^>]*\bid="author"[\s\S]*?<\/section>/.exec(html)?.[0] ?? ''
    expect(section).toContain('Luis Goncalves')
    expect(section).toContain('href="https://luisg.me/"')
    expect(html.indexOf('id="author"')).toBeGreaterThan(html.indexOf('id="join"'))
  })

  it('reduces motion when asked', () => {
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)/)
  })
})

// Its palette and faces are the window's (site.css says so): every token it names has the value of tokens.css, in light and in dark,
// and the faces are the window's two, set `swap`, with the body's face preloaded.
describe('site/assets/site.css', () => {
  const tokens = (text: string): Record<string, string> => Object.fromEntries([...text.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]))
  const halves = (text: string): [string, string] => {
    const at = text.indexOf('@media (prefers-color-scheme: dark)')
    return [text.slice(0, at), text.slice(at)]
  }
  const ownToTheSite = new Set(['--grid', '--measure'])

  it('uses the tokens of the window, to the value, in light and in dark', () => {
    const app = halves(readFileSync(join(root, 'app/src/renderer/styles/tokens.css'), 'utf8'))
    const ours = halves(css)
    for (const theme of [0, 1]) {
      const [mine, theirs] = [tokens(ours[theme]), tokens(app[theme])]
      expect(Object.keys(mine).length).toBeGreaterThan(8)
      for (const [name, value] of Object.entries(mine)) if (!ownToTheSite.has(name)) expect([name, value]).toEqual([name, theirs[name]])
    }
  })

  it('sets the window\'s two faces, swapped in, and preloads the body\'s', () => {
    const faces = [...css.matchAll(/@font-face \{([^}]*)\}/g)].map((m) => m[1])
    expect(faces.map((face) => /font-family: '([^']+)'; font-weight: (\d+)/.exec(face)!.slice(1).join(' '))).toEqual([`${UI_FACE} 400`, `${UI_FACE} 500`, `${UI_FACE} 600`, `${MONO_FACE} 400`])
    for (const face of faces) expect(face).toContain('font-display: swap')
    for (const [, file] of css.matchAll(/url\(([^)]+\.woff2)\)/g)) expect(`assets/${file}` in copied, file).toBe(true)
    expect(Object.keys(copied).filter((path) => path.endsWith('.woff2'))).toHaveLength(4)
    expect(attrs(/<link rel="preload" href="([^"]+)" as="font"/g)).toEqual(['assets/fonts/instrument-sans-400.woff2'])
  })
})

// The manual page (manual/index.html, built by build-manual.mjs) takes its look from assets/manual.css: the same values
// and faces, and every address the page names is a file in site/ or one the Pages build copies.
describe('site/assets/manual.css and the manual page', () => {
  const manualCss = readFileSync(join(site, 'assets/manual.css'), 'utf8')
  const tokens = (text: string): Record<string, string> => Object.fromEntries([...text.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]))
  const halves = (text: string): [string, string] => {
    const at = text.indexOf('@media (prefers-color-scheme: dark)')
    return [text.slice(0, at), text.slice(at)]
  }
  const ownToTheSite = new Set(['--measure'])

  it('has the window\'s values, in light and in dark, and the same four faces', () => {
    const app = halves(readFileSync(join(root, 'app/src/renderer/styles/tokens.css'), 'utf8'))
    const ours = halves(manualCss)
    for (const theme of [0, 1]) {
      const [mine, theirs] = [tokens(ours[theme]), tokens(app[theme])]
      expect(Object.keys(mine).length).toBeGreaterThan(8)
      for (const [name, value] of Object.entries(mine)) if (!ownToTheSite.has(name)) expect([name, value]).toEqual([name, theirs[name]])
    }
    const faces = (text: string) => [...text.matchAll(/@font-face \{([^}]*)\}/g)].map((m) => m[1])
    expect(faces(manualCss)).toEqual(faces(css))
    expect(manualCss).not.toMatch(/url\(\s*['"]?(https?:)?\/\//)
    expect(manualCss).not.toMatch(/@import/)
  })

  it('names only files that are there or that the Pages build copies', () => {
    const page = renderPage('# T\n\n## One\n')
    const named = [...page.matchAll(/\b(?:src|href)="(\.\.\/[^"]+)"/g)].map((m) => join('manual', m[1])).map((p) => p.replace(/^\.\.\//, '')).map((p) => resolve('/', p).slice(1))
    expect(named.filter((p) => p.startsWith('assets/')).length).toBeGreaterThan(2)
    for (const path of named.filter((p) => p.startsWith('assets/'))) expect(existsSync(join(site, path)) || path in copied, path).toBe(true)
    for (const [, file] of manualCss.matchAll(/url\(([^)]+\.woff2)\)/g)) expect(`assets/${file}` in copied, file).toBe(true)
    expect(page).toContain('<nav class="contents" aria-label="Contents">')
    expect(page).not.toMatch(/<style/)
  })
})
