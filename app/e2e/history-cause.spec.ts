import { cpSync, existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import type { HistoryEntry } from '../src/shared/history'
import type { TornoState } from '../src/renderer/state/store'
import { openListed } from './objects'

// What caused each build kept in a project's history, as main decides it and writes it in `.torno/history/index.json`:
// the person saving the file, the agent after its turn's first edit (with the prompt it came out of), the person's
// Params, and a failed build, which is a line of the history with no copies. Read from the file, never from the window.
const appDir = resolve(__dirname, '..')
const fixtures = resolve(appDir, '../kernel/tests/fixtures/ws')
const fakeAgent = resolve(appDir, 'test/fake-agent.mjs')

test.describe.configure({ mode: 'serial' })

let root: string
let app: ElectronApplication
let page: Page

const model = () => join(root, 'hollow', 'hollow.py')
const state = (): Promise<TornoState> => page.evaluate(() => window.__tornoTest!.state())
const entries = (): HistoryEntry[] => JSON.parse(readFileSync(join(root, 'hollow', '.torno', 'history', 'index.json'), 'utf8')).entries

test.beforeAll(async () => {
  root = mkdtempSync(join(realpathSync(tmpdir()), 'torno-e2e-cause-'))
  cpSync(fixtures, root, { recursive: true, filter: (source) => !source.endsWith('__pycache__') })
  app = await electron.launch({ args: ['.'], cwd: appDir, env: { ...process.env, TORNO_TEST: '1', TORNO_AGENT_CMD: `node ${fakeAgent}`, TORNO_WORKSPACE: root } })
  page = await app.firstWindow()
  await page.waitForSelector('[data-region="viewport"]')
})

test.afterAll(async () => {
  await app?.close()
  rmSync(root, { recursive: true, force: true })
})

async function landed(revision: number): Promise<void> {
  await expect.poll(async () => { const s = await state(); return s.build?.status === 'ok' && s.build.revision }, { timeout: 30_000 }).toBe(revision)
}

test('a save of the person, the person\'s params, an edit of the agent and a failure of it are told apart', async () => {
  // The build that opens the project is of files that may have changed while torno was closed: no one's.
  await openListed(page, 'hollow')
  await landed(1)
  const source = readFileSync(model(), 'utf8')
  // The person saves the file.
  writeFileSync(model(), source.replace('wall: float = 2', 'wall: float = 3'))
  await landed(2)
  // The person tries a value of Params.
  await page.evaluate(() => window.torno.object.setParam('hollow', 'wall', 4))
  await landed(3)

  // The agent edits the model in a turn, and what it wrote fails to build.
  const { sessionId } = await page.evaluate(() => window.torno.session.start('hollow'))
  await page.evaluate((id) => window.torno.chat.send(id, { text: 'edit hollow.py "return {" "return WAL, {"' }), sessionId)
  await expect.poll(async () => entries().some((e) => e.failed), { timeout: 30_000 }).toBe(true)

  const kept = entries()
  expect(kept.map((e) => [e.cause, e.failed === true])).toEqual([['unknown', false], ['person', false], ['params', false], ['agent', true]])
  const failed = kept[3]
  expect(failed.turn).toMatchObject({ text: 'edit hollow.py "return {" "return WAL, {"' })
  expect(failed.turn!.conversation).toMatch(/^[0-9a-f-]{36}$/)
  // The prompt is the id of the person's `user` item in the chat's log, which a later view joins on.
  const log = join(root, 'hollow', '.torno', 'chat', `${failed.turn!.conversation}.jsonl`)
  await expect.poll(() => existsSync(log) && readFileSync(log, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as { kind: string; id: string }).some((i) => i.kind === 'user' && i.id === failed.turn!.prompt), { timeout: 15_000 }).toBe(true)
  expect(failed).toMatchObject({ files: [], error: expect.stringContaining('WAL'), revision: 3 })
  expect(kept[0].turn).toBeUndefined()
  await page.evaluate((id) => window.torno.session.stop(id), sessionId)
})
