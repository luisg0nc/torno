import { cpSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { agentsIn, inTerminal } from './terminal'
import type { TornoState } from '../src/renderer/state/store'
import { openListed } from './objects'
import { fromMore, moreItems, newSession } from './helpers'

// The session pane through the window, with a stand-in for the agent's CLI
// (test/fake-agent.mjs, named by TORNO_AGENT_CMD): no test here runs `claude`.
//
// The window is hidden, so what the terminal shows is read from its buffer
// through window.__tornoTerm, never from pixels.
const appDir = resolve(__dirname, '..')
const fixtures = resolve(appDir, '../kernel/tests/fixtures/ws')
const fakeAgent = resolve(appDir, 'test/fake-agent.mjs')

test.describe.configure({ mode: 'serial' })

let root: string
let app: ElectronApplication
let page: Page

function copyFixtures(): string {
  const dir = mkdtempSync(join(realpathSync(tmpdir()), 'torno-e2e-session-'))
  cpSync(fixtures, dir, { recursive: true, filter: (source) => !source.endsWith('__pycache__') })
  inTerminal(dir)
  return dir
}

// TORNO_TEST=1 makes main create the window with show: false. Never launch without it.
function launch(env: Record<string, string>): Promise<ElectronApplication> {
  return electron.launch({
    args: ['.'],
    cwd: appDir,
    env: { ...process.env, TORNO_TEST: '1', TORNO_AGENT_CMD: `node ${fakeAgent}`, ...env }
  })
}

test.beforeAll(async () => {
  root = copyFixtures()
  app = await launch({ TORNO_WORKSPACE: root })
  page = await app.firstWindow()
  await page.waitForSelector('[data-region="left"]')
})

test.afterAll(async () => {
  await app?.close()
  rmSync(root, { recursive: true, force: true })
})

const state = (p: Page = page): Promise<TornoState> => p.evaluate(() => window.__tornoTest!.state())
const dock = (p: Page = page) => p.locator('[data-region="session"]')
const text = (p: Page = page): Promise<string> => p.evaluate(() => window.__tornoTerm!.text())
const sessionStatus = (p: Page = page) => dock(p).getByRole('status')
const openObject = (name: string, p: Page = page) => openListed(p, name)

/** Type a line into the terminal, as a person would. */
async function typeLine(line: string, p: Page = page): Promise<void> {
  await p.locator('.session-term textarea').focus()
  await p.keyboard.type(line)
  await p.keyboard.press('Enter')
}

test('with no object open the dock says what to do; with one, it offers a new session', async () => {
  await expect(dock()).toContainText('Claude Code works here, one session per project. Make or open a project to start.')
  await expect(dock().getByRole('button')).toHaveCount(0)

  await openObject('bracket')
  await expect(dock().getByRole('heading', { name: 'Claude Code' })).toBeVisible()
  await expect(dock().getByRole('button', { name: 'New session' })).toBeVisible()
  // Nothing to resume: no conversation has been had here.
  await expect(dock().getByRole('button', { name: 'Resume' })).toHaveCount(0)
  await expect(dock()).toContainText('Claude Code runs here, in the folder of bracket')
  await expect(sessionStatus()).toHaveCount(0)
})

test('a new session runs the agent in a terminal, and what is typed reaches it', async () => {
  await newSession(dock())
  await expect.poll(text).toContain('READY')
  await expect(sessionStatus()).toHaveText('Idle')
  await expect(dock().locator('.session-empty')).toHaveCount(0)

  // Started in the object's folder, with Claude Code's arguments.
  expect(agentsIn(join(root, 'bracket'))).toHaveLength(1)
  for (const flag of ['--session-id', '--mcp-config', '--allowedTools', '--settings']) expect(await text()).toContain(flag)
  // Its hooks' addresses hold no secret: the token is in its environment, named in each hook's headers (#113).
  const said = (await text()).replace(/\s+/g, '')
  expect(said).toMatch(/http:\/\/127\.0\.0\.1:\d+\/hooks\/[0-9a-f-]{36}\/Stop/)
  expect(said).toContain('"X-Torno-Session\\":\\"$TORNO_SESSION\\"')

  // The terminal has the focus from the start.
  await page.keyboard.type('hi')
  await page.keyboard.press('Enter')
  await expect.poll(text).toContain('> hi')
})

test('the agent was started at the size of the terminal, and is told when it changes', async () => {
  const size = () => page.evaluate(() => window.__tornoTerm!.size()!)
  const first = await size()
  expect(first.cols).toBeGreaterThan(40)
  expect(first.cols).not.toBe(80)
  await typeLine('size')
  await expect.poll(text).toContain(`size: ${first.cols}x${first.rows}`)

  // Widen the dock from the keyboard: the terminal is fitted again and the PTY follows.
  const handle = page.getByRole('separator', { name: 'Resize session' })
  await handle.focus()
  for (let i = 0; i < 5; i += 1) await page.keyboard.press('ArrowLeft')
  await expect.poll(async () => (await size()).cols).toBeGreaterThan(first.cols)
  const wider = await size()
  await typeLine('size')
  await expect.poll(text).toContain(`size: ${wider.cols}x${wider.rows}`)

  // Hidden, the terminal keeps its size and its text; shown again it is as it was.
  await page.getByRole('button', { name: 'Hide session' }).click()
  await expect(dock()).toBeHidden()
  await page.getByRole('button', { name: 'Show session' }).click()
  await expect(dock()).toBeVisible()
  expect(await size()).toEqual(wider)
  expect(await text()).toContain('> hi')
})

test('the title bar holds the folder, the project and its menu, the dock toggle and the window controls', async () => {
  await openObject('bracket')
  const bar = page.locator('.title-row')
  await expect(bar.getByRole('button', { name: /^Folder / })).toBeVisible()
  const project = bar.getByRole('button', { name: 'Project bracket' })
  await expect(project).toBeVisible()
  // The bar is the window's drag region, and its crumbs are not.
  const region = (sel: string) => page.locator(sel).first().evaluate((el) => getComputedStyle(el).getPropertyValue('-webkit-app-region'))
  expect(await region('.title-row')).toBe('drag')
  expect(await region('.crumb-folder')).toBe('no-drag')
  // The project menu: All projects at its head, then the folder's projects; one chosen is the open project.
  await project.click()
  const menu = page.getByRole('menu', { name: 'Projects' })
  await expect(menu.getByRole('menuitem').first()).toHaveText(/^All projects/)
  await expect(menu.getByRole('menuitem', { name: 'bracket', exact: true })).toHaveAttribute('aria-current', 'true')
  await menu.getByRole('menuitem', { name: 'hollow', exact: true }).click()
  await expect(menu).toHaveCount(0)
  await expect(bar.getByRole('button', { name: 'Project hollow' })).toBeVisible()
  await expect.poll(async () => (await state()).objectId).toBe('hollow')
  // On the page of projects only the folder shows.
  await page.keyboard.press('Escape')
  await bar.getByRole('button', { name: 'Project hollow' }).click()
  await menu.getByRole('menuitem', { name: /^All projects/ }).click()
  await expect(bar.getByRole('button', { name: /^Project / })).toHaveCount(0)
  await expect(bar.getByRole('button', { name: /^Folder / })).toBeVisible()
  // The dock's toggle is in the bar, and the window draws its controls here: 46 by 40 each.
  await expect(bar.getByRole('button', { name: 'Hide session' })).toBeVisible()
  const controls = bar.locator('.window-control')
  await expect(controls).toHaveCount(3)
  for (const control of await controls.all()) expect(await control.boundingBox()).toMatchObject({ width: 46, height: 40 })
  await openObject('bracket')
})

test('the terminal is drawn in the colours of the tokens, in both schemes', async () => {
  const theme = () => page.evaluate(() => window.__tornoTerm!.theme())
  expect(await theme()).toEqual({ background: '#FAF9F6', foreground: '#20242B' })
  await page.emulateMedia({ colorScheme: 'dark' })
  await expect.poll(theme).toEqual({ background: '#222529', foreground: '#E9E7E2' })
  await page.emulateMedia({ colorScheme: 'light' })
  await expect.poll(theme).toEqual({ background: '#FAF9F6', foreground: '#20242B' })
  expect(await page.evaluate(() => window.__tornoTerm!.renderer())).not.toBeNull()
})

test('an agent that paints a ground of its own has it to the edges of the pane, the inset with it; one that paints none has the panel', async () => {
  const ground = () => page.evaluate(() => window.__tornoTerm!.ground())
  const panel = await page.evaluate(() => getComputedStyle(document.querySelector('.session-term')!).backgroundColor)
  await typeLine('ground 20 20 30')
  await expect.poll(text).toContain('ground: painted')
  await expect.poll(ground).toEqual({ inset: 'rgb(20, 20, 30)', theme: '#14141e' })
  await typeLine('ground')
  await expect.poll(ground).toEqual({ inset: panel, theme: '#FAF9F6' })
})

test('the status follows the hooks the agent posts', async () => {
  // The build that opening the object began has ended before the turn does: a build that ends in the turn, and was not
  // looked at, is a reason for main to hold the Stop back (`unlooked`), and the status would stay where it was.
  await expect.poll(async () => (await state()).build, { timeout: 30_000 }).toMatchObject({ objectId: 'bracket', status: 'ok' })
  await typeLine('hook')
  // The prompt is answered with where the object's build stands.
  await expect.poll(text).toContain('context: [torno] bracket · ')
  await expect(sessionStatus()).toHaveText('Working')
  await typeLine('hook PermissionRequest')
  await expect(sessionStatus()).toHaveText('Needs you')
  await typeLine('hook Stop')
  await expect(sessionStatus()).toHaveText('Idle')
  // The conversation is on file once the agent has named it.
  const file = JSON.parse(readFileSync(join(root, 'bracket', '.torno', 'session.json'), 'utf8'))
  expect(await text()).toContain(file.conversationId)
})

test('Shift+Enter is a new line for the agent, not a submit', async () => {
  await page.locator('.session-term textarea').focus()
  await page.keyboard.type('two')
  await page.keyboard.press('Shift+Enter')
  // ESC then CR: the stand-in reads the CR as the end of its line and shows the ESC.
  await expect.poll(text).toContain('> two\\e')
})

test('Ctrl+` goes between the session and the viewport; keys typed in the terminal stay there', async () => {
  const inDock = () => page.evaluate(() => document.activeElement?.closest('[data-region="session"]') !== null)
  await page.locator('.session-term textarea').focus()
  const before = await page.evaluate(() => window.__tornoTest!.camera())
  await page.keyboard.type('2o')
  expect(await page.evaluate(() => window.__tornoTest!.camera())).toEqual(before)
  expect((await state()).ortho).toBe(false)
  await page.keyboard.press('Control+U') // clear the line typed

  await page.keyboard.press('Control+Backquote')
  expect(await inDock()).toBe(false)
  await page.keyboard.press('Control+Backquote')
  await expect.poll(inDock).toBe(true)
  expect(await page.evaluate(() => document.activeElement?.tagName)).toBe('TEXTAREA')

  // From the viewport with the dock hidden: the dock comes back, with the focus.
  await page.keyboard.press('Control+Backquote')
  await page.getByRole('button', { name: 'Hide session' }).click()
  await page.evaluate(() => (document.activeElement as HTMLElement).blur())
  await page.keyboard.press('Control+Backquote')
  await expect(dock()).toBeVisible()
  await expect.poll(inDock).toBe(true)
  // The backquote never reached the agent.
  expect(await text()).not.toContain('`')
})

/** The address of torno's MCP server the session shown was given: in the file its `--mcp-config` names. */
async function mcpAddress(): Promise<string> {
  const file = /"--mcp-config","([^"]+\.mcp\.json)"/.exec((await text()).replace(/\s+/g, ''))![1]
  return JSON.parse(readFileSync(file, 'utf8')).mcpServers.torno.url
}

