import { cpSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import type { BoardFile } from '../src/shared/board'
import type { Mark, MarksFile } from '../src/shared/marks'
import type { TornoState } from '../src/renderer/state/store'
import { openSection, newSession } from './helpers'
import { openListed } from './objects'

// A round of a review made in the hidden window, on the `gauge` fixture (a 40 × 30 × 6 plate with one Ø8 hole): "Review this
// build" starts R1 on h1, a face is picked as what is not wanted (the `-` key), a sketch is drawn as what is wanted, a view note is
// drawn as a plain mark of the round, and a prompt sent meanwhile carries none of them (they are held). Send review puts the round in the composer, the next prompt carries the review
// line and both items, and the stand-in agent resolves both. After the plate is built again (h2) the round's panel says OK to
// one item and Still wrong to the other, and the board holds no frame or card for them (#248).
// Everything is read from marks.json, board.json, the store, the DOM and what the stand-in is told: no screenshots.
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
  root = mkdtempSync(join(realpathSync(tmpdir()), 'torno-e2e-review-'))
  home = mkdtempSync(join(realpathSync(tmpdir()), 'torno-e2e-review-home-'))
  cpSync(fixtures, root, { recursive: true, filter: (source) => !source.endsWith('__pycache__') })
  // TORNO_TEST=1 makes main create the window with show: false. Never launch without it.
  app = await electron.launch({ args: ['.'], cwd: appDir, env: { ...process.env, HOME: home, TORNO_TEST: '1', TORNO_AGENT_CMD: `node ${fakeAgent}`, TORNO_WORKSPACE: root } })
  page = await app.firstWindow()
  await page.waitForSelector('[data-region="viewport"]')
})

test.afterAll(async () => {
  await app?.close()
  rmSync(root, { recursive: true, force: true })
  rmSync(home, { recursive: true, force: true })
})

const state = (): Promise<TornoState> => page.evaluate(() => window.__tornoTest!.state())
const camera = () => page.evaluate(() => window.__tornoTest!.camera())
const canvas = () => page.locator('.viewport-canvas canvas').first()
const dock = () => page.locator('[data-region="session"]')
const chat = () => dock().locator('.chat')
const composer = () => dock().locator('[data-chat-composer]')
const bar = () => page.getByRole('toolbar', { name: 'Review' })
const sketchPanel = () => page.getByRole('complementary', { name: 'Sketch' })
// The round's panel is the head of the route card.
const roundPanel = () => page.locator('.route-hand [data-part="round-panel"]')
const drawingBoard = () => page.getByRole('dialog', { name: 'Drawing on the view' })

const marksFile = (): MarksFile => JSON.parse(readFileSync(join(root, 'gauge', '.torno', 'marks.json'), 'utf8')) as MarksFile
const marks = (): Mark[] => {
  try {
    return marksFile().marks
  } catch {
    return []
  }
}
const mark = (id: string): Mark | undefined => marks().find((m) => m.id === id)
const boardFile = (): BoardFile | undefined => {
  try {
    return JSON.parse(readFileSync(join(root, 'gauge', '.torno', 'board', 'board.json'), 'utf8')) as BoardFile
  } catch {
    return undefined
  }
}

/** Where a point of the object frame is drawn, in the page's pixels. */
async function pageXY(point: Vec3): Promise<[number, number]> {
  const [fx, fy] = await page.evaluate((at) => window.__tornoTest!.project(at), point)
  const box = (await canvas().boundingBox())!
  return [box.x + fx * box.width, box.y + fy * box.height]
}

/** Press where the first point is drawn and draw through the others, one move each, then let go. */
async function drag(points: Vec3[]): Promise<void> {
  const at: [number, number][] = []
  for (const point of points) at.push(await pageXY(point))
  await page.mouse.move(...at[0])
  await page.mouse.down()
  for (const [x, y] of at.slice(1)) await page.mouse.move(x, y)
  await page.mouse.up()
}

