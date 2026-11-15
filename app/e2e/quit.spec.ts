import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, readlinkSync, realpathSync, rmSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { _electron as electron, expect, test } from '@playwright/test'
import { openPanel } from './helpers'
import { openListed } from './objects'

const appDir = resolve(__dirname, '..')
const fixtures = resolve(appDir, '../kernel/tests/fixtures/ws')

function readOr<T>(read: () => T, otherwise: T): T {
  try {
    return read()
  } catch {
    return otherwise // gone already, or not ours to read
  }
}

/**
 * The kernel of the workspace at `root`, as pid → command line: the processes
 * started there (`uv` and the Python supervisor) and everything below them
 * (the workers, whose working directory cannot be read).
 */
function kernelProcesses(root: string): Map<number, string> {
  const parent = new Map<number, number>()
  const found = new Set<number>()
  for (const name of readdirSync('/proc')) {
    if (!/^\d+$/.test(name)) continue
    const pid = Number(name)
    // "pid (comm) state ppid ...": comm may hold spaces, so count from the last bracket.
    const stat = readOr(() => readFileSync(`/proc/${pid}/stat`, 'utf8'), '')
    parent.set(pid, Number(stat.slice(stat.lastIndexOf(')') + 2).split(' ')[1]))
    if (readOr(() => readlinkSync(`/proc/${pid}/cwd`), '') === root) found.add(pid)
  }
  for (let grew = true; grew; ) {
    grew = false
    for (const [pid, ppid] of parent) {
      if (found.has(ppid) && !found.has(pid)) {
        found.add(pid)
        grew = true
      }
    }
  }
  return new Map([...found].map((pid) => [pid, commandOf(pid)]))
}

function commandOf(pid: number): string {
  return readOr(() => readFileSync(`/proc/${pid}/cmdline`, 'utf8'), '').replaceAll('\0', ' ').trim()
}

// Seen on the visible screen: a test's Electron ran with --user-data-dir=~/.config/torno, and wrote its cache there.
test('under test Electron keeps its own files in a temporary folder, never under the home, and takes it away at quit', async () => {
  const app = await electron.launch({ args: ['.'], cwd: appDir, env: { ...process.env, TORNO_TEST: '1' } })
  let paths: Record<string, string> = {}
  try {
    await app.firstWindow()
    paths = await app.evaluate(({ app }) => Object.fromEntries((['userData', 'sessionData', 'crashDumps'] as const).map((name) => [name, app.getPath(name)])))
    const temp = realpathSync(tmpdir())
    for (const [name, path] of Object.entries(paths)) {
      expect([name, path.startsWith(paths.userData)]).toEqual([name, true])
      expect([name, path.startsWith(homedir())]).toEqual([name, false])
    }
    expect(realpathSync(paths.userData).startsWith(join(temp, 'torno-test-'))).toBe(true)
    expect(paths.sessionData).toBe(paths.userData)
    // Its command line names that folder, and not the person's.
    const args = await app.evaluate(() => process.argv.join(' '))
    expect(args).not.toContain(join(homedir(), '.config'))
    expect(existsSync(paths.userData)).toBe(true)
  } finally {
    await app.close()
  }
  await expect.poll(() => existsSync(paths.userData), { timeout: 10_000 }).toBe(false)
})

test('quitting during a build leaves no kernel or worker process behind', async () => {
  test.skip(process.platform !== 'linux', 'reads /proc')
  const root = mkdtempSync(join(realpathSync(tmpdir()), 'torno-e2e-quit-'))
  cpSync(fixtures, root, { recursive: true, filter: (source) => !source.endsWith('__pycache__') })
  // TORNO_TEST=1 makes main create the window with show: false. Never launch without it.
  const app = await electron.launch({
    args: ['.'],
    cwd: appDir,
    env: { ...process.env, TORNO_TEST: '1', TORNO_WORKSPACE: root }
  })
  let before = new Map<number, string>()
  try {
    const page = await app.firstWindow()
    await page.waitForSelector('[data-region="viewport"]')
    const state = await page.evaluate(() => window.torno.object.open('slow'))
    expect(state.status).toBe('building')
    // uv, the supervisor, and the worker that sleeps for a minute in the model.
    await expect
      .poll(() => (before = kernelProcesses(root)).size, { timeout: 20_000 })
      .toBeGreaterThanOrEqual(3)
    expect([...before.values()].filter((command) => command.includes('torno_kernel')).length).toBeGreaterThanOrEqual(3)
  } finally {
    await app.close()
  }
  // A pid still alive with the command it had is one of them left behind.
  const left = () => [...before].filter(([pid, command]) => commandOf(pid) === command).map(([pid]) => pid)
  await expect.poll(left, { timeout: 10_000 }).toEqual([])
  rmSync(root, { recursive: true, force: true })
})