test('each object has its own session, kept while another is shown', async () => {
  await openObject('plain')
  await expect(dock().getByRole('button', { name: 'New session' })).toBeVisible()
  await expect(sessionStatus()).toHaveCount(0)
  expect(await text()).toBe('')
  await newSession(dock())
  await expect.poll(text).toContain('READY')
  // The address it was given, in the file its `--mcp-config` names, ends in its object.
  expect(await mcpAddress()).toMatch(/\/mcp\/plain$/)
  expect(await text()).not.toContain('> hi')

  await openObject('bracket')
  await expect(sessionStatus()).toHaveText('Idle')
  expect(await text()).toContain('> hi')
  expect(await mcpAddress()).toMatch(/\/mcp\/bracket$/)
  await typeLine('still here')
  await expect.poll(text).toContain('> still here')
  expect(agentsIn(join(root, 'bracket'))).toHaveLength(1)
  expect(agentsIn(join(root, 'plain'))).toHaveLength(1)
})

test('a session that ends keeps what it said, and its conversation can be resumed', async () => {
  const conversation = JSON.parse(readFileSync(join(root, 'bracket', '.torno', 'session.json'), 'utf8')).conversationId
  await typeLine('exit')
  await expect(sessionStatus()).toHaveText('Ended')
  expect(await text()).toContain('> still here')
  await expect.poll(() => agentsIn(join(root, 'bracket'))).toEqual([])

  await fromMore(dock(), 'Resume')
  await expect.poll(text).toContain(`"--resume","${conversation}"`)
  await expect(sessionStatus()).toHaveText('Idle')
  expect(await text()).not.toContain('> still here')
  expect(await moreItems(dock())).not.toContain('Resume')

  // A new session takes the place of the one running.
  const [old] = agentsIn(join(root, 'bracket'))
  await newSession(dock())
  await expect.poll(text).toContain('"--session-id"')
  await expect.poll(() => agentsIn(join(root, 'bracket')).filter((pid) => pid !== old)).toHaveLength(1)
  await expect.poll(() => agentsIn(join(root, 'bracket'))).not.toContain(old)
  await typeLine('fresh')
  await expect.poll(text).toContain('> fresh')
})