/** Waits until the camera has stopped: a view asked for by key is gone to over a quarter of a second. */
async function atRest(): Promise<void> {
  let last = ''
  await expect
    .poll(
      async () => {
        const now = JSON.stringify(await camera())
        const still = now === last
        last = now
        return still
      },
      { intervals: [120] }
    )
    .toBe(true)
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

/** The text torno added to the n-th prompt of the chat, as the agent was given it (the stand-in's script never sees it). */
async function added(n: number): Promise<string> {
  const item = chat().locator('.chat-added').nth(n)
  await expect(item.locator('.chat-added-label')).toHaveText('with', { timeout: 30_000 })
  await item.getByRole('button', { name: 'Show text' }).click()
  return (await item.locator('.chat-added-text').textContent()) ?? ''
}

test('Review this build starts R1 on the build on show, and the keys choose what the next marks are', async () => {
  await openListed(page, 'gauge')
  await openSection(page, 'Marks')
  await expect.poll(async () => (await state()).build, { timeout: 60_000 }).toMatchObject({ status: 'ok' })
  await page.keyboard.press('1')
  await atRest()
  await expect(bar()).toHaveCount(0)
  await page.getByRole('button', { name: 'Review this build' }).click()
  await expect(bar()).toBeVisible()
  await expect(bar()).toContainText('Reviewing h1')
  await expect(page.locator('[data-band="review"]')).toHaveCount(1)
  await expect(page.locator('.pboard-switch')).toHaveCount(0)
  await expect(bar()).toContainText('0 − · 0 +')
  await expect.poll(() => marksFile().rounds?.map((r) => [r.id, r.build])).toEqual([['R1', 'h1']])
  // The key of the choice takes it, and the same key again goes back to plain.
  const choice = (name: string) => bar().getByRole('radio', { name: new RegExp(name) })
  await expect(choice('Plain')).toHaveAttribute('aria-checked', 'true')
  await page.keyboard.press('-')
  await expect(choice("Don't want")).toHaveAttribute('aria-checked', 'true')
  await page.keyboard.press('-')
  await expect(choice('Plain')).toHaveAttribute('aria-checked', 'true')
  await page.keyboard.press('-')
  await expect(choice("Don't want")).toHaveAttribute('aria-checked', 'true')
})

test('a face picked while "don\'t want" is chosen is a mark of the round, with its sign', async () => {
  // The top of the plate, clear of the hole.
  const top: Vec3 = [16, -10, 6]
  const hit = await page.evaluate((at) => {
    const [fx, fy] = window.__tornoTest!.project(at)
    return window.__tornoTest!.pickAt(fx, fy, { edges: false })
  }, top)
  expect(hit?.kind).toBe('face')
  const [x, y] = await pageXY(top)
  await page.mouse.click(x, y)
  await page.getByRole('group', { name: 'Selection' }).getByRole('button', { name: 'Note' }).click()
  const note = page.getByRole('textbox', { name: 'Note on M1' })
  await note.fill('nothing holds here')
  await note.press('Enter')
  await expect.poll(() => mark('M1')).toMatchObject({ kind: 'pick', author: 'user', status: 'draft', intent: 'dont', round: 'R1' })
  await expect(bar()).toContainText('1 − · 0 +')
  // Its row says what it is, and that it waits.
  const row = page.locator('.mark-row[data-mark="M1"]')
  await expect(row).toContainText('− M1')
  // The sign is a round disc before the square chip: the minus hatched in the person's colour.
  await expect(row.locator('.mark-line > .sign-disc[data-sign="-"]')).toHaveText('−')
  await expect(row.locator('.sign-disc + .mark-chip')).toHaveText('M1')
  await expect(row.locator('.mark-chip')).not.toContainText('−')
  expect(await row.locator('.mark-line > .sign-disc').evaluate((el) => [getComputedStyle(el).borderRadius, getComputedStyle(el).width, getComputedStyle(el).backgroundImage.includes('repeating-linear-gradient')])).toEqual(['50%', '18px', true])
  // While the round is open the item is told in the view too: a tag at its point with the disc and the note, and no leader (a mark has none).
  const told = page.locator('.viewport-pane [data-tag="round-note-M1"]')
  await expect(told).toBeVisible()
  await expect(told).toContainText('nothing holds here')
  await expect(told.locator('.sign-disc[data-sign="-"]')).toHaveText('−')
  await expect(page.locator('svg.leader-layer [data-leader="round-note-M1"]')).toHaveCount(0)
  // The pens of the band carry the same discs.
  await expect(bar().locator('.sign-disc')).toHaveCount(2)
  await expect(row).toContainText('in review, not sent')
})

test('a sketch drawn while "want" is chosen is the round\'s second item', async () => {
  await bar().getByRole('radio', { name: /Want/ }).click()
  await expect(bar().getByRole('radio', { name: /Want/ })).toHaveAttribute('aria-checked', 'true')
  await page.keyboard.press('d')
  await expect(sketchPanel()).toBeVisible()
  await page.keyboard.press('Shift+2')
  await expect(sketchPanel()).toContainText('XZ at y = 0')
  await drag([[10, 0, 6], [-10, 0, 14], [-14, 0, 14]])
  await expect.poll(() => mark('M2')).toMatchObject({ kind: 'sketch', author: 'user', intent: 'want', round: 'R1' })
  await sketchPanel().getByRole('button', { name: 'Done' }).click()
  await expect(sketchPanel()).toHaveCount(0)
  await expect(bar()).toContainText('1 − · 1 +')
  await expect(page.locator('.mark-row[data-mark="M2"]')).toContainText('+ M2')
  await expect(page.locator('.mark-row[data-mark="M2"] .mark-line > .sign-disc[data-sign="+"]')).toHaveText('+')
})

test('a view note drawn in the round is its plain third item, and no prompt carries it', async () => {
  await newSession(dock())
  await expect(chat()).toBeVisible()
  await expect(composer()).toBeEnabled()
  await bar().getByRole('radio', { name: /Plain/ }).click()
  // A point of the canvas over a part: the same fraction of the picture is over it too.
  const spot = await page.evaluate(() => {
    for (const fy of [0.5, 0.45, 0.55, 0.4, 0.6]) {
      for (const fx of [0.5, 0.45, 0.55, 0.4, 0.6]) {
        if (window.__tornoTest!.pickAt(fx, fy, { edges: false })) return { fx, fy }
      }
    }
    return null
  })
  expect(spot).not.toBeNull()
  await dock().getByRole('button', { name: 'Draw on view' }).click()
  await expect(drawingBoard()).toBeVisible()
  const box = (await drawingBoard().locator('canvas').boundingBox())!
  await page.mouse.move(box.x + box.width * (spot!.fx - 0.01), box.y + box.height * spot!.fy)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width * (spot!.fx + 0.01), box.y + box.height * spot!.fy, { steps: 10 })
  await page.mouse.up()
  await drawingBoard().getByRole('button', { name: 'Done' }).click()
  await expect(drawingBoard()).toHaveCount(0)
  await expect.poll(() => mark('M3')).toMatchObject({ kind: 'note', author: 'user', status: 'draft', round: 'R1' })
  expect((mark('M3') as { intent?: unknown } | undefined)?.intent).toBeUndefined()
  // It is held with the round: it is no "goes with your next prompt" waiting above the box.
  await expect(page.locator('.mark-row[data-mark="M3"]')).toContainText('in review, not sent')
  await expect(dock().locator('.chat-note-wait')).toHaveCount(0)
})

