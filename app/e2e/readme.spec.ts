import { mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { _electron as electron, chromium, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import type { TornoState } from '../src/renderer/state/store'
import { openListed } from './objects'
import { configured, readmeWorkspace, showScans } from './readme-workspace'

// The pictures of the README (docs/images/README.md): the window in the states it describes, one hidden launch
// each, written to <TORNO_README_SHOTS>/<shot>.png with a <shot>.json beside it holding the boxes of the regions
// the README crops to. Skipped unless TORNO_README_SHOTS is set and readme-workspace.ts has a workspace to copy
// from: it is not a test of anything.
//
// The projects are real ones, copied from the author's workspace (readme-workspace.ts): an airbox fitted to a scan
// of an engine bay, `intake`, whose tub wall is `wall: float = 2.8` in airbox.py, with one scan, S3, of the bay;
// and a desk stand for a speaker, `speaker-stand`, one part `stand`. The marks below are put on faces of those
// models at points measured on them; with other projects, change them.
//
// The window is hidden (TORNO_TEST=1), as .claude/rules/e2e-hidden-window.md asks of every launch, and webContents.capturePage()
// gives one picture a launch. The agent is the stand-in: the chat it shows is what torno really rendered of a
// scripted turn, with one cosmetic edit, said where it is made: the person's prompt is the stand-in's script, so
// the text of that one bubble is replaced by the words a person would have typed before the capture.
const appDir = resolve(__dirname, '..')
const fakeAgent = resolve(appDir, 'test/fake-agent.mjs')
const out = process.env.TORNO_README_SHOTS ?? ''
const SIZE: [number, number] = [1600, 1000]

type Theme = 'light' | 'dark'
type Main = { pickSave: string | null }

const INTAKE_CAMERA = { position: [620, -420, 380], target: [0, 40, 90], up: [0, 0, 1], ortho: false, fov: 35, zoom: 1 }
const STAND_CAMERA = { position: [-300, -330, 260], target: [0, 100, 20], up: [0, 0, 1], ortho: false, fov: 35, zoom: 1 }

/** The marks of the walk-through on the airbox: a pin on the lid for a latch, the width of the tray pocket (passes) and the tub wall (fails: 2.8 against 3). */
function intakeMarks(root: string): void {
  const base = { author: 'user', status: 'sent', anchorState: 'ok', layout: 'assembly', revision: 1, camera: INTAKE_CAMERA, createdAt: '2026-10-16T16:00:00.000Z' }
  mkdirSync(join(root, 'intake', '.torno'), { recursive: true })
  writeFileSync(
    join(root, 'intake', '.torno', 'marks.json'),
    JSON.stringify({
      next: 4,
      marks: [
        { ...base, id: 'M1', kind: 'pin', status: 'draft', note: 'a latch goes here: it needs 34 mm of flat wall', anchor: { point: [20, -60, 118], normal: [0, -1, 0], part: 'airbox-lid' } },
        { ...base, id: 'M2', kind: 'dimension', note: 'across the tray pocket', measure: 'distance', a: { point: [-116, -1, 77], normal: [-1, 0, 0], part: 'airbox-tub' }, b: { point: [110, 24, 60], normal: [1, 0, 0], part: 'airbox-tub' }, expected: 226 },
        { ...base, id: 'M3', kind: 'dimension', note: 'tub wall', measure: 'thickness', a: { point: [110, 24, 90], normal: [1, 0, 0], part: 'airbox-tub' }, expected: 3 }
      ]
    })
  )
}

/** The marks on the speaker stand: a pin on the front wall, its thickness and the frame's width (pass), the side wall against 10 mm (fails). */
function standMarks(root: string): void {
  const base = { author: 'user', status: 'sent', anchorState: 'ok', layout: 'main', revision: 1, camera: STAND_CAMERA, createdAt: '2026-10-15T17:30:00.000Z' }
  mkdirSync(join(root, 'speaker-stand', '.torno'), { recursive: true })
  writeFileSync(
    join(root, 'speaker-stand', '.torno', 'marks.json'),
    JSON.stringify({
      next: 5,
      marks: [
        { ...base, id: 'M1', kind: 'pin', status: 'draft', note: 'let the wave of slots run on into the corner', anchor: { point: [40, 0, 45], normal: [0, -1, 0], part: 'stand' } },
        { ...base, id: 'M2', kind: 'dimension', note: 'front wall', measure: 'thickness', a: { point: [-80, 0, 30], normal: [0, -1, 0], part: 'stand' }, expected: 8 },
        { ...base, id: 'M3', kind: 'dimension', note: 'frame width', measure: 'distance', a: { point: [-115, 120, 30], normal: [-1, 0, 0], part: 'stand' }, b: { point: [115, 120, 30], normal: [1, 0, 0], part: 'stand' }, expected: 230 },
        { ...base, id: 'M4', kind: 'dimension', note: 'side wall', measure: 'thickness', a: { point: [115, 120, 30], normal: [1, 0, 0], part: 'stand' }, expected: 10 }
      ]
    })
  )
}

/** Starts torno hidden, in a theme, at the README's size, in the workspace's own home so that nothing of the person's is listed. */
async function start(theme: Theme, env: Record<string, string>, home: string): Promise<{ app: ElectronApplication; page: Page }> {
  const app = await electron.launch({ args: ['.'], cwd: appDir, env: { ...process.env, HOME: home, TORNO_TEST: '1', TORNO_AGENT_CMD: `node ${fakeAgent}`, FAKE_AGENT_INIT: JSON.stringify({ model: 'claude-opus-5-5' }), ...env } })
  await app.evaluate(({ nativeTheme }, theme) => void (nativeTheme.themeSource = theme), theme)
  const page = await app.firstWindow()
  await page.emulateMedia({ colorScheme: theme })
  await app.evaluate(({ BrowserWindow }, [w, h]) => BrowserWindow.getAllWindows()[0].setContentSize(w, h), SIZE)
  // No red underline of the spell checker under a mark's name in the box.
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.session.setSpellCheckerEnabled(false))
  return { app, page }
}

const state = (page: Page): Promise<TornoState> => page.evaluate(() => window.__tornoTest!.state())

/** Opens a project and waits for its build; the real models take a while. */
async function open(page: Page, id: string, status = 'ok'): Promise<void> {
  await openListed(page, id)
  await expect.poll(async () => ((await state(page)).objectId === id ? (await state(page)).build?.status : null), { timeout: 240_000 }).toBe(status)
  if (status === 'ok') await expect.poll(async () => (await state(page)).scene !== null).toBe(true)
}

/** Every mark of the project checked against the build and found where it was put. */
async function marksSettled(page: Page): Promise<void> {
  await expect
    .poll(
      async () => {
        const states = (await state(page)).marks.map((m) => m.anchorState)
        return states.length > 0 && states.every((s) => s === 'ok')
      },
      { timeout: 60_000 }
    )
    .toBe(true)
}

/** The boxes of the window's regions, in px of the picture, for the crops the README wants. */
async function boxes(page: Page): Promise<Record<string, { x: number; y: number; width: number; height: number }>> {
  const found: Record<string, { x: number; y: number; width: number; height: number }> = {}
  for (const region of ['left', 'viewport', 'session']) {
    const box = (await page.locator(`[data-region="${region}"]`).count()) > 0 ? await page.locator(`[data-region="${region}"]`).first().boundingBox() : null
    if (box) found[region] = box
  }
  return found
}

/** The whole window as it is drawn, once: fonts loaded, a frame drawn, the focus shown as in a window in use. */
async function capture(app: ElectronApplication, page: Page, name: string): Promise<void> {
  const devtools = await page.context().newCDPSession(page)
  await devtools.send('Emulation.setFocusEmulationEnabled', { enabled: true })
  await page.evaluate(async () => {
    await document.fonts.ready
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
  })
  await page.waitForTimeout(600)
  const regions = await boxes(page)
  const png = await app.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows()[0].webContents.capturePage()).toPNG().toString('base64'))
  mkdirSync(out, { recursive: true })
  writeFileSync(join(out, `${name}.png`), Buffer.from(png, 'base64'))
  writeFileSync(join(out, `${name}.json`), JSON.stringify(regions))
}