test('a window loaded again finds the session still running', async () => {
  await page.reload()
  await page.waitForSelector('[data-region="left"]')
  await openObject('bracket')
  await expect(sessionStatus()).toHaveText('Idle')
  await typeLine('back')
  await expect.poll(text).toContain('> back')
  expect(agentsIn(join(root, 'bracket'))).toHaveLength(1)
})

// Seen on the visible screen: a session could be ended only by typing /exit, by replacing it or by choosing another agent.
test('"End" ends the session and starts none, asking first when it is in the middle of something', async () => {
  const end = () => fromMore(dock(), 'End')
  const asked = () => dock().getByRole('alertdialog', { name: 'End the running session?' })
  await expect(sessionStatus()).toHaveText('Idle')
  await typeLine('hook')
  await expect(sessionStatus()).toHaveText('Working')
  await end()
  await expect(asked()).toContainText('Claude Code is working. Ending the session stops it there.')
  await asked().getByRole('button', { name: 'Keep it' }).click()
  await expect(asked()).toHaveCount(0)
  await expect(sessionStatus()).toHaveText('Working')
  expect(agentsIn(join(root, 'bracket'))).toHaveLength(1)
  await end()
  await asked().getByRole('button', { name: 'End it' }).click()
  await expect(sessionStatus()).toHaveText('Ended')
  await expect.poll(() => agentsIn(join(root, 'bracket'))).toEqual([])
  // Ended, there is nothing to end; its conversation can be resumed, as after any end.
  expect(await moreItems(dock())).toEqual(['Resume', 'New session', 'Prompts only', 'What Claude Code reads', 'Hide session'])

  // One at rest is ended at once.
  await newSession(dock())
  await expect(sessionStatus()).toHaveText('Idle')
  await expect.poll(() => agentsIn(join(root, 'bracket'))).toHaveLength(1)
  await end()
  await expect(asked()).toHaveCount(0)
  await expect(sessionStatus()).toHaveText('Ended')
  await expect.poll(() => agentsIn(join(root, 'bracket'))).toEqual([])
  await newSession(dock())
  await expect(sessionStatus()).toHaveText('Idle')
  await expect.poll(() => agentsIn(join(root, 'bracket'))).toHaveLength(1)
})