test('a note still being typed when the window closes is kept: nothing ended it, and nothing blurred', async () => {
  const root = mkdtempSync(join(realpathSync(tmpdir()), 'torno-e2e-quit-note-'))
  cpSync(fixtures, root, { recursive: true, filter: (source) => !source.endsWith('__pycache__') })
  // TORNO_TEST=1 makes main create the window with show: false. Never launch without it.
  const app = await electron.launch({ args: ['.'], cwd: appDir, env: { ...process.env, TORNO_TEST: '1', TORNO_WORKSPACE: root } })
  try {
    const page = await app.firstWindow()
    await page.waitForSelector('[data-region="left"]')
    await openListed(page, 'bracket')
    await expect.poll(async () => (await page.evaluate(() => window.__tornoTest!.state())).build, { timeout: 30_000 }).toMatchObject({ status: 'ok', revision: 1 })

    // A pin on the top of the base, clear of the post.
    await page.getByRole('toolbar', { name: 'Tools' }).getByRole('button', { name: 'Pin', exact: true }).click()
    const [fx, fy] = await page.evaluate(() => window.__tornoTest!.project([14, 9, 2.5]))
    const box = (await page.locator('.viewport-canvas canvas').first().boundingBox())!
    await page.mouse.move(box.x + fx * box.width, box.y + fy * box.height)
    await page.mouse.down()
    await page.mouse.up()
    await expect(page.locator('.note-card textarea')).toBeFocused()
    await page.keyboard.type('thicker here')
    await expect(page.locator('.note-card textarea')).toHaveValue('thicker here')
    // Typed, and not handed to main: neither Enter, nor a press elsewhere, nor the focus leaving.
    expect((await page.evaluate(() => window.__tornoTest!.state())).marks[0]).toMatchObject({ id: 'M1', note: '' })
    // Closed as the person closes it: the window, and with it the app.
    const exited = new Promise<void>((done) => app.process().once('exit', () => done()))
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close()).catch(() => {})
    await exited
  } finally {
    await app.close().catch(() => {})
  }
  const kept = (): string | undefined => readOr(() => JSON.parse(readFileSync(join(root, 'bracket', '.torno', 'marks.json'), 'utf8')).marks[0]?.note, undefined)
  await expect.poll(kept, { timeout: 10_000 }).toBe('thicker here')
  rmSync(root, { recursive: true, force: true })
})

test('a layer hidden just before the window closes is in .torno/scene.json: the save was still waiting', async () => {
  const root = mkdtempSync(join(realpathSync(tmpdir()), 'torno-e2e-quit-scene-'))
  cpSync(fixtures, root, { recursive: true, filter: (source) => !source.endsWith('__pycache__') })
  // TORNO_TEST=1 makes main create the window with show: false. Never launch without it.
  const app = await electron.launch({ args: ['.'], cwd: appDir, env: { ...process.env, TORNO_TEST: '1', TORNO_WORKSPACE: root } })
  const sceneFile = (): { layers?: Record<string, { visible?: boolean }> } => readOr(() => JSON.parse(readFileSync(join(root, 'bracket', '.torno', 'scene.json'), 'utf8')), {})
  try {
    const page = await app.firstWindow()
    await page.waitForSelector('[data-region="left"]')
    await openListed(page, 'bracket')
    await expect.poll(async () => (await page.evaluate(() => window.__tornoTest!.state())).build, { timeout: 30_000 }).toMatchObject({ status: 'ok', revision: 1 })
    // Past the save that opening the object may have asked for.
    await page.waitForTimeout(1000)

    await openPanel(page, 'Layers')

    await page.locator('[data-layer="post"]').hover()
    await page.getByRole('button', { name: 'Show post' }).click()
    // Saved half a second after the last change: not yet.
    expect(sceneFile().layers?.post?.visible).toBeUndefined()
    const exited = new Promise<void>((done) => app.process().once('exit', () => done()))
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close()).catch(() => {})
    await exited
  } finally {
    await app.close().catch(() => {})
  }
  expect(sceneFile().layers?.post?.visible).toBe(false)
  rmSync(root, { recursive: true, force: true })
})
