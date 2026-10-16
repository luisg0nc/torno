import { cpSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import type { TornoState } from '../src/renderer/state/store'
import type { Anchor, Mark, MarksFile, PinMark } from '../src/shared/marks'

// Marks across rebuilds (review focus 1): a mark stays at its point; after every
// build its ref is that of the face now there, and it says so when the surface
// moved away or its part is gone.
//
// The model is the fixture `morph`, which builds what `variant.txt` beside it
// says: `a`, a plate 5 mm thick with a post on it; `b`, the plate 8 mm thick,
// its top 3 mm higher and chamfered, and no post. The marks are added through
// window.torno.marks at what window.__tornoTest.pickAt finds under a point of
// the canvas, so that nothing here depends on the tools that place them.
const appDir = resolve(__dirname, '..')
const fixtures = resolve(appDir, '../kernel/tests/fixtures/ws')
const fakeAgent = resolve(appDir, 'test/fake-agent.mjs')

test.describe.configure({ mode: 'serial' })

let root: string
let app: ElectronApplication
let page: Page

test.beforeAll(async () => {
  root = mkdtempSync(join(realpathSync(tmpdir()), 'torno-e2e-reanchor-'))
  cpSync(fixtures, root, { recursive: true, filter: (source) => !source.endsWith('__pycache__') })
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
const ON_TOP: Vec3 = [14, 9, 2.5] // on the top of the plate of variant a, clear of the post
const ON_POST: Vec3 = [0, 0, 22.5] // the middle of the top of the post

const state = (): Promise<TornoState> => page.evaluate(() => window.__tornoTest!.state())
const marks = (): Promise<PinMark[]> => page.evaluate(() => window.torno.marks.list('morph')) as Promise<PinMark[]>
const marksOnDisk = (): MarksFile => JSON.parse(readFileSync(join(root, 'morph', '.torno', 'marks.json'), 'utf8'))
const row = (id: string) => page.locator(`.mark-row[data-mark="${id}"]`)
const describe = (ref: string) => page.evaluate((r) => window.torno.geometry.describe('morph', 'main', r), ref)

/** Build the other variant, and wait for the marks to have been checked against it. */
async function switchTo(variant: 'a' | 'b', revision: number, states: Array<Mark['anchorState']>): Promise<void> {
  writeFileSync(join(root, 'morph', 'variant.txt'), `${variant}\n`)
  await expect.poll(async () => (await state()).build, { timeout: 30_000 }).toMatchObject({ status: 'ok', revision, stale: false })
  await expect.poll(async () => (await marks()).map((m) => m.anchorState), { timeout: 15_000 }).toEqual(states)
}

/** A pin of the person's where the part is drawn at `point`: what is under it there is its anchor. */
async function pinAt(point: Vec3, note: string): Promise<PinMark> {
  const added = await page.evaluate(
    ([at, text]) => {
      const hooks = window.__tornoTest!
      const [fx, fy] = hooks.project(at)
      const hit = hooks.pickAt(fx, fy)
      if (!hit) throw new Error(`nothing is drawn at ${at.join(', ')}`)
      const anchor = { point: hit.point, part: hit.part, ref: hit.ref, ...(hit.normal ? { normal: hit.normal } : {}) }
      const { layout, revision } = hooks.state()
      return window.torno.marks.add('morph', { kind: 'pin', author: 'user', note: text, layout, revision, camera: hooks.camera(), anchor })
    },
    [point, note] as const
  )
  return added as PinMark
}

/** The colour an element is drawn in, and the colour a token of the design stands for, both as the browser computes them. */
function colours(selector: string, token: string): Promise<{ drawn: string; token: string }> {
  return page.evaluate(
    ([sel, name]) => {
      const probe = document.createElement('span')
      probe.style.color = `var(${name})`
      document.body.append(probe)
      const colour = getComputedStyle(probe).color
      probe.remove()
      return { drawn: getComputedStyle(document.querySelector(sel)!).color, token: colour }
    },
    [selector, token] as const
  )
}

/** A pick of the person's of an edge of the plate, at the middle of that edge. */
async function pickEdge(ref: string, note: string): Promise<Mark> {
  const edge = await describe(ref)
  if (edge.kind !== 'edge') throw new Error(`${ref} is not an edge`)
  return page.evaluate(
    ([anchor, text]) => {
      const hooks = window.__tornoTest!
      const { layout, revision } = hooks.state()
      return window.torno.marks.add('morph', { kind: 'pick', target: 'edge', author: 'user', note: text, layout, revision, camera: hooks.camera(), anchor })
    },
    [{ point: edge.center, part: 'plate', ref }, note] as const
  )
}

let placed: { top: Anchor; post: Anchor }
/** What the kernel calls the two edges picked, in variant a. */
let edges: { e1: string; e2: string }

test('pins on the top of the plate and on the post are on those faces', async () => {
  await page.getByRole('button', { name: 'morph', exact: true }).click()
  await expect.poll(async () => (await state()).build, { timeout: 30_000 }).toMatchObject({ status: 'ok', revision: 1 })
  expect((await state()).layout).toBe('main')

  const top = await pinAt(ON_TOP, 'too thin here')
  const post = await pinAt(ON_POST, 'shorten the post')
  expect([top.id, post.id]).toEqual(['M1', 'M2'])
  expect(top.anchor.part).toBe('plate')
  expect(top.anchor.ref).toMatch(/^plate\/F\d+$/)
  expect(top.anchor.point[2]).toBeCloseTo(2.5, 3)
  expect(post.anchor.part).toBe('post')
  expect(post.anchor.ref).toMatch(/^post\/F\d+$/)
  expect(post.anchor.point[2]).toBeCloseTo(22.5, 3)

  // Picks of two edges of the plate, at their middles. In variant b the edges with these numbers
  // are others, 2 and 2.5 mm from these points, which stay on the plate's surface.
  await pickEdge('plate/E1', 'round this edge')
  await pickEdge('plate/E2', 'and this one')
  edges = { e1: (await describe('plate/E1')).descriptor, e2: (await describe('plate/E2')).descriptor }

  // A mark just added is checked against the build there is: it is told what it is on.
  await expect.poll(async () => (await marks()).map((m) => m.anchor.descriptor)).toEqual(['plane, normal +Z, z = 2.5, 1200 mm²', 'plane, normal +Z, z = 22.5, 50.27 mm²', edges.e1, edges.e2])
  const now = await marks()
  expect(now.map((m) => m.anchorState)).toEqual(['ok', 'ok', 'ok', 'ok'])
  expect(now.map((m) => m.anchor.ref)).toEqual([top.anchor.ref, post.anchor.ref, 'plate/E1', 'plate/E2'])
  expect(now.map((m) => m.anchor.point)).toEqual([top.anchor.point, post.anchor.point, now[2].anchor.point, now[3].anchor.point])
  placed = { top: now[0].anchor, post: now[1].anchor }
  await expect(page.locator('.mark-row .mark-chip')).toHaveText(['M1', 'M2', 'M3', 'M4'])
  await expect(page.locator('.mark-anchor')).toHaveCount(0)
})

test('rebuilt thicker and without its post: the first pin has drifted onto the face now there, the second is orphaned, and both rows say so', async () => {
  await switchTo('b', 2, ['drifted', 'orphaned', 'drifted', 'drifted'])
  const [top, post, first, second] = await marks()

  // The pin is where the person put it, 3 mm under the top the plate now has.
  expect(top.anchor.point).toEqual(placed.top.point)
  expect(top.anchor.part).toBe('plate')
  expect(top.anchor.ref).toMatch(/^plate\/F\d+$/)
  expect(top.anchor.normal![2]).toBeCloseTo(1, 6)
  expect(top.anchor.descriptor).toBe('plane, normal +Z, z = 5.5, 1064 mm²')
  // The ref is of this build: asked what that face is, the kernel says the same.
  expect(top.anchor.ref).not.toBe(placed.top.ref)
  expect(await describe(top.anchor.ref!)).toMatchObject({ kind: 'face', type: 'plane', descriptor: top.anchor.descriptor })
  // The face it used to name is not the top of anything any more.
  expect(await describe(placed.top.ref!)).not.toMatchObject({ descriptor: top.anchor.descriptor })

  // The post is gone: its pin is kept as it was, so that it is found again if the post comes back.
  expect(post.anchor).toEqual(placed.post)
  expect((await state()).scene?.parts.map((p) => p.name)).toEqual(['plate'])

  await expect(row('M1').locator('.mark-chip')).toHaveText('M1')
  await expect(row('M1').locator('.mark-anchor')).toHaveText('moved: check it')
  await expect(row('M2').locator('.mark-chip')).toHaveText('M2')
  await expect(row('M2').locator('.mark-anchor')).toHaveText('its part is gone')
  // Seen on a visible screen: what the build did to a mark took the note's room, cut the status word and had the
  // column scroll sideways. It has a line of its own under the note, also beside a note longer than the column.
  await row('M1').locator('.mark-note').click({ position: { x: 4, y: 8 } })
  await page.keyboard.type('the wall is too thin here and wants two more millimetres at least')
  await page.keyboard.press('Enter')
  await expect(row('M1').locator('.mark-note')).toContainText('the wall is too thin')
  for (const id of ['M1', 'M2']) {
    const boxes = await row(id).evaluate((el) => {
      const box = (selector: string) => el.querySelector(selector)!.getBoundingClientRect()
      const status = el.querySelector<HTMLElement>('.mark-status')!
      return { row: el.getBoundingClientRect(), note: box('.mark-note'), anchor: box('.mark-anchor'), status: status.getBoundingClientRect(), cut: status.scrollWidth > status.clientWidth, word: status.textContent }
    })
    expect([id, boxes.anchor.top >= boxes.note.bottom - 6]).toEqual([id, true])
    expect([id, boxes.anchor.right <= boxes.row.right + 0.5, boxes.status.right <= boxes.row.right + 0.5]).toEqual([id, true, true])
    expect([id, boxes.word, boxes.cut]).toEqual([id, 'draft', false])
    expect([id, boxes.note.width > 60]).toEqual([id, true])
  }
  for (const selector of ['.marks-body', '[data-region="left"]']) {
    const [scroll, client] = await page.locator(selector).evaluate((el) => [el.scrollWidth, el.clientWidth])
    expect([selector, scroll <= client]).toEqual([selector, true])
  }
  // The active row shows its note whole, wrapped, and the list still does not scroll sideways.
  await expect(row('M1')).toHaveAttribute('aria-current', 'true')
  const whole = row('M1').locator('.mark-note')
  await expect(whole).toHaveText('the wall is too thin here and wants two more millimetres at least')
  expect(await whole.evaluate((el) => el.scrollWidth <= el.clientWidth && el.scrollHeight <= el.clientHeight + 1)).toBe(true)
  expect(await whole.getAttribute('title')).toBeNull()
  expect(await page.locator('.marks-body').evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true)
  await row('M1').locator('.mark-note').click({ position: { x: 4, y: 8 } })
  await page.keyboard.type('too thin here')
  await page.keyboard.press('Enter')
  await expect(row('M1').locator('.mark-note')).toHaveText('too thin here')
  const moved = await colours('.mark-row[data-mark="M1"] .mark-anchor', '--warn')
  expect(moved.drawn).toBe(moved.token)
  const gone = await colours('.mark-row[data-mark="M2"] .mark-anchor', '--fail')
  expect(gone.drawn).toBe(gone.token)
  expect(moved.token).not.toBe(gone.token)
  // Either can still be resolved from its row, and keeps its note.
  for (const id of ['M1', 'M2']) await expect(row(id).getByRole('button', { name: `Resolve ${id}` })).toHaveCount(1)
  await expect(page.locator('.mark-row .mark-note')).toHaveText(['too thin here', 'shorten the post', 'round this edge', 'and this one'])

  // The edges picked: the plate still has an E1 and an E2, each near the point of its mark and
  // one of them "line, 30 mm" like the edge that was picked. They are other edges, and the marks say so.
  expect(await describe('plate/E1')).toMatchObject({ kind: 'edge' })
  expect(await describe('plate/E2')).toMatchObject({ kind: 'edge' })
  for (const [mark, ref] of [[first, 'plate/E1'], [second, 'plate/E2']] as const) {
    expect(mark.anchorState).toBe('drifted')
    // The ref is kept, so that the mark is found on its edge again if the model goes back; what
    // it is described as is the face under its point, never the edge that took the number.
    expect(mark.anchor.ref).toBe(ref)
    expect(mark.anchor.descriptor).toMatch(/^plane, /)
    await expect(row(mark.id).locator('.mark-anchor')).toHaveText('moved: check it')
  }

  expect(marksOnDisk().marks).toEqual([top, post, first, second])
})

test('rebuilt as it was: both pins are ok again, on the faces they were put on', async () => {
  await switchTo('a', 3, ['ok', 'ok', 'ok', 'ok'])
  const [top, post, first, second] = await marks()
  expect(top.anchor).toMatchObject({ point: placed.top.point, part: 'plate', ref: placed.top.ref, descriptor: 'plane, normal +Z, z = 2.5, 1200 mm²' })
  expect(post.anchor).toMatchObject({ point: placed.post.point, part: 'post', ref: placed.post.ref, descriptor: 'plane, normal +Z, z = 22.5, 50.27 mm²' })
  expect(first.anchor).toMatchObject({ ref: 'plate/E1', descriptor: edges.e1 })
  expect(second.anchor).toMatchObject({ ref: 'plate/E2', descriptor: edges.e2 })
  await expect(page.locator('.mark-row .mark-chip')).toHaveText(['M1', 'M2', 'M3', 'M4'])
  await expect(page.locator('.mark-anchor')).toHaveCount(0)
  expect(marksOnDisk().marks).toEqual([top, post, first, second])
})

test('a resolved mark is left alone by the builds that follow', async () => {
  await row('M2').hover()
  await row('M2').getByRole('button', { name: 'Resolve M2' }).click()
  // Resolved marks are folded away in the panel.
  await expect.poll(async () => (await marks())[1].status).toBe('resolved')
  await expect(row('M2')).toHaveCount(0)
  const before = (await marks())[1]
  await switchTo('b', 4, ['drifted', 'ok', 'drifted', 'drifted'])
  expect((await marks())[1]).toEqual(before)
  await expect(page.locator('.mark-anchor')).toHaveText(['moved: check it', 'moved: check it', 'moved: check it'])
})

test('reopened, it is checked against the build there is: its part is gone, and it says so without another build', async () => {
  await page.evaluate(() => window.torno.marks.update('morph', 'M2', { status: 'draft' }))
  await expect.poll(async () => (await marks()).map((m) => [m.status, m.anchorState])).toEqual([
    ['draft', 'drifted'],
    ['draft', 'orphaned'],
    ['draft', 'drifted'],
    ['draft', 'drifted']
  ])
  expect((await state()).build).toMatchObject({ status: 'ok', revision: 4 })
  await expect(row('M2').locator('.mark-chip')).toHaveText('M2')
  await expect(row('M2').locator('.mark-anchor')).toHaveText('its part is gone')
})

const tool = (name: string) => page.getByRole('toolbar', { name: 'Tools' }).getByRole('button', { name, exact: true })

/** Click where a point of the object frame is drawn. */
async function clickOver(point: Vec3): Promise<void> {
  const [fx, fy] = await page.evaluate((at) => window.__tornoTest!.project(at), point)
  const box = (await page.locator('.viewport-canvas canvas').first().boundingBox())!
  await page.mouse.move(box.x + fx * box.width, box.y + fy * box.height)
  await page.mouse.down()
  await page.mouse.up()
}

test('Re-place puts a drifted pin back on the part with one click: the same mark and note, ok again, and the tool that was in hand comes back', async () => {
  const before = await marks()
  expect(before[0]).toMatchObject({ id: 'M1', anchorState: 'drifted', note: 'too thin here' })
  await page.keyboard.press('a') // the arrow tool is in hand
  await expect(tool('Arrow')).toHaveAttribute('aria-pressed', 'true')
  await row('M1').hover()
  const replace = row('M1').getByRole('button', { name: 'Re-place M1' })
  await replace.click()
  await expect(replace).toHaveAttribute('aria-pressed', 'true')
  await expect(tool('Pin')).toHaveAttribute('aria-pressed', 'true')
  expect((await state()).activeMark).toBe('M1')

  // On the top the plate now has, 3 mm above where the pin was left.
  const onTop: Vec3 = [-12, -8, 5.5]
  await clickOver(onTop)
  await expect.poll(async () => (await marks())[0].anchorState).toBe('ok')
  const [moved, ...rest] = await marks()
  expect(moved).toMatchObject({ id: 'M1', kind: 'pin', note: 'too thin here', status: 'draft', anchorState: 'ok', revision: 4, createdAt: before[0].createdAt })
  expect(moved.anchor).toMatchObject({ part: 'plate', descriptor: 'plane, normal +Z, z = 5.5, 1064 mm²' })
  for (const [i, c] of onTop.entries()) expect(moved.anchor.point[i]).toBeCloseTo(c, 1)
  expect(await describe(moved.anchor.ref!)).toMatchObject({ kind: 'face', descriptor: moved.anchor.descriptor })
  // No new mark, no note opened, the others untouched.
  expect(rest).toEqual(before.slice(1))
  expect(marksOnDisk().next).toBe(5)
  await expect(page.locator('.note-card')).toHaveCount(0)
  await expect(row('M1').locator('.mark-anchor')).toHaveCount(0)
  await expect(row('M1').getByRole('button', { name: 'Re-place M1' })).toHaveCount(0)
  await expect(tool('Arrow')).toHaveAttribute('aria-pressed', 'true')
  expect(marksOnDisk().marks[0]).toEqual(moved)
})

test('Escape leaves a mark where it is; an orphaned pin is put on a part that is there', async () => {
  await row('M2').hover()
  await row('M2').getByRole('button', { name: 'Re-place M2' }).click()
  await expect(tool('Pin')).toHaveAttribute('aria-pressed', 'true')
  // Beside the part: nothing to put it on, and the tool stays in hand for it.
  const box = (await page.locator('.viewport-canvas canvas').first().boundingBox())!
  await page.mouse.move(box.x + box.width - 12, box.y + box.height - 60)
  await expect(page.locator('.pick-readout')).toHaveText('Click the part where M2 should be. Esc leaves it where it is')
  await page.mouse.down()
  await page.mouse.up()
  await expect(tool('Pin')).toHaveAttribute('aria-pressed', 'true')
  await page.keyboard.press('Escape')
  await expect(tool('Arrow')).toHaveAttribute('aria-pressed', 'true')
  expect((await marks())[1]).toMatchObject({ id: 'M2', anchorState: 'orphaned', anchor: placed.post })

  await row('M2').hover()
  await row('M2').getByRole('button', { name: 'Re-place M2' }).click()
  await clickOver([10, 6, 5.5])
  await expect.poll(async () => (await marks())[1].anchorState).toBe('ok')
  expect((await marks())[1]).toMatchObject({ id: 'M2', note: 'shorten the post', anchor: { part: 'plate' } })
  await expect(row('M2').locator('.mark-chip')).toHaveText('M2')
  await page.keyboard.press('v')
})

test('a mark whose layout the build no longer has says so, and going to it does nothing', async () => {
  // As a mark left in a layout that a later model dropped.
  const lost = await page.evaluate(() => {
    const hooks = window.__tornoTest!
    return window.torno.marks.add('morph', { kind: 'pin', author: 'user', note: 'on the bed', layout: 'print', revision: 1, camera: hooks.camera(), anchor: { point: [0, 0, 0], part: 'plate', ref: 'plate/F0' } })
  })
  await expect.poll(async () => (await marks()).find((m) => m.id === lost.id)?.anchorState).toBe('orphaned')
  await expect(row(lost.id).locator('.mark-anchor')).toHaveText('its layout is gone')
  await expect(row(lost.id).getByRole('button', { name: `Re-place ${lost.id}` })).toHaveCount(0)
  const before = { camera: await page.evaluate(() => window.__tornoTest!.camera()), active: (await state()).activeMark }
  await row(lost.id).locator('.mark-chip').click()
  await page.waitForTimeout(400)
  expect((await state()).activeMark).toBe(before.active)
  expect((await state()).layout).toBe('main')
  expect(await page.evaluate(() => window.__tornoTest!.camera())).toEqual(before.camera)
  await row(lost.id).hover()
  await expect(row(lost.id).getByRole('button', { name: `Go to ${lost.id}` })).toBeDisabled()
})

test("a mark of the agent's that lost its part is not offered Re-place, and main refuses to put it somewhere else", async () => {
  // As the agent's tools leave one: through main's store, as the agent. The post is gone in this build.
  const theirs = await app.evaluate(async (_electron, camera) => {
    const { marks } = (globalThis as unknown as { __tornoMain: { marks: import('../src/main/marks/store').MarkStore } }).__tornoMain
    return marks.add('morph', { kind: 'pin', author: 'agent', note: 'shorter?', layout: 'main', revision: 1, camera, anchor: { point: [0, 0, 22.5], part: 'post' } }, 'sent')
  }, await page.evaluate(() => window.__tornoTest!.camera()))
  await expect.poll(async () => (await marks()).find((m) => m.id === theirs.id)?.anchorState).toBe('orphaned')
  await expect(row(theirs.id)).toHaveAttribute('data-author', 'agent')
  await expect(row(theirs.id).locator('.mark-anchor')).toHaveText('its part is gone')
  await row(theirs.id).hover()
  await expect(row(theirs.id).getByRole('button', { name: `Go to ${theirs.id}` })).toBeVisible()
  await expect(row(theirs.id).getByRole('button', { name: `Re-place ${theirs.id}` })).toHaveCount(0)
  const refused = await page.evaluate(
    ([id, camera]) => window.torno.marks.replace('morph', id, { anchor: { point: [10, 6, 5.5], part: 'plate' }, revision: 4, camera }).then(() => 'moved', (e: Error) => e.message),
    [theirs.id, await page.evaluate(() => window.__tornoTest!.camera())] as const
  )
  expect(refused).toBe(`${theirs.id} is the agent's mark: it is not put somewhere else`)
})
