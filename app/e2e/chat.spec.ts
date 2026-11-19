import { cpSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { _electron as electron, expect, test, type ElectronApplication, type Locator, type Page } from '@playwright/test'
import type { TornoState } from '../src/renderer/state/store'
import type { HistoryEntry } from '../src/shared/history'
import type { Mark } from '../src/shared/marks'
import { openListed } from './objects'
import { closeModelMenu, fromMore, inModelMenu, newSession, openStrip } from './helpers'

// The chat pane of Claude Code, through the window: what is said and shown, what torno added to a prompt, every torno
// tool the agent used (through the real MCP server), refs that point into the viewport, stopping, the switch to the
// terminal and back, and the window reloaded mid-stream. The agent is the stand-in in its stream mode
// (test/fake-agent.mjs). The window is hidden: everything is read from the DOM and the store, never from pixels.
const appDir = resolve(__dirname, '..')
const fixtures = resolve(appDir, '../kernel/tests/fixtures/ws')
const fakeAgent = resolve(appDir, 'test/fake-agent.mjs')

test.describe.configure({ mode: 'serial' })

let root: string
let app: ElectronApplication
let page: Page

test.beforeAll(async () => {
  root = mkdtempSync(join(realpathSync(tmpdir()), 'torno-e2e-chat-'))
  cpSync(fixtures, root, { recursive: true, filter: (source) => !source.endsWith('__pycache__') })
  // hollow has a draft of the person's and a dimension, given to the agent before, that its build does not meet.
  mkdirSync(join(root, 'hollow', '.torno'), { recursive: true })
  const base = { author: 'user', anchorState: 'ok', layout: 'assembly', revision: 1, camera: { position: [120, -90, 60], target: [0, 0, 6], up: [0, 0, 1], ortho: false, fov: 35, zoom: 1 }, createdAt: '2026-10-09T20:00:00.000Z' }
  writeFileSync(
    join(root, 'hollow', '.torno', 'marks.json'),
    JSON.stringify({
      next: 5,
      marks: [
        { ...base, id: 'M1', kind: 'pin', status: 'draft', note: 'too thin here', anchor: { point: [20, 0, 20], normal: [1, 0, 0], part: 'tub' } },
        { ...base, id: 'M4', kind: 'dimension', status: 'sent', note: 'wall', measure: 'thickness', a: { point: [-20, 0, 20], normal: [-1, 0, 0], part: 'tub' }, expected: 3 },
        { ...base, id: 'M3', kind: 'dimension', status: 'sent', note: 'height with the lid', measure: 'distance', a: { point: [0, 0, 0], normal: [0, 0, -1], part: 'tub' }, b: { point: [0, 0, 40], normal: [0, 0, 1], part: 'lid' }, expected: 42 }
      ]
    })
  )
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

const state = (): Promise<TornoState> => page.evaluate(() => window.__tornoTest!.state())
const dock = () => page.locator('[data-region="session"]')
const chat = () => dock().locator('.chat')
const composer = () => dock().locator('[data-chat-composer]')
const canvas = () => page.locator('.viewport-canvas canvas').first()
const turns = () => chat().locator('.chat-turn')
const peeked = (): Promise<string[]> => page.evaluate(() => window.__tornoTest!.peeked())
const terminalText = (): Promise<string> => page.evaluate(() => window.__tornoTerm!.text())

async function clickOver(point: Vec3): Promise<void> {
  const [fx, fy] = await page.evaluate((at) => window.__tornoTest!.project(at), point)
  const box = (await canvas().boundingBox())!
  await page.mouse.move(box.x + fx * box.width, box.y + fy * box.height)
  await page.mouse.down()
  await page.mouse.up()
}

/** Write a prompt in the box and send it, as a person does. */
async function say(prompt: string): Promise<void> {
  await composer().focus()
  await page.keyboard.type(prompt)
  await page.keyboard.press('Enter')
}

test('a new session is a chat, with no terminal; a prompt is answered, and what torno added to it is shown with the mark it sent', async () => {
  await openListed(page, 'bracket')
  await expect.poll(async () => (await state()).build, { timeout: 30_000 }).toMatchObject({ status: 'ok', revision: 1 })

  // A mark the person has left, not yet sent.
  await page.getByRole('toolbar', { name: 'Tools' }).getByRole('button', { name: 'Pin', exact: true }).click()
  await clickOver(ON_BASE)
  await expect(page.locator('.note-card textarea')).toBeFocused()
  await page.keyboard.type('thicker here')
  await page.keyboard.press('Enter')
  await expect.poll(async () => (await state()).marks[0]?.status).toBe('draft')

  await newSession(dock())
  await expect(chat()).toBeVisible()
  await expect(dock().locator('.xterm')).toHaveCount(0)
  await expect(dock().getByRole('status').first()).toHaveText('Idle')
  await expect(composer()).toBeFocused()
  // The header says which view this is.
  await expect(dock().getByRole('group', { name: 'View' }).getByRole('button', { name: 'Chat' })).toHaveAttribute('aria-pressed', 'true')
  // What goes with the next prompt, as chips of the marks.
  await expect(chat().locator('.chat-next .ref-chip[data-ref="M1"]')).toBeVisible()

  // Chips of the next useful prompts: an open mark, the print layout bracket has, and a conversation not begun. One fills the box and sends nothing;
  // they go while the box has text and come back when it is empty.
  const suggestions = chat().getByRole('group', { name: 'Suggestions' })
  await expect(suggestions.getByRole('button')).toHaveText(['Review 1 mark', 'Check printability', 'Explain this model'])
  await suggestions.getByRole('button', { name: 'Review 1 mark' }).click()
  await expect(composer()).toHaveValue('/mcp__torno__review ')
  await expect(composer()).toBeFocused()
  await expect(suggestions).toHaveCount(0)
  await expect(turns()).toHaveCount(0)
  await composer().fill('')
  await expect(suggestions.getByRole('button')).toHaveCount(3)
  await composer().focus()

  await say('say hello there')
  const user = chat().locator('.chat-user').first()
  await expect(user).toContainText('say hello there')
  await expect(chat().locator('.chat-text').first()).toContainText('hello there')
  await expect(turns().first()).toContainText('Done in')
  // The model, once the agent has said it with its first answer.
  await expect(await inModelMenu(dock(), 'Model')).toHaveValue('fake-model')
  await closeModelMenu(dock())
  // Enter sent it and the box is empty again.
  await expect(composer()).toHaveValue('')

  // Under the prompt: what torno added, with the mark it sent and the build; the mark is sent now.
  const added = chat().locator('.chat-added').first()
  await expect(added.locator('.chat-added-label')).toHaveText('with')
  await expect(added.locator('.ref-chip[data-ref="M1"]')).toBeVisible()
  await expect(added.locator('.ref-chip[data-ref="r1"]')).toBeVisible()
  await expect(added.locator('.chat-added-build')).toContainText('ok')
  await expect.poll(async () => (await state()).marks[0].status).toBe('sent')
  await expect(chat().locator('.chat-next')).toHaveCount(0)
  // The exact text the agent was given opens out.
  await added.getByRole('button', { name: 'Show text' }).click()
  await expect(added.locator('.chat-added-text')).toContainText('[torno] bracket')
  await expect(added.locator('.chat-added-text')).toContainText('M1')
})

test('a ref in the chat lights the viewport while the pointer is on it, and a click goes to the mark', async () => {
  const chip = chat().locator('.chat-added .ref-chip[data-ref="M1"]').first()
  const ref = ((await state()).marks[0] as Extract<Mark, { kind: 'pin' }>).anchor.ref!
  expect(ref).toMatch(/^base\/F\d+$/)
  expect(await peeked()).toEqual([])
  await chip.hover()
  await expect.poll(peeked).toEqual([ref])
  await page.mouse.move(5, 5)
  await expect.poll(peeked).toEqual([])
  // Clicking it makes the mark the one gone to.
  const before = (await state()).markFocus
  await chip.click()
  await expect.poll(async () => (await state()).markFocus).toBeGreaterThan(before)
  expect((await state()).activeMark).toBe('M1')
  // What the chip did, it did to the view: the next letter is the view's, not the chat's.
  await page.keyboard.press('p')
  await expect(page.locator('.tool-button[data-tool="pin"]')).toHaveAttribute('aria-pressed', 'true')
  await page.keyboard.press('Escape')
  await expect(page.locator('.tool-button[data-tool="pin"]')).toHaveAttribute('aria-pressed', 'false')
  // M3 is a screw, not a mark of this object: text, not a chip. A mark the object has is a chip.
  await say('say an M3 clearance hole near M1')
  const screw = chat().locator('.chat-text').last()
  await expect(screw).toContainText('M3 clearance hole')
  await expect(screw.locator('.ref-chip[data-ref="M3"]')).toHaveCount(0)
  await expect(screw.locator('.ref-chip[data-ref="M1"]')).toHaveCount(1)
  // A ref of a part the build does not have is only text; a face the part does not have says so and does nothing.
  await say('say look at gizmo/F3 and base/F99')
  const text = chat().locator('.chat-text').last()
  await expect(text).toContainText('gizmo/F3')
  await expect(text.locator('.ref-chip[data-ref="gizmo/F3"]')).toHaveCount(0)
  const gone = text.locator('.ref-chip[data-ref="base/F99"]')
  await expect(gone).toBeVisible()
  await expect(gone).toHaveAttribute('title', 'base has no F99')
  await expect(gone).not.toHaveAttribute('data-live', '')
  expect(await gone.evaluate((el) => el.tagName)).toBe('SPAN')
})

test('a tool of torno is shown as torno\'s: its line, its picture, what was pulled; other tools are one line each', async () => {
  await say('tool mcp__torno__look {"view":"iso"}')
  const look = chat().locator('.chat-tool[data-torno]').last()
  await expect(look).toContainText('torno · look (iso)')
  await expect(look).toHaveAttribute('data-state', 'done', { timeout: 20_000 })
  await expect(look.locator('.chat-tool-state')).toHaveText('')
  await expect(look.locator('.chat-thumb')).toHaveCount(1)
  await expect(turns().last()).toContainText('Pulled from torno: look, 1 picture')
  // The picture opens large over the transcript, and Escape puts it away.
  await look.locator('.chat-thumb').click()
  const large = chat().locator('.chat-picture')
  await expect(large).toBeVisible()
  await expect(large).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(large).toHaveCount(0)
  await expect(look.locator('.chat-thumb')).toBeFocused()
  // The line opens to its input and its result.
  await look.locator('.chat-tool-line').click()
  await expect(look.locator('.chat-pre').first()).toContainText('"view": "iso"')

  await say('tool Bash {"command":"ls -la"}')
  const bash = chat().locator('.chat-tool').last()
  await expect(bash).toContainText('Bash: ls -la')
  await expect(bash).not.toHaveAttribute('data-torno', '')
  await expect(bash).toHaveAttribute('data-state', 'done')
  await expect(bash.locator('.chat-tool-state')).toHaveText('')
  await expect(bash.locator('.chat-thumb')).toHaveCount(0)
})

test('Insert puts the refs of the selection in the box at the cursor and sends nothing; Escape gives the keys back to the view', async () => {
  await page.getByRole('toolbar', { name: 'Tools' }).getByRole('button', { name: 'Select', exact: true }).click()
  await clickOver(ON_BASE)
  await expect.poll(async () => (await state()).selection).toHaveLength(1)
  const ref = (await state()).selection[0]
  const users = await chat().locator('.chat-user').count()
  await composer().focus()
  await page.keyboard.type('check')
  await page.getByRole('button', { name: 'Insert in prompt', exact: true }).click()
  await expect(composer()).toHaveValue(`check ${ref} `)
  await expect(composer()).toBeFocused()
  await page.keyboard.type('is thin')
  await expect(composer()).toHaveValue(`check ${ref} is thin`)
  await expect(chat().locator('.chat-user')).toHaveCount(users)
  // Escape is done with the box, as it is with a field: the keys of the view are the view's again.
  await page.keyboard.press('Escape')
  await expect(composer()).not.toBeFocused()
  await expect(composer()).toHaveValue(`check ${ref} is thin`)
  // Ctrl+` goes to the box in place of the terminal, and from it back to the view.
  await page.keyboard.press('Control+Backquote')
  await expect(composer()).toBeFocused()
  await page.keyboard.press('Control+Backquote')
  await expect(composer()).not.toBeFocused()
  await composer().focus()
  await page.keyboard.press('Control+A')
  await page.keyboard.press('Backspace')
  await expect(composer()).toHaveValue('')
  // With the dock hidden, Insert shows it and gives the box the keys: what is typed next is not the view's.
  await page.getByRole('button', { name: 'Hide session', exact: true }).click()
  await expect(composer()).toBeHidden()
  await page.getByRole('button', { name: 'Insert in prompt', exact: true }).click()
  await expect(composer()).toBeVisible()
  await expect(composer()).toBeFocused()
  await page.keyboard.type('m')
  await expect(composer()).toHaveValue(`${ref} m`)
  await page.keyboard.press('Control+A')
  await page.keyboard.press('Backspace')
  await expect(composer()).toHaveValue('')
})

test('Shift+Enter breaks the line and Enter sends it, queued while the agent works; Stop ends the turn within moments', async () => {
  const first = await turns().count()
  await composer().focus()
  await page.keyboard.type('say one')
  await page.keyboard.press('Shift+Enter')
  await page.keyboard.type('say two')
  await expect(composer()).toHaveValue('say one\nsay two')
  await page.keyboard.press('Enter')
  await expect(chat().locator('.chat-user').last()).toContainText('say two')
  await expect(turns()).toHaveCount(first + 1)
  await expect(turns().last()).toContainText('Done in')

  const before = first + 1
  await say('slow 5')
  const streaming = chat().locator('.chat-text').last().locator('.chat-dot')
  await expect(streaming).toBeVisible()
  await expect(dock().getByRole('status').first()).toHaveText('Working')
  await expect(chat().locator('.chat-user', { hasText: 'slow 5' })).toHaveAttribute('data-state', 'sent')
  // Another prompt while it works waits behind it, and says so.
  await say('say after')
  await expect(chat().locator('.chat-user[data-state="queued"]')).toHaveCount(1)
  await expect(chat().locator('.chat-user[data-state="queued"]')).toContainText('say after')
  await dock().getByRole('button', { name: 'Stop' }).click()
  await expect(turns().nth(before)).toContainText('Stopped', { timeout: 2000 })
  // What was waiting behind it is not dropped: the CLI runs it after the stop, so it moves under "Stopped" as sent, and is answered.
  await expect(chat().locator('.chat-user', { hasText: 'say after' })).toHaveAttribute('data-state', 'sent')
  await expect(chat().locator('.chat-user[data-state="not-sent"]')).toHaveCount(0)
  await expect(turns().nth(before + 1)).toContainText('Done in')
  await expect(chat().locator('.chat-text').last()).toContainText('after')
  await expect(dock().getByRole('status').first()).toHaveText('Idle')
})

test('a delta of a streaming text draws that item and no other, whatever else is in the transcript', async () => {
  const renders = (): Promise<Record<string, number>> => page.evaluate(() => ({ ...window.__tornoChatRenders }))
  await say('slow 4')
  const text = chat().locator('.chat-text').last()
  await expect(text).toContainText('word2')
  const early = await renders()
  await expect(text).toContainText('word12')
  const late = await renders()
  const grown = Object.keys(late).filter((id) => late[id] !== early[id])
  // One item changed, and it drew more often; every other item of the transcript was drawn no more.
  expect(grown).toHaveLength(1)
  expect(late[grown[0]]).toBeGreaterThan(early[grown[0]] ?? 0)
  // The turn ends: the footer and the item's last state are drawn, and the beat of a second has drawn none else.
  await expect(turns().last()).toContainText('Done in', { timeout: 10_000 })
  await expect(chat().locator('.chat-text .chat-dot')).toHaveCount(0)
})

test('the view is switched to the terminal, which resumes the same conversation, and back to the chat, which shows what was said', async () => {
  await dock().getByRole('group', { name: 'View' }).getByRole('button', { name: 'Terminal' }).click()
  await expect.poll(terminalText, { timeout: 15_000 }).toContain('READY')
  expect(await terminalText()).toContain('--resume')
  await expect(chat()).toHaveCount(0)
  await expect(dock().getByRole('group', { name: 'View' }).getByRole('button', { name: 'Terminal' })).toHaveAttribute('aria-pressed', 'true')
  // The terminal is typed into as before.
  await page.keyboard.type('hi')
  await page.keyboard.press('Enter')
  await expect.poll(terminalText).toContain('> hi')

  await dock().getByRole('group', { name: 'View' }).getByRole('button', { name: 'Chat' }).click()
  await expect(chat()).toBeVisible({ timeout: 15_000 })
  const earlier = chat().getByRole('region', { name: 'Earlier in this conversation' })
  await expect(earlier).toBeVisible()
  await expect(earlier).toContainText('say hello there')
  await expect(earlier).toContainText('Turns made in the terminal are not shown here.')
  // A fresh transcript below it, ready for the next prompt.
  await expect(composer()).toBeEnabled()
})

test('an ended session can still be read, and nothing more can be written to it', async () => {
  await fromMore(dock(), 'End')
  await expect(dock().getByRole('status').first()).toHaveText('Ended')
  // The conversation that ended can still be read, and nothing more can be written to it.
  await expect(composer()).toBeDisabled()
  await expect(chat().locator('.chat-note').last()).toContainText('The session ended')
  // And after the window is loaded again: main still holds what it said.
  await Promise.all([page.waitForEvent('load'), page.evaluate(() => window.location.reload())])
  await page.waitForSelector('[data-region="left"]')
  await openListed(page, 'bracket')
  await expect(chat()).toBeVisible({ timeout: 15_000 })
  await expect(chat().locator('.chat-note').last()).toContainText('The session ended')
  await expect(chat().locator('.chat-user', { hasText: 'say hello there' })).toHaveCount(1)
  await expect(composer()).toBeDisabled()
})

test('the window reloaded in the middle of a stream shows every item once and goes on streaming', async () => {
  await newSession(dock())
  await expect(composer()).toBeEnabled()
  await say('say before')
  await expect(turns().first()).toContainText('Done in')
  await say('slow 3')
  await expect(chat().locator('.chat-text').last().locator('.chat-dot')).toBeVisible()
  await Promise.all([page.waitForEvent('load'), page.evaluate(() => window.location.reload())])
  await page.waitForSelector('[data-region="left"]')
  await openListed(page, 'bracket')
  await expect(chat()).toBeVisible({ timeout: 15_000 })
  await expect(chat().locator('.chat-user', { hasText: 'slow 3' })).toHaveCount(1)
  // It finishes: the turn is told, and nothing is drawn twice.
  await expect(turns()).toHaveCount(2, { timeout: 15_000 })
  const ids = await chat().locator('.chat-group').evaluateAll((groups) => groups.map((g) => g.getAttribute('data-id')))
  expect(new Set(ids).size).toBe(ids.length)
  await expect(chat().locator('.chat-text .chat-dot')).toHaveCount(0)
})

test('what goes with the next prompt is chips of the marks themselves: the drafts, and the dimensions that fail', async () => {
  await openListed(page, 'hollow')
  await expect.poll(async () => (await state()).build, { timeout: 30_000 }).toMatchObject({ objectId: 'hollow', status: 'ok' })
  await newSession(dock())
  const next = chat().locator('.chat-next')
  await expect(next).toContainText('Goes with your next prompt:')
  await expect(next.locator('.ref-chip[data-ref="M1"]')).toBeVisible()
  const failing = next.locator('.chat-next-one', { has: page.locator('.ref-chip[data-ref="M3"]') })
  await expect(failing).toBeVisible()
  await expect(failing).toContainText('fails')
  // A chip is live: the pointer on M3 lights what it is anchored to.
  await next.locator('.ref-chip[data-ref="M3"]').hover()
  await expect.poll(async () => (await page.evaluate(() => window.__tornoTest!.peeked())).length).toBeGreaterThan(0)
})

test('the build an edit started is a build under the edit: that it worked and how long, what it did to a dimension and to the parts; a failed one says why, and opens its sheet', async () => {
  // hollow is open, with a session: its dimension M4 (a wall of 3 mm) fails on r1, where the wall is 2.
  await expect(composer()).toBeEnabled()
  await say('edit hollow.py "wall: float = 2" "wall: float = 3"')
  const built = chat().locator('.chat-build').first()
  // The build is named as the history names it (h41) once the history has it, as its revision (r2) until then.
  await expect(built).toContainText(/Built (r2|h\d+) ok/, { timeout: 30_000 })
  await expect(built.locator('.chat-build-head')).toContainText(/\d s$/)
  // Not what torno adds to a prompt: a build, under the card of the edit.
  await expect(built.locator('.chat-added-label')).toHaveCount(0)
  await expect(chat().locator('.chat-group', { has: page.locator('.chat-tool') }).last().locator('.chat-build')).toHaveCount(1)
  // The dimension the edit mended, as a chip and a word; the part it changed, as the kernel said it.
  await expect(built.locator('.chat-build-dimensions li', { hasText: 'M4' })).toContainText('now passes', { timeout: 15_000 })
  // The part it changed is a row of the table, with its volume before and now, and the change.
  await expect(built.locator('.chat-build-table thead')).toContainText('Volume, mm³')
  await expect(built.locator('.chat-build-table tbody tr').first()).toContainText('tub')
  await expect(built.locator('.chat-build-table tbody tr').first().locator('td.num')).toHaveCount(3)
  // Nothing of the text the agent got is drawn until it is asked for, and then it is whole.
  await expect(built.locator('.chat-added-text')).toHaveCount(0)
  await built.getByRole('button', { name: 'Show text' }).click()
  await expect(built.locator('.chat-added-text')).toContainText('[torno] hollow')
  // The chip of a build that worked does nothing while the build after it did not fail.
  await expect(built.locator('.ref-chip[data-ref="r2"]')).not.toHaveAttribute('data-live', '')

  await say('edit hollow.py "return {" "return WAL, {"')
  const failed = chat().locator('.chat-build').last()
  await expect(failed).toContainText(/The build after (r2|h\d+) failed/, { timeout: 30_000 })
  await expect(failed.locator('.chat-build-error')).toHaveText("NameError: name 'WAL' is not defined")
  await expect(failed.locator('.chat-build-head')).toHaveAttribute('data-verdict', 'failed')
  await failed.getByRole('button', { name: 'Show error' }).click()
  await expect(page.getByRole('dialog', { name: 'Build error' })).toContainText("name 'WAL' is not defined")
  // The session ran this edit: the sheet says it was told, and hands over without sending.
  await expect(page.getByRole('dialog', { name: 'Build error' }).locator('[data-part="told"]')).toContainText('Claude Code was told after its edit')
  await page.getByRole('dialog', { name: 'Build error' }).getByRole('button', { name: 'Ask Claude Code to fix it' }).click()
  await expect(composer()).toHaveValue('Fix the build of hollow: see the error. ')
  await composer().fill('')
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog', { name: 'Build error' })).toHaveCount(0)
  // The build on show is live now, and says why in a click; an older one is not.
  const chip = built.locator('.ref-chip[data-ref="r2"]')
  await expect(chip).toHaveAttribute('data-live', '')
  await chip.click()
  await expect(page.getByRole('dialog', { name: 'Build error' })).toBeVisible()
  await page.keyboard.press('Escape')
  // Mended: the failure's line has no sheet to open any more.
  await say('edit hollow.py "return WAL, {" "return {"')
  await expect(chat().locator('.chat-build').last()).toContainText(/Built (r3|h\d+) ok/, { timeout: 30_000 })
  await expect(failed.getByRole('button', { name: 'Show error' })).toHaveCount(0)
})

test('a turn ends with what it did to the project, and "See changes" shows the lines it removed and added, and the file as it is', async () => {
  await expect(composer()).toBeEnabled()
  const before = await turns().count()
  await say('edit hollow.py "wall: float = 3" "wall: float = 4"')
  await expect(turns()).toHaveCount(before + 1, { timeout: 30_000 })
  const end = turns().last()
  // The account, from the turn's own items: the file, the build its edit started.
  await expect(end.locator('.chat-turn-line').first()).toContainText('hollow.py edited')
  await expect(end.locator('.chat-turn-line').first()).toContainText(/r\d+ → r\d+ ok|r\d+ ok/)
  await end.getByRole('button', { name: 'See changes' }).click()
  const sheet = page.getByRole('dialog', { name: 'Changes in this turn' })
  await expect(sheet).toBeVisible()
  // It covers the view's area and nothing else: not the card, not the dock; and the turn it is about is lit while it is open.
  const area = (await page.locator('[data-region="viewport"]').boundingBox())!
  const box = (await sheet.boundingBox())!
  expect(Math.abs(box.x - area.x)).toBeLessThan(2)
  expect(Math.abs(box.x + box.width - (area.x + area.width))).toBeLessThan(2)
  expect(Math.abs(box.y - area.y)).toBeLessThan(2)
  expect(Math.abs(box.y + box.height - (area.y + area.height))).toBeLessThan(2)
  const docked = (await dock().boundingBox())!
  expect(box.x + box.width).toBeLessThanOrEqual(docked.x + 1)
  await expect(end).toHaveAttribute('data-open', '')
  // The code is below, with the file's tab (its name and how many lines went and came) and the parts' tags above it.
  await expect(sheet.getByRole('button', { name: /^hollow\.py \+\d+ −\d+/ })).toBeVisible()
  // The build before is one press away, through Compare; the build after puts it back. The parts the turn changed carry tags above.
  const scrub = sheet.getByRole('group', { name: 'Build shown' })
  await expect(scrub.getByRole('button')).toHaveCount(2)
  await expect(sheet.locator('[data-tag]').first()).toBeAttached()
  await scrub.getByRole('button').first().click()
  await expect(page.locator('.band[data-band="compare"]')).toBeVisible()
  await scrub.getByRole('button').last().click()
  await expect(page.locator('.band[data-band="compare"]')).toHaveCount(0)
  // Main read the file when the prompt was sent and when the turn ended.
  await expect(sheet.locator('.diff-row[data-kind="removed"]')).toContainText('wall: float = 3', { timeout: 15_000 })
  await expect(sheet.locator('.diff-row[data-kind="added"]')).toContainText('wall: float = 4')
  await sheet.getByRole('button', { name: 'Whole file' }).click()
  await expect(sheet.locator('.changes-whole')).toContainText('wall: float = 4')
  await expect(sheet.locator('.changes-whole')).not.toContainText('wall: float = 3')
  // Escape puts it away, and the build before it drew too, and the focus goes back to the button.
  await scrub.getByRole('button').first().click()
  await expect(page.locator('.band[data-band="compare"]')).toBeVisible()
  await sheet.focus()
  await page.keyboard.press('Escape')
  await expect(sheet).toHaveCount(0)
  await expect(page.locator('.band[data-band="compare"]')).toHaveCount(0)
  await expect(end).not.toHaveAttribute('data-open', '')
  await expect(end.getByRole('button', { name: 'See changes' })).toBeFocused()
  // A turn that edited nothing has no such button.
  await say('say nothing was changed')
  await expect(turns()).toHaveCount(before + 2, { timeout: 30_000 })
  await expect(turns().last().getByRole('button', { name: 'See changes' })).toHaveCount(0)
})

const hollowModel = (): string => join(root, 'hollow', 'hollow.py')
const kept = (): HistoryEntry[] => JSON.parse(readFileSync(join(root, 'hollow', '.torno', 'history', 'index.json'), 'utf8')).entries
const GO_BACK = 'Go back to before this prompt'
/** An item of the turn's More menu (Go back, Star): the menu is opened, and the item is there to press. */
async function moreItem(turn: Locator, name: string): Promise<Locator> {
  await turn.getByRole('button', { name: 'More for this turn', exact: true }).click()
  return turn.getByRole('menuitem', { name, exact: true })
}

test('a turn ends with the builds of its prompt, Compare draws them, Star keeps the last, and a save of the person between turns is a line', async () => {
  await expect(composer()).toBeEnabled()
  const before = await turns().count()
  await say('edit hollow.py "wall: float = 4" "wall: float = 5"')
  await expect(turns()).toHaveCount(before + 1, { timeout: 30_000 })
  const end = turns().last()
  // The buttons; the builds are the strip's, on top of the dock: the build the prompt began from and the one it made are its last two nodes.
  for (const name of ['Compare', 'See changes', 'More for this turn']) await expect(end.getByRole('button', { name, exact: true })).toBeVisible()
  // What the dots hold: Go back and Star, and no Pin to board.
  await moreItem(end, GO_BACK)
  for (const name of [GO_BACK, 'Star']) await expect(end.getByRole('menuitem', { name, exact: true })).toBeVisible()
  await expect(end.getByRole('menuitem', { name: 'Pin to board', exact: true })).toHaveCount(0)
  await page.keyboard.press('Escape')
  await expect(end.getByRole('menu')).toHaveCount(0)
  await openStrip(page)
  const nodes = dock().locator('.strip-node[data-kind="built"]')
  await expect.poll(() => nodes.count(), { timeout: 15_000 }).toBeGreaterThanOrEqual(2)
  const ids = (await nodes.evaluateAll((els) => els.map((el) => el.getAttribute('data-build')!))).slice(-2)

  // Compare: the last build over the one the prompt began from, for this prompt's number; again puts it away.
  await end.getByRole('button', { name: 'Compare', exact: true }).click()
  await expect.poll(async () => (await state()).compare).toMatchObject({ from: ids[0], to: ids[1], mode: 'overlay', prompt: expect.any(Number) })
  await expect(end.getByRole('button', { name: 'Comparing' })).toHaveAttribute('aria-pressed', 'true')
  await end.getByRole('button', { name: 'Comparing' }).click()
  await expect.poll(async () => (await state()).compare).toBeNull()

  // Star: the history's star, on the turn's last build.
  await (await moreItem(end, 'Star')).click()
  await expect(await moreItem(end, 'Unstar')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect.poll(() => kept().find((e) => e.id === ids[1])?.starred).toBe(true)

  // The person saves the model in their own editor: a line between this turn and the next prompt, from the history's cause.
  const saved = kept().length
  writeFileSync(hollowModel(), `${readFileSync(hollowModel(), 'utf8')}\n# saved by the person\n`)
  await expect.poll(() => kept().slice(saved).find((e) => e.cause === 'person'), { timeout: 30_000 }).toBeTruthy()
  await say('say after the save')
  await expect(turns()).toHaveCount(before + 2, { timeout: 30_000 })
  const line = chat().locator('.chat-save').last()
  await expect(line).toContainText('You saved')
  await expect(line).toContainText('in your editor')
  await expect(line.locator('.num').last()).toHaveText(kept().filter((e) => e.cause === 'person').at(-1)!.id)
})

test('"Go back to before this prompt" lists what it will do, puts the file back as it was, and folds the prompt it undid into one faded row', async () => {
  await expect(composer()).toBeEnabled()
  const was = readFileSync(hollowModel(), 'utf8')
  const before = await turns().count()
  const kind = kept().length
  await say('edit hollow.py "wall: float = 5" "wall: float = 7"')
  await expect(turns()).toHaveCount(before + 1, { timeout: 30_000 })
  await expect.poll(() => kept().slice(kind).some((e) => e.cause === 'agent' && !e.failed), { timeout: 30_000 }).toBe(true)
  expect(readFileSync(hollowModel(), 'utf8')).toContain('wall: float = 7')
  const end = turns().last()
  const goBack = await moreItem(end, GO_BACK)
  await expect(goBack).toBeEnabled()
  await goBack.click()
  const ask = end.getByRole('alertdialog', { name: GO_BACK })
  await expect(ask).toContainText('Writes: hollow/hollow.py')
  await expect(ask).toContainText('Undoes prompt')
  // Keeping things as they are changes nothing.
  await ask.getByRole('button', { name: 'Cancel' }).click()
  await expect(ask).toHaveCount(0)
  expect(readFileSync(hollowModel(), 'utf8')).toContain('wall: float = 7')
  await (await moreItem(end, GO_BACK)).click()
  await ask.getByRole('button', { name: 'Go back', exact: true }).click()
  await expect.poll(() => readFileSync(hollowModel(), 'utf8'), { timeout: 30_000 }).toBe(was)
  // The prompt's builds are marked, and the build that followed says what it went back to.
  await expect.poll(() => kept().filter((e) => e.turn && e.undone).length).toBeGreaterThan(0)
  await expect.poll(() => kept().at(-1)).toMatchObject({ cause: 'goback', wentBackTo: expect.stringMatching(/^h\d+$/) })
  // The prompt is one faded row, closed; "Show" opens it as it was.
  const gone = chat().locator('.chat-gone')
  await expect(gone).toContainText('you went back from this')
  await expect(gone.locator('.chat-user')).toHaveCount(0)
  await gone.getByRole('button', { name: 'Show' }).click()
  await expect(gone.locator('.chat-user').last()).toContainText('wall: float = 7')
  await gone.getByRole('button', { name: 'Hide' }).click()
  await expect(gone.locator('.chat-user')).toHaveCount(0)
})

test('with no copy of the build to put back, the same button asks Claude to undo, which asks first and sends a prompt that holds the lines to reverse', async () => {
  await expect(composer()).toBeEnabled()
  // Not while the session works.
  const slow = await turns().count()
  await say('slow 2')
  // (The last turn that has the dots: this one has none yet.)
  await chat().getByRole('button', { name: 'More for this turn', exact: true }).last().click()
  await expect(chat().getByRole('menuitem', { name: GO_BACK, exact: true })).toBeDisabled()
  await page.keyboard.press('Escape')
  await expect(turns()).toHaveCount(slow + 1, { timeout: 30_000 })
  const before = slow + 1
  const kind = kept().length
  await say('edit hollow.py "wall: float = 5" "wall: float = 6"')
  await expect(turns()).toHaveCount(before + 1, { timeout: 30_000 })
  await expect.poll(() => kept().slice(kind).some((e) => e.cause === 'agent' && !e.failed), { timeout: 30_000 }).toBe(true)
  // The copies of the builds before this prompt are gone from the disk: no copy to restore.
  for (const e of kept().slice(0, kind)) rmSync(join(root, 'hollow', '.torno', 'history', e.id, 'source'), { recursive: true, force: true })
  const last = turns().last()
  await (await moreItem(last, GO_BACK)).click()
  const ask = last.getByRole('alertdialog', { name: GO_BACK })
  await expect(ask).toContainText('Claude will be asked to put the files back instead.')
  await ask.getByRole('button', { name: 'Cancel' }).click()
  await expect(ask).toHaveCount(0)
  const users = await chat().locator('.chat-user').count()
  await (await moreItem(last, GO_BACK)).click()
  await ask.getByRole('button', { name: 'Ask Claude' }).click()
  // A note says what was asked and that torno writes nothing; then the prompt, with the lines to reverse, as the person's.
  await expect(chat().locator('.chat-note', { hasText: 'Undo: Claude Code is asked to put hollow.py back' })).toContainText('torno writes nothing')
  await expect(chat().locator('.chat-user')).toHaveCount(users + 1)
  const asked = chat().locator('.chat-user').last()
  await expect(asked).toContainText('Undo your last turn')
  await expect(asked).toContainText('- wall: float = 6')
  await expect(asked).toContainText('+ wall: float = 5')
  await expect(turns()).toHaveCount(before + 2, { timeout: 30_000 })
})

test('a card of look can be gone to as the person\'s own view, and a highlight pointed again after a click put it away', async () => {
  await openListed(page, 'bracket')
  await expect.poll(async () => (await state()).build, { timeout: 30_000 }).toMatchObject({ status: 'ok' })
  // Which way the camera looks: from its position to its target.
  const along = async (): Promise<number[]> => {
    const c = await page.evaluate(() => window.__tornoTest!.camera())
    return c.target.map((t, i) => t - c.position[i])
  }
  await say('tool mcp__torno__look {"view":"front"}')
  const look = chat().locator('.chat-tool[data-torno]').last()
  await expect(look).toHaveAttribute('data-state', 'done', { timeout: 20_000 })
  const before = await along()
  await look.getByRole('button', { name: 'See in view' }).click()
  // The front view looks along +y.
  await expect.poll(async () => { const [x, y] = await along(); return y > Math.abs(x) * 10 + 1e-6 }, { timeout: 5_000 }).toBe(true)
  expect(await along()).not.toEqual(before)
  // The person's own edit, not the agent's `show`: nothing of it is put back.
  expect((await state()).shownByAgent).toBeNull()

  // A highlight: its refs are chips in the line, and "Point again" lights them once a click has put them away.
  await say('tool mcp__torno__highlight {"refs":["base/F1"],"note":"here"}')
  const pointed = chat().locator('.chat-tool[data-torno]').last()
  await expect(pointed).toHaveAttribute('data-state', 'done', { timeout: 20_000 })
  await expect(pointed.locator('.ref-chip[data-ref="base/F1"]')).toHaveCount(1)
  const agentLit = (): Promise<readonly string[]> => page.evaluate(() => window.__tornoTest!.highlighted().agent)
  await expect.poll(agentLit).toEqual(['base/F1'])
  const box = (await canvas().boundingBox())!
  await page.mouse.click(box.x + 4, box.y + 4)
  await expect.poll(agentLit).toEqual([])
  await pointed.getByRole('button', { name: 'Point again' }).click()
  await expect.poll(agentLit).toEqual(['base/F1'])
})

test('a turn\'s tools fold to one line once it has ended, and the agent\'s list of tasks stands above the box while it works', async () => {
  await openListed(page, 'bracket')
  await composer().focus()
  const script = [
    'tool TodoWrite {"todos":[{"content":"Look at the part","status":"in_progress","activeForm":"Looking at the part"},{"content":"Report","status":"pending"}]}',
    'work 2',
    'tool Read {"file_path":"/ws/a.py"}',
    'tool Read {"file_path":"/ws/b.py"}',
    'tool Read {"file_path":"/ws/c.py"}',
    'tool Read {"file_path":"/ws/d.py"}',
    'say that is all'
  ]
  for (const [n, line] of script.entries()) {
    await page.keyboard.type(line)
    if (n < script.length - 1) await page.keyboard.press('Shift+Enter')
  }
  await page.keyboard.press('Enter')
  const turnsBefore = await turns().count()
  // While it works: the list is above the box, with what is being done.
  const bar = chat().locator('.chat-tasks-bar')
  await expect(bar).toContainText('Looking at the part', { timeout: 20_000 })
  await expect(bar).toContainText('0 of 2')
  await expect(bar.locator('.chat-tasks-meter i')).toHaveCount(2)
  // Every line is there while the turn goes on.
  await expect(chat().locator('.chat-fold')).toHaveCount(0)
  // Over: the five lines are one, the list is a card in the transcript and no longer above the box.
  await expect(turns()).toHaveCount(turnsBefore + 1, { timeout: 30_000 })
  await expect(bar).toHaveCount(0)
  const fold = chat().locator('.chat-fold').last()
  await expect(fold.locator('.chat-tool-label')).toHaveText('Bash, Read 4 files')
  await expect(chat().locator('[data-kind="tasks"]').last()).toContainText('Looking at the part')
  const lines = chat().locator('.chat-tool:not(.chat-fold-head)')
  const before = await lines.count()
  await fold.locator('.chat-tool-line').click()
  await expect(lines).toHaveCount(before + 5)
  await expect(fold.locator('.chat-tool[data-state="done"] .chat-tool-state').first()).toHaveText('')
  await fold.locator('.chat-tool-line').first().click()
  await expect(lines).toHaveCount(before)
})
