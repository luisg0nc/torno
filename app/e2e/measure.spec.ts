import { cpSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { inTerminal } from './terminal'
import type { TornoState } from '../src/renderer/state/store'
import type { Hit } from '../src/renderer/viewport/picking'
import type { DimensionMark, MarksFile } from '../src/shared/marks'
import type { Camera } from '../src/shared/view'

// The Measure tool and the dimensions it leaves, on the `measures` fixture: a
// plate 40 × 30 × 6 with two Ø8 holes 20 apart, a 45° chamfer and a pocket.
//
// The window is hidden. The pointer is aimed through window.__tornoTest.project
// and moved with page.mouse; what was measured is read from the object's
// marks.json (main's own, with the kernel's values), from .state, and from the
// picture the agent would be given.
const appDir = resolve(__dirname, '..')
const fixtures = resolve(appDir, '../kernel/tests/fixtures/ws')
const fakeAgent = resolve(appDir, 'test/fake-agent.mjs')

test.describe.configure({ mode: 'serial' })

let root: string
let app: ElectronApplication
let page: Page
/** What main printed on stderr: a refusal of what the person asked is never there (#13). */
let stderr = ''

function copyFixtures(): string {
  const dir = mkdtempSync(join(realpathSync(tmpdir()), 'torno-e2e-measure-'))
  cpSync(fixtures, dir, { recursive: true, filter: (source) => !source.endsWith('__pycache__') })
  inTerminal(dir)
  return dir
}

// TORNO_TEST=1 makes main create the window with show: false. Never launch without it.
function launch(env: Record<string, string>): Promise<ElectronApplication> {
  return electron.launch({ args: ['.'], cwd: appDir, env: { ...process.env, TORNO_TEST: '1', TORNO_AGENT_CMD: `node ${fakeAgent}`, ...env } })
}

type Vec3 = [number, number, number]
const state = (p: Page): Promise<TornoState> => p.evaluate(() => window.__tornoTest!.state())
const camera = (p: Page): Promise<Camera> => p.evaluate(() => window.__tornoTest!.camera())
const marksOnDisk = (dir: string): MarksFile => {
  try {
    return JSON.parse(readFileSync(join(dir, 'measures', '.torno', 'marks.json'), 'utf8'))
  } catch {
    return { next: 1, marks: [] }
  }
}
const dimension = (dir: string, id: string): DimensionMark | undefined => marksOnDisk(dir).marks.find((m) => m.id === id) as DimensionMark | undefined
const readout = (p: Page) => p.locator('.pick-readout')
const canvas = (p: Page) => p.locator('.viewport-canvas canvas').first()
const row = (id: string, p: Page) => p.locator(`.mark-row[data-mark="${id}"]`)

function pickOver(point: Vec3, p: Page): Promise<Hit | null> {
  return p.evaluate((at) => {
    const [fx, fy] = window.__tornoTest!.project(at)
    return window.__tornoTest!.pickAt(fx, fy)
  }, point)
}

/** Where a point of the object frame is drawn, in the page's pixels. */
async function pageXY(point: Vec3, p: Page): Promise<[number, number]> {
  const [fx, fy] = await p.evaluate((at) => window.__tornoTest!.project(at), point)
  const box = (await canvas(p).boundingBox())!
  return [box.x + fx * box.width, box.y + fy * box.height]
}

async function clickOver(point: Vec3, p: Page, times = 1): Promise<void> {
  const [x, y] = await pageXY(point, p)
  await p.mouse.move(x, y)
  for (let i = 0; i < times; i++) {
    await p.mouse.down()
    await p.mouse.up()
  }
}

/** Waits until the camera has stopped: a view asked for by key is gone to over a quarter of a second. */
async function atRest(p: Page): Promise<void> {
  let last = ''
  await expect
    .poll(
      async () => {
        const now = JSON.stringify(await camera(p))
        const still = now === last
        last = now
        return still
      },
      { intervals: [120] }
    )
    .toBe(true)
}

async function openMeasures(p: Page): Promise<void> {
  await p.getByRole('button', { name: 'measures', exact: true }).click()
  await expect.poll(async () => (await state(p)).build?.status, { timeout: 90_000 }).toBe('ok')
  await expect.poll(async () => (await state(p)).scene !== null).toBe(true)
  await atRest(p)
}

// Points of the plate, as the iso view sees them: its top, the far wall of each hole, its chamfer.
const ON_TOP: Vec3 = [-2, 10, 3]
const UNDER: Vec3 = [-2, -2, -3]
const IN_HOLE: Vec3 = [-10 - 2.83, 5 + 2.83, 1.6]
const IN_OTHER_HOLE: Vec3 = [10 - 2.83, 5 + 2.83, 1.6]
const ON_CHAMFER: Vec3 = [19, -6, 2]

/**
 * Takes a picture of the current view, as the agent is given it, and keeps its
 * pixels in the page under a name. Answers how many of them are of a token's colour.
 */
function picture(p: Page, name: string, marks: boolean, token = '--user-mark'): Promise<number> {
  return p.evaluate(
    async ([key, withMarks, colour]) => {
      const hex = getComputedStyle(document.documentElement).getPropertyValue(colour).trim()
      const [r, g, b] = [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16))
      const taken = await window.__tornoTest!.look({ view: 'current', marks: withMarks })
      const bitmap = await createImageBitmap(new Blob([taken.png as Uint8Array<ArrayBuffer>], { type: 'image/png' }))
      const drawn = new OffscreenCanvas(bitmap.width, bitmap.height)
      const ctx = drawn.getContext('2d')!
      ctx.drawImage(bitmap, 0, 0)
      const { data } = ctx.getImageData(0, 0, bitmap.width, bitmap.height)
      const kept = ((window as unknown as { __pictures?: Record<string, Uint8ClampedArray> }).__pictures ??= {})
      kept[key] = data
      let coloured = 0
      for (let i = 0; i < data.length; i += 4) if (Math.abs(data[i] - r) + Math.abs(data[i + 1] - g) + Math.abs(data[i + 2] - b) <= 6) coloured += 1
      return coloured
    },
    [name, marks, token] as const
  )
}

