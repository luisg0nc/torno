import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { expect, it } from 'vitest'
import { MONO_FACE, UI_FACE, canvasFont } from './fonts'

it('canvasFont names the face, the weight and the fallback', () => {
  expect(UI_FACE).toBe('Instrument Sans')
  expect(MONO_FACE).toBe('Martian Mono')
  expect(canvasFont(12, 500, true)).toBe('500 12px "Martian Mono", ui-monospace, monospace')
  expect(canvasFont(12)).toBe('400 12px "Instrument Sans", system-ui, sans-serif')
  expect(canvasFont(10.5, 600)).toBe('600 10.5px "Instrument Sans", system-ui, sans-serif')
})

/** Every file under a folder, without node_modules and the build's output. */
function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    return statSync(path).isDirectory() ? (name === 'node_modules' ? [] : walk(path)) : [path]
  })
}

it('no family name is written outside shared/fonts.ts, tokens.css, main/export/html.ts and page.css', () => {
  const src = resolve(__dirname, '..')
  const allowed = new Set(['shared/fonts.ts', 'renderer/styles/tokens.css', 'main/export/html.ts', 'export/page.css'])
  // The family names, not the packages' import paths (`@fontsource/ibm-plex-sans/...`), which stay until the Plex faces go.
  const named = /IBM Plex (Sans|Mono)|Instrument Sans|Martian Mono/
  const outside = walk(src)
    .map((file) => relative(src, file))
    .filter((file) => !allowed.has(file) && file !== 'shared/fonts.test.ts')
    .filter((file) => named.test(readFileSync(join(src, file), 'utf8')))
  expect(outside).toEqual([])
})
