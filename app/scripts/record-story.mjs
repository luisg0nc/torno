// Records a story of the site (site/stories/<name>.html, drawn by site/assets/story.js) as the README's GIFs:
// docs/images/story.gif in the light scheme and story-dark.gif in the dark. Headless Chromium draws it one frame at a
// time with the story's own clock stopped (no window opens), and ffmpeg makes each GIF. From the repository root, after
// `node app/scripts/build-site.mjs` (it copies in the fonts):
//   node app/scripts/record-story.mjs [name]
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { chromium } from '@playwright/test'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const name = process.argv[2] || 'simracing-panel'
const FPS = 12, WIDTH = 800
const page = pathToFileURL(join(root, 'site/stories', `${name}.html`)).href
const schemes = [['light', 'story.gif'], ['dark', 'story-dark.gif']]

const browser = await chromium.launch({ headless: true })
try {
  for (const [scheme, file] of schemes) {
    const frames = mkdtempSync(join(tmpdir(), 'torno-story-'))
    try {
      const context = await browser.newContext({ viewport: { width: 1000, height: 1000 }, colorScheme: scheme, reducedMotion: 'no-preference' })
      const tab = await context.newPage()
      await tab.goto(page)
      await tab.evaluate(() => document.fonts.ready)
      const figure = tab.locator('[data-story]')
      const loop = await figure.evaluate((el) => el.storyRecord())
      const count = Math.round(loop * FPS)
      for (let i = 0; i < count; i++) {
        if (i > 0) await figure.evaluate((el, dt) => el.storyAdvance(dt), 1 / FPS)
        await figure.screenshot({ path: join(frames, `f${String(i).padStart(4, '0')}.png`) })
      }
      await context.close()
      const out = join(root, 'docs/images', file)
      execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', String(FPS), '-i', join(frames, 'f%04d.png'), '-vf',
        `crop=iw-4:ih-4:2:2,scale=${WIDTH}:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=64:stats_mode=full[p];[b][p]paletteuse=dither=none:diff_mode=rectangle`,
        '-loop', '0', out])
      console.log(`${file}: ${count} frames, ${(statSync(out).size / 1e6).toFixed(1)} MB`)
    } finally {
      rmSync(frames, { recursive: true, force: true })
    }
  }
} finally {
  await browser.close()
}
