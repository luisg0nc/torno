import { execFileSync, spawnSync } from 'node:child_process'
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { afterAll, expect, it } from 'vitest'
import { readPng } from './test/pngRead'

const scripts = resolve(__dirname, '../../scripts')
const script = join(scripts, 'torno')
const made: string[] = []
const darwin = process.platform === 'darwin'
/** Desktop entries are freedesktop's: on macOS the script refuses them, and the tests of their contents are skipped there. */
const linuxOnly = it.skipIf(darwin)
afterAll(() => {
  for (const dir of made) rmSync(dir, { recursive: true, force: true })
})

/**
 * With a HOME and a data folder of its own, so that nothing of the person's is read or written whatever the
 * script does. No test here runs it against the real home.
 */
function run(args: string[], env: Record<string, string> = {}, from = script) {
  const home = mkdtempSync(join(tmpdir(), 'torno-launcher-'))
  made.push(home)
  const result = spawnSync('sh', [from, ...args], { encoding: 'utf8', env: { PATH: process.env.PATH ?? '', HOME: home, XDG_DATA_HOME: join(home, 'data'), ...env } })
  return { ...result, home }
}

/** Every file under a folder, by its path from it. */
const files = (dir: string): string[] => (existsSync(dir) ? (readdirSync(dir, { recursive: true, withFileTypes: true }).filter((entry) => entry.isFile()).map((entry) => join(entry.parentPath, entry.name).slice(dir.length + 1)).sort()) : [])

it('says the command it would start, with a platform only when one is asked for, and starts nothing', () => {
  const plain = run(['--print-command'])
  expect(plain.status).toBe(0)
  const lines = plain.stdout.trim().split('\n')
  expect(lines[0].endsWith('/app/node_modules/.bin/electron')).toBe(true)
  expect(lines[1].endsWith('/app')).toBe(true)
  expect(lines).toHaveLength(2)
  if (darwin) {
    // Electron has one platform there: a valid value is ignored, with a line on stderr, and not under the test switch.
    for (const value of ['wayland', 'x11']) {
      const ignored = run(['--print-command'], { TORNO_OZONE: value })
      expect([ignored.status, ignored.stdout]).toEqual([0, plain.stdout])
      expect(ignored.stderr).toBe('torno: TORNO_OZONE is for Linux; on macOS Electron has one platform, and it is ignored\n')
    }
    expect(run(['--print-command'], { TORNO_OZONE: 'x11', TORNO_TEST: '1' }).stderr).toBe('')
  } else {
    expect(run(['--print-command'], { TORNO_OZONE: 'wayland' }).stdout.trim().split('\n').at(-1)).toBe('--ozone-platform=wayland')
    expect(run(['--print-command'], { TORNO_OZONE: 'x11' }).stdout.trim().split('\n').at(-1)).toBe('--ozone-platform=x11')
  }
  // Never with the test switch, whatever is asked.
  expect(run(['--print-command'], { TORNO_OZONE: 'wayland', TORNO_TEST: '1' }).stdout).not.toContain('ozone')
  // With a folder it is the same command: the folder goes in the environment. One that is no folder is refused as at a start.
  expect(run(['--print-command', plain.home]).stdout.endsWith(plain.stdout)).toBe(true)
  const missing = run(['--print-command', join(plain.home, 'nowhere')])
  expect([missing.status, missing.stdout]).toEqual([2, ''])
  expect(missing.stderr).toContain('not a folder')
  // Nothing was installed, built or written for the asking.
  expect(files(plain.home)).toEqual([])
})