test('a prompt sent now carries none of the items: the round is held until Send review', async () => {
  await send(['say received'])
  const text = await added(0)
  expect(text).toContain('R1 is in review, not sent (3 marks).')
  // The board's line has no frame of a round to name, and no review line and no item is in it.
  expect(text).not.toContain('Review of h1 (R1)')
  expect(text).not.toContain("don't want")
  expect(text).not.toMatch(/\bM[12] ·/)
  expect(text).not.toContain('Sketch M2')
  expect(text).not.toMatch(/\bM3 ·/)
  await expect(chat().locator('.chat-added').first().locator('[data-part="held"]')).toContainText('in review, not sent')
  // Neither was sent: both are drafts still, in their round.
  expect([mark('M1')?.status, mark('M2')?.status, mark('M3')?.status]).toEqual(['draft', 'draft', 'draft'])
  await expect(chat().locator('.chat-user').first()).toContainText('say received')
})

test('Send review puts the round in the composer; the next prompt carries its line and both items, and the agent resolves both', async () => {
  await bar().getByRole('button', { name: 'Send review' }).click()
  await expect(bar()).toHaveCount(0)
  const chip = dock().getByRole('group', { name: 'Review attached' })
  await expect(chip).toBeVisible()
  await expect(chip).toContainText('Review of h1 · 1 − · 1 +')
  // The stand-in's script: it says it, and resolves both items as the agent would.
  await send(['say answering the review', 'tool mcp__torno__resolve_mark {"id":"M1","note":"the clamp is gone"}', 'tool mcp__torno__resolve_mark {"id":"M2","note":"a handle along the top"}'])
  const text = await added(1)
  expect(text).toContain('Review of h1 (R1): 1 don\'t want, 1 want, 1 plain. Answer each item by its id.')
  expect(text).toContain("don't want")
  expect(text).toMatch(/M1 · don't want/)
  expect(text).toMatch(/M2 · want/)
  expect(text).toMatch(/\bM3 ·/)
  await expect(chat().locator('.chat-added').nth(1).locator('[data-part="review"]')).toContainText('R1')
  await expect(chip).toHaveCount(0)
  // Claude answered both, and the round is sent.
  await expect.poll(() => [mark('M1')?.status, mark('M2')?.status], { timeout: 30_000 }).toEqual(['resolved', 'resolved'])
  expect(mark('M1')).toMatchObject({ resolvedBy: 'agent', resolvedNote: 'the clamp is gone' })
  expect(mark('M2')).toMatchObject({ resolvedBy: 'agent', resolvedNote: 'a handle along the top' })
  await expect.poll(() => marksFile().rounds?.[0]?.sentAt).toBeTruthy()
})

test('after a rebuild the panel of R1 says OK to one item and Still wrong to the other', async () => {
  // The model saved again (the history goes by the Python files, so a line of comment makes another build, h2), which the panel shows against h1.
  const model = join(root, 'gauge', 'gauge.py')
  writeFileSync(model, `${readFileSync(model, 'utf8')}\n# a second look\n`)
  await expect.poll(async () => (await state()).build, { timeout: 60_000 }).toMatchObject({ status: 'ok', revision: 2, stale: false })
  await page.getByRole('button', { name: 'Open the panel of R1' }).click()
  await expect(roundPanel()).toBeVisible()
  await expect(page.locator('.route-hand .hand')).toHaveAttribute('data-kind', 'review')
  await expect(roundPanel()).toContainText('Review of h1 · 1 − · 1 +')
  await expect(roundPanel()).toContainText('h1 is shown faint beside h2', { timeout: 30_000 })
  const m1 = roundPanel().locator('[data-mark="M1"]')
  const m2 = roundPanel().locator('[data-mark="M2"]')
  await expect(m1).toContainText('the clamp is gone')
  await expect(m2).toContainText('a handle along the top')
  await m1.getByRole('button', { name: 'OK', exact: true }).click()
  await expect.poll(() => mark('M1')?.judged).toEqual({ verdict: 'ok', build: 'h2' })
  await expect(m1).toContainText('OK in h2')
  await m2.getByRole('button', { name: 'Still wrong' }).click()
  await m2.getByRole('textbox').fill('the handle is on the wrong side')
  await m2.getByRole('button', { name: 'Send back' }).click()
  await expect.poll(() => mark('M2')?.judged).toEqual({ verdict: 'still-wrong', build: 'h2' })
  // It is open again, in the next round, which main made on the build on show.
  expect(mark('M2')).toMatchObject({ status: 'draft', round: 'R2' })
  expect(mark('M1')).toMatchObject({ round: 'R1' })
  expect(marksFile().rounds?.map((r) => [r.id, r.build, r.from ?? null])).toEqual([
    ['R1', 'h1', null],
    ['R2', 'h2', 'R1']
  ])
  await roundPanel().getByRole('button', { name: 'Close the review' }).click()
  await expect(roundPanel()).toHaveCount(0)
})

test('the brief holds no frame for a round and no card for its marks', async () => {
  await page.keyboard.press('Control+Tab')
  await expect(page.locator('.brief-page')).toBeVisible({ timeout: 20_000 })
  await expect(page.locator('.brief-page [data-card]')).toHaveCount(0)
  const board = boardFile()
  expect(board?.cards.filter((c) => c.kind === 'frame' || c.kind === 'mark') ?? []).toEqual([])
  await page.keyboard.press('Control+Tab')
})
