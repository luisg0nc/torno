import { cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import type { TornoState } from '../src/renderer/state/store'
import type { Mark, MarksFile, NewMark } from '../src/shared/marks'
import type { Camera, LookRequest } from '../src/shared/view'
import { openSection } from './helpers'
import { openListed } from './objects'
import { box, stl } from '../src/test/scanFixtures'

// Marks as they are seen: drawn in the viewport and in the pictures the agent
// gets, each with its number, and listed in the left column. The tools that
// make marks with the pointer come later: here they are added through
// window.torno.marks, and the agent's through the store in main.
//
// The window is hidden. Pictures come from window.__tornoTest.look, the code
// the look tool uses; where a label is drawn is read through .markScreen.
const appDir = resolve(__dirname, '..')
const fixtures = resolve(appDir, '../kernel/tests/fixtures/ws')
const fakeAgent = resolve(appDir, 'test/fake-agent.mjs')

test.describe.configure({ mode: 'serial' })

let root: string
let app: ElectronApplication
let page: Page

function copyFixtures(): string {
  const dir = mkdtempSync(join(realpathSync(tmpdir()), 'torno-e2e-marks-'))
  cpSync(fixtures, dir, { recursive: true, filter: (source) => !source.endsWith('__pycache__') })
  return dir
}

// TORNO_TEST=1 makes main create the window with show: false. Never launch without it.
function launch(env: Record<string, string>): Promise<ElectronApplication> {
  return electron.launch({ args: ['.'], cwd: appDir, env: { ...process.env, TORNO_TEST: '1', TORNO_AGENT_CMD: `node ${fakeAgent}`, ...env } })
}

const CORRUPT = '{"next": 4, "marks": ['

test.beforeAll(async () => {
  root = copyFixtures()
  // The marks file of another object is broken before torno ever reads it.
  mkdirSync(join(root, 'plain', '.torno'), { recursive: true })
  writeFileSync(join(root, 'plain', '.torno', 'marks.json'), CORRUPT)
  app = await launch({ TORNO_WORKSPACE: root })
  page = await app.firstWindow()
  await page.waitForSelector('[data-region="viewport"]')
})

test.afterAll(async () => {
  await app?.close()
  rmSync(root, { recursive: true, force: true })
})

type Vec3 = [number, number, number]
type Draft = Record<string, unknown> & { kind: Mark['kind'] }
const state = (p: Page = page): Promise<TornoState> => p.evaluate(() => window.__tornoTest!.state())
const camera = (p: Page = page): Promise<Camera> => p.evaluate(() => window.__tornoTest!.camera())
const marksOnDisk = (): MarksFile => JSON.parse(readFileSync(join(root, 'bracket', '.torno', 'marks.json'), 'utf8'))
const row = (id: string, p: Page = page) => p.locator(`.mark-row[data-mark="${id}"]`)
const rows = (p: Page = page) => p.locator('.mark-row')
const markScreen = (id: string, p: Page = page) => p.evaluate((mark) => window.__tornoTest!.markScreen(mark), id)

/** The camera once it has come to rest: the same twice, a moment apart. */
async function resting(p: Page = page): Promise<Camera> {
  let last = JSON.stringify(await camera(p))
  for (;;) {
    await p.waitForTimeout(250)
    const now = JSON.stringify(await camera(p))
    if (now === last) return JSON.parse(now) as Camera
    last = now
  }
}

async function openObject(name: string, p: Page = page): Promise<void> {
  await openListed(p, name)
  await expect.poll(async () => (await state(p)).build?.status, { timeout: 30_000 }).toBe('ok')
}

/** A mark of the person's, placed from the view on screen in the layout shown, unless it says otherwise. */
function addMark(mark: Draft, p: Page = page): Promise<Mark> {
  return p.evaluate(
    (m) => window.torno.marks.add('bracket', { author: 'user', note: '', layout: window.__tornoTest!.state().layout, revision: 1, camera: window.__tornoTest!.camera(), ...m } as never),
    mark
  )
}

/** A mark of the agent's: those do not come through the window, which can only make the person's. */
async function addAgentMark(mark: Draft, to: ElectronApplication, p: Page): Promise<Mark> {
  const whole = { author: 'agent', note: '', layout: 'assembly', revision: 1, camera: await camera(p), ...mark }
  return to.evaluate((_electron, m) => (globalThis as unknown as { __tornoMain: { marks: { add(id: string, mark: NewMark): Promise<Mark> } } }).__tornoMain.marks.add('bracket', m as NewMark), whole)
}

/**
 * Two pictures of the same view, compared: how many pixels differ within
 * `reach` (a share of the width) of a point given in fractions of the picture,
 * and how many anywhere.
 */
function differing(a: LookRequest, b: LookRequest, at: { x: number; y: number } = { x: 0.5, y: 0.5 }, reach = 0.05, p: Page = page): Promise<{ near: number; all: number }> {
  return p.evaluate(
    async ([first, second, centre, r]) => {
      const pixels = async (req: LookRequest) => {
        const picture = await window.__tornoTest!.look(req)
        const bitmap = await createImageBitmap(new Blob([picture.png as Uint8Array<ArrayBuffer>], { type: 'image/png' }))
        const canvas = new OffscreenCanvas(bitmap.width, bitmap.height)
        const ctx = canvas.getContext('2d')!
        ctx.drawImage(bitmap, 0, 0)
        return ctx.getImageData(0, 0, bitmap.width, bitmap.height)
      }
      const [one, two] = [await pixels(first), await pixels(second)]
      let near = 0
      let all = 0
      for (let y = 0; y < one.height; y++) {
        for (let x = 0; x < one.width; x++) {
          const i = (y * one.width + x) * 4
          if (Math.abs(one.data[i] - two.data[i]) + Math.abs(one.data[i + 1] - two.data[i + 1]) + Math.abs(one.data[i + 2] - two.data[i + 2]) < 24) continue
          all += 1
          if (Math.abs(x - centre.x * one.width) <= r * one.width && Math.abs(y - centre.y * one.height) <= r * one.width) near += 1
        }
      }
      return { near, all }
    },
    [a, b, at, reach] as const
  )
}

const ON_BASE: Vec3 = [14, 9, 2.5] // on the top of the base, clear of the post
const PLAIN = { view: 'current', marks: false } as const
const MARKED = { view: 'current' } as const

test('with no marks, the panel says how to leave one', async () => {
  await openObject('bracket')
  const panel = page.getByRole('region', { name: 'Marks' })
  await expect(panel).toContainText('Point at the part to leave a note for the agent.')
  await expect(panel).toContainText('A mark goes with your next prompt, and stays here until the agent resolves it.')
  // The keys are on the palette and on the sheet of keys, not here.
  await expect(panel.getByRole('list', { name: 'Tool keys' })).toHaveCount(0)
  await expect(panel.locator('kbd')).toHaveCount(0)
  await expect(rows()).toHaveCount(0)
  // Nothing to draw: a picture with marks is the picture without.
  expect((await differing(MARKED, PLAIN)).all).toBe(0)
})

test('a pin and an arrow are listed with their numbers, and drawn in the picture the agent gets', async () => {
  await addMark({ kind: 'pin', note: 'too thin here', anchor: { point: ON_BASE, normal: [0, 0, 1], part: 'base' } })
  await addMark({ kind: 'arrow', note: 'move it up', from: { point: [-14, -9, 2.5], part: 'base' }, to: [-14, -9, 16] })
  await expect(rows()).toHaveCount(2)
  await expect(rows().locator('.mark-chip')).toHaveText(['M1', 'M2'])
  await expect(rows().locator('.mark-note')).toHaveText(['too thin here', 'move it up'])
  await expect(page.getByRole('list', { name: 'To send' }).locator('.mark-row')).toHaveCount(2)
  await expect(rows().locator('.mark-status')).toHaveCount(0)
  await expect(row('M1').locator('.mark-kind')).toHaveAttribute('aria-label', 'Pin')
  await expect(row('M2').locator('.mark-kind')).toHaveAttribute('aria-label', 'Arrow')
  await expect(row('M1')).toHaveAttribute('data-author', 'user')

  for (const id of ['M1', 'M2']) {
    const label = (await markScreen(id))!
    expect(label.visible, id).toBe(true)
    // The chip with its number is there with marks, and not without.
    expect((await differing(MARKED, PLAIN, label, 0.012)).near, id).toBeGreaterThan(60)
  }
  // And nothing else in the picture changed: the marks are a small part of it.
  const { all } = await differing(MARKED, PLAIN)
  expect(all).toBeGreaterThan(200)
  expect(all).toBeLessThan(6000)
  // The labels do not sit on each other.
  const [one, two] = [(await markScreen('M1'))!, (await markScreen('M2'))!]
  expect(Math.hypot(one.x - two.x, one.y - two.y)).toBeGreaterThan(0.05)
})

test('the pointer on a row rings its chip in the view and lights what it is on, without making it the active one', async () => {
  const hovered = (): Promise<string | null> => page.evaluate(() => window.__tornoTest!.hoveredMark())
  const peeked = (): Promise<string[]> => page.evaluate(() => window.__tornoTest!.peeked())
  // The pointer of the test before may rest over a row of the list: out of the panel first.
  await page.mouse.move(900, 450)
  await expect.poll(hovered).toBeNull()
  await row('M2').hover()
  await expect.poll(hovered).toBe('M2')
  await expect(row('M2')).toHaveAttribute('data-hovered', '')
  // Lit as a mention of it in the chat is: by the ref it is on, when the check of the marks has given it one.
  const arrow = (await state()).marks.find((m) => m.id === 'M2')!
  const ref = arrow.kind === 'arrow' ? arrow.from.ref : undefined
  expect(await peeked()).toEqual(ref ? [ref] : [])
  expect((await state()).activeMark).toBeNull()
  await row('M1').hover()
  await expect.poll(hovered).toBe('M1')
  await expect(row('M2')).not.toHaveAttribute('data-hovered', '')
  // Off the rows, nothing is pointed at.
  await page.getByRole('region', { name: 'Marks' }).getByRole('heading', { name: 'To send', level: 3 }).hover()
  await expect.poll(hovered).toBeNull()
  expect(await peeked()).toEqual([])
  // The keys reach a mark by its row's buttons: with their focus in the row, its chip is pointed at too.
  await page.getByRole('button', { name: /^Note of M2/ }).focus()
  await page.keyboard.press('Tab')
  await expect(page.getByRole('button', { name: 'Go to M2', exact: true })).toBeFocused()
  await expect.poll(hovered).toBe('M2')
  await page.keyboard.press('Tab')
  await expect(page.getByRole('button', { name: 'Resolve M2', exact: true })).toBeFocused()
  expect(await hovered()).toBe('M2')
  // The pointer on another row points there while it is on it, and leaving gives the light back to the keys' row.
  await row('M1').hover()
  await expect.poll(hovered).toBe('M1')
  await page.getByRole('region', { name: 'Marks' }).getByRole('heading', { name: 'To send', level: 3 }).hover()
  await expect.poll(hovered).toBe('M2')
  await page.getByRole('button', { name: 'Resolve M2', exact: true }).blur()
  await expect.poll(hovered).toBeNull()
  // A click on a row's button focuses it too, but that is no pointing of the keys': the light goes with the pointer.
  await row('M1').hover()
  await page.getByRole('button', { name: 'Go to M1', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Go to M1', exact: true })).toBeFocused()
  await page.getByRole('region', { name: 'Marks' }).getByRole('heading', { name: 'To send', level: 3 }).hover()
  await expect.poll(hovered).toBeNull()
  expect(await peeked()).toEqual([])
})

test('a named view draws the marks with its own camera, at any size', async () => {
  for (const size of [640, 2000]) {
    const { all } = await differing({ view: 'top', size }, { view: 'top', size, marks: false })
    // As large a share of a big picture as of a small one.
    const share = all / (size * size * 0.75)
    expect(share, String(size)).toBeGreaterThan(0.0006)
    expect(share, String(size)).toBeLessThan(0.02)
  }
})

test('a note is written in the panel and kept in .torno/marks.json; the view keys do not fire meanwhile', async () => {
  const before = await camera()
  await row('M1').locator('.mark-note').click({ position: { x: 4, y: 8 } })
  const field = row('M1').locator('.mark-note-input')
  await expect(field).toBeFocused()
  await expect(field).toHaveAttribute('maxlength', '2000')
  await expect(field).toHaveValue('too thin here')
  // 1, f and o are view keys, v and p tool keys: here they are letters.
  await page.keyboard.type('4 mm of proof 1')
  await page.keyboard.press('Enter')
  await expect(row('M1').locator('.mark-note')).toHaveText('4 mm of proof 1')
  await expect.poll(() => marksOnDisk().marks[0].note).toBe('4 mm of proof 1')
  expect(await camera()).toEqual(before)
  // Writing a note makes its mark the active one, without going anywhere.
  expect((await state()).activeMark).toBe('M1')

  // Esc leaves the note as it was.
  await row('M1').locator('.mark-note').click({ position: { x: 4, y: 8 } })
  await page.keyboard.type('never mind')
  await page.keyboard.press('Escape')
  await expect(row('M1').locator('.mark-note')).toHaveText('4 mm of proof 1')
  expect(marksOnDisk().marks[0].note).toBe('4 mm of proof 1')

  // No more can be typed than a note keeps.
  await row('M2').locator('.mark-note').click({ position: { x: 4, y: 8 } })
  await row('M2').locator('.mark-note-input').fill('x'.repeat(2100))
  await page.keyboard.press('Enter')
  await expect.poll(() => marksOnDisk().marks[1].note.length).toBe(2000)
  await page.evaluate(() => window.torno.marks.update('bracket', 'M2', { note: 'move it up' }))
})

test('clicking a row makes its mark the active one; the camera moves only for a mark out of view, and "Go to" always goes', async () => {
  const placedFrom = marksOnDisk().marks[1].camera
  const from = async (c: Camera): Promise<number> => {
    const now = await camera()
    return Math.max(...now.position.map((v, i) => Math.abs(v - c.position[i])), ...now.target.map((v, i) => Math.abs(v - c.target[i])))
  }
  await page.getByRole('button', { name: 'Top view, 4', exact: true }).click()
  await expect.poll(async () => (await camera()).position[2]).toBeGreaterThan(placedFrom.position[2] + 1)
  const top = await resting()
  expect((await markScreen('M2'))?.visible).toBe(true)
  await row('M2').locator('.mark-chip').click()
  await expect(row('M2')).toHaveAttribute('aria-current', 'true')
  await expect(row('M1')).not.toHaveAttribute('aria-current', 'true')
  expect((await state()).activeMark).toBe('M2')
  // In view already: the view the person set up stays.
  expect(await resting()).toEqual(top)

  // The reticle at the end of the row goes to the view it was placed from, in view or not.
  await page.getByRole('button', { name: 'Go to M2', exact: true }).click()
  await expect.poll(() => from(placedFrom)).toBeLessThan(1e-6)

  // Close in on M1, far from M2: M2 is out of view, and a click on its row goes to where it was placed from.
  await page.getByRole('button', { name: 'Top view, 4', exact: true }).click()
  await resting()
  const canvas = (await page.locator('.viewport-canvas canvas').first().boundingBox())!
  const one = (await markScreen('M1'))!
  await page.mouse.move(canvas.x + one.x * canvas.width, canvas.y + one.y * canvas.height)
  for (let i = 0; i < 16; i++) await page.mouse.wheel(0, -400)
  await expect.poll(async () => (await markScreen('M2'))?.visible).toBe(false)
  await resting()
  await row('M2').locator('.mark-chip').click()
  await expect.poll(() => from(placedFrom)).toBeLessThan(1e-6)
  await expect.poll(async () => (await markScreen('M2'))?.visible).toBe(true)
})

test('the mark being worked on is drawn like any other in the picture the agent gets', async () => {
  // M2, the arrow, is the active one: on screen its lines are wider.
  expect((await state()).activeMark).toBe('M2')
  const picture = (): Promise<string> =>
    page.evaluate(async () => {
      const { png } = await window.__tornoTest!.look({ view: 'iso', size: 640 })
      let binary = ''
      for (let i = 0; i < png.length; i += 0x8000) binary += String.fromCharCode(...png.subarray(i, i + 0x8000))
      return btoa(binary)
    })
  const withArrowActive = await picture()
  await row('M1').locator('.mark-chip').click()
  await expect.poll(async () => (await state()).activeMark).toBe('M1')
  const withPinActive = await picture()
  expect(withPinActive).toBe(withArrowActive)
  // And it is still the active one on screen afterwards.
  expect((await state()).activeMark).toBe('M1')
  await row('M2').locator('.mark-chip').click()
  await expect.poll(async () => (await state()).activeMark).toBe('M2')
})

test('a pick mark tints its face, also when that face is selected; a ref that names nothing is drawn at its point', async () => {
  // What is drawn there, which from this view is the post: the mark is of that face, at the point of it that was hit.
  const hit = await page.evaluate((at) => {
    const [fx, fy] = window.__tornoTest!.project(at)
    return window.__tornoTest!.pickAt(fx, fy, { edges: false })!
  }, [-14, 9, 2.5] as Vec3)
  const face = hit.ref
  const onFace = await page.evaluate((at) => window.__tornoTest!.project(at), [-17, 12, 2.5] as Vec3)
  const before = await differing(MARKED, PLAIN, { x: onFace[0], y: onFace[1] }, 0.004)
  expect(before.near).toBe(0)
  await addMark({ kind: 'pick', target: 'face', note: 'this face', anchor: { point: hit.point, ...(hit.normal ? { normal: hit.normal } : {}), part: hit.part, ref: face } })
  await expect(rows()).toHaveCount(3)
  // Away from the mark's point and its label, the face itself has taken the mark's colour.
  expect((await differing(MARKED, PLAIN, { x: onFace[0], y: onFace[1] }, 0.004)).near).toBeGreaterThan(20)

  // Selected as well: the selection is not in a picture, the mark's tint still is.
  const box = (await page.locator('.viewport-canvas canvas').first().boundingBox())!
  await page.mouse.move(box.x + onFace[0] * box.width, box.y + onFace[1] * box.height)
  await page.mouse.down()
  await page.mouse.up()
  await expect.poll(async () => (await state()).selection).toEqual([face])
  expect((await differing(MARKED, PLAIN, { x: onFace[0], y: onFace[1] }, 0.004)).near).toBeGreaterThan(20)

  // A face the part does not have, and a part the layout does not have: drawn where they were put, with no tint.
  await addMark({ kind: 'pick', target: 'face', anchor: { point: [14, -9, 2.5], part: 'base', ref: 'base/F999' } })
  await addMark({ kind: 'pick', target: 'part', anchor: { point: [0, 12, 2.5], part: 'gone', ref: 'gone' } })
  for (const id of ['M4', 'M5']) {
    const label = (await markScreen(id))!
    expect(label.visible).toBe(true)
    expect((await differing(MARKED, PLAIN, label, 0.012)).near, id).toBeGreaterThan(60)
  }
  for (const id of ['M4', 'M5']) await page.evaluate((mark) => window.torno.marks.remove('bracket', mark), id)
  await expect(rows()).toHaveCount(3)
})

test('resolving a mark folds it under "Resolved" and takes it out of the picture', async () => {
  const label = (await markScreen('M1'))!
  expect((await differing(MARKED, PLAIN, label, 0.012)).near).toBeGreaterThan(60)

  await row('M1').hover()
  await page.getByRole('button', { name: 'Resolve M1', exact: true }).click()
  await expect(rows()).toHaveCount(2)
  await expect(row('M1')).toHaveCount(0)
  await expect.poll(() => marksOnDisk().marks[0].status).toBe('resolved')
  expect(await markScreen('M1')).toBeNull()
  expect((await differing(MARKED, PLAIN, label, 0.012)).near).toBe(0)

  const fold = page.getByRole('button', { name: /^Resolved/ })
  await expect(fold).toHaveAttribute('aria-expanded', 'false')
  await expect(fold).toContainText('1')
  await fold.click()
  await expect(page.getByRole('list', { name: 'Resolved marks' }).locator('.mark-row')).toHaveAttribute('data-mark', 'M1')
  // It can be taken up again.
  await row('M1').hover()
  await page.getByRole('button', { name: 'Reopen M1', exact: true }).click()
  await expect.poll(() => marksOnDisk().marks[0].status).toBe('draft')
  await expect.poll(async () => (await markScreen('M1'))?.visible).toBe(true)
  await expect(fold).toHaveCount(0)
})

test('deleting a mark takes it out of the file; its number is not given out again', async () => {
  await row('M3').hover()
  await page.getByRole('button', { name: 'Delete M3', exact: true }).click()
  await expect(rows().locator('.mark-chip')).toHaveText(['M1', 'M2'])
  await expect.poll(() => marksOnDisk().marks.map((m) => m.id)).toEqual(['M1', 'M2'])
  expect(marksOnDisk().next).toBe(6)

  // Undo puts it back whole, with its number, note and group; once.
  const gone = page.getByText('Deleted M3')
  await expect(gone).toBeVisible()
  await page.getByRole('button', { name: 'Undo', exact: true }).click()
  await expect(rows().locator('.mark-chip')).toHaveText(['M1', 'M2', 'M3'])
  await expect(gone).toHaveCount(0)
  await expect.poll(() => marksOnDisk().marks.map((m) => m.id)).toEqual(['M1', 'M2', 'M3'])
  expect(marksOnDisk().next).toBe(6)
  await expect(page.getByRole('list', { name: 'To send' }).locator('.mark-row[data-mark="M3"]')).toHaveCount(1)
  expect(await page.evaluate(() => window.torno.marks.restore('bracket', 'M3').then(() => 'back', (e: Error) => e.message))).toMatch(/cannot be put back/)
  // And the rest of the file is as it was.
  await row('M3').hover()
  await page.getByRole('button', { name: 'Delete M3', exact: true }).click()
  await expect.poll(() => marksOnDisk().marks.map((m) => m.id)).toEqual(['M1', 'M2'])
})

test('marks belong to a layout: another layout shows none of them, and going to one switches back', async () => {
  await page.getByRole('group', { name: 'Layout' }).getByRole('button').click()
  await page.getByRole('menuitem', { name: 'print', exact: true }).click()
  await expect.poll(async () => (await state()).layout).toBe('print')
  expect(await markScreen('M1')).toBeNull()
  expect(await markScreen('M2')).toBeNull()
  expect((await differing(MARKED, PLAIN)).all).toBe(0)
  // Asked for by name, the other layout's picture has its marks.
  expect((await differing({ view: 'iso', layout: 'assembly' }, { view: 'iso', layout: 'assembly', marks: false })).all).toBeGreaterThan(200)
  // And asking for it left the screen as it was.
  expect(await markScreen('M1')).toBeNull()

  // The rows are still there, and say where their marks are.
  await expect(rows()).toHaveCount(2)
  await expect(row('M1').locator('.mark-layout')).toHaveText('assembly')
  const print = await addMark({ kind: 'pin', note: 'on the bed', anchor: { point: [60, 0, 8], normal: [0, 0, 1], part: 'post' } })
  expect(print).toMatchObject({ id: 'M6', layout: 'print' })
  await expect.poll(async () => (await markScreen('M6'))?.visible).toBe(true)
  await expect(row('M6').locator('.mark-layout')).toHaveCount(0)

  await row('M1').locator('.mark-chip').click()
  await expect.poll(async () => (await state()).layout).toBe('assembly')
  expect((await state()).activeMark).toBe('M1')
  await expect.poll(async () => (await markScreen('M1'))?.visible).toBe(true)
  expect(await markScreen('M6')).toBeNull()
  await expect(row('M6').locator('.mark-layout')).toHaveText('print')
})

test("the count of open marks on a part in the layers lists only its marks, and the chip above the list brings them all back", async () => {
  // M6 is a pin of the print layout on the post; M1 and M2 are on the base, in the layout shown.
  await openSection(page, 'Marks')
  await expect(row('M6')).toHaveCount(1)
  await openSection(page, 'Parts')
  const count = page.locator('[data-layer="base"] .layer-marks')
  await expect(count).toBeVisible()
  const open = Number(await count.textContent())
  expect(open).toBeGreaterThanOrEqual(2)
  await count.click()
  // The list is the Marks panel's: the count in the layers said which part it is cut to.
  await openSection(page, 'Marks')
  await expect(page.locator('.marks-filter')).toHaveText(/Only marks on base/)
  await expect(row('M1')).toHaveCount(1)
  await expect(row('M2')).toHaveCount(1)
  await expect(row('M6')).toHaveCount(0)
  expect((await state()).marksOnPart).toBe('base')
  // A view of the list only: nothing of the marks changes, and the agent is told them all.
  expect(marksOnDisk().marks.map((m) => m.id)).toContain('M6')
  await page.getByRole('button', { name: 'Show all marks' }).click()
  await expect(page.locator('.marks-filter')).toHaveCount(0)
  await expect(row('M6')).toHaveCount(1)
  expect((await state()).marksOnPart).toBeNull()
})

test('what was wrong with a marks file is said in the panel in full, to a window that was not listening too, until it is dismissed', async () => {
  // Main reads the file of an object the window is not showing: nobody hears the problem said.
  const first = await page.evaluate(() => window.torno.marks.list('plain'))
  expect(first).toEqual([])
  const aside = readdirSync(join(root, 'plain', '.torno')).find((name) => name.startsWith('marks.json.corrupt-'))!
  expect(readFileSync(join(root, 'plain', '.torno', aside), 'utf8')).toBe(CORRUPT)
  expect((await state()).marksProblem).toBeNull()

  const sentence = `The marks file of this project could not be read. It was kept as .torno/${aside}, and a new list was started.`
  const line = page.locator('.marks-problem')
  await openObject('plain')
  await expect(line).toContainText(sentence)
  // Still there after the window is loaded anew.
  await page.reload()
  await page.waitForSelector('[data-region="viewport"]')
  await openObject('plain')
  await expect(line).toContainText(sentence)
  // The ids the lost file gave out are not given out again.
  expect((await page.evaluate((c) => window.torno.marks.add('plain', { kind: 'pin', author: 'user', note: '', layout: 'assembly', revision: 1, camera: c, anchor: { point: [0, 0, 0] } }), await camera())).id).toBe('M4')

  await line.getByRole('button', { name: 'Dismiss' }).click()
  await expect(line).toHaveCount(0)
  await page.reload()
  await page.waitForSelector('[data-region="viewport"]')
  await openObject('plain')
  await expect(rows()).toHaveCount(1)
  await expect(line).toHaveCount(0)
})

test('with a scan imported, five mark rows and more are in view in the Marks panel at 1440 × 900', async () => {
  test.setTimeout(120_000)
  const own = copyFixtures()
  const camera = { position: [120, -90, 60], target: [0, 0, 6], up: [0, 0, 1], ortho: false, fov: 35, zoom: 1 }
  const at = { author: 'user', status: 'draft', anchorState: 'ok', layout: 'assembly', revision: 1, camera, createdAt: '2026-10-09T20:00:00.000Z' }
  mkdirSync(join(own, 'hollow', '.torno'), { recursive: true })
  const pins = Array.from({ length: 8 }, (_, n) => ({ ...at, id: `M${n + 1}`, kind: 'pin', note: `note ${n + 1}`, anchor: { point: [20, 0, 5 + 4 * n], normal: [1, 0, 0], part: 'tub' } }))
  writeFileSync(join(own, 'hollow', '.torno', 'marks.json'), JSON.stringify({ next: 9, marks: pins }))
  const scan = join(own, 'floor.stl')
  writeFileSync(scan, stl(box([60, 50, 2], [0, 0, -10])))
  const ownApp = await launch({ TORNO_WORKSPACE: own })
  try {
    const p = await ownApp.firstWindow()
    await p.waitForSelector('[data-region="viewport"]')
    expect(await p.evaluate(() => [innerWidth, innerHeight])).toEqual([1440, 900])
    await openListed(p, 'hollow')
    await expect.poll(async () => (await state(p)).build?.status, { timeout: 30_000 }).toBe('ok')
    await expect(rows(p)).toHaveCount(8)
    await ownApp.evaluate((_electron, path) => void ((globalThis as unknown as { __tornoMain: { pickFile: string | null } }).__tornoMain.pickFile = path), scan)
    await openSection(p, 'Scans')
    await p.getByRole('button', { name: 'Import scan…' }).click()
    await expect.poll(async () => (await state(p)).scans.length, { timeout: 60_000 }).toBe(1)
    const asked = p.getByRole('dialog', { name: 'How is S1 read?' })
    if (await asked.isVisible()) await asked.getByRole('button', { name: 'Later' }).click()
    await p.getByRole('button', { name: 'Details of S1' }).click()
    await expect(p.locator('.scan-detail')).toBeVisible()
    await openSection(p, 'Marks')
    // The rows wholly in sight in the marks' own scroller.
    const whole = await p.evaluate(() => {
      const body = document.querySelector('.marks-body')!.getBoundingClientRect()
      return [...document.querySelectorAll('.mark-row')].filter((row) => {
        const r = row.getBoundingClientRect()
        return r.top >= body.top - 0.5 && r.bottom <= body.bottom + 0.5 && r.height > 0
      }).length
    })
    expect(whole).toBeGreaterThanOrEqual(5)
  } finally {
    await ownApp.close()
    rmSync(own, { recursive: true, force: true })
  }
})

test('a mark\'s chip in the view answers the pointer: its line at the pointer, its row on a click, over any tool', async () => {
  test.setTimeout(120_000)
  const own = copyFixtures()
  const placed = { position: [120, -90, 60], target: [0, 0, 6], up: [0, 0, 1], ortho: false, fov: 35, zoom: 1 }
  const at = { author: 'user', status: 'sent', anchorState: 'ok', layout: 'assembly', revision: 1, camera: placed, createdAt: '2026-10-09T20:00:00.000Z' }
  mkdirSync(join(own, 'hollow', '.torno'), { recursive: true })
  writeFileSync(
    join(own, 'hollow', '.torno', 'marks.json'),
    JSON.stringify({
      next: 5,
      marks: [
        { ...at, id: 'M1', kind: 'pin', status: 'draft', note: 'too thin here', anchor: { point: [20, 0, 20], normal: [1, 0, 0], part: 'tub' } },
        { ...at, id: 'M3', kind: 'dimension', note: 'height with the lid', measure: 'distance', a: { point: [0, 0, 0], normal: [0, 0, -1], part: 'tub' }, b: { point: [0, 0, 40], normal: [0, 0, 1], part: 'lid' }, expected: 42 },
        { ...at, id: 'M4', kind: 'pin', author: 'agent', note: 'I thickened this wall to 2 mm', anchor: { point: [0, -20, 20], normal: [0, -1, 0], part: 'tub' } }
      ]
    })
  )
  const ownApp = await launch({ TORNO_WORKSPACE: own })
  try {
    const p = await ownApp.firstWindow()
    await p.waitForSelector('[data-region="viewport"]')
    await openListed(p, 'hollow')
    await expect.poll(async () => (await state(p)).build?.status, { timeout: 30_000 }).toBe('ok')
    await expect.poll(async () => (await state(p)).marks.find((m): m is Extract<Mark, { kind: 'dimension' }> => m.id === 'M3' && m.kind === 'dimension')?.verdict, { timeout: 30_000 }).toBe('fail')
    const canvas = p.locator('.viewport-canvas canvas').first()
    const view = (await canvas.boundingBox())!
    const chip = async (id: string): Promise<[number, number]> => {
      const label = (await markScreen(id, p))!
      expect(label.visible, id).toBe(true)
      return [view.x + label.x * view.width, view.y + label.y * view.height]
    }
    const readout = p.locator('.pick-readout')
    const hovered = (): Promise<string | null> => p.evaluate(() => window.__tornoTest!.hoveredMark())

    // The pointer on a chip: the hand, the row's hover, the chip ringed, and its line at the pointer.
    await p.mouse.move(...(await chip('M1')))
    await expect(readout).toBeVisible()
    await expect(readout).toHaveText(/^M1\s*too thin here$/)
    await expect(readout).toHaveAttribute('data-says', 'note')
    expect(await hovered()).toBe('M1')
    await expect(row('M1', p)).toHaveAttribute('data-hovered', '')
    await expect(canvas).toHaveCSS('cursor', 'pointer')
    // What it is on is lit in the accent, on a layer of its own: nothing of the person's mark in the agent's colour.
    const pinned = (await state(p)).marks.find((m) => m.id === 'M1')!
    const onRef = pinned.kind === 'pin' ? pinned.anchor.ref : undefined
    expect(onRef).toMatch(/^tub\/F\d+$/)
    const lit = await p.evaluate(() => window.__tornoTest!.highlighted())
    expect(lit.point).toEqual([onRef])
    expect(lit.agent).toEqual([])
    // A failing dimension says what it should be and by how much it misses, in the face of numbers.
    await p.mouse.move(...(await chip('M3')))
    await expect(readout).toHaveText(/^M3\s*40 mm, expected 42 ± 0\.05, 2 under$/)
    await expect(readout).toHaveAttribute('data-says', 'ref')
    await expect(row('M1', p)).not.toHaveAttribute('data-hovered', '')

    // A click on it opens its row, in view, and leaves the camera where it is.
    const before = await camera(p)
    await p.mouse.click(...(await chip('M3')))
    await expect(row('M3', p)).toHaveAttribute('aria-current', 'true')
    await expect(row('M3', p)).toBeInViewport()
    expect(await camera(p)).toEqual(before)
    // A mark that was sent has its note in its row: no card opens over the view.
    await expect(p.locator('.note-card')).toHaveCount(0)
    // One of the person's not yet sent opens its note beside it, to be written.
    await p.mouse.click(...(await chip('M1')))
    await expect(p.locator('.note-card[data-mark="M1"]')).toBeVisible()
    await expect(p.getByRole('textbox', { name: 'Note on M1' })).toBeFocused()
    await p.keyboard.press('Escape')
    await expect(p.locator('.note-card')).toHaveCount(0)
    expect((await state(p)).activeMark).toBe('M1')

    // With the Pin tool in hand a click on a chip is the chip's: no pin is left under it.
    await p.keyboard.press('p')
    await expect(p.locator('.tool-button[data-tool="pin"]')).toHaveAttribute('aria-pressed', 'true')
    await p.mouse.click(...(await chip('M4')))
    await expect(row('M4', p)).toHaveAttribute('aria-current', 'true')
    await p.waitForTimeout(500)
    expect((await state(p)).marks.map((m) => m.id)).toEqual(['M1', 'M3', 'M4'])
    // Off the chips the tool has the pointer again: over the part, the pin says what it would be on.
    const [x, y] = await chip('M4')
    await p.mouse.move(view.x + view.width / 2, view.y + view.height / 2)
    await expect.poll(hovered).toBeNull()
    await expect(canvas).not.toHaveCSS('cursor', 'pointer')

    // A drag that starts on a chip turns the camera, and opens nothing.
    const turned = await camera(p)
    await p.mouse.move(x, y)
    await p.mouse.down()
    await p.mouse.move(x + 80, y + 30, { steps: 5 })
    await p.mouse.up()
    await expect.poll(async () => JSON.stringify(await camera(p))).not.toBe(JSON.stringify(turned))
    expect((await state(p)).activeMark).toBe('M4')
    expect((await state(p)).marks).toHaveLength(3)
  } finally {
    await ownApp.close()
    rmSync(own, { recursive: true, force: true })
  }
})

test('a view note in the list has its picture and its comment; the pointer on it lights only the faces under its ink that the build still has; a click goes to its camera', async () => {
  test.setTimeout(120_000)
  const own = copyFixtures()
  const ownApp = await launch({ TORNO_WORKSPACE: own })
  try {
    const p = await ownApp.firstWindow()
    await p.waitForSelector('[data-region="viewport"]')
    await openObject('bracket', p)
    const now = await state(p)
    const face = now.scene!.parts.find((part) => part.name === 'base')!
    expect(face.faceCount).toBeGreaterThan(1)
    // The note was made from another view than the one on show.
    const seen = { position: [120, -90, 60], target: [0, 0, 6], up: [0, 0, 1], ortho: false, fov: 35, zoom: 1 }
    const made = await p.evaluate(
      async ({ camera, layout, ref, gone }) => {
        const canvas = new OffscreenCanvas(160, 100)
        const ctx = canvas.getContext('2d')!
        ctx.fillStyle = '#d9d4c8'
        ctx.fillRect(0, 0, 160, 100)
        const plain = new Uint8Array(await (await canvas.convertToBlob({ type: 'image/png' })).arrayBuffer())
        ctx.strokeStyle = '#d4342c'
        ctx.lineWidth = 6
        ctx.beginPath()
        ctx.moveTo(20, 30)
        ctx.lineTo(120, 60)
        ctx.stroke()
        const inked = new Uint8Array(await (await canvas.convertToBlob({ type: 'image/png' })).arrayBuffer())
        const strokeUnder = { box: [20, 30, 120, 60], refs: [{ ref }, { ref: gone }], cuts: [], scans: [], bare: false }
        return window.torno.notes.make({
          objectId: 'bracket', revision: 1, layout, camera, caption: 'the bracket from the front', size: { w: 160, h: 100 }, plain, inked, inkColour: '#d4342c',
          strokes: [{ width: 6, points: [[20, 30], [120, 60]] }], labels: [], under: [strokeUnder], comment: 'make the base thicker here', references: [],
          // A note hangs a label only where its ink first lay over a face (one with no anchor is a picture in no place).
          anchor: { point: [0, 0, 0], part: 'base', ref }
        } as never)
      },
      { camera: seen, layout: now.layout, ref: `base/F0`, gone: `base/F${face.faceCount + 40}` }
    )
    const id = made.id
    const mark = row(id, p)
    await expect(mark).toHaveCount(1)
    // Its picture with the ink, and its comment.
    await expect(mark.locator('img.mark-thumb')).toBeVisible()
    await expect(mark.locator('.mark-note')).toHaveText('make the base thicker here')
    // The faces under the ink that the build has light up; the one it does not have lights nothing.
    await p.mouse.move(900, 450)
    await mark.hover()
    await expect.poll(() => p.evaluate(() => window.__tornoTest!.peeked())).toEqual(['base/F0'])
    await p.mouse.move(900, 450)
    await expect.poll(() => p.evaluate(() => window.__tornoTest!.peeked())).toEqual([])
    // A click on the row, and the reticle, go to the camera the note was made from.
    const apart = async (): Promise<number> => {
      const c = await camera(p)
      return Math.max(...c.position.map((v, i) => Math.abs(v - seen.position[i])), ...c.target.map((v, i) => Math.abs(v - seen.target[i])))
    }
    await p.getByRole('button', { name: 'Top view, 4', exact: true }).click()
    await resting(p)
    expect(await apart()).toBeGreaterThan(1)
    // Close in on a corner of the view, far from where the note hangs its label: it is out of view, and a click goes to its camera.
    const canvas = (await p.locator('.viewport-canvas canvas').first().boundingBox())!
    await p.mouse.move(canvas.x + 20, canvas.y + canvas.height - 20)
    for (let i = 0; i < 16; i++) await p.mouse.wheel(0, -400)
    await expect.poll(async () => (await markScreen(id, p))?.visible).toBe(false)
    await resting(p)
    await mark.locator('.mark-chip').click()
    await expect(mark).toHaveAttribute('aria-current', 'true')
    await expect.poll(apart).toBeLessThan(1e-6)
    await p.getByRole('button', { name: 'Top view, 4', exact: true }).click()
    await resting(p)
    await mark.hover()
    await p.getByRole('button', { name: `Go to ${id}`, exact: true }).click()
    await expect.poll(apart).toBeLessThan(1e-6)
  } finally {
    await ownApp.close()
    rmSync(own, { recursive: true, force: true })
  }
})

// Set TORNO_SHOTS=<dir> to write marks-light.png and marks-dark.png there: the
// window with the bracket and five marks, one of each kind, three of them the
// person's and two the agent's; and marks-look.png, the picture the agent gets
// of the same. Each picture of the window needs its own launch: on a hidden
// window capturePage() delivers one image and hangs on the next call, and
// page.screenshot() never returns.
for (const scheme of ['light', 'dark'] as const) {
  test(`screenshot of the marks, ${scheme}`, async () => {
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
      const side = await shotPage.evaluate((at) => {
        const [fx, fy] = window.__tornoTest!.project(at)
        return window.__tornoTest!.pickAt(fx, fy, { edges: false })!
      }, [20, 3, 0] as Vec3)
      await addMark({ kind: 'pin', note: 'Too thin here: 4 mm at least', anchor: { point: [15, -11, 2.5], normal: [0, 0, 1], part: 'base' } }, shotPage)
      await addAgentMark({ kind: 'pick', target: 'face', note: 'Do you mean this face?', anchor: { point: side.point, normal: side.normal, part: side.part, ref: side.ref } }, shotApp, shotPage)
      await addMark({ kind: 'arrow', note: 'Make the post 8 mm taller', from: { point: [0, 0, 22.5], normal: [0, 0, 1], part: 'post' }, to: [0, 0, 30.5] }, shotPage)
      await addMark(
        {
          kind: 'stroke',
          space: 'plane',
          note: 'A rib like this, both sides',
          anchor: { point: [4, 0, 2.5] },
          plane: { origin: [0, 0, 0], x: [1, 0, 0], y: [0, 0, 1], label: 'XZ at y = 0.0' },
          points2d: [[4, 2.5], [4.3, 6], [5.2, 9.5], [7, 12.4], [9.6, 13.2], [12.5, 11], [15, 7.4], [17, 4.4], [18.5, 2.5]]
        },
        shotPage
      )
      await addAgentMark({ kind: 'shape', shape: 'box', intent: 'remove', note: 'I would cut this corner away', position: [-16, -11, 2.5], rotation: [0, 0, 0, 1], size: [8, 8, 5] }, shotApp, shotPage)
      await expect(rows(shotPage)).toHaveCount(5)
      await shotPage.evaluate(() => window.torno.marks.update('bracket', 'M1', { status: 'sent' }))
      // The stroke is the active mark, so its plane shows; the camera stays where it is.
      await row('M4', shotPage).locator('.mark-note').click({ position: { x: 4, y: 8 } })
      await shotPage.keyboard.press('Escape')
      await row('M2', shotPage).hover()
      await shotPage.evaluate(async () => {
        await document.fonts.ready
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
      })
      if (scheme === 'light') {
        const look = await shotPage.evaluate(async () => Array.from((await window.__tornoTest!.look({ view: 'iso' })).png))
        writeFileSync(join(dir!, 'marks-look.png'), Buffer.from(look))
      }
      const png = await shotApp.evaluate(async ({ BrowserWindow }) => {
        const image = await BrowserWindow.getAllWindows()[0].webContents.capturePage()
        return image.toPNG().toString('base64')
      })
      writeFileSync(join(dir!, `marks-${scheme}.png`), Buffer.from(png, 'base64'))
    } finally {
      await shotApp.close()
      rmSync(shotRoot, { recursive: true, force: true })
    }
  })
}
