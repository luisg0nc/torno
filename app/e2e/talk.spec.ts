import { cpSync, mkdtempSync, readFileSync, realpathSync, rmSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { inTerminal } from './terminal'
import type { MarkStore } from '../src/main/marks/store'
import type { TornoState } from '../src/renderer/state/store'
import type { Mark } from '../src/shared/marks'

// What the agent is told of the marks, and what the person is shown of what
// the agent did, through the window: a note that was typed and not ended, a
// mark changed after it was sent, the selection, a mark the agent resolved,
// marks on a part that is switched off, and a session whose object has left
// the list. The agent is the stand-in (test/fake-agent.mjs).
const appDir = resolve(__dirname, '..')
const fixtures = resolve(appDir, '../kernel/tests/fixtures/ws')
const fakeAgent = resolve(appDir, 'test/fake-agent.mjs')

test.describe.configure({ mode: 'serial' })

let root: string
let app: ElectronApplication
let page: Page

test.beforeAll(async () => {
  root = mkdtempSync(join(realpathSync(tmpdir()), 'torno-e2e-talk-'))
  cpSync(fixtures, root, { recursive: true, filter: (source) => !source.endsWith('__pycache__') })
  inTerminal(root)
  // TORNO_TEST=1 makes main create the window with show: false. Never launch without it.
  app = await electron.launch({ args: ['.'], cwd: appDir, env: { ...process.env, TORNO_TEST: '1', TORNO_AGENT_CMD: `node ${fakeAgent}`, TORNO_WORKSPACE: root } })
  page = await app.firstWindow()
  await page.waitForSelector('[data-region="left"]')
})

test.afterAll(async () => {
  await app?.close()
  rmSync(root, { recursive: true, force: true })
})

type Vec3 = [number, number, number]
const ON_BASE: Vec3 = [14, 9, 2.5] // on the top of the base, clear of the post
const ON_POST: Vec3 = [0, 0, 22.5] // the middle of the top of the post

const state = (): Promise<TornoState> => page.evaluate(() => window.__tornoTest!.state())
const terminal = (): Promise<string> => page.evaluate(() => window.__tornoTerm!.text())
/** What the terminal shows without its line breaks, which fall where the pane is wide. */
const said = async (): Promise<string> => (await terminal()).replace(/\s+/g, '')
const squeezed = (text: string): string => text.replace(/\s+/g, '')
const canvas = () => page.locator('.viewport-canvas canvas').first()
const row = (id: string) => page.locator(`.mark-row[data-mark="${id}"]`)
const panel = () => page.getByRole('region', { name: 'Marks' })
const tool = (name: string) => page.getByRole('toolbar', { name: 'Tools' }).getByRole('button', { name, exact: true })
const onDisk = (object: string): Mark[] => JSON.parse(readFileSync(join(root, object, '.torno', 'marks.json'), 'utf8')).marks

async function pageXY(point: Vec3): Promise<[number, number]> {
  const [fx, fy] = await page.evaluate((at) => window.__tornoTest!.project(at), point)
  const box = (await canvas().boundingBox())!
  return [box.x + fx * box.width, box.y + fy * box.height]
}

async function clickOver(point: Vec3): Promise<void> {
  const [x, y] = await pageXY(point)
  await page.mouse.move(x, y)
  await page.mouse.down()
  await page.mouse.up()
}

/** Have the stand-in agent post the hook of a prompt, as the conversation it was started in or as another. */
async function prompt(conversation = ''): Promise<void> {
  await page.locator('.session-term textarea').focus()
  await page.keyboard.type(`hook UserPromptSubmit ${conversation}`.trim())
  await page.keyboard.press('Enter')
}

/** What the agent was given with its latest prompt, without white space. */
async function lastContext(): Promise<string> {
  const all = await said()
  return all.slice(all.lastIndexOf('context:'))
}

/** Change a mark as the agent's tools do: through main's store, as the agent. */
function asAgent(objectId: string, id: string, patch: object): Promise<void> {
  return app.evaluate(
    async (_electron, [object, mark, change]) => {
      const { marks } = (globalThis as unknown as { __tornoMain: { marks: MarkStore } }).__tornoMain
      await marks.update(object, mark, change, 'agent')
    },
    [objectId, id, patch] as const
  )
}

test('a note that was typed and not ended goes with the prompt typed next: Ctrl+` leaves the card, and the note is kept', async () => {
  await page.getByRole('button', { name: 'bracket', exact: true }).click()
  await expect.poll(async () => (await state()).build, { timeout: 30_000 }).toMatchObject({ status: 'ok', revision: 1 })
  await page.locator('[data-region="session"]').getByRole('button', { name: 'New session' }).click()
  await expect.poll(terminal).toContain('READY')

  await tool('Pin').click()
  await clickOver(ON_BASE)
  await expect(page.locator('.note-card textarea')).toBeFocused()
  await page.keyboard.type('make this corner thicker')
  // Neither Enter nor a press elsewhere: straight to the terminal, as one does.
  await page.keyboard.press('Control+Backquote')
  await expect(page.locator('.session-term textarea')).toBeFocused()
  await expect.poll(async () => (await state()).marks[0]?.note).toBe('make this corner thicker')
  // The card is still there, for more.
  await expect(page.locator('.note-card')).toHaveCount(1)

  await page.keyboard.type('hook')
  await page.keyboard.press('Enter')
  await expect.poll(lastContext).toMatch(/M1pinonbase\/F\d+\(plane,normal\+Z,z=2\.5,1200mm²\)at\([\d.,]+\):"makethiscornerthicker"/)
  await expect.poll(async () => (await state()).marks[0].status).toBe('sent')
  expect(onDisk('bracket')[0]).toMatchObject({ note: 'make this corner thicker', status: 'sent', sentBefore: true })
  // It was checked against the build it was placed on.
  expect(onDisk('bracket')[0].checkedRevision).toBe(1)
})

test('a mark changed after it was sent is sent again, and said to have changed', async () => {
  // The card left open still holds the note; more is typed and ended with Enter.
  await page.locator('.note-card textarea').focus()
  await page.keyboard.type(', by 2 mm')
  await page.keyboard.press('Enter')
  await expect(page.locator('.note-card')).toHaveCount(0)
  await expect.poll(async () => (await state()).marks[0]).toMatchObject({ note: 'make this corner thicker, by 2 mm', status: 'draft' })
  await expect(page.getByRole('list', { name: 'To send' }).locator('.mark-row[data-mark="M1"]')).toHaveCount(1)

  await prompt()
  await expect.poll(lastContext).toContain(squeezed('(changed) M1 pin on base/F'))
  expect(await lastContext()).toContain(squeezed('"make this corner thicker, by 2 mm"'))
  await expect.poll(async () => (await state()).marks[0].status).toBe('sent')

  // Nothing changed since: the next prompt lists it among the open ones only.
  await prompt()
  await expect.poll(async () => squeezed(await lastContext())).toMatch(/Openmarks:M1$/)
  expect(await lastContext()).not.toContain('(changed)')
})

test('after the agent starts another conversation, the next prompt lists the open marks once more', async () => {
  await prompt('11111111-2222-4333-8444-555555555555')
  await expect.poll(lastContext).toContain(squeezed('Marks still open (this conversation has not seen them): M1 pin on base/F'))
  expect(await lastContext()).not.toContain('(changed)')
  await prompt('11111111-2222-4333-8444-555555555555')
  await expect.poll(async () => squeezed(await lastContext())).toMatch(/base,post\.Openmarks:M1$/)
})

test('what is selected goes with the prompt, each ref with what the kernel says of it', async () => {
  await tool('Select').click()
  await clickOver(ON_POST)
  const [ref] = (await state()).selection
  expect(ref).toMatch(/^post\/F\d+$/)
  await expect(page.locator('.selection-descriptor')).toHaveText(/plane, normal \+Z/)
  await prompt()
  await expect.poll(lastContext).toContain(squeezed(`Selected: ${ref} (plane, normal +Z, z = 22.5,`))

  // Nothing selected, nothing said.
  await page.keyboard.press('Control+Backquote')
  await page.keyboard.press('Escape')
  await expect.poll(async () => (await state()).selection).toEqual([])
  await prompt()
  await expect.poll(async () => squeezed(await lastContext())).toMatch(/base,post\.Openmarks:M1$/)
})

test('on a stale build the selection cannot be put in the prompt: its refs would name other geometry', async () => {
  await tool('Select').click()
  await clickOver(ON_POST)
  await expect.poll(async () => (await state()).selection.length).toBe(1)
  const insert = page.getByRole('button', { name: 'Insert', exact: true })
  await expect(insert).toBeEnabled()

  const model = join(root, 'bracket', 'bracket.py')
  const source = readFileSync(model, 'utf8')
  writeFileSync(model, `${source}\nraise RuntimeError("not today")\n`)
  await expect.poll(async () => (await state()).build, { timeout: 30_000 }).toMatchObject({ status: 'failed', stale: true })
  await expect(insert).toBeDisabled()
  await expect(insert).toHaveAttribute('title', 'The last build failed: picks wait for a build that works')
  // Nor is it told to the agent with a prompt.
  await prompt()
  await expect.poll(lastContext).toContain('BUILDFAILED')
  expect(await lastContext()).not.toContain('Selected:')

  writeFileSync(model, source)
  await expect.poll(async () => (await state()).build, { timeout: 30_000 }).toMatchObject({ status: 'ok', stale: false })
  await page.keyboard.press('Control+Backquote')
  await page.keyboard.press('Escape')
})

test('a mark the agent resolved stays in the list, saying so and what the agent did, until the person says OK', async () => {
  await asAgent('bracket', 'M1', { status: 'resolved', resolvedNote: 'made the corner 2 mm thicker' })
  const open = panel().locator('.mark-rows').first()
  await expect(open.locator('[data-mark="M1"]')).toHaveAttribute('data-awaiting', '')
  await expect(row('M1').locator('.mark-resolution-note')).toHaveText('Resolved by the agent: made the corner 2 mm thicker')
  // Not drawn any more, like any resolved mark.
  expect(await page.evaluate(() => window.__tornoTest!.markScreen('M1'))).toBeNull()
  expect(onDisk('bracket')[0]).toMatchObject({ status: 'resolved', resolvedBy: 'agent' })
  expect(onDisk('bracket')[0]).not.toHaveProperty('acknowledged')

  await row('M1').getByRole('button', { name: 'OK', exact: true }).click()
  await expect(open.locator('[data-mark="M1"]')).toHaveCount(0)
  await panel().getByRole('button', { name: /Resolved/ }).click()
  await expect(panel().getByRole('list', { name: 'Resolved marks' }).locator('[data-mark="M1"]')).toHaveCount(1)
  expect(onDisk('bracket')[0]).toMatchObject({ status: 'resolved', resolvedBy: 'agent', acknowledged: true })
})

test('Reopen makes a mark the agent resolved a draft again; one the person resolves goes straight under Resolved', async () => {
  await tool('Pin').click()
  await clickOver(ON_BASE)
  await page.keyboard.type('and this one')
  await page.keyboard.press('Enter')
  await page.keyboard.press('Escape')
  await expect.poll(async () => (await state()).marks.map((m) => m.id)).toEqual(['M1', 'M2'])
  await asAgent('bracket', 'M2', { status: 'resolved' })
  await expect(row('M2').locator('.mark-resolution-note')).toHaveText('Resolved by the agent')
  await row('M2').getByRole('button', { name: 'Reopen', exact: true }).click()
  await expect.poll(async () => (await state()).marks[1]).toMatchObject({ status: 'draft' })
  expect(onDisk('bracket')[1]).not.toHaveProperty('resolvedBy')
  await expect(row('M2')).not.toHaveAttribute('data-awaiting', '')
  // The agent is told that what it did was not taken, not that the mark changed.
  expect(onDisk('bracket')[1]).toMatchObject({ status: 'draft', reopened: true })
  await prompt()
  await expect.poll(lastContext).toContain(squeezed('(reopened by the user) M2 pin on base/F'))
  expect(await lastContext()).not.toContain('(changed)')
  await expect.poll(async () => (await state()).marks[1].status).toBe('sent')
  expect(onDisk('bracket')[1]).not.toHaveProperty('reopened')

  await row('M2').hover()
  await row('M2').getByRole('button', { name: 'Resolve M2' }).click()
  await expect(panel().getByRole('list', { name: 'Resolved marks' }).locator('[data-mark="M2"]')).toHaveCount(1)
  expect(onDisk('bracket')[1]).toMatchObject({ status: 'resolved', resolvedBy: 'user' })
  // Back among the open ones for what follows.
  await page.evaluate(() => window.torno.marks.update('bracket', 'M2', { status: 'draft' }))
})

test('a mark on a part that is switched off is not drawn, in the window or in a picture; its row stays, and says why', async () => {
  await tool('Pin').click()
  await clickOver(ON_POST)
  await page.keyboard.type('shorter')
  await page.keyboard.press('Enter')
  await page.keyboard.press('Escape')
  await expect.poll(async () => (await state()).marks.map((m) => m.id)).toEqual(['M1', 'M2', 'M3'])
  const drawn = (id: string) => page.evaluate((mark) => window.__tornoTest!.markScreen(mark) !== null, id)
  expect(await drawn('M2')).toBe(true)
  expect(await drawn('M3')).toBe(true)
  const picture = async (request: object = {}): Promise<number> => (await page.evaluate((req) => window.__tornoTest!.look({ view: 'iso', size: 400, ...req }), request)).png.length
  const withBoth = await picture()

  await page.locator('[data-layer="post"]').hover()
  await page.getByRole('button', { name: 'Show post' }).click()
  await expect.poll(() => drawn('M3')).toBe(false)
  expect(await drawn('M2')).toBe(true)
  await expect(row('M3')).toHaveAttribute('data-hidden', '')
  await expect(row('M3').locator('.mark-layout')).toHaveText('its part is hidden')
  await expect(row('M2')).not.toHaveAttribute('data-hidden', '')
  // A picture of the base alone has no M3; one that names the post draws the post and its mark.
  const withoutPost = await picture()
  expect(withoutPost).not.toBe(withBoth)
  expect(await picture({ parts: ['base', 'post'] })).toBe(withBoth)
  expect(await picture({ parts: ['base'], marks: true })).toBe(withoutPost)

  await page.locator('[data-layer="post"]').hover()
  await page.getByRole('button', { name: 'Show post' }).click()
  await expect.poll(() => drawn('M3')).toBe(true)
  await expect(row('M3')).not.toHaveAttribute('data-hidden', '')
})

test('a pin on an edge is a pin on that edge: the agent is told which, and the two faces that meet there', async () => {
  // The middle of the edge between the top of the base and its side at x = 20.
  const onEdge: Vec3 = [20, 0, 2.5]
  const hit = await page.evaluate((at) => {
    const hooks = window.__tornoTest!
    const [fx, fy] = hooks.project(at)
    return hooks.pickAt(fx, fy)
  }, onEdge)
  expect(hit).toMatchObject({ kind: 'edge', part: 'base' })

  await tool('Pin').click()
  await clickOver(onEdge)
  await expect(page.locator('.note-card textarea')).toBeFocused()
  await page.keyboard.type('this edge is ugly')
  await page.keyboard.press('Enter')
  await page.keyboard.press('Escape')
  // Kept through the check that follows the placing: still the edge, now with the faces it is between.
  await expect.poll(async () => (await state()).marks.at(-1)?.checkedRevision).toBeGreaterThan(0)
  const pin = (await state()).marks.at(-1) as Extract<Mark, { kind: 'pin' }>
  expect(pin).toMatchObject({ kind: 'pin', anchorState: 'ok', anchor: { part: 'base', ref: hit!.ref, edge: hit!.ref, descriptor: 'line, 30 mm' } })
  expect(pin.anchor.between).toHaveLength(2)
  for (const face of pin.anchor.between!) expect(face).toMatch(/^base\/F\d+$/)

  await prompt()
  const [a, b] = pin.anchor.between!
  await expect.poll(lastContext).toContain(squeezed(`${pin.id} pin on the edge ${hit!.ref} between ${a} and ${b} (line, 30 mm) at (20, `))
  expect(await lastContext()).toContain(squeezed('"this edge is ugly"'))
})

test('a session goes on being typed into when its object leaves the list: its last model file was deleted', async () => {
  await page.getByRole('button', { name: 'plain', exact: true }).click()
  await expect.poll(async () => (await state()).build, { timeout: 30_000 }).toMatchObject({ objectId: 'plain', status: 'ok' })
  await page.locator('[data-region="session"]').getByRole('button', { name: 'New session' }).click()
  await expect.poll(terminal).toContain('READY')
  await page.keyboard.type('before')
  await page.keyboard.press('Enter')
  await expect.poll(terminal).toContain('> before')

  unlinkSync(join(root, 'plain', 'plain.py'))
  // The folder holds no .py any more: main's list of objects no longer has it.
  await expect.poll(async () => (await page.evaluate(() => window.torno.workspace.current()))?.objects.some((o) => o.id === 'plain'), { timeout: 15_000 }).toBe(false)

  await page.locator('.session-term textarea').focus()
  await page.keyboard.type('still here')
  await page.keyboard.press('Enter')
  await expect.poll(terminal).toContain('> still here')
})
