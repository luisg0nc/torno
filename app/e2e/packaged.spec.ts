import { cpSync, existsSync, lstatSync, mkdtempSync, readdirSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve, sep } from 'node:path'
import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test'
import { EXAMPLE_OBJECTS } from '../src/main/example'

// The packaged app: skipped unless TORNO_PACKAGED names its executable. On a Mac that is
// `…/torno.app/Contents/MacOS/torno` (`pnpm dist:mac`); where macOS is not at hand, the Linux stand-in of
// `pnpm pack:check`, `dist/linux-unpacked/torno-app`. Only that path differs between the two.
// It is the one spec that does not start the app from `out/`: no `args: ['.']`, no `cwd`.
const packaged = process.env.TORNO_PACKAGED
const appDir = resolve(__dirname, '..')
const fixtures = resolve(appDir, '../kernel/tests/fixtures/ws')
const fakeAgent = resolve(appDir, 'test/fake-agent.mjs')

test.skip(!packaged, 'TORNO_PACKAGED names the packaged app\'s executable')
test.describe.configure({ mode: 'serial' })

const temp = (name: string): string => mkdtempSync(join(realpathSync(tmpdir()), `torno-e2e-${name}-`))

/** What is installed: the `.app` on a Mac, the folder of the executable otherwise. */
function installed(executable: string): string {
  const at = executable.indexOf(`.app${sep}Contents${sep}`)
  return at >= 0 ? executable.slice(0, at + 4) : dirname(executable)
}

/** Every file and folder under `root` with its size and modification time: what must not change during a run. */
function listing(root: string): string[] {
  return readdirSync(root, { recursive: true, encoding: 'utf8' })
    .map((path) => {
      const stat = lstatSync(join(root, path))
      return `${path} ${stat.isDirectory() ? 'dir' : stat.size} ${stat.mtimeMs}`
    })
    .sort()
}

// TORNO_TEST=1 makes main create the window with show: false. Never launch without it.
const launch = (env: Record<string, string> = {}): Promise<ElectronApplication> =>
  electron.launch({
    executablePath: packaged!,
    args: [],
    env: { ...process.env, TORNO_TEST: '1', TORNO_CONFIG: join(temp('config'), 'config.json'), TORNO_AGENT_CMD: `node ${fakeAgent}`, ...env }
  })

test('builds an object with the kernel it carries, in an environment outside the package, and writes nothing inside it', async () => {
  test.setTimeout(420_000) // the kernel's environment is made anew in each run (uv's cache makes it quick)
  const root = temp('packaged')
  cpSync(fixtures, root, { recursive: true, filter: (source) => !source.endsWith('__pycache__') })
  const before = listing(installed(packaged!))
  const app = await launch({ TORNO_WORKSPACE: root })
  try {
    const page = await app.firstWindow()
    await page.waitForSelector('[data-region="left"]')
    expect(await app.evaluate(({ app }) => app.isPackaged)).toBe(true)
    expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isVisible())).toBe(false)

    await page.getByRole('button', { name: 'hollow', exact: true }).click()
    await expect
      .poll(async () => (await page.evaluate(() => window.__tornoTest!.state())).build?.status, { timeout: 360_000, intervals: [1000] })
      .toBe('ok')
    const state = await page.evaluate(() => window.__tornoTest!.state())
    expect(state.objectId).toBe('hollow')
    expect(state.scene).not.toBeNull()

    // The kernel's environment is under the profile (`userData`), never in the package.
    const userData = await app.evaluate(({ app }) => app.getPath('userData'))
    expect(existsSync(join(userData, 'kernel-env'))).toBe(true)
    const resources = await app.evaluate(() => process.resourcesPath)
    expect(existsSync(join(resources, 'kernel', '.venv'))).toBe(false)
    // The workspace is written only under .torno/.
    expect(existsSync(join(root, 'hollow', '.torno'))).toBe(true)
    expect(existsSync(join(root, '.venv'))).toBe(false)
  } finally {
    await app.close()
    rmSync(root, { recursive: true, force: true })
  }
  expect(listing(installed(packaged!))).toEqual(before)
})

test('offers the example it carries, with its four objects', async () => {
  test.setTimeout(420_000)
  const bare = await launch()
  let copy = ''
  try {
    const page = await bare.firstWindow()
    await expect(page.getByRole('button')).toHaveText(['Open folder', 'Open the example'])
    await page.getByRole('button', { name: 'Open the example' }).click()
    await page.waitForSelector('[data-region="left"]')
    copy = (await page.evaluate(() => window.__tornoTest!.state())).workspace!.root
    // A copy in the temporary folder, never the resources themselves.
    const resources = await bare.evaluate(() => process.resourcesPath)
    expect(copy.startsWith(resources)).toBe(false)
    await expect(page.locator('.object-row')).toHaveText([...EXAMPLE_OBJECTS].sort())
  } finally {
    await bare.close()
  }
  expect(existsSync(copy)).toBe(false)
})
