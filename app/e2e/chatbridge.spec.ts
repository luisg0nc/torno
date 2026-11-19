import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import type { ChatHistory, ChatItem } from '../src/shared/chat'
import type { TornoState } from '../src/renderer/state/store'
import { openListed } from './objects'

// What the window may ask of main about a chat session (`window.torno.chat`), through the real preload and IPC, with
// the stand-in agent (test/fake-agent.mjs) in the stream mode of Claude Code's headless CLI. The pane of the chat
// (e2e/chat.spec.ts) is not what is tested here: these calls are made from the page, with the session started and the
// object's view chosen by the bridge itself.
const appDir = resolve(__dirname, '..')
const fixtures = resolve(appDir, '../kernel/tests/fixtures/ws')
const fakeAgent = resolve(appDir, 'test/fake-agent.mjs')

let root: string
let app: ElectronApplication
let page: Page

test.beforeAll(async () => {
  root = mkdtempSync(join(realpathSync(tmpdir()), 'torno-e2e-chatbridge-'))
  cpSync(fixtures, root, { recursive: true, filter: (source) => !source.endsWith('__pycache__') })
  app = await electron.launch({ args: ['.'], cwd: appDir, env: { ...process.env, TORNO_TEST: '1', TORNO_AGENT_CMD: `node ${fakeAgent}`, TORNO_WORKSPACE: root } })
  page = await app.firstWindow()
  await page.waitForSelector('[data-region="viewport"]')
  await openListed(page, 'measures')
  await expect.poll(async () => (await page.evaluate(() => window.__tornoTest!.state() as TornoState)).build, { timeout: 30_000 }).toMatchObject({ objectId: 'measures', status: 'ok' })
})

test.afterAll(async () => {
  await app?.close()
  rmSync(root, { recursive: true, force: true })
})

const choiceOnDisk = (): unknown => JSON.parse(readFileSync(join(root, 'measures', '.torno', 'agent.json'), 'utf8'))
const history = (sessionId: string): Promise<ChatHistory> => page.evaluate((id) => window.torno.chat.history(id), sessionId)
const kinds = async (sessionId: string): Promise<string[]> => (await history(sessionId)).items.map((i) => i.kind)
const turns = async (sessionId: string): Promise<number> => (await kinds(sessionId)).filter((k) => k === 'turn').length
const failure = (call: () => Promise<unknown>): Promise<string> => call().then(() => 'done', (e: Error) => e.message)

