import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { openListed } from './objects'
import { inTerminal } from './terminal'
import { newSession } from './helpers'

// The instruction files Claude Code reads for an object (a CLAUDE.md above it, the person's own), listed in the session
// pane by path and size (never their text), shown in their folder on a click, and told to the agent with the first
// prompt of a session. The agent is the stand-in; the window is hidden; nothing opens a file manager (`revealedFiles`).
//
// The app gets a HOME of its own, so that the person's real ~/.claude/CLAUDE.md is never listed, and the workspace is
// a folder of it. A machine may have an organisation's file too (/etc/claude-code/CLAUDE.md): only the files this
// test made are asserted.
const appDir = resolve(__dirname, '..')
const fixtures = resolve(appDir, '../kernel/tests/fixtures/ws')
const fakeAgent = resolve(appDir, 'test/fake-agent.mjs')

type Main = { revealedFiles: string[] }

let home: string
let root: string
let app: ElectronApplication | undefined
let page: Page

/** A home folder with a workspace of its own in it, `~/objects`, a copy of the fixtures. */
function setUp(): void {
  home = mkdtempSync(join(realpathSync(tmpdir()), 'torno-e2e-instructions-'))
  root = join(home, 'objects')
  cpSync(fixtures, root, { recursive: true, filter: (source) => !source.endsWith('__pycache__') })
}

async function launch(): Promise<void> {
  // TORNO_TEST=1 makes main create the window with show: false. Never launch without it.
  app = await electron.launch({ args: ['.'], cwd: appDir, env: { ...process.env, TORNO_TEST: '1', HOME: home, TORNO_AGENT_CMD: `node ${fakeAgent}`, TORNO_WORKSPACE: root } })
  page = await app.firstWindow()
  await page.waitForSelector('[data-region="viewport"]')
}

test.afterEach(async () => {
  await app?.close()
  app = undefined
  rmSync(home, { recursive: true, force: true })
})

/** A CLAUDE file in a folder above `dir` (or `dir` itself, not counting the person's own, which the app's HOME holds apart): one Claude Code would read in place of an AGENTS.md. */
function strayClaudeFile(dir: string): string | null {
  for (let at = dirname(dir); ; at = dirname(at)) {
    for (const name of ['CLAUDE.md', join('.claude', 'CLAUDE.md'), 'CLAUDE.local.md']) if (existsSync(join(at, name))) return join(at, name)
    if (dirname(at) === at) return null
  }
}

const dock = () => page.locator('[data-region="session"]')
const reads = () => dock().locator('.session-reads')
const more = () => dock().getByRole('button', { name: 'More', exact: true })
/** The instruction files are under "What Claude Code reads" of the header's More menu: opened as a person does, if they are not in sight. */
async function showReads(): Promise<void> {
  if (!(await reads().isVisible())) {
    await more().click()
    await page.getByRole('menu', { name: 'More' }).getByRole('menuitem', { name: 'What Claude Code reads' }).click()
  }
  await expect(reads()).toBeVisible()
}
async function hideReads(): Promise<void> {
  if (await reads().isVisible()) await page.keyboard.press('Escape')
  await expect(reads()).toHaveCount(0)
}
const revealed = (): Promise<string[]> => app!.evaluate(() => [...(globalThis as unknown as { __tornoMain: Main }).__tornoMain.revealedFiles])

