import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import type { TornoState } from '../src/renderer/state/store'
import { openListed } from './objects'
import { configured, readmeWorkspace } from './readme-workspace'
import { newSession } from './helpers'

// The frames of the README's recording of the loop (docs/images/demo.gif and demo.mp4): a person pins the tub wall
// of an airbox that sits in a scan of the engine bay it is for, "too thin here", asks for 3 mm, the agent looks,
// edits the model, the parts rebuild and the dimension "tub wall" turns from failing to passing. Never part of the
// suite: skipped unless TORNO_DEMO names the folder the frames are written to (`<TORNO_DEMO>/frame-NN.png`) and
// readme-workspace.ts has the author's workspace to copy the project from (the `intake` of readme.spec.ts, whose
// tub wall is `wall: float = 2.8` in airbox.py). Remade with docs/images/demo-frames/make.sh.
//
// The window is hidden (TORNO_TEST=1) and the agent is the stand-in (app/test/fake-agent.mjs): no real CLI is run.
// webContents.capturePage() gives one image a launch, so each frame is a launch of its own, driven from the start to
// its moment. The prompt the stand-in is sent is its script; the one cosmetic edit of a frame is that, once the turn
// is drawn, the text of the person's prompt bubble is set to the words a person would have typed (`naturalPrompt`).
// Everything else on screen is what torno drew.
const appDir = resolve(__dirname, '..')
const fakeAgent = resolve(appDir, 'test/fake-agent.mjs')
const W = 1600
const H = 1000

type Vec3 = [number, number, number]
const CAMERA = { position: [620, -420, 380], target: [0, 40, 90], up: [0, 0, 1], ortho: false, fov: 35, zoom: 1 }
/** Where the person pins the wall: the front face of the tub (at -Y), which the scan leaves in view, below the lid's seam. */
const PIN_AT: Vec3 = [0, -60, 95]
/** Where the dimension of the wall is taken, on the same face. */
const WALL_AT: Vec3 = [-30, -60, 60]
const PROMPT = 'The tub wall at M2 is too thin. Make it 3 mm.'

/** The workspace, with the person's dimension "tub wall" on the airbox, 3 mm expected (the model has 2.8). */
function workspace(): { root: string; home: string } {
  const { root, home } = readmeWorkspace()
  const base = { author: 'user', status: 'sent', anchorState: 'ok', layout: 'assembly', revision: 1, camera: CAMERA, createdAt: '2026-10-16T16:00:00.000Z' }
  mkdirSync(join(root, 'intake', '.torno'), { recursive: true })
  writeFileSync(
    join(root, 'intake', '.torno', 'marks.json'),
    JSON.stringify({ next: 2, marks: [{ ...base, id: 'M1', kind: 'dimension', note: 'tub wall', measure: 'thickness', a: { point: WALL_AT, normal: [0, -1, 0], part: 'airbox-tub' }, expected: 3 }] })
  )
  return { root, home }
}

async function start(root: string, home: string): Promise<{ app: ElectronApplication; page: Page }> {
  const app = await electron.launch({ args: ['.'], cwd: appDir, env: { ...process.env, TORNO_TEST: '1', TORNO_AGENT_CMD: `node ${fakeAgent}`, FAKE_AGENT_INIT: JSON.stringify({ model: 'claude-opus-5-5' }), TORNO_WORKSPACE: root, HOME: home } })
  await app.evaluate(({ nativeTheme }) => void (nativeTheme.themeSource = 'light'))
  const page = await app.firstWindow()
  await page.emulateMedia({ colorScheme: 'light' })
  await app.evaluate(({ BrowserWindow }, [w, h]) => BrowserWindow.getAllWindows()[0].setContentSize(w, h), [W, H])
  await expect.poll(() => page.evaluate(() => [window.innerWidth, window.innerHeight])).toEqual([W, H])
  // No red underline of the spell checker under "M2" in the box.
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.session.setSpellCheckerEnabled(false))
  return { app, page }
}

const state = (page: Page): Promise<TornoState> => page.evaluate(() => window.__tornoTest!.state())
const canvas = (page: Page) => page.locator('[data-region="viewport"] canvas').first()
const dock = (page: Page) => page.locator('[data-region="session"]')

async function capture(app: ElectronApplication, page: Page, name: string): Promise<void> {
  const devtools = await page.context().newCDPSession(page)
  await devtools.send('Emulation.setFocusEmulationEnabled', { enabled: true })
  await page.evaluate(async () => {
    await document.fonts.ready
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
  })
  const png = await app.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows()[0].webContents.capturePage()).toPNG().toString('base64'))
  const dir = resolve(process.env.TORNO_DEMO!)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, `${name}.png`), Buffer.from(png, 'base64'))
}

async function pointAt(page: Page, point: Vec3): Promise<[number, number]> {
  const [fx, fy] = await page.evaluate((at) => window.__tornoTest!.project(at), point)
  const box = (await canvas(page).boundingBox())!
  return [box.x + fx * box.width, box.y + fy * box.height]
}

/** The one cosmetic edit: the person's prompt bubble says what a person would have typed, M2 as the chip torno drew for it. */
async function naturalPrompt(page: Page): Promise<void> {
  await page.evaluate((text) => {
    const bubble = document.querySelector('.chat-user .chat-you')!
    const chip = document.querySelector('.chat-added .ref-chip[data-ref="M2"]')?.cloneNode(true)
    const [before, after] = text.split('M2')
    bubble.replaceChildren(document.createTextNode(before), ...(chip ? [chip] : [document.createTextNode('M2')]), document.createTextNode(after))
  }, PROMPT)
}

