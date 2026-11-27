import { cpSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import type { TornoState } from '../src/renderer/state/store'
import { openListed } from './objects'
import { newSession, showModel } from './helpers'

// What Claude Code spent (#357): the sentence under a turn's end (#368), and the Usage page (#371) with a conversation's ledger
// and why its large turn was large (#369). The project's earlier conversation is a chat log written by the spec, with the CLI's
// numbers on its turns, as the transcript keeps them; the live turn is the stand-in's, which says it cost nothing. Hidden window.
const appDir = resolve(__dirname, '..')
const fixtures = resolve(appDir, '../kernel/tests/fixtures/ws')
const fakeAgent = resolve(appDir, 'test/fake-agent.mjs')
const EARLIER = '5f0c1d2e-0000-4000-8000-00000000aaaa'

test.describe.configure({ mode: 'serial' })

let root: string
let app: ElectronApplication
let page: Page

const state = (): Promise<TornoState> => page.evaluate(() => window.__tornoTest!.state())
const dock = () => page.locator('[data-region="session"]')
const usagePage = () => page.locator('main.viewport .usage-page')

/** An earlier conversation of five prompts: four of $1, then one of $8 with 14 pictures from look, and a first turn after a resume. */
function writeEarlier(dir: string): void {
  const hour = 60 * 60 * 1000
  const at = Date.now() - 6 * hour
  const lines: object[] = []
  const turn = (n: number, cost: number | undefined, requests: number) => ({ kind: 'turn', id: `e${n}`, ok: true, stopped: false, seconds: 20, pulled: {}, usage: { input: 10, output: 2000, cacheRead: 150_000 * requests, cacheCreation: 9000, requests, ...(cost !== undefined ? { costUsd: cost, sessionCostUsd: 1 } : {}) } })
  for (let n = 1; n <= 6; n++) {
    lines.push({ kind: 'user', id: `u${n}`, text: n === 5 ? 'Look at it from every side' : `Prompt said ${n}`, images: [], state: 'sent', at: at + n * 10 * 60 * 1000 })
    if (n === 5) lines.push({ kind: 'tool', id: 'look5', toolUseId: 'look5', name: 'mcp__torno__look', torno: true, input: {}, state: 'done', images: Array.from({ length: 14 }, (_, i) => ({ id: `p${i}`, mediaType: 'image/png' })) })
    lines.push(n === 5 ? turn(n, 8, 62) : n === 6 ? turn(n, undefined, 7) : turn(n, 1, 8))
  }
  mkdirSync(join(dir, '.torno', 'chat'), { recursive: true })
  writeFileSync(join(dir, '.torno', 'chat', `${EARLIER}.jsonl`), `${lines.map((l) => JSON.stringify(l)).join('\n')}\n`)
}

test.beforeAll(async () => {
  root = mkdtempSync(join(realpathSync(tmpdir()), 'torno-e2e-usage-'))
  cpSync(fixtures, root, { recursive: true, filter: (source) => !source.endsWith('__pycache__') })
  writeEarlier(join(root, 'hollow'))
  app = await electron.launch({ args: ['.'], cwd: appDir, env: { ...process.env, TORNO_TEST: '1', TORNO_AGENT_CMD: `node ${fakeAgent}`, TORNO_WORKSPACE: root } })
  page = await app.firstWindow()
  await page.waitForSelector('[data-region="viewport"]')
})

test.afterAll(async () => {
  await app?.close()
  rmSync(root, { recursive: true, force: true })
})

test('the end of a turn says what it took, from what Claude Code said', async () => {
  await openListed(page, 'hollow')
  await expect.poll(async () => (await state()).build?.status, { timeout: 30_000 }).toBe('ok')
  await newSession(dock())
  await expect(dock().locator('[data-chat-composer]')).toBeEnabled()
  // Claude edits once, then asks to run a command and waits: the person saves meanwhile, and that save is built.
  const model = join(root, 'hollow', 'hollow.py')
  await dock().locator('[data-chat-composer]').fill('edit hollow.py "wall: float = 2" "wall: float = 3"\nask Bash {"command":"python gen.py"}')
  await dock().locator('[data-chat-composer]').press('Enter')
  const ask = dock().locator('.chat .chat-ask').last()
  await expect(ask.getByRole('button', { name: 'Allow', exact: true })).toBeVisible({ timeout: 30_000 })
  await expect.poll(async () => (await state()).build?.revision, { timeout: 30_000 }).toBe(2)
  writeFileSync(model, `${readFileSync(model, 'utf8')}\n# mine\n`)
  await expect.poll(async () => (await state()).build, { timeout: 30_000 }).toMatchObject({ status: 'ok', revision: 3, made: { cause: 'person' } })
  await ask.getByRole('button', { name: 'Allow', exact: true }).click()
  const turn = dock().locator('.chat .chat-turn')
  await expect(turn.locator('.chat-turn-usage')).toHaveText('$0 for 1 call: 0 of context read again, 1 new to it, 1 written.', { timeout: 30_000 })
  // The turn's own build alone: not the one of the save made by hand, though it is under the command's card.
  await expect(turn).toContainText('r1 → r2 ok')
})

test('the Usage page says the week in a sentence, its days, where the tokens went and the conversations', async () => {
  await page.locator('.pboard-switch').getByRole('button', { name: 'Usage', exact: true }).click()
  await expect(usagePage()).toBeVisible()
  await expect(usagePage().locator('h1')).toHaveText('Usage of hollow')
  // 4 × $1 + $8, the resumed turn not counted; 7 prompts with the live one, in 2 conversations.
  await expect(usagePage().locator('.usage-lead')).toContainText('$12.00 over 7 prompts in 2 conversations.')
  await expect(usagePage().locator('.usage-lead small')).toContainText('Prompt 5 took 67 % of the week: 62 calls and 14 pictures.')
  await expect(usagePage().locator('.usage-lead small')).toContainText('1 first turn after a resume has no cost to count.')
  await expect(usagePage().locator('svg.usage-days')).toBeVisible()
  await expect(usagePage().locator('.usage-legend')).toContainText('read again')
  await expect(usagePage().locator('.usage-convs tbody tr')).toHaveCount(2)
  // The model is out of sight while the page is up, and the timeline with it.
  expect(await page.evaluate(() => window.__tornoTest!.paused())).toBe(true)
})

test('a conversation opens to its prompts as a ledger, the large one with why, the resume as a line', async () => {
  await usagePage().locator(`.usage-convs tr[data-conversation="${EARLIER}"] .usage-conv`).click()
  await expect(usagePage().locator('.usage-lead')).toHaveText('$12.00 for 6 prompts and 101 calls, with 1 turn of unknown cost.')
  const hot = usagePage().locator('.usage-ledger tr[data-hot]')
  await expect(hot).toHaveCount(1)
  await expect(hot).toContainText('Look at it from every side')
  const why = usagePage().locator('.usage-ledger-why .usage-why')
  await expect(why).toContainText("Why this turn was large: 8 × this project's usual turn")
  await expect(why).toContainText('14 pictures came in on the way, all from look.')
  await expect(usagePage().locator('.usage-ledger-sep')).toHaveText('Resumed here, in a new Claude Code process')
  await expect(usagePage().locator('.usage-ledger tr[data-prompt="u6"]')).toContainText('not known')
  await usagePage().locator('.usage-back').click()
  await expect(usagePage().locator('.usage-convs')).toBeVisible()
  // The live conversation's one prompt built once: the save made by hand during its turn is not counted.
  await usagePage().locator(`.usage-convs tbody tr:not([data-conversation="${EARLIER}"]) .usage-conv`).click()
  await expect(usagePage().locator('.usage-ledger tbody tr[data-prompt] td:nth-child(5)')).toHaveText('1')
  await usagePage().locator('.usage-back').click()
  await showModel(page)
  await expect(usagePage()).toHaveCount(0)
})