/** How many pixels differ between two pictures kept by `picture`. */
function differing(p: Page, one: string, other: string): Promise<number> {
  return p.evaluate(
    ([a, b]) => {
      const kept = (window as unknown as { __pictures: Record<string, Uint8ClampedArray> }).__pictures
      const [first, second] = [kept[a], kept[b]]
      if (first.length !== second.length) return -1
      let changed = 0
      for (let i = 0; i < first.length; i += 4) if (Math.abs(first[i] - second[i]) + Math.abs(first[i + 1] - second[i + 1]) + Math.abs(first[i + 2] - second[i + 2]) >= 24) changed += 1
      return changed
    },
    [one, other] as const
  )
}

test.beforeAll(async () => {
  root = copyFixtures()
  app = await launch({ TORNO_WORKSPACE: root })
  app.process().stderr?.on('data', (chunk: Buffer) => (stderr += chunk.toString()))
  page = await app.firstWindow()
  await page.waitForSelector('[data-region="left"]')
  await openMeasures(page)
})

test.afterAll(async () => {
  await app?.close()
  rmSync(root, { recursive: true, force: true })
})

test('M takes up the Measure tool, which says what its clicks measure', async () => {
  await page.keyboard.press('m')
  const tools = page.getByRole('toolbar', { name: 'Tools' })
  await expect(tools.getByRole('button', { name: 'Measure', exact: true })).toHaveAttribute('aria-pressed', 'true')
  const choice = page.getByRole('group', { name: 'What to measure' })
  await expect(choice.getByRole('button', { name: 'Distance' })).toHaveAttribute('aria-pressed', 'true')
  await expect(choice.getByRole('button', { name: 'Diameter' })).toHaveAttribute('aria-pressed', 'true')
})