/** Types a script for the stand-in as one prompt and sends it. */
async function prompt(page: Page, lines: string[]): Promise<void> {
  const box = page.locator('[data-chat-composer]')
  await expect(box).toBeFocused()
  await box.fill(lines.join('\n'))
  await page.keyboard.press('Enter')
}

/** The one cosmetic edit: the person's prompt bubble shows the words a person typed, not the stand-in's script. */
async function wording(page: Page, text: string): Promise<void> {
  await page.evaluate((text) => {
    const bubble = document.querySelector('.chat-user-text')
    if (bubble) bubble.textContent = text
  }, text)
}

/** The face of the tub the wall dimension is on, as torno found it (`airbox-tub/F<i>`), for the stand-in's measure call. */
async function wallFace(page: Page): Promise<string> {
  const mark = (await state(page)).marks.find((m) => m.id === 'M3') as unknown as { a: { ref: string } }
  return mark.a.ref
}

const SHOTS = ['hero', 'hero-dark', 'marks', 'chat', 'section', 'objects', 'first-screen'] as const

for (const shot of SHOTS) {
  test(`README picture: ${shot}`, async () => {
    test.skip(!out || !configured(), 'TORNO_README_SHOTS, TORNO_README_OBJECTS or TORNO_README_PROJECTS is not set')
    test.setTimeout(600_000)
    const theme: Theme = shot === 'hero-dark' ? 'dark' : 'light'
    const { root, home } = readmeWorkspace()
    intakeMarks(root)
    standMarks(root)
    if (shot === 'section') showScans(root, 'intake', { S3: { visible: false } })
    const env: Record<string, string> = shot === 'first-screen' ? {} : { TORNO_WORKSPACE: root }
    const { app, page } = await start(theme, env, home)
    try {
      if (shot === 'first-screen') {
        await expect(page.locator('.ready')).toBeVisible()
        await page.waitForTimeout(800)
      } else if (shot === 'marks') {
        await page.waitForSelector('[data-region="left"]')
        await open(page, 'speaker-stand')
        await marksSettled(page)
      } else if (shot !== 'objects') {
        await page.waitForSelector('[data-region="left"]')
        await open(page, 'intake')
        await marksSettled(page)
      }
      if (shot === 'hero' || shot === 'hero-dark') {
        // A conversation about the marks: the pin goes with the prompt, the agent looks, measures on the B-rep and answers.
        await page.locator('[data-region="session"]').getByRole('button', { name: 'New session' }).click()
        await prompt(page, [
          'say You marked three things. **M1** pins the front wall of the lid for a latch. **M2**, across the tray pocket, passes at 226 mm. **M3**, the tub wall, fails: 2.8 mm against the 3 mm you asked for. Let me look at the wall.',
          'tool mcp__torno__look {"view":"iso"}',
          `tool mcp__torno__measure {"kind":"thickness","a":{"ref":"${await wallFace(page)}","point":[110,24,90]}}`,
          'say The tub wall is 2.8 mm, measured on the solid, not the mesh: `wall` in `airbox.py`, which the lid shares. I will set it to 3 mm and rebuild, and M3 should pass. At **M1** the deck stands 36 mm off the seam (`deck_h`), and a latch needs 34, so there is room.'
        ])
        await expect(page.locator('.chat-turn')).toContainText('Pulled from torno: look, 1 picture', { timeout: 90_000 })
        await expect(page.locator('.chat-item[data-kind="user"]').last()).toHaveAttribute('data-state', 'sent', { timeout: 60_000 })
        await expect.poll(async () => page.locator('.chat-text').count(), { timeout: 60_000 }).toBeGreaterThan(1)
        await wording(page, 'Is the tub wall thick enough to print? And is there room for a latch at M1?')
        await page.locator('.mark-row[data-mark="M3"]').click()
        await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
      } else if (shot === 'marks') {
        // The stand and its Marks list, the session pane away: the pin with its note, dimensions that pass, one that fails.
        await page.getByRole('button', { name: 'Hide session', exact: true }).click()
        await page.waitForTimeout(400)
        const at = (await page.evaluate(() => window.__tornoTest!.markScreen('M4')))!
        const view = (await page.locator('[data-region="viewport"] canvas').first().boundingBox())!
        await page.mouse.move(view.x + at.x * view.width, view.y + at.y * view.height)
        await expect(page.locator('.pick-readout')).toContainText('under')
      } else if (shot === 'chat') {
        // The agent's turn: the prompt with the marks torno added opened to its text, look with its picture, an edit and its build.
        await page.locator('[data-region="session"]').getByRole('button', { name: 'New session' }).click()
        await prompt(page, [
          'say The tub wall at **M3** is 2.8 mm against the 3 mm you asked for. Looking at it:',
          'tool mcp__torno__look {"view":"iso"}',
          `tool mcp__torno__measure {"kind":"thickness","a":{"ref":"${await wallFace(page)}","point":[110,24,90]}}`,
          'say 2.8 mm on the solid. I will set `wall` to 3 mm and rebuild.',
          'edit airbox.py "wall: float = 2.8" "wall: float = 3"',
          // The airbox takes most of a minute to build, longer than an edit's answer waits: the agent waits and reads the marks again, as it would.
          'work 50',
          'tool mcp__torno__marks {}',
          'say Built r2: the tub wall is 3 mm and **M3** passes.'
        ])
        await expect.poll(async () => (await state(page)).build?.revision, { timeout: 240_000 }).toBe(2)
        await expect(page.locator('.chat-turn')).toContainText('Pulled from torno: look, 1 picture', { timeout: 240_000 })
        await expect(page.locator('.mark-row[data-mark="M3"] .mark-value')).toHaveAttribute('data-verdict', 'pass', { timeout: 60_000 })
        await expect.poll(async () => page.locator('.chat-text').count(), { timeout: 120_000 }).toBe(3)
        await expect(page.locator('.chat-item[data-kind="user"]').last()).toHaveAttribute('data-state', 'sent', { timeout: 60_000 })
        await wording(page, 'The tub wall at M3 is too thin. Make it 3 mm.')
        await page.locator('.chat-added').first().getByRole('button', { name: 'Show text' }).click()
        // The turn is taller than the pane: the picture is its head, the prompt and what torno added to it in full.
        await page.waitForTimeout(300)
        await page.evaluate(() => document.querySelectorAll('[data-region="session"] *').forEach((el) => { if (el.scrollTop > 0) el.scrollTop = 0 }))
      } else if (shot === 'section') {
        await page.getByRole('button', { name: 'Hide session', exact: true }).click()
        await page.keyboard.press('x')
        await page.getByRole('button', { name: 'Cut across Y' }).click()
        await expect.poll(async () => (await state(page)).section !== null).toBe(true)
        await page.waitForTimeout(800)
      } else if (shot === 'objects') {
        // The page of projects, each built once so that its card has a picture.
        await page.waitForSelector('[data-region="left"]')
        const listed = (await state(page)).workspace!.objects.map((o) => o.id)
        for (const id of listed) await open(page, id)
        await page.getByRole('button', { name: 'Hide session', exact: true }).click()
        await page.locator('[data-region="viewport"] canvas').first().click({ position: { x: 5, y: 5 } })
        await page.keyboard.press('w')
        // A card asks for its picture only once it is in view: each is brought there, then the page goes back to the top.
        for (const id of listed) {
          await page.locator(`.card[data-object="${id}"]`).scrollIntoViewIfNeeded()
          await expect(page.locator(`.card[data-object="${id}"] img`)).toHaveJSProperty('naturalWidth', 480, { timeout: 60_000 })
        }
        await page.waitForTimeout(600)
        await page.evaluate(() => document.querySelectorAll('*').forEach((el) => { if (el.scrollTop > 0) el.scrollTop = 0 }))
      }
      await capture(app, page, shot)
    } finally {
      await app.close()
    }
  })
}