test('a chat session is started, spoken to, answered, interrupted and read back through the bridge', async () => {
  // The view is chosen for the sessions to come, and only a view there is.
  await page.evaluate(() => window.torno.session.chooseView('measures', 'terminal'))
  expect(choiceOnDisk()).toEqual({ agent: 'claude', view: 'terminal' })
  await page.evaluate(() => window.torno.session.chooseView('measures', 'chat'))
  expect(choiceOnDisk()).toEqual({ agent: 'claude', view: 'chat' })
  expect(await failure(() => page.evaluate(() => window.torno.session.chooseView('measures', 'both' as never)))).toContain('no view named')

  const started = await page.evaluate(() => window.torno.session.start('measures'))
  expect(started.view).toBe('chat')
  const id = started.sessionId
  // Said before the session can end it: no view can be chosen under a running session.
  expect(await failure(() => page.evaluate(() => window.torno.session.chooseView('measures', 'terminal')))).toContain('End the session first')

  // What is told of the session as it goes.
  await page.evaluate((sessionId) => {
    const w = window as unknown as { __told: Array<{ sessionId: string; item: ChatItem; seq: number }> }
    w.__told = []
    window.torno.chat.onItem((m) => m.sessionId === sessionId && w.__told.push(m))
  }, id)

  expect((await history(id)).items).toEqual([])
  await page.evaluate((sessionId) => window.torno.chat.send(sessionId, { text: 'say hello there' }), id)
  await expect.poll(() => turns(id), { timeout: 10_000 }).toBe(1)
  const first = await history(id)
  // What torno added to the prompt (the build, at least) is under it.
  expect(first.items.map((i) => i.kind)).toEqual(['user', 'context', 'text', 'turn'])
  expect(first.items[1]).toMatchObject({ forUser: first.items[0].id })
  expect(first.items[2]).toMatchObject({ text: 'hello there', streaming: false })
  expect(first.meta).toMatchObject({ model: 'fake-model', tornoConnected: true })
  expect(first.earlier).toEqual([])
  await expect.poll(() => page.evaluate(() => (window as unknown as { __told: unknown[] }).__told.length)).toBeGreaterThanOrEqual(3)
  const seqs = await page.evaluate(() => (window as unknown as { __told: Array<{ seq: number }> }).__told.map((m) => m.seq))
  expect(seqs).toEqual([...seqs].sort((a, b) => a - b))
  expect(seqs.at(-1)).toBeLessThanOrEqual(first.seq)
  await expect.poll(async () => (await history(id)).commands.map((c) => c.name)).toEqual(['compact', 'clear'])

  // The view as the person has it, in the prompt: a picture of the window's viewport, 1280 px on its long edge.
  await page.evaluate((sessionId) => window.torno.chat.send(sessionId, { text: 'say with a view', attachView: true }), id)
  await expect.poll(() => turns(id), { timeout: 10_000 }).toBe(2)
  const withView = (await history(id)).items.filter((i): i is Extract<ChatItem, { kind: 'user' }> => i.kind === 'user')[1]
  expect(withView.images).toHaveLength(1)
  expect(withView.images[0]).toMatchObject({ mediaType: 'image/png' })
  expect(Math.max(withView.images[0].width!, withView.images[0].height!)).toBe(1280)
  expect(Buffer.from(withView.images[0].data!, 'base64').subarray(1, 4).toString()).toBe('PNG')

  // A request of the agent's waits for the person, who answers it.
  await page.evaluate((sessionId) => window.torno.chat.send(sessionId, { text: 'ask Bash {"command":"ls"}' }), id)
  await expect.poll(async () => (await history(id)).items.some((i) => i.kind === 'ask' && i.state === 'open')).toBe(true)
  const ask = (await history(id)).items.find((i) => i.kind === 'ask') as Extract<ChatItem, { kind: 'ask' }>
  await page.evaluate(([sessionId, requestId]) => window.torno.chat.answer(sessionId, requestId, { allow: true, updatedInput: { command: 'rm -rf /' } }), [id, ask.requestId])
  await expect.poll(() => turns(id), { timeout: 10_000 }).toBe(3)
  const done = (await history(id)).items
  expect(done.find((i) => i.kind === 'ask')).toMatchObject({ state: 'allowed' })
  expect(done.find((i) => i.kind === 'tool')).toMatchObject({ result: 'allowed: {"command":"ls"}' })

  // Interrupted, a turn is stopped within a moment.
  await page.evaluate((sessionId) => window.torno.chat.send(sessionId, { text: 'slow 20' }), id)
  await expect.poll(async () => (await history(id)).items.some((i) => i.kind === 'text' && i.streaming)).toBe(true)
  await page.evaluate((sessionId) => window.torno.chat.interrupt(sessionId), id)
  await expect.poll(() => turns(id), { timeout: 5_000 }).toBe(4)
  expect((await history(id)).items.filter((i) => i.kind === 'turn').at(-1)).toMatchObject({ ok: false, stopped: true })

  // The model of the session, and nothing that is not a model's name.
  await page.evaluate((sessionId) => window.torno.chat.setModel(sessionId, 'haiku'), id)
  expect(await failure(() => page.evaluate((sessionId) => window.torno.chat.setModel(sessionId, 'a b; rm'), id))).toContain('Not a model name')
  await page.evaluate((sessionId) => window.torno.chat.send(sessionId, { text: 'say again' }), id)
  await expect.poll(() => turns(id), { timeout: 10_000 }).toBe(5)
  expect((await history(id)).meta.model).toBe('haiku')

  // Another session than a live one of this workspace is refused.
  expect(await failure(() => page.evaluate(() => window.torno.chat.history('no-such-session')))).toContain('There is no such conversation')
  expect(await failure(() => page.evaluate(() => window.torno.chat.send('no-such-session', { text: 'hi' })))).toContain('ended')

  // Ended, the session can still be read, and nothing more can be asked of it.
  await page.evaluate((sessionId) => window.torno.session.stop(sessionId), id)
  const ended = await history(id)
  expect(ended.items.at(-1)).toMatchObject({ kind: 'note', text: 'The session ended' })
  expect(await failure(() => page.evaluate((sessionId) => window.torno.chat.send(sessionId, { text: 'late' }), id))).toContain('ended')

  // What was said is on file, without a picture, and git is told to pass it over.
  const folder = join(root, 'measures', '.torno', 'chat')
  const files = readdirSync(folder)
  expect(files).toHaveLength(1)
  const text = readFileSync(join(folder, files[0]), 'utf8')
  expect(text).not.toContain('"data"')
  expect(text.trim().split('\n').map((l) => (JSON.parse(l) as ChatItem).kind)).toContain('turn')
  expect(readFileSync(join(root, 'measures', '.torno', '.gitignore'), 'utf8')).toContain('chat/')
  expect(existsSync(join(root, 'measures', 'chat'))).toBe(false)
})
