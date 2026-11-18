import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { expect, it } from 'vitest'

/** `--name: value` of a block of CSS, by name. */
const tokens = (css: string): Record<string, string> => Object.fromEntries([...css.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]))
const halves = (css: string): [string, string] => {
  const at = css.indexOf('@media (prefers-color-scheme: dark)')
  return [css.slice(0, at), css.slice(at)]
}

it('uses the tokens of the app, to the value, in light and in dark', () => {
  const app = halves(readFileSync(resolve(__dirname, '../renderer/styles/tokens.css'), 'utf8'))
  const page = halves(readFileSync(resolve(__dirname, 'page.css'), 'utf8'))
  for (const theme of [0, 1]) {
    const [ours, theirs] = [tokens(page[theme]), tokens(app[theme])]
    expect(Object.keys(ours).length).toBeGreaterThan(8)
    for (const [name, value] of Object.entries(ours)) expect([name, value]).toEqual([name, theirs[name]])
  }
  // The page can be switched by hand: the dark values are also under [data-theme="dark"].
  expect(readFileSync(resolve(__dirname, 'page.css'), 'utf8')).toContain(':root[data-theme="dark"]')
})

it('declares every token a rule reads, and carries --raise for what floats', () => {
  const css = readFileSync(resolve(__dirname, 'page.css'), 'utf8')
  const [light, dark] = halves(css)
  const declared = new Set(Object.keys(tokens(light)))
  const read = new Set([...css.matchAll(/var\((--[a-z0-9-]+)/g)].map((m) => m[1]))
  expect([...read].filter((name) => !declared.has(name))).toEqual([])
  // What the window draws on --raise (a tag, a popover, the selected segment) the page draws on it too.
  expect(declared.has('--raise')).toBe(true)
  expect(Object.keys(tokens(dark))).toContain('--raise')
  expect(css).toMatch(/#said \{[^}]*background: var\(--raise\)/)
  expect(css).toMatch(/#foot details\[open\] \{[^}]*background: var\(--raise\)/)
  expect(css).toMatch(/\.themes button\[aria-pressed="true"\] \{[^}]*background: var\(--raise\)/)
})

it('holds the dark values twice to the letter: for a system that asks for dark, and for the switch', () => {
  const css = readFileSync(resolve(__dirname, 'page.css'), 'utf8')
  const system = /@media \(prefers-color-scheme: dark\) \{\s*:root:not\(\[data-theme="light"\]\) \{([^}]*)\}/.exec(css)
  const byHand = /\n:root\[data-theme="dark"\] \{([^}]*)\}/.exec(css)
  expect(system).not.toBeNull()
  expect(byHand).not.toBeNull()
  expect(tokens(byHand![1])).toEqual(tokens(system![1]))
})

it('asks for nothing from anywhere: no url, no import', () => {
  const css = readFileSync(resolve(__dirname, 'page.css'), 'utf8')
  expect(css).not.toMatch(/url\(|@import|https?:/)
})

it('has a viewer that sets text and never markup, and evaluates nothing', () => {
  const dir = resolve(__dirname, 'viewer')
  for (const file of ['main.ts', 'model.ts', 'overlay.ts', 'panel.ts']) {
    const source = readFileSync(resolve(dir, file), 'utf8')
    expect([file, source.match(/innerHTML|outerHTML|insertAdjacentHTML|document\.write|\beval\(|new Function|DOMParser|createContextualFragment|srcdoc|fetch\(|XMLHttpRequest|WebSocket|importScripts|localStorage|sessionStorage|cookie/g)]).toEqual([file, null])
  }
})

/** What a source file imports, as written. */
const imports = (path: string): string[] => [...readFileSync(path, 'utf8').matchAll(/^(?:import|export)\b[^'"]*?\bfrom\s+['"]([^'"]+)['"]/gm), ...readFileSync(path, 'utf8').matchAll(/^import\s+['"]([^'"]+)['"]/gm)].map((m) => m[1])

it('builds its viewer from three.js, the shared rules and four modules of the viewport, and from nothing else of the app', () => {
  const viewport = ['lights', 'ground', 'views', 'theme']
  const allowed = (from: string): boolean => from === 'three' || from === 'three/addons/controls/OrbitControls.js' || /^\.\.\/\.\.\/shared\/[a-z]+$/.test(from) || viewport.some((name) => from === `../../renderer/viewport/${name}`) || /^\.\/(main|model|overlay|panel)$/.test(from)
  for (const file of ['main.ts', 'model.ts', 'overlay.ts', 'panel.ts']) {
    const found = imports(resolve(__dirname, 'viewer', file))
    expect(found.length).toBeGreaterThan(0)
    expect([file, found.filter((from) => !allowed(from))]).toEqual([file, []])
  }
  // Those four in turn: three.js, the shared rules and one another. Not the part's mesh with its picking tree, not React, not the store.
  for (const name of viewport) {
    const found = imports(resolve(__dirname, '../renderer/viewport', `${name}.ts`))
    expect([name, found.filter((from) => from !== 'three' && !/^\.\.\/\.\.\/shared\/[a-z]+$/.test(from) && !viewport.some((other) => from === `./${other}`))]).toEqual([name, []])
  }
  // And the shared rules the page takes are plain: they import only one another.
  const shared = new Set<string>()
  const follow = (path: string): void => {
    for (const from of imports(path)) {
      const next = from.startsWith('.') ? resolve(path, '..', `${from}.ts`) : null
      expect([path, from, next !== null && /\/src\/(shared|renderer\/viewport|export\/viewer)\//.test(next)]).toEqual([path, from, from.startsWith('.')])
      if (next && !shared.has(next)) {
        shared.add(next)
        follow(next)
      }
    }
  }
  follow(resolve(__dirname, 'viewer/main.ts'))
  expect([...shared].filter((path) => /partMesh|three-mesh-bvh|store|\.tsx$/.test(path))).toEqual([])
})
