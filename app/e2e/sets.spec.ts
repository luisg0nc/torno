import { cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import type { TornoState } from '../src/renderer/state/store'
import type { NamedSet, SetsFile } from '../src/shared/sets'
import { openSection } from './helpers'
import { openListed } from './objects'

// Named sets (#171), made and found again in the hidden window, on the fixture `morph` of e2e/reanchor.spec.ts: `variant.txt`
// says `a` (a plate 5 mm thick with a post on it) or `b` (the plate 8 mm thick, its top 3 mm higher and chamfered, no post), and
// the faces of b are numbered otherwise. Two faces are selected with the pointer, Ctrl+G names them `deck`, a rebuild renumbers
// the faces, and the set must still name the same two (the wiring in main/ipc.ts has no unit test of its own). Then the
// stand-in agent calls `add_set`: its proposal says who made it until the person accepts it.
const appDir = resolve(__dirname, '..')
const fixtures = resolve(appDir, '../kernel/tests/fixtures/ws')
const fakeAgent = resolve(appDir, 'test/fake-agent.mjs')

test.describe.configure({ mode: 'serial' })

type Vec3 = [number, number, number]

let root: string
let home: string
let app: ElectronApplication
let page: Page

test.beforeAll(async () => {
  root = mkdtempSync(join(realpathSync(tmpdir()), 'torno-e2e-sets-'))
  home = mkdtempSync(join(realpathSync(tmpdir()), 'torno-e2e-sets-home-'))
  cpSync(fixtures, root, { recursive: true, filter: (source) => !source.endsWith('__pycache__') })
  // TORNO_TEST=1 makes main create the window with show: false. Never launch without it.
  app = await electron.launch({ args: ['.'], cwd: appDir, env: { ...process.env, HOME: home, TORNO_TEST: '1', TORNO_AGENT_CMD: `node ${fakeAgent}`, TORNO_WORKSPACE: root } })
  page = await app.firstWindow()
  await page.waitForSelector('[data-region="left"]')
})

test.afterAll(async () => {
  await app?.close()
  rmSync(root, { recursive: true, force: true })
  rmSync(home, { recursive: true, force: true })
})

const ON_TOP: Vec3 = [14, 9, 2.5] // on the top of the plate of variant a, clear of the post
const ON_SIDE: Vec3 = [20, 0, 0] // the middle of the plate's end at +X, in both variants

const state = (): Promise<TornoState> => page.evaluate(() => window.__tornoTest!.state())
const canvas = () => page.locator('.viewport-canvas canvas').first()
const describe = (ref: string) => page.evaluate((r) => window.torno.geometry.describe('morph', 'main', r), ref)
const dock = () => page.locator('[data-region="session"]')
const chat = () => dock().locator('.chat')
const composer = () => dock().locator('[data-chat-composer]')
const setsOnDisk = (): NamedSet[] => {
  try {
    return (JSON.parse(readFileSync(join(root, 'morph', '.torno', 'sets.json'), 'utf8')) as SetsFile).sets
  } catch {
    return []
  }
}
const faces = (set: NamedSet): string[] => set.members.map((m) => ('face' in m ? m.face : ''))

/** Where a point of the object frame is drawn, in the page's pixels. */
async function pageXY(point: Vec3): Promise<[number, number]> {
  const [fx, fy] = await page.evaluate((at) => window.__tornoTest!.project(at), point)
  const box = (await canvas().boundingBox())!
  return [box.x + fx * box.width, box.y + fy * box.height]
}

/** A click where the point is drawn, with Shift to add to what is selected. */
async function clickOver(point: Vec3, shift = false): Promise<void> {
  const [x, y] = await pageXY(point)
  await page.mouse.move(x, y)
  if (shift) await page.keyboard.down('Shift')
  await page.mouse.down()
  await page.mouse.up()
  if (shift) await page.keyboard.up('Shift')
}

/** The ref of the face drawn at a point of the object frame, as the view picks it. */
async function faceOver(point: Vec3): Promise<string> {
  const hit = await page.evaluate((at) => {
    const hooks = window.__tornoTest!
    const [fx, fy] = hooks.project(at)
    return hooks.pickAt(fx, fy)
  }, point)
  if (!hit?.ref) throw new Error(`no face is drawn at ${point.join(', ')}`)
  return hit.ref
}

/** The model of the other variant is built, and the sets have been found again against it. */
async function switchTo(variant: 'a' | 'b', revision: number): Promise<void> {
  writeFileSync(join(root, 'morph', 'variant.txt'), `${variant}\n`)
  await expect.poll(async () => (await state()).build, { timeout: 30_000 }).toMatchObject({ status: 'ok', revision, stale: false })
}

/** Types a script of the stand-in into the box of the chat, a line at a time, and sends it. */
async function send(lines: string[]): Promise<void> {
  await composer().focus()
  for (const [n, line] of lines.entries()) {
    await page.keyboard.type(line)
    if (n < lines.length - 1) await page.keyboard.press('Shift+Enter')
  }
  await page.keyboard.press('Enter')
}

let before: { top: string; side: string }

test('Ctrl+G names the two faces that are selected, and sets.json holds both with their forms', async () => {
  await openListed(page, 'morph')
  await expect.poll(async () => (await state()).build, { timeout: 30_000 }).toMatchObject({ status: 'ok', revision: 1 })
  await openSection(page, 'Parts')
  before = { top: await faceOver(ON_TOP), side: await faceOver(ON_SIDE) }
  expect(before.top).not.toBe(before.side)

  await clickOver(ON_TOP)
  await clickOver(ON_SIDE, true)
  await expect.poll(async () => (await state()).selection).toEqual([before.top, before.side])

  await page.keyboard.press('Control+g')
  // The box opens in the head of the card, under the two refs held there.
  const form = page.locator('.hand').getByRole('dialog', { name: 'Name a set' })
  await expect(form).toBeVisible()
  await expect(page.locator('.hand .hand-ref')).toHaveCount(2)
  await form.getByLabel('Name').fill('deck')
  await page.keyboard.press('Enter')
  await expect(form).toHaveCount(0)

  // The set is written at once, and its selectors a second change after: wait for the second.
  await expect.poll(() => setsOnDisk()[0]?.members.every((m) => 'selector' in m && m.selector !== undefined), { timeout: 20_000 }).toBe(true)
  const sets = setsOnDisk()
  expect(sets).toHaveLength(1)
  expect(sets[0]).toMatchObject({ id: 'N1', name: 'deck', slug: 'deck', by: 'person', layout: 'main' })
  expect(sets[0].proposed).toBeUndefined()
  expect(faces(sets[0])).toEqual([before.top, before.side])
  for (const member of sets[0].members) expect(member).toMatchObject({ state: 'ok', type: 'PLANE', selector: { of: 'faces' } })
  expect(JSON.parse(readFileSync(join(root, 'morph', '.torno', 'sets.json'), 'utf8')).next).toBe(2)

  // Layers lists it, under the plate that holds both its faces.
  const row = page.locator('[data-set="N1"]')
  await expect(row.locator('.set-name')).toHaveText('#deck')
  await expect(row.locator('.layer-count')).toHaveText('2')
  await expect(row.locator('[data-part="lost"]')).toHaveCount(0)
})

test('rebuilt with the faces renumbered, the set names the faces now there, both ok, and Layers shows no lost line', async () => {
  await page.keyboard.press('Escape')
  await switchTo('b', 2)
  // The refs are those of this build: the kernel is asked what the member is, and it says the same face as before.
  await expect.poll(() => faces(setsOnDisk()[0]).join(), { timeout: 20_000 }).not.toBe([before.top, before.side].join())
  const [set] = setsOnDisk()
  expect(set.members.map((m) => ('state' in m ? m.state : ''))).toEqual(['ok', 'ok'])
  const [top, side] = faces(set)
  // The top is now 3 mm higher, and the end the same face of the same plate, with a number of its own.
  expect(await describe(top)).toMatchObject({ kind: 'face', type: 'plane', descriptor: 'plane, normal +Z, z = 5.5, 1064 mm²' })
  expect(await describe(side)).toMatchObject({ kind: 'face', type: 'plane' })
  expect(await faceOver([0, 0, 5.5])).toBe(top)
  expect(await faceOver(ON_SIDE)).toBe(side)
  expect(top).not.toBe(before.top)
  const member = set.members[0] as { point: Vec3 }
  expect(member.point[2]).toBeCloseTo(5.5, 3)

  const row = page.locator('[data-set="N1"]')
  await expect(row.locator('.set-name')).toHaveText('#deck')
  await expect(row.locator('.layer-count')).toHaveText('2')
  await expect(row.locator('[data-part="lost"]')).toHaveCount(0)
  await expect(page.locator('.set-lost')).toHaveCount(0)
  // The same two are what a click on the name selects.
  await row.locator('.set-name').click()
  await expect.poll(async () => (await state()).selection).toEqual([top, side])
  await page.keyboard.press('Escape')
})

test('a proposal of Claude is marked until the person accepts it, and then it is theirs', async () => {
  await dock().getByRole('button', { name: 'New session' }).click()
  await expect(chat()).toBeVisible()
  await expect(composer()).toBeEnabled()
  const other = await faceOver([-20, 0, 0])
  await send([`tool mcp__torno__add_set {"name":"end faces","comment":"the two ends","refs":["${other}"]}`])
  const proposal = page.locator('[data-set="N2"]')
  await expect(proposal).toBeVisible({ timeout: 30_000 })
  await expect(proposal.locator('.set-name')).toHaveText('#end-faces')
  await expect(proposal).toHaveAttribute('data-proposed', '')
  await expect(proposal).toContainText('Proposed by Claude')
  expect(setsOnDisk().find((s) => s.id === 'N2')).toMatchObject({ by: 'agent', proposed: true })

  await proposal.getByRole('button', { name: 'Accept' }).click()
  await expect(proposal).not.toContainText('Proposed by Claude')
  await expect(proposal).not.toHaveAttribute('data-proposed', '')
  await expect.poll(() => setsOnDisk().find((s) => s.id === 'N2')?.proposed).toBeUndefined()
  expect(setsOnDisk().find((s) => s.id === 'N2')).toMatchObject({ by: 'person', name: 'end faces' })
  expect(setsOnDisk().map((s) => s.id)).toEqual(['N1', 'N2'])
})

test('what was wrong with a sets file is said in Layers with where it was kept, to a window that was not listening too, until it is dismissed', async () => {
  // Main reads the file of a project the window is not showing: nobody hears the problem said.
  const CORRUPT = '{"next": 4, "sets": ['
  mkdirSync(join(root, 'plain', '.torno'), { recursive: true })
  writeFileSync(join(root, 'plain', '.torno', 'sets.json'), CORRUPT)
  expect(await page.evaluate(() => window.torno.sets.list('plain'))).toEqual([])
  const aside = readdirSync(join(root, 'plain', '.torno')).find((name) => name.startsWith('sets.json.corrupt-'))!
  expect(readFileSync(join(root, 'plain', '.torno', aside), 'utf8')).toBe(CORRUPT)

  const sentence = `The named sets file of this project could not be read. It was kept as .torno/${aside}, and a new list was started.`
  const line = page.locator('[data-part="sets-problem"]')
  await openListed(page, 'plain')
  await expect(line).toContainText(sentence)
  // Still there after the window is loaded anew.
  await page.reload()
  await page.waitForSelector('[data-region="left"]')
  await openListed(page, 'plain')
  await expect(line).toContainText(sentence)

  await line.getByRole('button', { name: 'Dismiss' }).click()
  await expect(line).toHaveCount(0)
  await page.reload()
  await page.waitForSelector('[data-region="left"]')
  await openListed(page, 'plain')
  await expect(line).toHaveCount(0)
})