test('two clicks, on the top and on the bottom of the plate, leave its thickness: 6 mm between planes, from the kernel', async () => {
  expect(await pickOver(ON_TOP, page)).toMatchObject({ kind: 'face', normal: [0, 0, 1] })
  await clickOver(ON_TOP, page)
  // While the second end is pending the readout is an estimate from the mesh, and says so.
  const [x, y] = await pageXY([8, 10, 3], page)
  await page.mouse.move(x, y)
  await expect(readout(page)).toContainText('≈')
  expect(marksOnDisk(root).marks).toEqual([])

  // The bottom is seen from below: the camera is turned by a drag beside the part, which the tool leaves to it.
  const box = (await canvas(page).boundingBox())!
  const from: [number, number] = [box.x + box.width * 0.9, box.y + box.height * 0.3]
  await page.mouse.move(...from)
  await page.mouse.down()
  await page.mouse.move(from[0], from[1] - 120)
  await page.mouse.move(from[0], from[1] - 240)
  await page.mouse.up()
  await atRest(page)
  expect(await pickOver(UNDER, page)).toMatchObject({ kind: 'face', normal: [0, 0, -1] })
  await clickOver(UNDER, page)

  await expect.poll(() => dimension(root, 'M1')?.value).toBeCloseTo(6, 9)
  const kept = dimension(root, 'M1')!
  expect(kept).toMatchObject({ kind: 'dimension', measure: 'distance', how: 'between planes', status: 'draft', author: 'user', anchorState: 'ok' })
  expect(kept.a).toMatchObject({ part: 'plate', normal: [0, 0, 1] })
  expect(kept.b).toMatchObject({ part: 'plate', normal: [0, 0, -1] })
  expect(kept.points![0][2]).toBeCloseTo(3, 9)
  expect(kept.points![1][2]).toBeCloseTo(-3, 9)
  expect(kept.measuredRevision).toBe((await state(page)).revision)
  // The kernel's value is what is read out and what the row shows; no note was asked for.
  await expect(readout(page)).toHaveText(/M1\s*6 mm between planes/)
  await expect(row('M1', page).locator('.mark-value')).toHaveText('6 mm')
  await expect(page.locator('.note-card')).toHaveCount(0)
  // The tool is still in hand.
  await expect(page.getByRole('toolbar', { name: 'Tools' }).getByRole('button', { name: 'Measure', exact: true })).toHaveAttribute('aria-pressed', 'true')
})

test('a double click on the wall of a hole leaves its diameter: ⌀ 8', async () => {
  await page.keyboard.press('1')
  await atRest(page)
  const hit = await pickOver(IN_HOLE, page)
  expect(hit).toMatchObject({ kind: 'face', part: 'plate' })
  await clickOver(IN_HOLE, page, 2)
  await expect.poll(() => dimension(root, 'M2')?.value).toBeCloseTo(8, 9)
  const kept = dimension(root, 'M2')!
  expect(kept).toMatchObject({ measure: 'diameter', how: 'cylinder', a: { ref: hit!.ref } })
  expect(kept).not.toHaveProperty('b')
  // The two points it was taken between are the ends of a diameter of the hole about (-10, 5).
  const [p0, p1] = kept.points!
  expect(Math.hypot(p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2])).toBeCloseTo(8, 9)
  expect((p0[0] + p1[0]) / 2).toBeCloseTo(-10, 9)
  expect((p0[1] + p1[1]) / 2).toBeCloseTo(5, 9)
  await expect(row('M2', page).locator('.mark-value')).toHaveText('⌀ 8 mm')
  expect(marksOnDisk(root).marks).toHaveLength(2)
  // Both are drawn, each with a label.
  expect(await page.evaluate(() => [window.__tornoTest!.markScreen('M1'), window.__tornoTest!.markScreen('M2')].map((l) => l !== null))).toEqual([true, true])
})

test('an angle to the wall of a hole: before the click the pointer says it is taken by its axis, with no estimate', async () => {
  await page.getByRole('group', { name: 'What to measure' }).getByRole('button', { name: 'Angle' }).click()
  await clickOver(ON_TOP, page)
  const [x, y] = await pageXY(IN_OTHER_HOLE, page)
  await page.mouse.move(x, y)
  await page.mouse.move(x + 1, y)
  await expect(readout(page)).toContainText('By its axis:')
  await expect(readout(page)).toContainText('is a cylinder face')
  await expect(readout(page)).not.toContainText('≈')
  await expect(readout(page)).not.toContainText('assembly:')
  // Not clicked: the first end is dropped, and nothing is kept.
  await page.keyboard.press('Escape')
  expect(marksOnDisk(root).marks).toHaveLength(2)
  expect((await state(page)).marksProblem).toBeNull()
  // A refusal is answered, not thrown: Electron prints nothing of it on the terminal.
  expect(stderr).not.toContain("Error occurred in handler for 'marks:add'")
  expect(stderr).not.toContain('angle is measured between')
  await page.getByRole('group', { name: 'What to measure' }).getByRole('button', { name: 'Distance' }).click()
})