test('a CLAUDE.md above the object and the person\'s own are listed with their sizes, a click shows one in its folder, and the first prompt tells the agent', async () => {
  setUp()
  const above = join(root, 'CLAUDE.md')
  const own = join(home, '.claude', 'CLAUDE.md')
  writeFileSync(above, 'a'.repeat(3000))
  mkdirSync(join(home, '.claude'))
  writeFileSync(own, 'b'.repeat(900))
  // An AGENTS.md beside the object is not read by Claude Code while a CLAUDE.md is above it.
  writeFileSync(join(root, 'bracket', 'AGENTS.md'), 'c')
  await launch()
  await openListed(page, 'bracket')

  // Under More, before any session: not a question, not a dialog, and no line under the header.
  await expect(reads()).toHaveCount(0)
  await showReads()
  await expect(reads()).toContainText('Claude Code also reads, by default')
  const row = (path: string) => reads().locator('.session-read', { hasText: path })
  await expect(row('~/objects/CLAUDE.md')).toContainText('2.9 KB')
  await expect(row('~/.claude/CLAUDE.md')).toContainText('900 B')
  await expect(reads()).not.toContainText('AGENTS.md')
  await expect(page.getByRole('alertdialog')).toHaveCount(0)
  await expect(reads()).toHaveAttribute('title', /torno lists their paths and sizes and never reads or changes them/)
  // Paths and sizes are set in the face of numbers.
  expect(await row('~/objects/CLAUDE.md').evaluate((el) => getComputedStyle(el).fontFamily)).toMatch(/mono/i)

  // A click shows the file in its folder: main is given the row's place and finds the path itself.
  expect(await revealed()).toEqual([])
  await row('~/objects/CLAUDE.md').getByRole('menuitem').click()
  await expect.poll(revealed).toEqual([above])
  await hideReads()

  // The first prompt of the session carries the sentence, and the person sees it under "torno added".
  await newSession(dock())
  await expect(dock().locator('.chat')).toBeVisible()
  await showReads()
  await hideReads()
  const say = async (prompt: string): Promise<void> => {
    await dock().locator('[data-chat-composer]').focus()
    await page.keyboard.type(prompt)
    await page.keyboard.press('Enter')
  }
  await say('say hello there')
  await expect(dock().locator('.chat-turn')).toHaveCount(1, { timeout: 30_000 })
  const added = dock().locator('.chat-added')
  await added.first().getByRole('button', { name: 'Show text' }).click()
  // Named in the "torno added" line itself, with no need to open the text.
  await expect(added.first().locator('.chat-added-instructions')).toHaveText('2 instruction files')
  await expect(added.first().locator('.chat-added-instructions .num')).toHaveText('2')
  const told = added.first().locator('.chat-added-text')
  await expect(told).toContainText('Claude Code loads these instruction files here by default:')
  await expect(told).toContainText('~/objects/CLAUDE.md (2.9 KB)')
  await expect(told).toContainText('~/.claude/CLAUDE.md (900 B)')
  await expect(told).toContainText("What torno's tools say of the build is current")
  await expect(told).toContainText('take its advice on how to model, not on how to see the build')
  // Not with the next prompt of the same session.
  await say('say hello again')
  await expect(dock().locator('.chat-turn')).toHaveCount(2, { timeout: 30_000 })
  await expect(added).toHaveCount(2)
  await added.nth(1).getByRole('button', { name: 'Show text' }).click()
  await expect(added.nth(1).locator('.chat-added-text')).not.toContainText('instruction files')
  await expect(added.nth(1).locator('.chat-added-instructions')).toHaveCount(0)

  // torno read nothing of the files' text and changed nothing: they are as they were, and nothing else is beside them.
  expect(readFileSync(above, 'utf8')).toBe('a'.repeat(3000))
  expect(readFileSync(own, 'utf8')).toBe('b'.repeat(900))
  expect(readdirSync(join(home, '.claude'))).toEqual(['CLAUDE.md'])
})

test('with Claude Code\'s terminal the pane says it too, and an AGENTS.md is read when no CLAUDE.md is above the object', async () => {
  setUp()
  writeFileSync(join(root, 'AGENTS.md'), 'd'.repeat(10))
  mkdirSync(join(root, 'bracket', '.claude', 'rules'), { recursive: true })
  writeFileSync(join(root, 'bracket', '.claude', 'rules', 'style.md'), 'e'.repeat(2048))
  inTerminal(root)
  await launch()
  await openListed(page, 'bracket')
  // A rules folder is one entry: the folder, its files (at most that many load) and their size.
  await showReads()
  await expect(reads().locator('.session-read', { hasText: 'bracket/.claude/rules/' })).toContainText('up to 1 file, 2 KB')
  // Claude Code reads an AGENTS.md only where no CLAUDE file is in the folder or above it. The app looks up to `/` as Claude Code does, so
  // a machine whose temporary folder lies under a folder with one cannot show it: that assertion is then skipped, and says why.
  const stray = strayClaudeFile(home)
  test.skip(stray !== null, `${stray} is above the temporary folder, so Claude Code would not read an AGENTS.md here`)
  await expect(reads()).toContainText('~/objects/AGENTS.md')
  await expect(reads()).toContainText('10 B')
  await hideReads()
  await newSession(dock())
  await expect.poll(() => page.evaluate(() => window.__tornoTerm!.text())).toContain('READY')
  await showReads()
  await expect(reads()).toContainText('~/objects/AGENTS.md')
  await expect(dock().locator('.chat')).toHaveCount(0)
})
