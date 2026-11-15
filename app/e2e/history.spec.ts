import { cpSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import type { TornoState } from '../src/renderer/state/store'
import type { HistoryEntry } from '../src/shared/history'
import { openListed } from './objects'

// The history of a project is Prompts only: one row for each prompt, across the project's conversations, opened by the
// status line's History button or by the chat's own toggle. Clicking a row compares it, a double click opens it in the chat;
// in a terminal's view the same list is a pane of its own, from the history's labels. The agent is the stand-in in its
// stream mode (test/fake-agent.mjs); the window is hidden.
const appDir = resolve(__dirname, '..')
const fixtures = resolve(appDir, '../kernel/tests/fixtures/ws')
const fakeAgent = resolve(appDir, 'test/fake-agent.mjs')

test.describe.configure({ mode: 'serial' })

let root: string
let app: ElectronApplication
let page: Page

const model = () => join(root, 'hollow', 'hollow.py')
const kept = (): HistoryEntry[] => JSON.parse(readFileSync(join(root, 'hollow', '.torno', 'history', 'index.json'), 'utf8')).entries
const state = (): Promise<TornoState> => page.evaluate(() => window.__tornoTest!.state())
const dock = () => page.locator('[data-region="session"]')
const chat = () => dock().locator('.chat')
const composer = () => dock().locator('[data-chat-composer]')
const turns = () => chat().locator('.chat-turn')
const prompts = () => dock().locator('[data-part="prompts"]')
const rows = () => prompts().locator('.prompt')
const historyButton = () => page.getByRole('button', { name: 'History', exact: true })

async function say(prompt: string): Promise<void> {
  await composer().focus()
  await page.keyboard.type(prompt)
  await page.keyboard.press('Enter')
}

async function builtRevision(revision: number): Promise<void> {
  await expect.poll(async () => { const s = await state(); return s.build?.status === 'ok' && s.build.revision }, { timeout: 30_000 }).toBe(revision)
}

/** A prompt that edits the model, once the turn has ended and its build is kept. */
async function edit(from: string, to: string, turn: number): Promise<void> {
  const before = kept().length
  await say(`edit hollow.py "wall: float = ${from}" "wall: float = ${to}"`)
  await expect(turns()).toHaveCount(turn, { timeout: 30_000 })
  await expect.poll(() => kept().slice(before).some((e) => e.cause === 'agent' && !e.failed), { timeout: 30_000 }).toBe(true)
}

const terminalEntry = (id: string, at: string, prompt: string, text: string): HistoryEntry => ({
  id, at, run: 'old', revision: 1, sources: 'a'.repeat(12), model: 'bracket/bracket.py', files: [], parts: 1, seconds: 1, line: 'first build kept', cause: 'agent', turn: { conversation: 'term-conv', prompt, text }
})

test.beforeAll(async () => {
  root = mkdtempSync(join(realpathSync(tmpdir()), 'torno-e2e-history-'))
  cpSync(fixtures, root, { recursive: true, filter: (source) => !source.endsWith('__pycache__') })
  // bracket is a project whose agent is the terminal, with prompts said there that only the history knows.
  mkdirSync(join(root, 'bracket', '.torno', 'history'), { recursive: true })
  writeFileSync(join(root, 'bracket', '.torno', 'agent.json'), JSON.stringify({ agent: 'claude', view: 'terminal' }))
  writeFileSync(
    join(root, 'bracket', '.torno', 'history', 'index.json'),
    JSON.stringify({
      next: 4,
      entries: [
        terminalEntry('h1', '2026-01-01T10:00:00.000Z', 't-term-conv-1', 'make the base wider'),
        terminalEntry('h2', '2026-01-01T10:05:00.000Z', 't-term-conv-1', 'make the base wider'),
        terminalEntry('h3', '2026-01-02T10:00:00.000Z', 't-term-conv-2', 'add a hole for the screw')
      ]
    })
  )
  app = await electron.launch({ args: ['.'], cwd: appDir, env: { ...process.env, TORNO_TEST: '1', TORNO_AGENT_CMD: `node ${fakeAgent}`, TORNO_WORKSPACE: root } })
  page = await app.firstWindow()
  await page.waitForSelector('[data-region="left"]')
})

test.afterAll(async () => {
  await app?.close()
  rmSync(root, { recursive: true, force: true })
})

test('History in the status line opens Prompts only: a row for each prompt, newest first, with the builds that came out of it', async () => {
  await openListed(page, 'hollow')
  await builtRevision(1)
  await dock().getByRole('button', { name: 'New session' }).click()
  await expect(composer()).toBeEnabled()
  await edit('2', '3', 1)
  await edit('3', '4', 2)
  await say('say nothing was built')
  await expect(turns()).toHaveCount(3, { timeout: 30_000 })

  await historyButton().click()
  await expect(prompts()).toBeVisible()
  await expect(historyButton()).toHaveAttribute('aria-expanded', 'true')
  await expect(chat().getByRole('button', { name: 'Prompts only' })).toHaveAttribute('aria-pressed', 'true')
  await expect(rows()).toHaveCount(3)
  // Numbered across the project, newest first.
  await expect(rows().locator('.prompt-number')).toHaveText(['3', '2', '1'])
  await expect(rows().nth(0)).toContainText('say nothing was built')
  await expect(rows().nth(1)).toContainText('wall: float = 4')
  // A prompt's builds as `from → to`, what they came to in a word, and when.
  await expect(rows().nth(1).locator('.prompt-facts')).toContainText(/h\d+ → h\d+/)
  await expect(rows().nth(1).locator('.prompt-result')).toHaveText('passes')
  await expect(rows().nth(0).locator('.prompt-result')).toHaveCount(0)
  await expect(rows().nth(1).locator('.prompt-facts')).toContainText('just now')
  await expect(prompts().locator('.prompts-summary')).toContainText('3 prompts')
  await expect(prompts().locator('.prompts-summary')).toContainText('1 conversation')
  // The picture of each build as it is made.
  await expect.poll(() => prompts().locator('.prompt-thumb img').count(), { timeout: 15_000 }).toBeGreaterThan(0)
  // Where the conversation began.
  await expect(prompts().locator('.prompt-began')).toContainText('Conversation began')

  // The same button, or the chat's own toggle, puts it away.
  await historyButton().click()
  await expect(prompts()).toHaveCount(0)
  await expect(historyButton()).toHaveAttribute('aria-expanded', 'false')
  await chat().getByRole('button', { name: 'Prompts only' }).click()
  await expect(prompts()).toBeVisible()
  await chat().getByRole('button', { name: 'Chat', exact: true }).click()
  await expect(prompts()).toHaveCount(0)
})

test('a click on a row compares that prompt, with its number in the status line; again puts it away', async () => {
  await historyButton().click()
  const row = rows().nth(1)
  const [from, to] = (await row.locator('.prompt-facts .num').first().innerText()).split(' → ')
  await row.locator('.prompt-row').click()
  await expect.poll(async () => (await state()).compare).toMatchObject({ from, to, mode: 'overlay', prompt: 2 })
  await expect(page.locator('.status-compare')).toContainText(`comparing prompt 2 · ${from} → ${to}`)
  await expect(row.locator('.prompt-row')).toHaveAttribute('aria-pressed', 'true')
  // A prompt that built nothing has nothing to compare.
  await expect(rows().nth(0).locator('.prompt-row')).toBeDisabled()
  await rows().nth(0).locator('.prompt-row').click({ force: true })
  expect((await state()).compare).toMatchObject({ prompt: 2 })
  await row.locator('.prompt-row').click()
  await expect.poll(async () => (await state()).compare).toBeNull()
  await expect(page.locator('.status-compare')).toHaveCount(0)
})

test('Starred lists the prompts with a starred build, and the saves of the person are lines between the rows', async () => {
  // Star the last build of prompt 2 from its turn in the chat.
  await chat().getByRole('button', { name: 'Chat', exact: true }).click()
  await turns().nth(1).getByRole('button', { name: 'Star', exact: true }).click()
  await expect.poll(() => kept().some((e) => e.starred)).toBe(true)
  await historyButton().click()
  await expect(rows().nth(1).locator('.prompt-star')).toBeVisible()
  await prompts().getByRole('button', { name: 'Starred', exact: true }).click()
  await expect(rows()).toHaveCount(1)
  await expect(rows().first().locator('.prompt-number')).toHaveText('2')
  await prompts().getByRole('button', { name: 'Starred', exact: true }).click()
  await expect(rows()).toHaveCount(3)

  // The person saves the model in their own editor: a line, from the history's cause, above the newest prompt.
  const saved = kept().length
  writeFileSync(model(), `${readFileSync(model(), 'utf8')}\n# saved by the person\n`)
  await expect.poll(() => kept().slice(saved).find((e) => e.cause === 'person'), { timeout: 30_000 }).toBeTruthy()
  const line = prompts().locator('.prompt-between').first()
  await expect(line).toContainText('You saved')
  await expect(line).toContainText('in your editor')
})

test('a double click on a row opens the chat at that prompt', async () => {
  const first = rows().nth(2)
  const id = (await first.getAttribute('data-prompt'))!
  await first.locator('.prompt-row').dblclick()
  await expect(prompts()).toHaveCount(0)
  await expect(chat().getByRole('button', { name: 'Chat', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await expect(chat().locator(`.chat-group[data-id="${id}"]`)).toBeInViewport()
  await expect(chat().locator(`.chat-group[data-id="${id}"]`)).toContainText('wall: float = 3')
  // Another way in, by the keys: "Open in chat" on the row.
  await historyButton().click()
  await rows().nth(1).getByRole('button', { name: 'Open in chat' }).click()
  await expect(prompts()).toHaveCount(0)
})

test('a new conversation goes on with the numbers, lists beside the earlier one, and the earlier can be read above it', async () => {
  await dock().getByRole('button', { name: 'New session' }).click()
  await expect(composer()).toBeEnabled()
  await expect(turns()).toHaveCount(0)
  await edit('4', '5', 1)
  // The turn's own Compare says the prompt's number: 4, the project's, not 1, the conversation's.
  await turns().last().getByRole('button', { name: 'Compare', exact: true }).click()
  await expect.poll(async () => (await state()).compare).toMatchObject({ prompt: 4 })
  await turns().last().getByRole('button', { name: 'Comparing' }).click()

  await historyButton().click()
  await expect(rows().locator('.prompt-number')).toHaveText(['4', '3', '2', '1'])
  await expect(prompts().locator('.prompt-began')).toHaveCount(2)
  await expect(prompts().locator('.prompt-began', { hasText: 'the one in the chat' })).toHaveCount(1)
  await expect(prompts().locator('.prompts-summary')).toContainText('2 conversations')
  await chat().getByRole('button', { name: 'Chat', exact: true }).click()

  // The chat shows this conversation; the earlier is there on demand, and says what it said.
  await expect(chat().locator('.chat-user')).toHaveCount(1)
  await chat().getByRole('button', { name: 'Earlier conversations (1)' }).click()
  const earlier = chat().locator('.chat-conversation')
  await expect(earlier).toHaveCount(1)
  await expect(earlier.locator('.chat-user')).toHaveCount(3)
  await expect(earlier).toContainText('say nothing was built')

  // A double click on a prompt of that conversation opens it there.
  await historyButton().click()
  const old = rows().nth(3)
  const id = (await old.getAttribute('data-prompt'))!
  await old.locator('.prompt-row').dblclick()
  await expect(chat().locator(`.chat-group[data-id="${id}"]`)).toBeInViewport()
})

test('where the agent is a terminal the same list is a pane over the session, from what the history knows of its prompts', async () => {
  await openListed(page, 'bracket')
  await builtRevision(1)
  await expect(prompts()).toHaveCount(0)
  await historyButton().click()
  const pane = dock().locator('.session-prompts')
  await expect(pane).toBeVisible()
  await expect(rows()).toHaveCount(2)
  await expect(rows().locator('.prompt-number')).toHaveText(['2', '1'])
  await expect(rows().nth(0)).toContainText('add a hole for the screw')
  await expect(rows().nth(1)).toContainText('make the base wider')
  // A terminal's prompt is in no chat: nothing to open.
  await expect(pane.getByRole('button', { name: 'Open in chat' })).toHaveCount(0)
  await expect(pane.locator('.prompt-began')).toHaveCount(1)
  await pane.getByRole('button', { name: 'Close' }).click()
  await expect(pane).toHaveCount(0)
  await expect(historyButton()).toHaveAttribute('aria-expanded', 'false')
})
