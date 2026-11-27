// Renders social-preview.html to docs/images/social-preview.png, 1280 × 640, for Settings → General → Social preview
// on GitHub. Headless Chromium, no window. It fails, and writes nothing, when a face of the card did not load: a
// fallback face is what the old card had.
//
//     node app/scripts/social-preview.mjs [out.png]
import { chromium } from '@playwright/test'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const out = resolve(process.argv[2] ?? join(here, '../../docs/images/social-preview.png'))
const browser = await chromium.launch({ headless: true })
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 640 }, deviceScaleFactor: 1 })
  await page.goto(pathToFileURL(join(here, 'social-preview.html')).href)
  await page.evaluate(() => document.fonts.ready)
  const loaded = await page.evaluate(() => [...document.fonts].filter((f) => f.status === 'loaded').map((f) => `${f.family} ${f.weight}`))
  for (const face of ['Instrument Sans 400', 'Instrument Sans 600', 'Martian Mono 400']) {
    if (!loaded.includes(face)) throw new Error(`${face} did not load (loaded: ${loaded.join(', ') || 'none'})`)
  }
  if (!(await page.evaluate(() => [...document.images].every((i) => i.complete && i.naturalWidth > 0)))) throw new Error('the logo did not load')
  await page.screenshot({ path: out })
  console.log(out)
} finally {
  await browser.close()
}