// The header is one row (spec 2026-11-18, the session dock): the name, the state, the model with its menu, Chat / Terminal, More.
test('the dock\'s header is one row, and "More" holds End, Resume, New session, Prompts only, what Claude Code reads and Hide session', async () => {
  const folder = mkdtempSync(join(realpathSync(tmpdir()), 'torno-e2e-header-'))
  cpSync(fixtures, folder, { recursive: true, filter: (source) => !source.endsWith('__pycache__') })
  const one = await launch({ TORNO_WORKSPACE: folder })
  try {
    const window = await one.firstWindow()
    await window.waitForSelector('[data-region="left"]')
    await openObject('bracket', window)
    await newSession(dock(window))
    const header = dock(window).locator('.session-head')
    await expect(header.getByRole('heading', { name: 'Claude Code' })).toBeVisible()
    await expect(header.getByRole('status')).toHaveText('Idle')
    // One button, named by the model (the CLI says it with its first answer), and the menu it opens holds the model, the edits and the effort.
    await expect(header.getByRole('button', { name: 'Model' })).toBeVisible()
    await dock(window).locator('[data-chat-composer]').focus()
    await window.keyboard.type('say hello there')
    await window.keyboard.press('Enter')
    await expect(dock(window).locator('.chat-turn')).toHaveCount(1, { timeout: 30_000 })
    const model = header.getByRole('button', { name: /^fake-model/ })
    await expect(model).toBeVisible()
    await expect(header.getByRole('combobox')).toHaveCount(0)
    await model.click()
    for (const name of ['Model', 'Edits', 'Effort']) await expect(window.getByRole('combobox', { name })).toBeVisible()
    await window.keyboard.press('Escape')
    await expect(window.getByRole('combobox', { name: 'Model' })).toHaveCount(0)
    await expect(model).toBeFocused()
    // Chat / Terminal.
    const views = header.getByRole('group', { name: 'View' })
    await expect(views.getByRole('button')).toHaveText(['Chat', 'Terminal'])
    await expect(views.getByRole('button', { name: 'Chat' })).toHaveAttribute('aria-pressed', 'true')
    // The quiet lines of today are not under it: they are in the menu.
    await expect(dock(window).locator('.session-reads')).toHaveCount(0)

    const more = header.getByRole('button', { name: 'More', exact: true })
    const menu = window.getByRole('menu', { name: 'More' })
    await more.click()
    await expect(menu.getByRole('menuitem')).toHaveText(['End', 'New session', 'Prompts only', 'What Claude Code reads', 'Hide session'])
    await window.keyboard.press('Escape')
    await expect(menu).toHaveCount(0)
    await expect(more).toBeFocused()

    // What Claude Code reads is in the menu, as paths and sizes.
    await more.click()
    await menu.getByRole('menuitem', { name: 'What Claude Code reads' }).click()
    await expect(menu.locator('.session-reads')).toBeVisible()
    await window.keyboard.press('Escape')

    // End, then Resume is offered; New session starts again.
    await fromMore(dock(window), 'End')
    await expect(header.getByRole('status')).toHaveText('Ended')
    await more.click()
    await expect(menu.getByRole('menuitem')).toHaveText(['Resume', 'New session', 'Prompts only', 'What Claude Code reads', 'Hide session'])
    await menu.getByRole('menuitem', { name: 'Hide session' }).click()
    await expect(dock(window)).toBeHidden()
  } finally {
    await one.close().catch(() => {})
    rmSync(folder, { recursive: true, force: true })
  }
})