it('refuses the headless platform, and any other it does not know, before it does anything', () => {
  for (const value of ['headless', 'drm', '']) {
    const refused = run(['--print-command'], { TORNO_OZONE: value })
    expect([value, refused.status]).toEqual([value, value === '' ? 0 : 2])
    if (value !== '') expect(refused.stderr).toContain('TORNO_OZONE must be wayland or x11 (headless is not supported')
    if (value !== '') expect(refused.stdout).toBe('')
  }
  // Whoever asks: also a test run, and also for a desktop entry.
  expect(run(['--print-command'], { TORNO_OZONE: 'headless', TORNO_TEST: '1' }).status).toBe(2)
  expect(run(['--print-desktop'], { TORNO_OZONE: 'headless' }).status).toBe(2)
})

it.runIf(darwin)('refuses desktop entries on macOS, with code 2, and writes nothing', () => {
  for (const option of ['--print-desktop', '--install-desktop', '--uninstall-desktop']) {
    const refused = run([option])
    expect([option, refused.status, refused.stdout]).toEqual([option, 2, ''])
    expect(refused.stderr).toBe('torno: desktop entries are for Linux; on macOS make torno.app with pnpm dist:mac (README, Run)\n')
    expect(files(refused.home)).toEqual([])
  }
})

linuxOnly('prints a desktop entry that starts this script with the folder it is given, and writes nothing for the asking', () => {
  const printed = run(['--print-desktop'])
  expect(printed.status).toBe(0)
  const lines = printed.stdout.trim().split('\n')
  expect(lines[0]).toBe('[Desktop Entry]')
  expect(lines).toContain(`Exec="${script}" --from-desktop %F`)
  // Its icon is the repository's own file, by its whole path: nothing is copied anywhere for it.
  expect(lines).toContain(`Icon=${join(scripts, 'torno.svg')}`)
  expect(lines).toContain('Type=Application')
  expect(lines).toContain('Name=torno')
  expect(lines).toContain('Terminal=false')
  expect(printed.stdout).not.toContain('@')
  // The platform is the launcher's to decide when it runs, from TORNO_OZONE: the entry names none.
  expect(run(['--print-desktop'], { TORNO_OZONE: 'wayland' }).stdout).toBe(printed.stdout)
  expect(printed.stdout).not.toMatch(/ozone|headless|wayland|x11/)
  // It does not make torno an application for folders: a file manager would offer it for every one.
  expect(printed.stdout).not.toContain('MimeType')
  expect(files(printed.home)).toEqual([])
})