/** What the stand-in does, in the order it does it; each frame of the agent's turn sends the script up to its step. */
function script(ref: string, upTo: 'look' | 'edit' | 'all'): string {
  const lines = [
    'say Looking at **M2** and the dimension **M1** first.',
    'tool mcp__torno__look {"view":"iso"}',
    `tool mcp__torno__measure {"kind":"thickness","a":{"ref":"${ref}","point":[${PIN_AT.join(',')}]}}`,
    'say The tub wall is 2.8 mm, and M1 expects 3. It is the `wall` parameter of `airbox.py`.'
  ]
  if (upTo !== 'look') lines.push('edit airbox.py "wall: float = 2.8" "wall: float = 3"')
  // The airbox takes most of a minute to build, longer than an edit's answer waits: the agent waits and reads the marks again, as it would.
  if (upTo === 'all') lines.push('work 50', 'tool mcp__torno__marks {}', 'tool mcp__torno__resolve_mark {"id":"M2","note":"wall is 3 mm now"}', 'say Done: `wall` is 3 mm, r2 built, and **M1** passes.')
  return lines.join('\n')
}

/** The moments of the recording, in order; each is a launch driven from the start to it. */
const FRAMES = ['open', 'pin', 'pinned', 'compose', 'look', 'edit', 'done', 'passes'] as const
type Frame = (typeof FRAMES)[number]
const past = (frame: Frame, step: Frame): boolean => FRAMES.indexOf(frame) > FRAMES.indexOf(step)

for (const [n, frame] of FRAMES.entries()) {
  test(`demo frame ${n + 1}: ${frame}`, async () => {
    test.skip(!process.env.TORNO_DEMO || !configured(), 'TORNO_DEMO, TORNO_README_OBJECTS or TORNO_README_PROJECTS is not set')
    test.setTimeout(600_000)
    const { root, home } = workspace()
    const { app, page } = await start(root, home)
    // The dimension's row in the card's Checks (the section is open while there is a check to read), where a click opens what it says.
    const check = (id: string) => page.locator(`[data-region="left"] .check-row[data-check-mark="${id}"]`)
    const verdict = page.locator('[data-region="left"] .dimension-verdict').first()
    try {
      await page.waitForSelector('[data-region="viewport"]')
      await openListed(page, 'intake')
      await expect.poll(async () => ((await state(page)).objectId === 'intake' ? (await state(page)).build?.status : null), { timeout: 240_000 }).toBe('ok')
      await expect.poll(async () => (await state(page)).scene !== null).toBe(true)
      await expect(page.locator('.check-row[data-check-mark="M1"]')).toHaveAttribute('data-verdict', 'fails', { timeout: 60_000 })
      await page.waitForTimeout(800)

      if (past(frame, 'open')) {
        // The pin, with its note being written.
        await page.keyboard.press('p')
        const [x, y] = await pointAt(page, PIN_AT)
        await page.mouse.move(x, y)
        await page.mouse.down()
        await page.mouse.up()
        await expect(page.locator('.note-card textarea')).toBeFocused()
        await page.keyboard.type('too thin here')
      }
      if (past(frame, 'pin')) {
        await page.keyboard.press('Enter')
        await expect.poll(async () => (await state(page)).marks.find((m) => m.id === 'M2')?.status).toBe('draft')
        await page.keyboard.press('Escape')
      }
      if (frame === 'pinned') {
        // The dimension's row opened: what it says of the wall.
        await check('M1').click()
        await expect(verdict).toHaveText('Fails: 0.2 under')
        await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
        await page.mouse.move(W / 2, H - 40)
      }
      if (past(frame, 'pinned')) {
        await newSession(dock(page))
        await expect(page.locator('[data-chat-composer]')).toBeFocused()
      }
      if (frame === 'compose') await page.keyboard.type(PROMPT)
      if (past(frame, 'compose')) {
        const pin = (await state(page)).marks.find((m) => m.id === 'M2') as unknown as { anchor: { ref: string } }
        await page.locator('[data-chat-composer]').fill(script(pin.anchor.ref, frame === 'look' ? 'look' : frame === 'edit' ? 'edit' : 'all'))
        await page.keyboard.press('Enter')
        // The turn that edits waits through the rebuild before its last word: most of two minutes.
        await expect(page.locator('.chat-turn')).toBeVisible({ timeout: 240_000 })
      }
      if (past(frame, 'look')) {
        await expect.poll(async () => (await state(page)).scene !== null && (await state(page)).build?.revision === 2, { timeout: 240_000 }).toBe(true)
        await expect(page.locator('.check-row[data-check-mark="M1"]')).toHaveAttribute('data-verdict', 'passes', { timeout: 60_000 })
        if (frame !== 'edit') await expect(page.locator('.chat-text').last()).toContainText('Done', { timeout: 120_000 })
        await page.waitForTimeout(800)
      }
      if (frame === 'edit') {
        // The edit opened to its lines.
        await page.locator('.chat-tool', { hasText: 'Edit airbox.py' }).locator('.chat-tool-line').click()
        await expect(page.locator('.chat-tool .diff')).toBeVisible()
      }
      if (frame === 'passes') {
        await check('M1').click()
        await expect(verdict).toHaveText('Passes')
        await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
        // What the agent resolved, opened: M2 with its line, from Needs you.
        await page.locator('[data-region="left"] .needs-review').getByRole('button', { name: 'Review' }).click()
        await page.mouse.move(W / 2, H - 40)
      }
      if (past(frame, 'compose')) await naturalPrompt(page)
      await capture(app, page, `frame-${String(n + 1).padStart(2, '0')}`)
    } finally {
      await app.close()
      rmSync(dirname(root), { recursive: true, force: true })
    }
  })
}
