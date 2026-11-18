// Copies into site/ what the landing page (site/index.html) uses and git does not keep there: the Instrument Sans and Martian Mono faces
// from app/node_modules and the pictures and the recording from docs/images. Run by .github/workflows/pages.yml
// after `pnpm install`, and by hand to look at the page locally:
//   node app/scripts/build-site.mjs && python3 -m http.server -d site 8765
// app/src/site.test.ts reads COPIED to check that every local address of the page is a file that will be there.
import { copyFileSync, mkdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const fonts = 'app/node_modules/@fontsource'

/** Published path under site/ → source path in the repository. */
export const COPIED = {
  'assets/fonts/instrument-sans-400.woff2': `${fonts}/instrument-sans/files/instrument-sans-latin-400-normal.woff2`,
  'assets/fonts/instrument-sans-500.woff2': `${fonts}/instrument-sans/files/instrument-sans-latin-500-normal.woff2`,
  'assets/fonts/instrument-sans-600.woff2': `${fonts}/instrument-sans/files/instrument-sans-latin-600-normal.woff2`,
  'assets/fonts/martian-mono-400.woff2': `${fonts}/martian-mono/files/martian-mono-latin-400-normal.woff2`,
  'assets/img/hero.png': 'docs/images/hero.png',
  'assets/img/hero-dark.png': 'docs/images/hero-dark.png',
  'assets/img/marks.png': 'docs/images/marks.png',
  'assets/img/chat.png': 'docs/images/chat.png',
  'assets/img/export.png': 'docs/images/export.png',
  'assets/img/social-preview.png': 'docs/images/social-preview.png',
  'assets/img/demo.mp4': 'docs/images/demo.mp4',
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  for (const [to, from] of Object.entries(COPIED)) {
    const dest = join(root, 'site', to)
    mkdirSync(dirname(dest), { recursive: true })
    copyFileSync(join(root, from), dest)
  }
  console.log(`site/: ${Object.keys(COPIED).length} files copied`)
}