test('README picture: export, the page in a browser', async () => {
  test.skip(!out || !configured(), 'TORNO_README_SHOTS, TORNO_README_OBJECTS or TORNO_README_PROJECTS is not set')
  test.setTimeout(600_000)
  const { root, home } = readmeWorkspace()
  intakeMarks(root)
  const { app, page } = await start('light', { TORNO_WORKSPACE: root }, home)
  const file = join(root, 'intake.html')
  try {
    await page.waitForSelector('[data-region="left"]')
    await open(page, 'intake')
    await marksSettled(page)
    await app.evaluate((_electron, to) => void ((globalThis as unknown as { __tornoMain: Main }).__tornoMain.pickSave = to), file)
    await page.getByRole('button', { name: 'Export…' }).click()
    const sheet = page.getByRole('dialog', { name: 'Export' })
    await expect(sheet).toContainText('intake')
    await sheet.getByRole('checkbox', { name: /Include marks and their notes/ }).check()
    await sheet.getByRole('button', { name: 'Export', exact: true }).click()
    await expect(page.getByText(`Saved to ${file}`)).toBeVisible({ timeout: 240_000 })
  } finally {
    await app.close()
  }
  // The exported file, in a browser of Playwright's own (headless, never a window on the desktop): the viewer draws, then the shot.
  const browser = await chromium.launch()
  try {
    const tab = await browser.newPage({ viewport: { width: 1400, height: 880 }, deviceScaleFactor: 1 })
    await tab.goto(`file://${file}`)
    await tab.waitForSelector('canvas')
    await tab.waitForTimeout(4000)
    mkdirSync(out, { recursive: true })
    await tab.screenshot({ path: join(out, 'export.png') })
  } finally {
    await browser.close()
  }
})