// Seen on the visible screen: the window manager's close ended torno and an agent in the middle of its work, with no question.
test('closing the window asks first while a session is in the middle of something, and closes at once when none is', async () => {
  const folder = copyFixtures()
  const closeWindow = (of: ElectronApplication) => of.evaluate(({ BrowserWindow }) => void setTimeout(() => BrowserWindow.getAllWindows()[0]?.close(), 0))
  const windows = (of: ElectronApplication) => of.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().filter((win) => !win.isDestroyed()).length)
  const busy = await launch({ TORNO_WORKSPACE: folder })
  try {
    const window = await busy.firstWindow()
    await window.waitForSelector('[data-region="left"]')
    await openObject('bracket', window)
    await newSession(dock(window))
    await expect(sessionStatus(window)).toHaveText('Idle')
    await typeLine('hook', window)
    await expect(sessionStatus(window)).toHaveText('Working')

    const asked = window.getByRole('alertdialog', { name: 'Close torno?' })
    await closeWindow(busy)
    await expect(asked).toContainText('bracket: Claude Code is working')
    // Over the whole window, in the middle of it; not a strip in the left column.
    expect(await window.locator('[data-region="left"]').getByRole('alertdialog').count()).toBe(0)
    const box = (await asked.boundingBox())!
    const [width, height] = await window.evaluate(() => [innerWidth, innerHeight])
    expect(Math.abs(box.x + box.width / 2 - width / 2)).toBeLessThan(2)
    expect(Math.abs(box.y + box.height / 2 - height / 2)).toBeLessThan(2)
    await expect(asked.getByRole('button')).toHaveText(['bracket', 'Keep it open', 'Close torno'])
    // The button that changes nothing has the focus: a stray Enter keeps torno open.
    await expect(asked.getByRole('button', { name: 'Keep it open' })).toBeFocused()
    await asked.getByRole('button', { name: 'Keep it open' }).click()
    await expect(asked).toHaveCount(0)
    // Longer than a window that does not answer is waited for: it was answered, and stays.
    await window.waitForTimeout(1800)
    expect(await windows(busy)).toBe(1)
    await expect(sessionStatus(window)).toHaveText('Working')
    expect(agentsIn(join(folder, 'bracket'))).toHaveLength(1)

    const closed = busy.waitForEvent('close')
    await closeWindow(busy)
    await asked.getByRole('button', { name: 'Close torno' }).click()
    await closed
    await expect.poll(() => agentsIn(join(folder, 'bracket')), { timeout: 10_000 }).toEqual([])
  } finally {
    await busy.close().catch(() => {})
  }

  // With a session at rest, and with none, nothing is asked.
  const quiet = await launch({ TORNO_WORKSPACE: folder })
  try {
    const window = await quiet.firstWindow()
    await window.waitForSelector('[data-region="left"]')
    await openObject('bracket', window)
    await newSession(dock(window))
    await expect(sessionStatus(window)).toHaveText('Idle')
    const closed = quiet.waitForEvent('close')
    await closeWindow(quiet)
    await closed
    await expect.poll(() => agentsIn(join(folder, 'bracket')), { timeout: 10_000 }).toEqual([])
  } finally {
    await quiet.close().catch(() => {})
    rmSync(folder, { recursive: true, force: true })
  }
})