test('with an expected value the hole fails: the row says so, and the chip in the picture is ringed', async () => {
  // Counted in the colour of a verdict that fails, which is not the colour of the person's marks: a ring is the only thing of it.
  const before = await picture(page, 'before', true, '--fail')
  await row('M2', page).click()
  const fields = row('M2', page).locator('.dimension-fields')
  await expect(fields.locator('.dimension-value')).toHaveText('⌀ 8 mm')
  await expect(fields.locator('.dimension-how')).toHaveText('cylinder')
  await expect(fields.getByRole('textbox', { name: 'Tolerance' })).toHaveAttribute('placeholder', '0.05')
  await fields.getByRole('textbox', { name: 'Expected' }).fill('8.5')
  await fields.getByRole('textbox', { name: 'Expected' }).press('Enter')

  await expect.poll(() => dimension(root, 'M2')?.verdict).toBe('fail')
  expect(dimension(root, 'M2')).toMatchObject({ expected: 8.5, value: 8 })
  await expect(row('M2', page).locator('.mark-value')).toHaveAttribute('data-verdict', 'fail')
  await expect(fields.locator('.dimension-verdict')).toHaveText('Fails: 0.5 under')
  // The row, open and with the pointer on it: its value, its verdict and the way to a note, none of them cut.
  await row('M2', page).hover()
  const note = row('M2', page).locator('.mark-note')
  await expect(note).toHaveAttribute('data-empty', '')
  const [wide, room] = await note.evaluate((el) => [el.scrollWidth, el.clientWidth])
  expect(wide).toBeLessThanOrEqual(room)
  const covered = await row('M2', page).evaluate((li) => {
    const text = li.querySelector('.mark-note')!.getBoundingClientRect()
    const actions = li.querySelector('.mark-actions')!.getBoundingClientRect()
    const ink = document.createRange()
    ink.selectNodeContents(li.querySelector('.mark-note')!)
    return ink.getBoundingClientRect().right > actions.left && text.top < actions.bottom && getComputedStyle(li.querySelector('.mark-actions')!).opacity !== '0'
  })
  expect(covered).toBe(false)

  // The picture: the same but for the chip of M2, whose value is now ringed.
  await atRest(page)
  const after = await picture(page, 'after', true, '--fail')
  const changed = await differing(page, 'before', 'after')
  expect(changed).toBeGreaterThan(40)
  expect(changed).toBeLessThan(4000)
  expect(after).toBeGreaterThan(before)

  // Within the tolerance it passes.
  await fields.getByRole('textbox', { name: 'Tolerance' }).fill('0.5')
  await fields.getByRole('textbox', { name: 'Tolerance' }).press('Enter')
  await expect(fields.locator('.dimension-verdict')).toHaveText('Passes')
  await expect.poll(() => dimension(root, 'M2')?.verdict).toBe('pass')
  // Back to the default, it fails again; the value was never asked of the window.
  await fields.getByRole('textbox', { name: 'Tolerance' }).fill('')
  await fields.getByRole('textbox', { name: 'Tolerance' }).press('Enter')
  await expect.poll(() => dimension(root, 'M2')?.verdict).toBe('fail')
  expect(dimension(root, 'M2')).not.toHaveProperty('tolerance')
})

test('the picture for the agent shows both dimensions, and none of them without the marks', async () => {
  const withMarks = await picture(page, 'marks', true)
  const without = await picture(page, 'bare', false)
  expect(without).toBe(0)
  // Two numbered chips of the person's, the lines and the ring of the one that fails.
  expect(withMarks).toBeGreaterThan(600)
})

test('the window cannot give a dimension a value: main measures what it is given', async () => {
  const forged = await page.evaluate(async () => {
    const s = window.__tornoTest!.state()
    const hole = s.marks.find((m) => m.id === 'M2')
    if (hole?.kind !== 'dimension') throw new Error('no M2')
    const { id: _id, status: _status, anchorState: _anchorState, createdAt: _createdAt, ...given } = hole
    return window.torno.marks.add(s.objectId!, { ...given, value: 99, verdict: 'pass', expected: 99, how: 'as I say' } as never)
  })
  expect(forged).toMatchObject({ id: 'M3', value: 8, how: 'cylinder', expected: 99, verdict: 'fail' })
  const patched = await page.evaluate(() => window.torno.marks.update(window.__tornoTest!.state().objectId!, 'M3', { value: 99, verdict: 'pass' } as never))
  expect(patched).toMatchObject({ value: 8, verdict: 'fail' })
  await page.evaluate(() => window.torno.marks.remove(window.__tornoTest!.state().objectId!, 'M3'))
})