linuxOnly('quotes a path the desktop entry could misread', () => {
  // A copy of the launcher in a folder whose name has a space, a dollar, a quote, a backslash and a per cent.
  const odd = mkdtempSync(join(tmpdir(), 'torno launcher $HOME "q" 50% \\-'))
  made.push(odd)
  cpSync(scripts, join(odd, 'scripts'), { recursive: true })
  const printed = run(['--print-desktop'], {}, join(odd, 'scripts', 'torno'))
  expect(printed.status).toBe(0)
  const exec = printed.stdout.split('\n').find((line) => line.startsWith('Exec='))!
  // Quoted, the four characters the specification names escaped, then every backslash doubled as in any string of the file; a per cent is two.
  const quoted = `${odd}/scripts/torno`.replace(/[\\"`$]/g, '\\$&').replace(/\\/g, '\\\\').replace(/%/g, '%%')
  expect(exec).toBe(`Exec="${quoted}" --from-desktop %F`)
  expect(printed.stdout.split('\n')).toContain(`Icon=${`${odd}/scripts/torno.svg`.replace(/\\/g, '\\\\')}`)
})

linuxOnly('installs one file, under the data folder it is given, after saying what, and takes it away again', () => {
  const installed = run(['--install-desktop'])
  expect(installed.status).toBe(0)
  const entry = join(installed.home, 'data', 'applications', 'torno.desktop')
  // That file and no other: no icon is copied, no cache is made.
  expect(files(installed.home)).toEqual(['data/applications/torno.desktop'])
  const printed = run(['--print-desktop']).stdout
  expect(readFileSync(entry, 'utf8')).toBe(printed)
  // Said before it is written: the path, then the entry.
  expect(installed.stdout.startsWith(`torno: writing ${entry}\n`)).toBe(true)
  expect(installed.stdout).toContain(printed)
  expect(installed.stdout).toContain('Run it again after moving the repository.')

  // Without XDG_DATA_HOME it is ~/.local/share, of the HOME it is given.
  const home = mkdtempSync(join(tmpdir(), 'torno-launcher-home-'))
  made.push(home)
  const plain = spawnSync('sh', [script, '--install-desktop'], { encoding: 'utf8', env: { PATH: process.env.PATH ?? '', HOME: home } })
  expect(plain.status).toBe(0)
  expect(files(home)).toEqual(['.local/share/applications/torno.desktop'])
  const removed = spawnSync('sh', [script, '--uninstall-desktop'], { encoding: 'utf8', env: { PATH: process.env.PATH ?? '', HOME: home } })
  expect(removed.status).toBe(0)
  expect(removed.stdout).toContain(join(home, '.local/share/applications/torno.desktop'))
  expect(files(home)).toEqual([])
})

linuxOnly('installs nothing as root, nor without a home', () => {
  // An `id` that says root, first on the PATH: the script is not run as root to see this.
  const bin = mkdtempSync(join(tmpdir(), 'torno-launcher-bin-'))
  made.push(bin)
  writeFileSync(join(bin, 'id'), '#!/bin/sh\necho 0\n')
  chmodSync(join(bin, 'id'), 0o755)
  const root = run(['--install-desktop'], { PATH: `${bin}:${process.env.PATH ?? ''}` })
  expect(root.status).toBe(2)
  expect(root.stderr).toContain('not as root')
  expect(files(root.home)).toEqual([])
  const homeless = spawnSync('sh', [script, '--install-desktop'], { encoding: 'utf8', env: { PATH: process.env.PATH ?? '' } })
  expect(homeless.status).toBe(2)
  expect(homeless.stderr).toContain('neither XDG_DATA_HOME nor HOME')
  // More than the option is a mistake, not a folder to open.
  const more = run(['--install-desktop', 'extra'])
  expect(more.status).toBe(2)
  expect(files(more.home)).toEqual([])
})

it('still says how it is used', () => {
  const help = execFileSync('sh', [script, '--help'], { encoding: 'utf8' })
  for (const word of ['usage: torno [workspace]', '--print-command', '--install-desktop', '--uninstall-desktop', '--print-desktop', 'TORNO_OZONE']) expect(help).toContain(word)
})

/** A colour of the light theme, as `tokens.css` has it. */
function token(name: string): string {
  const tokens = readFileSync(resolve(__dirname, 'renderer/styles/tokens.css'), 'utf8')
  const light = tokens.slice(0, tokens.indexOf('@media (prefers-color-scheme: dark)'))
  return new RegExp(`${name}:\\s*(#[0-9A-Fa-f]{6})`).exec(light)![1].toUpperCase()
}

interface Shape {
  /** What is drawn: `path <d>` or `rect <x> <y> <width> <height> <rx>`. */
  shape: string
  /** In an icon its fill; in the window, whether it is the part (`logo-part`) or the vise (`currentColor`). */
  fill: string
  /** An icon's ground: a rect from its corner. */
  tile: boolean
}

/** The paths and rects of a drawing, an SVG file's or JSX's alike. */
function shapesOf(text: string): Shape[] {
  return [...text.matchAll(/<(path|rect)\b([^>]*?)\/?>/g)].map(([, tag, attrs]) => {
    const attr = (name: string): string | undefined => new RegExp(`\\b${name}="([^"]*)"`).exec(attrs)?.[1]
    const shape = tag === 'path' ? `path ${attr('d')}` : `rect ${['x', 'y', 'width', 'height', 'rx'].map((n) => attr(n) ?? '0').join(' ')}`
    const fill = attr('className') === 'logo-part' ? 'part' : (attr('fill')?.toUpperCase() ?? 'vise')
    return { shape, fill, tile: tag === 'rect' && attr('x') === undefined }
  })
}

const ICONS = { 'torno.svg': 64, 'torno-16.svg': 16 }

it('has icons of its own: a vise in the ink holding a part in the accent, on the paper grey, and nothing else', () => {
  for (const [name, size] of Object.entries(ICONS)) {
    const svg = readFileSync(join(scripts, name), 'utf8')
    const colours = [...new Set([...svg.matchAll(/#[0-9A-Fa-f]{6}\b/g)].map((m) => m[0].toUpperCase()))].sort()
    expect([name, colours]).toEqual([name, [token('--ink'), token('--accent'), token('--surface')].sort()])
    expect(svg).toContain(`viewBox="0 0 ${size} ${size}"`)
    expect(svg).not.toMatch(/<(script|image|text)|href=/)
    const shapes = shapesOf(svg)
    // One tile, first; one part; the rest is the vise.
    expect(shapes.map((s) => s.tile)).toEqual(shapes.map((_, i) => i === 0))
    expect(shapes[0]).toMatchObject({ shape: `rect 0 0 ${size} ${size} ${size === 64 ? 14 : 3.5}`, fill: token('--surface') })
    expect(shapes.filter((s) => s.fill === token('--accent'))).toHaveLength(1)
    expect(shapes.slice(1).filter((s) => s.fill !== token('--accent')).every((s) => s.fill === token('--ink'))).toBe(true)
  }
})

it('draws its icons to the pixel: the small one on whole pixels at 16, the large one at 32 as at 64', () => {
  const numbers = (shapes: Shape[]): number[] => shapes.filter((s) => !s.tile).flatMap((s) => [...s.shape.matchAll(/-?\d*\.?\d+/g)].map((m) => Number(m[0])))
  expect(numbers(shapesOf(readFileSync(join(scripts, 'torno-16.svg'), 'utf8'))).filter((n) => !Number.isInteger(n))).toEqual([])
  // The edges of the large one: its rects', and the lines its paths' straight runs lie on (a corner's radius is drawn soft at any size).
  const large = shapesOf(readFileSync(join(scripts, 'torno.svg'), 'utf8')).filter((s) => !s.tile)
  const rects = large.filter((s) => s.shape.startsWith('rect')).flatMap((s) => s.shape.split(' ').slice(1, 5).map(Number))
  const runs = large.filter((s) => s.shape.startsWith('path')).flatMap((s) => edgesOf(s.shape.slice('path '.length)))
  expect(runs.length).toBeGreaterThan(4)
  expect([...rects, ...runs].filter((n) => n % 2 !== 0)).toEqual([])
})

/** Where a path's straight edges lie: the point it starts at, the y of each horizontal run and the x of each vertical one. */
function edgesOf(d: string): number[] {
  let [x, y] = [0, 0]
  const edges: number[] = []
  for (const [, command, args] of d.matchAll(/([a-zA-Z])([^a-zA-Z]*)/g)) {
    const n = [...args.matchAll(/-?\d*\.?\d+/g)].map((m) => Number(m[0]))
    if (command === 'M') {
      ;[x, y] = n
      edges.push(x, y)
    } else if (command === 'H' || command === 'h') {
      x = command === 'H' ? n[0] : x + n[0]
      edges.push(y)
    } else if (command === 'V' || command === 'v') {
      y = command === 'V' ? n[0] : y + n[0]
      edges.push(x)
    } else if (command === 'a') [x, y] = [x + n[5], y + n[6]]
    else if (command === 'A') [x, y] = [n[5], n[6]]
    else if (command !== 'Z' && command !== 'z') throw new Error(`${command} is not read here`)
  }
  return edges
}

it('gives the window the icon as a picture of 512 px, of the drawing the icon is now', () => {
  const png = readPng(resolve(__dirname, '../resources/icon.png'))
  expect([png.width, png.height]).toEqual([512, 512])
  const hex = ([r, g, b, a]: number[]): string => `#${[r, g, b].map((c) => c.toString(16).padStart(2, '0')).join('').toUpperCase()}${a === 255 ? '' : `/${a}`}`
  const at = (x: number, y: number): string => hex(png.rgba(Math.floor(x * 8), Math.floor(y * 8)))
  // The middle of each rect of the icon is in its colour, the tile is where nothing is drawn, and beyond its corner is nothing.
  const shapes = shapesOf(readFileSync(join(scripts, 'torno.svg'), 'utf8')).filter((s) => !s.tile && s.shape.startsWith('rect'))
  expect(shapes.length).toBeGreaterThan(2)
  for (const s of shapes) {
    const [x, y, width, height] = s.shape.split(' ').slice(1, 5).map(Number)
    expect([s.shape, at(x + width / 2, y + height / 2)]).toEqual([s.shape, s.fill])
  }
  expect(at(32, 4)).toBe(token('--surface'))
  expect(png.rgba(0, 0)[3]).toBe(0)
})

it('builds again when a script of the build or the viewer of exported pages changes or is missing', () => {
  const text = readFileSync(script, 'utf8')
  for (const part of [' app/scripts ', '"$app/out/viewer/viewer.js"', 'find app/src ']) expect(text).toContain(part)
  // And what it starts is what it prints: the command is made once.
  expect(text.match(/node_modules\/\.bin\/electron/g)).toHaveLength(1)
})

// The polish review's minors M8 to M11, and the one identity.
it('says how it is used whatever platform is asked for: the help is where the variable is explained', () => {
  const help = run(['--help'], { TORNO_OZONE: 'headless' })
  expect(help.status).toBe(0)
  expect(help.stdout).toContain('TORNO_OZONE')
  expect(help.stdout).toContain('usage: torno [workspace]')
})

it('prints the folder with the command it would start: all of what is started', () => {
  const plain = run(['--print-command'])
  const folder = run(['--print-command', plain.home])
  expect(folder.status).toBe(0)
  const lines = folder.stdout.trim().split('\n')
  expect(lines[0]).toMatch(/^TORNO_WORKSPACE=.*torno-launcher-/)
  expect(lines.slice(1).join('\n')).toBe(plain.stdout.trim())
  // None was given: none is printed.
  expect(plain.stdout).not.toContain('TORNO_WORKSPACE')
})

linuxOnly('says so when it replaces an entry that is there', () => {
  const first = run(['--install-desktop'])
  expect(first.stdout).toContain('torno: writing ')
  const again = spawnSync('sh', [script, '--install-desktop'], { encoding: 'utf8', env: { PATH: process.env.PATH ?? '', HOME: first.home, XDG_DATA_HOME: join(first.home, 'data') } })
  expect(again.status).toBe(0)
  expect(again.stdout).toContain(`torno: replacing ${join(first.home, 'data', 'applications', 'torno.desktop')}`)
})

it('shows what went wrong when it was started from the desktop entry, where nobody reads its errors: a notice, or a log under its own data', () => {
  // The entry says where it was started from; a folder that is none is the failure at hand.
  if (!darwin) expect(run(['--print-desktop']).stdout).toMatch(/^Exec="[^"]*scripts\/torno" --from-desktop %F$/m)
  const home = mkdtempSync(join(tmpdir(), 'torno-launcher-'))
  made.push(home)
  const bin = join(home, 'bin')
  cpSync(scripts, join(home, 'scripts'), { recursive: true })
  // A PATH with the tools of a shell and no notify-send: it is logged.
  const env = { PATH: '/usr/bin:/bin', HOME: home, XDG_DATA_HOME: join(home, 'data'), XDG_STATE_HOME: join(home, 'state') }
  const hasNotify = spawnSync('sh', ['-c', 'command -v notify-send'], { env }).status === 0
  const failed = spawnSync('sh', [script, '--from-desktop', join(home, 'nowhere')], { encoding: 'utf8', env: { ...env, TORNO_NOTIFY: join(bin, 'none') } })
  expect(failed.status).toBe(2)
  expect(failed.stderr).toContain('not a folder')
  const log = join(home, 'state', 'torno', 'launcher.log')
  expect(readFileSync(log, 'utf8')).toMatch(/torno: not a folder: .*nowhere/)
  // With a notifier it is shown, and nothing is logged for it.
  rmSync(log)
  const said = join(home, 'said.txt')
  const notify = join(home, 'notify')
  writeFileSync(notify, `#!/bin/sh\nprintf '%s\\n' "$@" > '${said}'\n`)
  chmodSync(notify, 0o755)
  spawnSync('sh', [script, '--from-desktop', join(home, 'nowhere')], { encoding: 'utf8', env: { ...env, TORNO_NOTIFY: notify } })
  expect(readFileSync(said, 'utf8')).toContain('not a folder')
  expect(existsSync(log)).toBe(false)
  // Started from a terminal (no such flag), nothing is shown or logged anywhere: the error is on stderr, where it is read.
  const plain = spawnSync('sh', [script, join(home, 'nowhere')], { encoding: 'utf8', env: { ...env, TORNO_NOTIFY: notify } })
  expect(plain.status).toBe(2)
  expect(existsSync(log)).toBe(false)
  void hasNotify
})

it('has one identity: the logo in the window is the drawing of the icons, without their tile', () => {
  const window = shapesOf(readFileSync(resolve(__dirname, 'renderer/ui/Logo.tsx'), 'utf8'))
  const icons = Object.keys(ICONS).flatMap((name) => shapesOf(readFileSync(join(scripts, name), 'utf8')).filter((s) => !s.tile))
  // Shape for shape; the part is the one in the accent, the vise is drawn in the colour of the text around it.
  const drawn = (shapes: Shape[]): string[] => shapes.map((s) => `${s.shape} ${s.fill === token('--accent') || s.fill === 'part' ? 'part' : 'vise'}`).sort()
  expect(drawn(window)).toEqual(drawn(icons))
  expect(window.filter((s) => s.fill !== 'part').every((s) => s.fill === 'vise')).toBe(true)
  expect(readFileSync(join(scripts, 'torno.desktop.in'), 'utf8')).toContain('StartupWMClass=torno')
  // And the window says whose it is, so that the desktop finds its entry and its icon, and has the icon itself
  // where the desktop takes it from the window (X11).
  const main = readFileSync(resolve(__dirname, 'main/index.ts'), 'utf8')
  expect(main).toContain("app.setName('torno')")
  expect(main).toContain("setDesktopName?.('torno.desktop')")
  expect(main).toContain('icon: windowIcon()')
  expect(readFileSync(resolve(__dirname, 'main/paths.ts'), 'utf8')).toContain("join(app.getAppPath(), 'resources', 'icon.png')")
})

/**
 * A repository of its own beside a copy of the launcher: a source or two, the build's files, `node_modules`, an
 * Electron that only says it was started and a `pnpm` that only says it built (and writes the build's files). The
 * launcher is run against that, never against this repository's `app/out`.
 */
function fakeRepository() {
  const root = mkdtempSync(join(tmpdir(), 'torno-launcher-repo-'))
  made.push(root)
  cpSync(scripts, join(root, 'scripts'), { recursive: true })
  const app = join(root, 'app')
  const write = (path: string, text: string, mode?: number): void => {
    mkdirSync(dirname(join(root, path)), { recursive: true })
    writeFileSync(join(root, path), text)
    if (mode !== undefined) chmodSync(join(root, path), mode)
  }
  write('app/src/main/index.ts', 'export const a = 1\n')
  write('app/src/renderer/ui/Thing.tsx', 'export const b = 2\n')
  write('app/scripts/build-viewer.mjs', '// the viewer\n')
  write('app/package.json', '{}\n')
  write('app/electron.vite.config.ts', 'export default {}\n')
  write('app/tsconfig.json', '{}\n')
  write('pnpm-lock.yaml', 'lockfileVersion: 9\n')
  mkdirSync(join(root, 'node_modules'), { recursive: true })
  write('app/node_modules/.bin/electron', `#!/bin/sh\necho started >> '${join(root, 'started.log')}'\n`, 0o755)
  // `pnpm build`: says it built, then writes what a build writes. FAIL=1 in its folder makes it fail; EDIT names a
  // source it changes while it runs, as a person saving during a build would.
  write(
    'bin/pnpm',
    `#!/bin/sh\necho "$*" >> '${join(root, 'built.log')}'\n` +
      `[ ! -f '${join(root, 'bin/EDIT')}' ] || echo '// saved during the build' >> "$(cat '${join(root, 'bin/EDIT')}')"\n` +
      `[ ! -f '${join(root, 'bin/FAIL')}' ] || exit 1\n` +
      `cd '${app}' && mkdir -p out/main out/preload out/renderer out/viewer && touch out/main/index.js out/preload/index.js out/renderer/index.html out/viewer/viewer.js\n`,
    0o755,
  )
  write('bin/uv', '#!/bin/sh\nexit 0\n', 0o755)
  const path = `${join(root, 'bin')}:${dirname(process.execPath)}:/usr/bin:/bin`
  const start = () => {
    const before = existsSync(join(root, 'built.log')) ? readFileSync(join(root, 'built.log'), 'utf8').split('\n').length : 1
    const result = spawnSync('sh', [join(root, 'scripts', 'torno')], { encoding: 'utf8', env: { PATH: path, HOME: join(root, 'home'), XDG_DATA_HOME: join(root, 'home', 'data') } })
    const after = existsSync(join(root, 'built.log')) ? readFileSync(join(root, 'built.log'), 'utf8').split('\n').length : 1
    return { status: result.status, stderr: result.stderr, built: after > before }
  }
  return { root, app, write, start }
}

it('builds again when what a source says changes, and not when only its time does', () => {
  const repo = fakeRepository()
  const first = repo.start()
  expect([first.status, first.built]).toEqual([0, true])
  // The stamp is what the sources hold, not a time.
  expect(readFileSync(join(repo.app, 'out', '.built'), 'utf8')).toMatch(/^[0-9a-f]{64}\n$/)
  expect(repo.start().built).toBe(false)
  // A checkout or a touch that leaves every source as it was: newer files, the same content.
  const later = new Date(Date.now() + 60_000)
  for (const source of ['app/src/main/index.ts', 'app/scripts/build-viewer.mjs', 'pnpm-lock.yaml']) utimesSync(join(repo.root, source), later, later)
  expect(repo.start().built).toBe(false)
  // A stamp older than everything says nothing either.
  utimesSync(join(repo.app, 'out', '.built'), new Date(0), new Date(0))
  expect(repo.start().built).toBe(false)
  // What a source says, in each place the build reads.
  for (const [source, text] of [['app/src/renderer/ui/Thing.tsx', 'export const b = 3\n'], ['app/scripts/build-viewer.mjs', '// another viewer\n'], ['app/package.json', '{ "a": 1 }\n'], ['pnpm-lock.yaml', 'lockfileVersion: 10\n']]) {
    repo.write(source, text)
    expect([source, repo.start().built]).toEqual([source, true])
    expect([source, repo.start().built]).toEqual([source, false])
  }
  // A new source, and one taken away, are changes too; so is one that only changed its name.
  repo.write('app/src/shared/new.ts', 'export {}\n')
  expect(repo.start().built).toBe(true)
  renameSync(join(repo.root, 'app/src/shared/new.ts'), join(repo.root, 'app/src/shared/renamed.ts'))
  expect(repo.start().built).toBe(true)
  rmSync(join(repo.root, 'app/src/shared/renamed.ts'))
  expect(repo.start().built).toBe(true)
  expect(repo.start().built).toBe(false)
  // What the build wrote, gone: built again whatever the stamp says.
  rmSync(join(repo.app, 'out', 'viewer', 'viewer.js'))
  expect(repo.start().built).toBe(true)
})

it('stamps a checkout with the same hash whichever of sha256sum and shasum is on the PATH, and stops before a build with neither', () => {
  const found = (tool: string): string | undefined => {
    const r = spawnSync('sh', ['-c', `command -v ${tool}`], { encoding: 'utf8' })
    return r.status === 0 ? r.stdout.trim() : undefined
  }
  const [gnu, bsd] = [found('sha256sum'), found('shasum')]
  const stampWith = (tools: Record<string, string>): { stamp: string | null; status: number | null; stderr: string; built: boolean } => {
    const repo = fakeRepository()
    // A PATH of links to what a shell needs and to the tools named; nothing else can answer.
    const bin = join(repo.root, 'tools')
    mkdirSync(bin)
    for (const tool of ['sh', 'find', 'sort', 'xargs', 'cut', 'cat', 'mv', 'mkdir', 'touch', 'dirname', 'readlink', 'date', 'id', 'uname', 'perl', 'env']) {
      const at = found(tool)
      if (at) symlinkSync(at, join(bin, tool))
    }
    symlinkSync(process.execPath, join(bin, 'node'))
    for (const [name, target] of Object.entries(tools)) symlinkSync(target, join(bin, name))
    const result = spawnSync('sh', [join(repo.root, 'scripts', 'torno')], { encoding: 'utf8', env: { PATH: `${join(repo.root, 'bin')}:${bin}`, HOME: join(repo.root, 'home') } })
    const stamp = join(repo.app, 'out', '.built')
    return { stamp: existsSync(stamp) ? readFileSync(stamp, 'utf8') : null, status: result.status, stderr: result.stderr, built: existsSync(join(repo.root, 'built.log')) }
  }
  const none = stampWith({})
  expect([none.status, none.built, none.stamp]).toEqual([1, false, null])
  expect(none.stderr).toContain('torno: neither sha256sum nor shasum was found on PATH')
  if (!gnu || !bsd) return
  const [withGnu, withBsd] = [stampWith({ sha256sum: gnu }), stampWith({ shasum: bsd })]
  expect([withGnu.status, withBsd.status]).toEqual([0, 0])
  expect(withGnu.stamp).toMatch(/^[0-9a-f]{64}\n$/)
  expect(withBsd.stamp).toBe(withGnu.stamp)
})

it('keeps no stamp of a build that failed, nor one of sources saved while it ran', () => {
  const repo = fakeRepository()
  expect(repo.start().built).toBe(true)
  const stamp = readFileSync(join(repo.app, 'out', '.built'), 'utf8')
  repo.write('app/src/main/index.ts', 'export const a = 2\n')
  repo.write('bin/FAIL', '')
  const failed = repo.start()
  expect([failed.status, failed.built]).toEqual([1, true])
  expect(failed.stderr).toContain('building the app failed')
  // The stamp is still of the last build that succeeded: the next start tries again.
  expect(readFileSync(join(repo.app, 'out', '.built'), 'utf8')).toBe(stamp)
  rmSync(join(repo.root, 'bin/FAIL'))
  expect(repo.start().built).toBe(true)
  expect(repo.start().built).toBe(false)
  // A source saved during a build is not what was built: the stamp is of what the sources held when it began.
  repo.write('bin/EDIT', join(repo.root, 'app/src/main/index.ts'))
  repo.write('app/src/renderer/ui/Thing.tsx', 'export const b = 4\n')
  expect(repo.start().built).toBe(true)
  rmSync(join(repo.root, 'bin/EDIT'))
  expect(repo.start().built).toBe(true)
  expect(repo.start().built).toBe(false)
})