test('closing the app ends the sessions', async () => {
  const before = [...agentsIn(join(root, 'bracket')), ...agentsIn(join(root, 'plain'))]
  expect(before).toHaveLength(2)
  await app.close()
  await expect.poll(() => [...agentsIn(join(root, 'bracket')), ...agentsIn(join(root, 'plain'))], { timeout: 10_000 }).toEqual([])
})

test('an agent that is not installed is named, and the buttons stay', async () => {
  const other = await launch({ TORNO_WORKSPACE: root, TORNO_AGENT_CMD: 'torno-no-such-agent' })
  try {
    const otherPage = await other.firstWindow()
    await otherPage.waitForSelector('[data-region="left"]')
    await openObject('plain', otherPage)
    await newSession(dock(otherPage))
    await expect(dock(otherPage).getByRole('alert')).toHaveText("cannot start the agent: 'torno-no-such-agent' was not found on PATH")
    await expect(dock(otherPage).getByRole('button', { name: 'New session' })).toBeEnabled()
    await expect(sessionStatus(otherPage)).toHaveCount(0)
  } finally {
    await other.close()
  }
})

// Set TORNO_SHOTS=<dir> to write session-light.png and session-dark.png there:
// the window with a session running. Each picture needs its own launch: on a
// hidden window capturePage() delivers one image and hangs on the next call,
// and page.screenshot() never returns.
for (const scheme of ['light', 'dark'] as const) {
  test(`screenshot of a session, ${scheme}`, async () => {
    const dir = process.env.TORNO_SHOTS
    test.skip(!dir, 'TORNO_SHOTS is not set')
    test.setTimeout(120_000)
    mkdirSync(dir!, { recursive: true })
    const shotRoot = copyFixtures()
    const shotApp = await launch({ TORNO_WORKSPACE: shotRoot })
    try {
      const shotPage = await shotApp.firstWindow()
      await shotPage.emulateMedia({ colorScheme: scheme })
      await openObject('bracket', shotPage)
      await expect.poll(async () => (await state(shotPage)).build?.status, { timeout: 90_000 }).not.toBe('building')
      if (!process.env.TORNO_SHOTS_EMPTY) {
        await newSession(dock(shotPage))
        await expect.poll(() => text(shotPage)).toContain('READY')
        await typeLine('make the post 4 mm taller', shotPage)
        await typeLine('palette', shotPage)
        await typeLine('hook', shotPage)
        await expect(sessionStatus(shotPage)).toHaveText('Working')
      }
      await shotPage.evaluate(async () => {
        await document.fonts.ready
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
      })
      const png = await shotApp.evaluate(async ({ BrowserWindow }) => {
        const image = await BrowserWindow.getAllWindows()[0].webContents.capturePage()
        return image.toPNG().toString('base64')
      })
      writeFileSync(join(dir!, `session-${scheme}${process.env.TORNO_SHOTS_EMPTY ? '-empty' : ''}.png`), Buffer.from(png, 'base64'))
    } finally {
      await shotApp.close()
      rmSync(shotRoot, { recursive: true, force: true })
    }
  })
}