test('T over a face leaves the thickness of the wall there, and Escape drops a first end without putting the tool down', async () => {
  // The floor of the pocket: 2 mm of plate under it.
  // The keys are the view's again once the field that was typed in is left.
  await page.evaluate(() => (document.activeElement as HTMLElement).blur())
  // From above, where all of it is seen.
  await page.keyboard.press('4')
  await atRest(page)
  const floor: Vec3 = [1, -10, -1]
  const onFloor = await pickOver(floor, page)
  expect(onFloor).toMatchObject({ kind: 'face' })
  expect(onFloor!.point[2]).toBeCloseTo(-1, 6)
  const [x, y] = await pageXY(floor, page)
  await page.mouse.move(x, y)
  await page.keyboard.press('t')
  await expect.poll(() => dimension(root, 'M4')?.value).toBeCloseTo(2, 9)
  expect(dimension(root, 'M4')).toMatchObject({ measure: 'thickness', how: 'wall, along the normal' })

  await clickOver(ON_TOP, page)
  await page.keyboard.press('Escape')
  await expect(page.getByRole('toolbar', { name: 'Tools' }).getByRole('button', { name: 'Measure', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await clickOver(ON_CHAMFER, page)
  // That click was a first end again: nothing was measured between it and the one dropped.
  await page.keyboard.press('Escape')
  expect(marksOnDisk(root).marks.map((m) => m.id)).toEqual(['M1', 'M2', 'M4'])
  await page.keyboard.press('Escape')
  await expect(page.getByRole('toolbar', { name: 'Tools' }).getByRole('button', { name: 'Select', exact: true })).toHaveAttribute('aria-pressed', 'true')
})

test('a dimension is given to the agent with the next prompt like any mark, and then says it is pinned', async () => {
  await expect(page.getByRole('list', { name: 'To send' }).locator('.mark-row[data-mark="M1"]')).toHaveCount(1)
  await app.evaluate(async () => {
    const hooks = (globalThis as unknown as { __tornoMain: { marks: { markSent(objectId: string): Promise<unknown> } } }).__tornoMain
    await hooks.marks.markSent('measures')
  })
  await expect(row('M1', page).locator('.mark-status')).toHaveText('pinned')
  // What it should be is changed: it is a draft again, to be told as changed.
  await row('M1', page).click()
  const fields = row('M1', page).locator('.dimension-fields')
  await fields.getByRole('textbox', { name: 'Expected' }).fill('6')
  await fields.getByRole('textbox', { name: 'Expected' }).press('Enter')
  await expect(fields.locator('.dimension-verdict')).toHaveText('Passes')
  await expect(page.getByRole('list', { name: 'To send' }).locator('.mark-row[data-mark="M1"]')).toHaveCount(1)
  expect(dimension(root, 'M1')).toMatchObject({ status: 'draft', sentBefore: true, expected: 6, verdict: 'pass' })
})

// Dimensions as checks of the part (review focus 1 and 2), on the fixture
// `gauge`: a plate 40 × 30 standing on z = 0 with a hole at (10, 0), 6 mm
// thick with a Ø8 hole when `variant.txt` says `a`, 5 mm with a Ø10 hole when
// it says `b`. The agent is the stand-in, whose `hook` line prints what it
// would be given with a prompt.
const gaugeMarks = (): DimensionMark[] => {
  try {
    return JSON.parse(readFileSync(join(root, 'gauge', '.torno', 'marks.json'), 'utf8')).marks
  } catch {
    return []
  }
}
const gauge = (id: string): DimensionMark | undefined => gaugeMarks().find((m) => m.id === id)
const terminal = async (): Promise<string> => (await page.evaluate(() => window.__tornoTerm!.text())).replace(/\s+/g, '')
const statusLine = () => page.locator('[data-region="status"]')

/** Has the stand-in agent post the hook of a prompt, and answers with what it was given, without white space. */
async function prompted(): Promise<string> {
  const before = (await terminal()).split('context:').length
  await page.locator('.session-term textarea').focus()
  await page.keyboard.type('hook')
  await page.keyboard.press('Enter')
  await expect.poll(async () => (await terminal()).split('context:').length).toBeGreaterThan(before)
  // What it prints arrives in pieces: until it has stopped growing.
  let last = ''
  await expect
    .poll(
      async () => {
        const now = await terminal()
        const still = now === last
        last = now
        return still
      },
      { intervals: [150] }
    )
    .toBe(true)
  return last.slice(last.lastIndexOf('context:'))
}

/** Builds the other variant of the gauge, and waits until its marks have been checked and its dimensions measured on that build. */
async function buildVariant(variant: 'a' | 'b', revision: number): Promise<void> {
  writeFileSync(join(root, 'gauge', 'variant.txt'), `${variant}\n`)
  await expect.poll(async () => (await state(page)).build, { timeout: 60_000 }).toMatchObject({ status: 'ok', revision, stale: false })
  await expect.poll(() => gaugeMarks().map((m) => m.measuredRevision), { timeout: 30_000 }).toEqual([revision, revision])
}

const GAUGE_TOP: Vec3 = [-10, 5, 6]
const GAUGE_HOLE: Vec3 = [10 - 2.83, 2.83, 3.2]

test('on the gauge, the thickness of the plate and the diameter of its hole are measured, and what they should be is typed', async () => {
  await page.evaluate(() => (document.activeElement as HTMLElement).blur())
  await page.getByRole('button', { name: 'gauge', exact: true }).click()
  await expect.poll(async () => (await state(page)).build, { timeout: 90_000 }).toMatchObject({ objectId: 'gauge', status: 'ok', revision: 1 })
  await expect.poll(async () => (await state(page)).scene !== null).toBe(true)
  await atRest(page)

  await page.keyboard.press('m')
  expect(await pickOver(GAUGE_TOP, page)).toMatchObject({ kind: 'face', normal: [0, 0, 1] })
  await page.mouse.move(...(await pageXY(GAUGE_TOP, page)))
  await page.keyboard.press('t')
  await expect.poll(() => gauge('M1')?.value).toBeCloseTo(6, 9)
  expect(await pickOver(GAUGE_HOLE, page)).toMatchObject({ kind: 'face', part: 'plate' })
  await clickOver(GAUGE_HOLE, page, 2)
  await expect.poll(() => gauge('M2')?.value).toBeCloseTo(8, 9)
  expect(gauge('M1')).toMatchObject({ measure: 'thickness', measuredRevision: 1 })
  expect(gauge('M2')).toMatchObject({ measure: 'diameter', measuredRevision: 1 })
  await page.keyboard.press('Escape')

  for (const [id, expected] of [['M1', '6'], ['M2', '8']] as const) {
    await row(id, page).click()
    const field = row(id, page).locator('.dimension-fields').getByRole('textbox', { name: 'Expected' })
    await field.fill(expected)
    await field.press('Enter')
    await expect(row(id, page).locator('.dimension-verdict')).toHaveText('Passes')
  }
  await page.evaluate(() => (document.activeElement as HTMLElement).blur())
  await expect(statusLine().locator('.status-dimensions')).toHaveCount(0)
})

test('given to the agent they are pinned: the next prompt says only how many pass', async () => {
  await page.locator('[data-region="session"]').getByRole('button', { name: 'New session' }).click()
  await expect.poll(terminal).toContain('READY')
  // New to the agent: told as marks, with their values and verdicts.
  const first = await prompted()
  expect(first).toMatch(/M1thickness6mmwall,alongthenormal,plate\/F\d+at\(-10,5,6\)\(expected6±0\.05:pass\)/)
  expect(first).toMatch(/M2diameter8mm,plate\/F\d+\(expected8±0\.05:pass\)/)
  expect(first).not.toContain('Dimensions')
  await expect(row('M1', page).locator('.mark-status')).toHaveText('pinned')
  await expect(row('M2', page).locator('.mark-status')).toHaveText('pinned')
  // The word of a row that is no draft takes no room until the row is pointed at: the width is the note's.
  const quiet = (await page.evaluate(() => window.__tornoTest!.state().activeMark)) === 'M1' ? 'M2' : 'M1'
  const word = row(quiet, page).locator('.mark-status')
  await page.mouse.move(700, 400)
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
  await expect.poll(async () => (await word.boundingBox())!.width).toBeLessThanOrEqual(1)
  await row(quiet, page).hover()
  await expect.poll(async () => (await word.boundingBox())!.width).toBeGreaterThan(20)
  await page.mouse.move(700, 400)
  // From then on: nothing of them but the count, while they pass.
  const second = await prompted()
  expect(second).toMatch(/Dimensions\(measuredonr\d+\):2pinneddimensionspassOpenmarks:M1,M2$/)
  expect(second).not.toContain('thickness')
})

test('a build that makes the plate 5 mm thick fails them: the rows, the status line and every prompt say so', async () => {
  await buildVariant('b', 2)
  // Measured on r2, between what is under their ends now: the top of the plate is 1 mm lower than where M1 was put.
  const thickness = gauge('M1')!
  expect(thickness.value).toBeCloseTo(5, 9)
  expect(thickness).toMatchObject({ verdict: 'fail', anchorState: 'drifted', checkedRevision: 2, status: 'sent', expected: 6 })
  expect(thickness.a.point[2]).toBeCloseTo(6, 6)
  expect(thickness.points![0][2]).toBeCloseTo(5, 9)
  const hole = gauge('M2')!
  // The wall of the hole is 1 mm further out than where M2 was put: it is measured on the face under it now.
  expect(hole.value).toBeCloseTo(10, 9)
  expect(hole).toMatchObject({ verdict: 'fail', anchorState: 'drifted', status: 'sent' })

  await expect(row('M1', page).locator('.mark-value')).toHaveText('5 mm')
  await expect(row('M1', page).locator('.mark-value')).toHaveAttribute('data-verdict', 'fail')
  await expect(row('M1', page).locator('.mark-anchor')).toHaveText('moved: check it')
  await expect(row('M2', page).locator('.mark-value')).toHaveText('⌀ 10 mm')
  await row('M2', page).click()
  await expect(row('M2', page).locator('.dimension-verdict')).toHaveText('Fails: 2 over')

  // The status line counts them, in the colour of failure, and goes to the first.
  const failing = statusLine().locator('.status-dimensions[data-state="fail"]')
  await expect(failing).toHaveText('2 dimensions fail')
  const colours = await page.evaluate(() => {
    const probe = document.createElement('span')
    probe.style.color = 'var(--fail)'
    document.body.append(probe)
    const token = getComputedStyle(probe).color
    probe.remove()
    return { drawn: getComputedStyle(document.querySelector('.status-dimensions[data-state="fail"]')!).color, token }
  })
  expect(colours.drawn).toBe(colours.token)
  await expect(row('M2', page)).toHaveAttribute('data-active', '')
  await failing.click()
  await expect(row('M1', page)).toHaveAttribute('data-active', '')
  await expect(row('M1', page)).toBeInViewport()
  await expect(row('M1', page).locator('.dimension-verdict')).toHaveText('Fails: 1 under')
  await expect(row('M1', page).locator('.dimension-how')).toHaveText('wall, along the normal, measured from what is under its ends now')
  await page.evaluate(() => (document.activeElement as HTMLElement).blur())

  // The agent is told of both with the prompt, and with the one after: they are not news that is told once.
  for (const _again of [1, 2]) {
    const context = await prompted()
    expect(context).toMatch(/Dimensions\(measuredonr\d+\):M1thickness5mmwall,alongthenormal,plate\/F\d+at\(-10,5,6\)\(expected6±0\.05:FAIL,1under\)\[movedsinceitwasplaced:checkit\]M2diameter10mm,plate\/F\d+\(expected8±0\.05:FAIL,2over\)\[movedsinceitwasplaced:checkit\]$/)
    expect(context).not.toContain('pinneddimension')
    // Each has its line: neither is named again among the open marks.
    expect(context).not.toContain('Openmarks:')
  }
  expect(gaugeMarks().map((m) => m.status)).toEqual(['sent', 'sent'])

  // The state file says the same.
  // It is written a second after the last change.
  const stateFile = (): string => {
    try {
      return readFileSync(join(root, 'gauge', '.torno', 'state.md'), 'utf8')
    } catch {
      return ''
    }
  }
  await expect.poll(stateFile, { timeout: 10_000 }).toMatch(/- M1 thickness 5 mm wall, along the normal, plate\/F\d+ at \(-10, 5, 6\) \(expected 6 ± 0\.05: FAIL, 1 under\) \[moved since it was placed: check it\]\n- M2 diameter 10 mm, plate\/F\d+ \(expected 8 ± 0\.05: FAIL, 2 over\) \[moved since it was placed: check it\]/)
})

test('built as it should be again, they pass: the status line is clear, and the prompt says only the count', async () => {
  await buildVariant('a', 3)
  expect(gauge('M1')!.value).toBeCloseTo(6, 9)
  expect(gauge('M1')).toMatchObject({ verdict: 'pass', anchorState: 'ok' })
  expect(gauge('M2')!.value).toBeCloseTo(8, 9)
  expect(gauge('M2')).toMatchObject({ verdict: 'pass', anchorState: 'ok' })
  await expect(row('M1', page).locator('.mark-value')).toHaveText('6 mm')
  await expect(row('M1', page).locator('.mark-value')).toHaveAttribute('data-verdict', 'pass')
  await expect(statusLine().locator('.status-dimensions')).toHaveCount(0)
  const context = await prompted()
  expect(context).toMatch(/Dimensions\(measuredonr\d+\):2pinneddimensionspassOpenmarks:M1,M2$/)
  expect(context).not.toContain('FAIL')
})

// Set TORNO_SHOTS=<dir> to write measure-light.png, measure-dark.png (the
// window: an axis distance, a diameter that fails, an angle and a wall that
// passes, with the failing one's numbers open) and measure-look.png (the
// picture the agent is given of the same) there. Each picture of the window
// needs its own launch: on a hidden window capturePage() delivers one image
// and hangs on the next call, and page.screenshot() never returns.
for (const shot of ['light', 'dark', 'look'] as const) {
  test(`screenshot of the dimensions, ${shot}`, async () => {
    const dir = process.env.TORNO_SHOTS
    test.skip(!dir, 'TORNO_SHOTS is not set')
    test.setTimeout(120_000)
    mkdirSync(dir!, { recursive: true })
    const shotRoot = copyFixtures()
    const shotApp = await launch({ TORNO_WORKSPACE: shotRoot })
    try {
      const p = await shotApp.firstWindow()
      await p.emulateMedia({ colorScheme: shot === 'dark' ? 'dark' : 'light' })
      await p.waitForSelector('[data-region="left"]')
      await openMeasures(p)
      await p.keyboard.press('m')
      // Between the axes of the two holes.
      await clickOver(IN_HOLE, p)
      await p.waitForTimeout(500)
      await clickOver(IN_OTHER_HOLE, p)
      await expect.poll(() => dimension(shotRoot, 'M1')?.value).toBeCloseTo(20, 9)
      // The diameter of one, which should have been 8.5.
      await p.waitForTimeout(500)
      await clickOver(IN_OTHER_HOLE, p, 2)
      await expect.poll(() => dimension(shotRoot, 'M2')?.value).toBeCloseTo(8, 9)
      // The chamfer against the top.
      await p.getByRole('group', { name: 'What to measure' }).getByRole('button', { name: 'Angle' }).click()
      await clickOver([14, -6, 3], p)
      await p.waitForTimeout(500)
      await clickOver(ON_CHAMFER, p)
      await expect.poll(() => dimension(shotRoot, 'M3')?.value).toBeCloseTo(45, 9)
      // The plate itself, which is as thick as it should be.
      const [x, y] = await pageXY([-14, -10, 3], p)
      await p.mouse.move(x, y)
      await p.keyboard.press('t')
      await expect.poll(() => dimension(shotRoot, 'M4')?.value).toBeCloseTo(6, 9)
      const expect_ = async (id: string, value: string): Promise<void> => {
        await row(id, p).click()
        const field = row(id, p).locator('.dimension-fields').getByRole('textbox', { name: 'Expected' })
        await field.fill(value)
        await field.press('Enter')
        await expect.poll(() => dimension(shotRoot, id)?.expected).toBe(Number(value))
      }
      await expect_('M4', '6')
      await expect_('M2', '8.5')
      await p.evaluate(() => (document.activeElement as HTMLElement).blur())
      await atRest(p)
      // The pointer beside the part: nothing is read out over the dimensions.
      await p.mouse.move(...(await pageXY([30, 30, 0], p)))
      await p.evaluate(async () => {
        await document.fonts.ready
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
      })
      if (shot === 'look') {
        const png = await p.evaluate(async () => Array.from((await window.__tornoTest!.look({ view: 'current' })).png))
        writeFileSync(join(dir!, 'measure-look.png'), Buffer.from(png))
      } else {
        const png = await shotApp.evaluate(async ({ BrowserWindow }) => {
          const image = await BrowserWindow.getAllWindows()[0].webContents.capturePage()
          return image.toPNG().toString('base64')
        })
        writeFileSync(join(dir!, `measure-${shot}.png`), Buffer.from(png, 'base64'))
      }
    } finally {
      await shotApp.close()
      rmSync(shotRoot, { recursive: true, force: true })
    }
  })
}
