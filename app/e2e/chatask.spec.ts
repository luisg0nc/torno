import { cpSync, mkdtempSync, readdirSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { _electron as electron, expect, test, type ElectronApplication, type Locator, type Page } from '@playwright/test'
import type { TornoState } from '../src/renderer/state/store'
import { SESSION_HEADER } from '../src/main/http'
import { closePanel, openPanel } from './helpers'
import { objectList, openListed, switcher } from './objects'

// What the chat asks of the person and what it offers: a permission request, the questions of `AskUserQuestion`
// and a plan, each a card that is answered; "Attach view" and "Draw on view"; the `/` commands the CLI named; the model of the session;
// the rate line. The agent is the stand-in in its stream mode (test/fake-agent.mjs). The window is hidden: everything
// is read from the DOM and the store, never from pixels.
const appDir = resolve(__dirname, '..')
const fixtures = resolve(appDir, '../kernel/tests/fixtures/ws')
const fakeAgent = resolve(appDir, 'test/fake-agent.mjs')

test.describe.configure({ mode: 'serial' })

let root: string
let home: string
let app: ElectronApplication
let page: Page

test.beforeAll(async () => {
  root = mkdtempSync(join(realpathSync(tmpdir()), 'torno-e2e-chatask-'))
  home = mkdtempSync(join(realpathSync(tmpdir()), 'torno-e2e-chatask-home-'))
  cpSync(fixtures, root, { recursive: true, filter: (source) => !source.endsWith('__pycache__') })
  // TORNO_TEST=1 makes main create the window with show: false. Never launch without it. The home is a folder of
  // this run: nothing of the settings of the person's own Claude Code may be written there, or anywhere.
  app = await electron.launch({ args: ['.'], cwd: appDir, env: { ...process.env, HOME: home, TORNO_TEST: '1', TORNO_AGENT_CMD: `node ${fakeAgent}`, TORNO_WORKSPACE: root } })
  page = await app.firstWindow()
  await page.waitForSelector('[data-region="left"]')
})

test.afterAll(async () => {
  await app?.close()
  rmSync(root, { recursive: true, force: true })
  rmSync(home, { recursive: true, force: true })
})

const peeked = (): Promise<string[]> => page.evaluate(() => window.__tornoTest!.peeked())
const state = (): Promise<TornoState> => page.evaluate(() => window.__tornoTest!.state())
const dock = () => page.locator('[data-region="session"]')
const chat = () => dock().locator('.chat')
const composer = () => dock().locator('[data-chat-composer]')
const turns = () => chat().locator('.chat-turn')
const asks = () => chat().locator('.chat-ask')
const status = () => dock().getByRole('status').first()

/** Write a prompt in the box and send it, as a person does. */
async function say(prompt: string): Promise<void> {
  await composer().focus()
  await page.keyboard.type(prompt)
  await page.keyboard.press('Enter')
}

/** What a tool of the agent's was given back, opened out. */
async function resultOf(tool: Locator): Promise<string> {
  if ((await tool.locator('.chat-tool-line').getAttribute('aria-expanded')) !== 'true') await tool.locator('.chat-tool-line').click()
  return (await tool.textContent()) ?? ''
}

/** The turns that have ended in this session so far; `finished` waits for one more. */
let ended = 0
async function finished(): Promise<void> {
  ended += 1
  await expect(turns()).toHaveCount(ended)
}

async function newSession(): Promise<void> {
  ended = 0
  await dock().getByRole('button', { name: 'New session' }).click()
  await expect(composer()).toBeEnabled()
}

test('a request to use a tool is a card with the input, answered with Allow, Allow for this session or Deny and a reason', async () => {
  await openListed(page, 'bracket')
  await expect.poll(async () => (await state()).build, { timeout: 30_000 }).toMatchObject({ status: 'ok', revision: 1 })
  await dock().getByRole('button', { name: 'New session' }).click()
  await expect(chat()).toBeVisible()

  await say('ask Bash {"command":"ls"}')
  const card = asks().last()
  await expect(card).toContainText('Claude Code asks to use Bash')
  await expect(card.locator('.chat-ask-input')).toHaveText('ls')
  await expect(card).toHaveAttribute('data-state', 'open')
  await expect(status()).toHaveText('Needs input')
  await expect(card.getByRole('button', { name: 'Allow', exact: true })).toHaveClass(/button-primary/)
  await card.getByRole('button', { name: 'Allow', exact: true }).click()
  await expect(card).toHaveAttribute('data-state', 'allowed')
  await expect(card).toContainText('Allowed')
  await expect(card.getByRole('button')).toHaveCount(0)
  await finished()
  await expect(turns().last()).toContainText('Done in')
  await expect(status()).toHaveText('Idle')
  const allowed = await resultOf(chat().locator('.chat-tool').last())
  expect(allowed).toContain('allowed: {"command":"ls"}')
  // "Allow" alone passes no permission on.
  expect(allowed).not.toContain('permissions:')

  // Write: the file and a few lines of what it will hold. Deny, with a reason.
  await say('ask Write {"file_path":"notes/a.txt","content":"one\\ntwo\\nthree\\nfour\\nfive\\nsix\\nseven\\neight"}')
  const write = asks().last()
  await expect(write).toContainText('Claude Code asks to use Write')
  await expect(write.locator('.chat-ask-input')).toContainText('notes/a.txt')
  await expect(write.locator('.chat-ask-input')).toContainText('three')
  await expect(write.locator('.chat-ask-input')).not.toContainText('eight')
  // The rest of it can be seen before it is allowed.
  await write.getByRole('button', { name: /^Show all/ }).click()
  await expect(write.locator('.chat-ask-input')).toContainText('eight')
  await expect(write.getByRole('button', { name: /^Show all/ })).toHaveCount(0)
  await write.getByLabel('Tell Claude Code what to do instead (optional)').fill('not there, please')
  await write.getByRole('button', { name: 'Deny', exact: true }).click()
  await expect(write).toHaveAttribute('data-state', 'denied')
  await expect(write).toContainText('Denied')
  await finished()
  expect(await resultOf(chat().locator('.chat-tool').last())).toContain('denied: not there, please')

  // Deny with nothing typed says so in a sentence of its own. An Edit is the line removed and the line added.
  await say('ask Edit {"file_path":"b.txt","old_string":"WALL = 2\\nLID = 1","new_string":"WALL = 3\\nLID = 1"}')
  const edit = asks().last()
  await expect(edit).toContainText('Claude Code asks to use Edit')
  await expect(edit.locator('.chat-ask-input .diff del')).toHaveText('WALL = 2')
  await expect(edit.locator('.chat-ask-input .diff ins')).toHaveText('WALL = 3')
  await expect(edit.locator('.chat-ask-input .diff-sign')).toHaveText(['−', '+', ''])
  // Its lines are the edit's, not the file's, and the card says so; no replace_all, so nothing of every match.
  await expect(edit.locator('.diff-caption')).toHaveText('Lines of the edit, not of the file: where it lands is not shown')
  await expect(edit.locator('.diff-note')).toHaveCount(1)
  await edit.getByRole('button', { name: 'Deny', exact: true }).click()
  await finished()
  expect(await resultOf(chat().locator('.chat-tool').last())).toContain('denied: The person denied this.')
  // The tool card, opened, shows the same lines in place of the JSON.
  const denied = chat().locator('.chat-tool').last()
  await expect(denied.locator('.diff del')).toHaveText('WALL = 2')
  await expect(denied.locator('.diff ins')).toHaveText('WALL = 3')
  await expect(denied).not.toContainText('old_string')

  // A MultiEdit is one block for each of its edits, numbered.
  await say('ask MultiEdit {"file_path":"b.txt","edits":[{"old_string":"WALL = 2","new_string":"WALL = 3","replace_all":true},{"old_string":"LID = 1","new_string":"LID = 2"}]}')
  const multi = asks().last()
  // An edit that replaces every match says so, and only that one.
  await expect(multi.locator('.diff-note:not(.diff-caption)')).toHaveText('Replaces every match in the file, of which one is shown')
  await expect(multi.locator('.diff-title')).toHaveText(['Edit 1 of 2', 'Edit 2 of 2'])
  await expect(multi.locator('.diff del')).toHaveText(['WALL = 2', 'LID = 1'])
  await expect(multi.locator('.diff ins')).toHaveText(['WALL = 3', 'LID = 2'])
  await multi.getByRole('button', { name: 'Deny', exact: true }).click()
  await finished()

  // Allow for this session passes on the rule the CLI suggested, as a rule of the session. Of the three kinds it suggests
  // (a rule for the settings of the folder, a directory, a mode) the others are not passed on.
  await say('ask Bash {"command":"pwd","description":"Show the folder","blocked_path":"/work/obj/pwd"}')
  const always = asks().last()
  // The request's words, and its path in the monospace face.
  await expect(always.locator('.chat-ask-why')).toHaveText('Show the folder')
  await expect(always.locator('.chat-ask-path .chat-ask-lead')).toHaveText('/work/obj/pwd')
  await always.getByRole('button', { name: 'Allow for this session', exact: true }).click()
  await expect(always).toContainText('Allowed')
  await finished()
  expect(await resultOf(chat().locator('.chat-tool').last())).toContain('permissions: [{"type":"addRules","rules":[{"toolName":"Bash"}],"behavior":"allow","destination":"session"}]')
})

test('a card takes the focus only when nothing is being written: not from a prompt in the box', async () => {
  // Sent with the button: the box is empty and has not the focus, so the card has it.
  await composer().focus()
  await page.keyboard.type('ask Bash {"command":"date"}')
  await dock().getByRole('button', { name: 'Send', exact: true }).click()
  const card = asks().last()
  await expect(card).toHaveAttribute('data-state', 'open')
  await expect(card).toBeFocused()
  await card.getByRole('button', { name: 'Allow', exact: true }).click()
  await expect(card).toHaveAttribute('data-state', 'allowed')
  await finished()

  // The next prompt is being written when the request comes: the box keeps the focus.
  await composer().focus()
  await page.keyboard.type('slow 1')
  await page.keyboard.press('Shift+Enter')
  await page.keyboard.type('ask Bash {"command":"id"}')
  await page.keyboard.press('Enter')
  await page.keyboard.type('draft')
  const late = asks().last()
  await expect(late).toHaveAttribute('data-state', 'open', { timeout: 10_000 })
  await expect(composer()).toBeFocused()
  await expect(composer()).toHaveValue('draft')
  await late.getByRole('button', { name: 'Allow', exact: true }).click()
  await expect(late).toHaveAttribute('data-state', 'allowed')
  await finished()
  await composer().fill('')
})

test('the questions of AskUserQuestion are one card: radio-like buttons, toggles joined by a comma, an Other line, and Submit once all are answered', async () => {
  const input = {
    questions: [
      { question: 'Which wall?', header: 'Wall', multiSelect: false, options: [{ label: '2 mm', description: 'thin' }, { label: '3 mm', description: 'thick' }] },
      { question: 'Finish?', header: 'Finish', multiSelect: true, options: [{ label: 'Matte', description: 'dull' }, { label: 'Gloss', description: 'shiny' }, { label: 'Brushed', description: 'lined' }] }
    ]
  }
  await say(`ask AskUserQuestion ${JSON.stringify(input)}`)
  const card = asks().last()
  await expect(card).toContainText('Which wall?')
  await expect(card).toContainText('Finish?')
  await expect(card).toContainText('thick')
  const submit = card.getByRole('button', { name: 'Submit', exact: true })
  await expect(submit).toBeDisabled()
  await expect(status()).toHaveText('Needs input')

  // One of a single choice: choosing another takes the first back.
  await card.getByRole('button', { name: /^2 mm/ }).click()
  await card.getByRole('button', { name: /^3 mm/ }).click()
  await expect(card.getByRole('button', { name: /^2 mm/ })).toHaveAttribute('aria-pressed', 'false')
  await expect(card.getByRole('button', { name: /^3 mm/ })).toHaveAttribute('aria-pressed', 'true')
  await expect(submit).toBeDisabled()
  // As many as are toggled on, joined.
  await card.getByRole('button', { name: /^Matte/ }).click()
  await card.getByRole('button', { name: /^Gloss/ }).click()
  await card.getByRole('button', { name: /^Brushed/ }).click()
  await card.getByRole('button', { name: /^Brushed/ }).click()
  await expect(submit).toBeEnabled()
  await submit.click()
  await expect(card).toHaveAttribute('data-state', 'allowed')
  await expect(card).toContainText('Which wall?')
  await expect(card).toContainText('3 mm')
  await expect(card).toContainText('Matte, Gloss')
  await finished()
  expect(await resultOf(chat().locator('.chat-tool').last())).toContain('"answers":{"Which wall?":"3 mm","Finish?":"Matte, Gloss"}')

  // The Other line is an answer of its own: its text, in place of what was chosen.
  await say(`ask AskUserQuestion ${JSON.stringify({ questions: [input.questions[0]] })}`)
  const other = asks().last()
  await other.getByRole('button', { name: /^2 mm/ }).click()
  await other.getByLabel('Other answer to Which wall?').fill('2.5 mm')
  await expect(other.getByRole('button', { name: /^2 mm/ })).toHaveAttribute('aria-pressed', 'false')
  await other.getByRole('button', { name: 'Submit', exact: true }).click()
  await finished()
  expect(await resultOf(chat().locator('.chat-tool').last())).toContain('"answers":{"Which wall?":"2.5 mm"}')
})

test('a question the window cannot draw says so and can be refused', async () => {
  await say('ask AskUserQuestion {"questions":[{"header":"no text"}]}')
  const card = asks().last()
  await expect(card).toContainText('The question could not be shown')
  await expect(card.getByRole('button', { name: 'Submit' })).toHaveCount(0)
  await card.getByRole('button', { name: 'Deny', exact: true }).click()
  await finished()
  expect(await resultOf(chat().locator('.chat-tool').last())).toContain('denied: The person could not be shown the question.')
})

test('a plan is drawn as markdown, approved or kept for more planning with a reason', async () => {
  await say('ask ExitPlanMode {"plan":"# The plan\\n- widen the wall\\n- rebuild"}')
  const plan = asks().last()
  await expect(plan).toContainText('Claude Code asks to leave plan mode')
  await expect(plan.locator('li')).toHaveCount(2)
  await expect(plan.locator('li').first()).toHaveText('widen the wall')
  await expect(plan.getByRole('button', { name: 'Allow', exact: true })).toHaveCount(0)
  await plan.getByLabel('Tell Claude Code what to do instead (optional)').fill('make it 3 mm')
  await plan.getByRole('button', { name: 'Keep planning', exact: true }).click()
  await expect(plan).toHaveAttribute('data-state', 'denied')
  await finished()
  expect(await resultOf(chat().locator('.chat-tool').last())).toContain('denied: make it 3 mm')
  // Refused by the person: "denied", not "failed".
  await expect(chat().locator('.chat-tool').last().locator('.chat-tool-state')).toHaveText('denied')

  await say('ask ExitPlanMode {"plan":"- just do it"}')
  const again = asks().last()
  await again.getByRole('button', { name: 'Approve plan', exact: true }).click()
  await expect(again).toContainText('Approved')
  await finished()
  expect(await resultOf(chat().locator('.chat-tool').last())).toContain('allowed: {"plan":"- just do it"}')
})

test('while a card waits, what is written is the answer: "Deny and send"; Enter on the card allows; Ctrl+C in an empty box stops the turn', async () => {
  // Text in the box with a permission open: the primary button refuses with it.
  await say('ask Write {"file_path":"c.txt","content":"one"}')
  const write = asks().last()
  await expect(write).toHaveAttribute('data-state', 'open')
  await expect(composer()).toHaveAttribute('placeholder', 'Answer the card above, or say what to do instead')
  await composer().fill('thicker than that, please')
  await expect(dock().getByRole('button', { name: 'Deny and send' })).toHaveClass(/button-primary/)
  await expect(dock().getByRole('button', { name: 'Queue' })).not.toHaveClass(/button-primary/)
  await dock().getByRole('button', { name: 'Deny and send' }).click()
  await expect(write).toHaveAttribute('data-state', 'denied')
  await expect(write).toContainText('thicker than that, please')
  await expect(composer()).toHaveValue('')
  await finished()
  expect(await resultOf(chat().locator('.chat-tool').last())).toContain('denied: thicker than that, please')
  await expect(dock().getByRole('button', { name: 'Deny and send' })).toHaveCount(0)

  // Enter in the box does what the primary button does.
  await say('ask Write {"file_path":"d.txt","content":"two"}')
  const again = asks().last()
  await expect(again).toHaveAttribute('data-state', 'open')
  await composer().fill('no, shorter')
  await composer().press('Enter')
  await expect(again).toHaveAttribute('data-state', 'denied')
  await finished()
  expect(await resultOf(chat().locator('.chat-tool').last())).toContain('denied: no, shorter')

  // Enter on the card itself allows.
  await say('ask Bash {"command":"ls"}')
  const bash = asks().last()
  await expect(bash).toHaveAttribute('data-state', 'open')
  await bash.focus()
  await page.keyboard.press('Enter')
  await expect(bash).toHaveAttribute('data-state', 'allowed')
  await finished()

  // Ctrl+C with nothing selected in the box stops the turn.
  await say('slow 5')
  await expect(status()).toHaveText('Working')
  await composer().focus()
  await page.keyboard.press('Control+C')
  await expect(turns().last()).toContainText('Stopped', { timeout: 2000 })
  await finished()
})

test('/compact is a prompt that is sent, a quiet note with the tokens, and a turn; the session is idle after it', async () => {
  await say('/compact')
  await expect(chat().locator('.chat-note', { hasText: 'Conversation compacted: 29,569 → 3,637 tokens' })).toHaveCount(1)
  await expect(chat().locator('.chat-note', { hasText: 'Conversation compacted' }).locator('.num')).toHaveText(['29,569', '3,637'])
  await finished()
  await expect(status()).toHaveText('Idle')
})

test('a request still open when the session is ended is closed: ending interrupts, and the CLI gives the request up', async () => {
  await say('ask Bash {"command":"sleep 100"}')
  const card = asks().last()
  await expect(card).toHaveAttribute('data-state', 'open')
  await dock().getByRole('button', { name: 'End session' }).click()
  // Ending a session that waits for an answer asks first.
  await page.getByRole('button', { name: 'End it', exact: true }).click()
  await expect(status()).toHaveText('Ended')
  await expect(card).toHaveAttribute('data-state', 'ended')
  // The interrupt that goes before the end is what the CLI answers by cancelling the request; a request it left open says the session ended.
  await expect(card).toContainText(/Cancelled: the turn was stopped|Not answered: the session ended/)
  await expect(card.getByRole('button')).toHaveCount(0)
})

/** Waits until the camera has stopped (a view the agent showed is flown to): a drawing made on a camera on its way is not worked out. */
async function cameraSettled(): Promise<void> {
  let last = ''
  await expect.poll(async () => {
    const now = JSON.stringify(await page.evaluate(() => window.__tornoTest!.camera()))
    const same = now === last
    last = now
    await page.waitForTimeout(250)
    return same
  }, { timeout: 15_000 }).toBe(true)
}

test('Attach view adds a picture of the viewport at 1280 px to the next prompt only, and the prompt shows it', async () => {
  await newSession()
  const attach = dock().getByRole('button', { name: 'Attach view' })
  await expect(attach).toHaveAttribute('aria-pressed', 'false')
  await attach.click()
  await expect(attach).toHaveAttribute('aria-pressed', 'true')
  // The picture the send would take is shown before it is sent, with a way to take it away.
  const attached = dock().getByRole('group', { name: 'View attached' })
  await expect(attached.locator('img')).toBeVisible()
  expect(await attached.locator('img').evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(100)
  await attached.getByRole('button', { name: 'Remove' }).click()
  await expect(attached).toHaveCount(0)
  await expect(attach).toHaveAttribute('aria-pressed', 'false')
  await attach.click()
  await expect(attached.locator('img')).toBeVisible()
  // The view moves after the press (the agent's `show`): the picture shown is still the one that goes.
  const before = await attached.locator('img').getAttribute('src')
  await app.evaluate(({ BrowserWindow }, req) => BrowserWindow.getAllWindows()[0].webContents.send('view:show', { id: 987700, request: req }), { objectId: 'bracket', view: 'top' })
  await expect.poll(async () => (await page.evaluate(() => window.__tornoTest!.camera())).position[2]).toBeGreaterThan(0)
  expect(await attached.locator('img').getAttribute('src')).toBe(before)
  await say('images')
  // Off after each send, the preview with it.
  await expect(attach).toHaveAttribute('aria-pressed', 'false')
  await expect(attached).toHaveCount(0)
  // The standard view again, for what follows.
  await app.evaluate(({ BrowserWindow }, req) => BrowserWindow.getAllWindows()[0].webContents.send('view:show', { id: 987702, request: req }), { objectId: 'bracket', view: 'iso' })
  await cameraSettled()
  const user = chat().locator('.chat-user').first()
  await expect(user.locator('.chat-thumb')).toHaveCount(1, { timeout: 20_000 })
  await expect(chat().locator('.chat-text').first()).toContainText(/images: 1 (1280x\d+|\d+x1280)/, { timeout: 20_000 })
  await expect(turns().first()).toContainText('Done in')

  // The next prompt carries none.
  await say('images')
  await expect(chat().locator('.chat-text').last()).toContainText('images: 0')
  await expect(chat().locator('.chat-user').last().locator('.chat-thumb')).toHaveCount(0)
})

/** Draws a line on the board between two fractions of its canvas, with real pointer events. */
async function line(board: Locator, from: [number, number], to: [number, number]): Promise<void> {
  const box = (await board.locator('canvas').boundingBox())!
  await page.mouse.move(box.x + box.width * from[0], box.y + box.height * from[1])
  await page.mouse.down()
  await page.mouse.move(box.x + box.width * to[0], box.y + box.height * to[1], { steps: 10 })
  await page.mouse.up()
}
const drawingBoard = () => page.getByRole('dialog', { name: 'Drawing on the view' })
const drawButton = () => dock().getByRole('button', { name: 'Draw on view' })
const waiting = () => dock().getByRole('group', { name: 'Drawing on the view' })

test('Draw on view: a board over the agent\'s picture of the view; the drawing goes with the next prompt only, with what its ink lies over', async () => {
  // A point of the canvas over a part: the same fraction of the picture is over it too (one camera, one aspect).
  const spot = await page.evaluate(() => {
    for (const fy of [0.5, 0.45, 0.55, 0.4, 0.6, 0.35, 0.65]) {
      for (const fx of [0.5, 0.45, 0.55, 0.4, 0.6, 0.35, 0.65]) {
        const hit = window.__tornoTest!.pickAt(fx, fy, { edges: false })
        if (hit) return { fx, fy, part: hit.part }
      }
    }
    return null
  })
  expect(spot).not.toBeNull()
  const { fx, fy, part } = spot!
  // The turns of this session so far: `finished` waits for one more.
  ended = await turns().count()

  await drawButton().click()
  await expect(drawingBoard()).toBeVisible()
  const canvas = drawingBoard().locator('canvas')
  expect(Math.max(Number(await canvas.getAttribute('width')), Number(await canvas.getAttribute('height')))).toBe(1280)
  await line(drawingBoard(), [fx - 0.01, fy], [fx + 0.01, fy])
  await expect(canvas).toHaveAttribute('data-strokes', '1')
  // Escape asks before what was drawn is thrown away; "Keep drawing" goes on.
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: 'Keep drawing' }).click()
  await expect(drawingBoard()).toBeVisible()
  await drawingBoard().getByRole('button', { name: 'Done' }).click()
  await expect(drawingBoard()).toHaveCount(0)
  await expect(waiting()).toBeVisible()
  await expect(drawButton()).toBeDisabled()
  // What the ink lies over is told before it is sent, as chips that are live: a face of the part drawn across, lit in the view by the pointer.
  const over = waiting().locator('.over[data-over="known"]')
  await expect(over).toContainText('Over')
  const face = over.locator(`.ref-chip[data-ref^="${part}/F"]`).first()
  await expect(face).toBeVisible()
  const ref = (await face.getAttribute('data-ref'))!
  expect(await peeked()).toEqual([])
  await face.hover()
  await expect.poll(peeked).toEqual([ref])
  await page.mouse.move(0, 0)
  await expect.poll(peeked).toEqual([])
  // The keys are the box's again: what is typed next is the prompt, not a key of the view.
  await page.keyboard.type('thicker')
  await expect(composer()).toHaveValue('thicker')
  await composer().fill('')

  await say('images')
  await expect(waiting()).toHaveCount(0)
  const user = chat().locator('.chat-user').last()
  await expect(user.locator('.chat-thumb')).toHaveCount(1, { timeout: 20_000 })
  await expect(user).not.toContainText('Picture:')
  // The prompt shows the same line under its picture; the caption's words are not among its text.
  await expect(user.locator('.chat-user-drawing')).toContainText('Over')
  await expect(user.locator('.chat-user-drawing').locator(`.ref-chip[data-ref="${ref}"]`)).toBeVisible()
  await expect(user.locator('.chat-user-drawing')).not.toContainText('stroke 1, x')
  // The stand-in says the size of each picture, then each line of the caption.
  await expect(chat()).toContainText(/images: 1 (1280x\d+|\d+x1280)/, { timeout: 20_000 })
  await expect(chat()).toContainText('Picture: the view as the person saw it when they drew on it')
  await expect(chat()).toContainText('Under the ink, stroke by stroke')
  await expect(chat()).toContainText(new RegExp(`stroke 1, x \\d+–\\d+, y \\d+–\\d+: ${part}/F\\d+`))
  await finished()
  await expect(drawButton()).toBeEnabled()

  // The next prompt carries none.
  await say('images')
  await expect(chat().locator('.chat-text').last()).toContainText('images: 0')
  await finished()
})

test('a stroke across a part and bare ground says it is partly over no part, before it is sent and under the prompt', async () => {
  const fy = await page.evaluate(() => {
    for (const fy of [0.5, 0.45, 0.55, 0.4, 0.6, 0.35, 0.65]) if (window.__tornoTest!.pickAt(0.5, fy, { edges: false })) return fy
    return null
  })
  expect(fy).not.toBeNull()
  ended = await turns().count()
  await drawButton().click()
  await expect(drawingBoard()).toBeVisible()
  // From the edge of the picture, where nothing is, across the part.
  await line(drawingBoard(), [0.01, fy!], [0.5, fy!])
  await drawingBoard().getByRole('button', { name: 'Done' }).click()
  await expect(waiting().locator('.over[data-over="known"]')).toContainText('stroke 1 partly over no part')
  await say('images')
  await expect(chat().locator('.chat-user').last().locator('.chat-user-drawing')).toContainText('stroke 1 partly over no part', { timeout: 20_000 })
  await finished()
})

test('a drawing made while the camera moved says that what its ink lies over was not worked out, and "Draw again" starts anew', async () => {
  await drawButton().click()
  await expect(drawingBoard()).toBeVisible()
  // The agent's `show` moves the view under the board.
  const show = (request: object): Promise<void> => app.evaluate(({ BrowserWindow }, req) => BrowserWindow.getAllWindows()[0].webContents.send('view:show', { id: 987701, request: req }), request)
  await show({ objectId: 'bracket', view: 'top' })
  await expect.poll(async () => (await page.evaluate(() => window.__tornoTest!.camera())).position[2]).toBeGreaterThan(0)
  await line(drawingBoard(), [0.45, 0.5], [0.55, 0.5])
  await drawingBoard().getByRole('button', { name: 'Done' }).click()
  await expect(waiting()).toBeVisible()
  const warn = waiting().locator('.over-warn')
  await expect(warn).toContainText('was not worked out')
  await expect(waiting().locator('.ref-chip')).toHaveCount(0)
  // It is shown in the colour of a warning.
  const [own, wanted] = await warn.evaluate((el) => {
    const probe = document.createElement('i')
    probe.style.color = 'var(--warn)'
    document.body.append(probe)
    const colour = getComputedStyle(probe).color
    probe.remove()
    return [getComputedStyle(el).color, colour]
  })
  expect(own).toBe(wanted)
  await waiting().getByRole('button', { name: 'Draw again' }).click()
  // The drawing is gone, and the board is open over a new picture.
  await expect(drawingBoard()).toBeVisible()
  await expect(waiting()).toHaveCount(0)
  await page.keyboard.press('Escape')
  await expect(drawingBoard()).toHaveCount(0)
  await show({ objectId: 'bracket', view: 'iso' })
  await cameraSettled()
})

test('a drawing waits in the composer: Edit opens it with its strokes, Remove takes it away, and a board discarded keeps nothing', async () => {
  await drawButton().click()
  await line(drawingBoard(), [0.2, 0.2], [0.4, 0.3])
  await drawingBoard().getByRole('button', { name: 'Done' }).click()
  await waiting().getByRole('button', { name: 'Edit' }).click()
  await expect(drawingBoard().locator('canvas')).toHaveAttribute('data-strokes', '1')
  // Nothing drawn since it was opened: Escape puts it away without asking, and the drawing still waits.
  await page.keyboard.press('Escape')
  await expect(drawingBoard()).toHaveCount(0)
  await expect(waiting()).toBeVisible()
  await waiting().getByRole('button', { name: 'Remove' }).click()
  await expect(waiting()).toHaveCount(0)

  // A board with a stroke that is discarded leaves nothing waiting.
  await drawButton().click()
  await line(drawingBoard(), [0.2, 0.2], [0.4, 0.3])
  await drawingBoard().getByRole('button', { name: 'Cancel' }).click()
  await page.getByRole('button', { name: 'Discard', exact: true }).click()
  await expect(drawingBoard()).toHaveCount(0)
  await expect(waiting()).toHaveCount(0)
  // Put away too, the board gives the keys back to the box.
  await page.keyboard.type('never mind')
  await expect(composer()).toHaveValue('never mind')
  await composer().fill('')
})

test('ink over the face a section cuts is told as the cut face of its part, not as over no part', async () => {
  await page.locator('[data-region="viewport"] canvas').first().click({ position: { x: 5, y: 5 } })
  await page.keyboard.press('x')
  await expect.poll(async () => (await state()).section !== null).toBe(true)
  // A point of the canvas where the view shows a cut face: what the drawing is told is there.
  const spot = await page.evaluate(() => {
    for (let fy = 0.3; fy <= 0.7; fy += 0.025) {
      for (let fx = 0.3; fx <= 0.7; fx += 0.025) {
        const under = window.__tornoTest!.underAt(fx, fy)
        if (under && 'cut' in under) return { fx, fy, part: under.cut }
      }
    }
    return null
  })
  expect(spot).not.toBeNull()
  const { fx, fy, part } = spot!
  ended = await turns().count()
  await drawButton().click()
  await line(drawingBoard(), [fx - 0.005, fy], [fx + 0.005, fy])
  await drawingBoard().getByRole('button', { name: 'Done' }).click()
  await expect(waiting()).toBeVisible()
  await expect(waiting().locator('.over')).toContainText(`the cut face of ${part}`)
  await say('images')
  await expect(chat()).toContainText(new RegExp(`stroke 1, x \\d+–\\d+, y \\d+–\\d+: (.*, )?the cut face of ${part}`), { timeout: 20_000 })
  await finished()
})

test('typing a / command offers the commands the CLI named: arrows choose, Tab or a click completes to the name and a space', async () => {
  await composer().focus()
  await page.keyboard.type('/co')
  const offered = chat().getByRole('listbox', { name: 'Commands' })
  await expect(offered).toBeVisible()
  await expect(offered.getByRole('option')).toHaveCount(1)
  await expect(offered.getByRole('option').first()).toContainText('compact')
  await expect(offered.getByRole('option').first()).toContainText('Compact the conversation')
  await page.keyboard.press('Tab')
  await expect(composer()).toHaveValue('/compact ')
  await expect(composer()).toBeFocused()
  // A space after the word: it is an argument now, and nothing is offered.
  await expect(offered).toHaveCount(0)

  await composer().fill('/c')
  await expect(offered.getByRole('option')).toHaveCount(2)
  await expect(offered.getByRole('option').first()).toHaveAttribute('aria-selected', 'true')
  await page.keyboard.press('ArrowDown')
  await expect(offered.getByRole('option').nth(1)).toHaveAttribute('aria-selected', 'true')
  await page.keyboard.press('Tab')
  await expect(composer()).toHaveValue('/clear ')

  await composer().fill('/')
  await offered.getByRole('option', { name: /compact/ }).click()
  await expect(composer()).toHaveValue('/compact ')
  await expect(composer()).toBeFocused()
  // Text that is no command word offers nothing.
  await composer().fill('see /co')
  await expect(offered).toHaveCount(0)
  await composer().fill('/zzz')
  await expect(offered).toHaveCount(0)
  await composer().fill('')
})

test('the model menu lists what the CLI offers, changes the model of the session only, and writes nothing under the home', async () => {
  const menu = dock().getByRole('combobox', { name: 'Model' })
  await expect(menu.locator('option')).toHaveText(['fake-model', 'Default', 'Haiku'])
  await expect(menu).toHaveValue('fake-model')
  await menu.selectOption({ label: 'Haiku' })
  // The next answer says it was given by the model chosen.
  await say('say with the new model')
  await expect(turns().last()).toContainText('Done in')
  await expect(menu).toHaveValue('haiku')
  // Nothing of Claude Code's settings was written, here or in the home of this run.
  const found: string[] = []
  const walk = (dir: string, depth: number): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (/claude/i.test(entry.name)) found.push(join(dir, entry.name))
      if (entry.isDirectory() && depth < 3) walk(join(dir, entry.name), depth + 1)
    }
  }
  walk(home, 0)
  expect(found).toEqual([])
})

test('the effort menu offers what the model takes, and sets the effort of the session only', async () => {
  const menu = dock().getByRole('combobox', { name: 'Effort' })
  // The person's default until one is chosen; the model is Haiku now, which the CLI says takes three.
  await expect(menu).toHaveValue('')
  await expect(menu.locator('option')).toHaveText(['Default effort', 'Low', 'Medium', 'High'])
  await menu.selectOption({ label: 'Medium' })
  await expect(menu).toHaveValue('medium')
  await expect(chat().locator('.chat-note').last()).toContainText('Effort: medium')
  await say('say with the new effort')
  await expect(turns().last()).toContainText('Done in')
  await expect(menu).toHaveValue('medium')
})

test('the edits menu sets how edits are asked for this session only, and the CLI reports it', async () => {
  const menu = dock().getByRole('combobox', { name: 'Edits' })
  await expect(menu.locator('option')).toHaveText(['Ask before edits', 'Accept edits', 'Plan only'])
  await menu.selectOption({ label: 'Accept edits' })
  await expect(menu).toHaveValue('acceptEdits')
  await expect(chat().locator('.chat-note').last()).toContainText('Edits: accept edits')
  await say('say with the new mode')
  await expect(turns().last()).toContainText('Done in')
  await expect(menu).toHaveValue('acceptEdits')
})

test('the foot says, quietly, when a window of the rate limit is half used or more', async () => {
  await expect(chat().locator('.chat-rate')).toHaveCount(0)
  await say('rate 72')
  const line = chat().locator('.chat-rate')
  await expect(line).toContainText('5-hour limit: 72 % used, resets at ')
  await expect(line).toContainText(/resets at \d{1,2}[:.]\d{2}/)
  await expect(line.locator('.num').first()).toBeVisible()
  await expect(turns().last()).toContainText('Done in')
  await say('rate 30')
  await expect(line).toHaveCount(0)
})

test('Stop with a request open: the card reads cancelled, has no buttons, and the session is idle', async () => {
  await newSession()
  await say('ask Bash {"command":"ls"}')
  const card = asks().last()
  await expect(card).toHaveAttribute('data-state', 'open')
  await expect(status()).toHaveText('Needs input')
  await dock().getByRole('button', { name: 'Stop' }).click()
  // The CLI gives the request up (control_cancel_request) and ends the turn.
  await expect(card).toHaveAttribute('data-state', 'ended')
  await expect(card.locator('.chat-ask-outcome')).toHaveText('Cancelled: the turn was stopped')
  await expect(card.getByRole('button')).toHaveCount(0)
  await finished()
  // Its tool reads "cancelled", not "failed".
  await expect(chat().locator('.chat-tool').last().locator('.chat-tool-state')).toHaveText('cancelled')
  await expect(turns().last()).toContainText('Stopped')
  await expect(status()).toHaveText('Idle')
  // The next request works as before: answered, it is allowed, and the session goes idle again.
  await say('ask Bash {"command":"pwd"}')
  const next = asks().last()
  await expect(next).toHaveAttribute('data-state', 'open')
  await next.getByRole('button', { name: 'Allow', exact: true }).click()
  await finished()
  await expect(status()).toHaveText('Idle')
})

test('a request that waits for the person shows on the dock\'s toggle when the dock is hidden, and on its row and in the status line when another object is open; the signs go when it is answered', async () => {
  const toggle = () => page.locator('.dock-toggle')
  const item = (name: string) => objectList(page).getByRole('button', { name, exact: true })
  const needs = () => page.locator('.status-needs')
  await newSession()
  await say('ask Bash {"command":"ls"}')
  const card = asks().last()
  await expect(card).toHaveAttribute('data-state', 'open')
  await expect(status()).toHaveText('Needs input')
  // The dock shown: its pane says it, the toggle has no dot.
  await expect(toggle().locator('.session-sign')).toHaveCount(0)

  // The dock hidden: the dot is on the toggle, and its name says what it is.
  await toggle().click()
  await expect(dock()).toBeHidden()
  await expect(toggle()).toHaveAttribute('aria-label', 'Show session')
  await expect(toggle()).toHaveAttribute('aria-description', 'Claude Code needs you')
  await expect(toggle()).toHaveAttribute('title', 'Show session: Claude Code needs you')
  await expect(toggle().locator('.session-sign[data-sign="needs_input"]')).toBeVisible()
  // The rail's Projects icon says it as well, of the open object, in words, and the status line has the button.
  await expect(switcher(page)).toHaveAttribute('aria-description', 'session needs you')
  // Its name is Projects: found by it exactly, state or none.
  await expect(page.getByRole('button', { name: 'Projects', exact: true })).toHaveCount(1)
  await expect(needs()).toContainText('bracket needs you')

  // Another object shown: the Projects icon carries the sign of the one that asks, and names it; so does its row of
  // the list; and the toggle (of an object with no session) has none.
  await openListed(page, 'hollow')
  await expect.poll(async () => (await state()).objectId).toBe('hollow')
  await expect(switcher(page)).toHaveAttribute('data-session', 'needs_input')
  await expect(switcher(page)).toHaveAttribute('aria-description', 'bracket needs you')
  await openPanel(page, 'Projects')
  await expect(item('bracket')).toHaveAttribute('data-session', 'needs_input')
  await expect(item('bracket')).toHaveAttribute('aria-description', 'session needs you')
  await expect(item('hollow')).not.toHaveAttribute('data-session', /./)
  await closePanel(page)
  await expect(toggle()).toHaveAttribute('aria-label', 'Show session')
  await expect(toggle().locator('.session-sign')).toHaveCount(0)
  await expect(needs()).toContainText('bracket needs you')

  // The button of the status line opens the object, shows the dock and goes to the card.
  await needs().click()
  await expect.poll(async () => (await state()).objectId).toBe('bracket')
  await expect(dock()).toBeVisible()
  await expect(card).toBeFocused()

  // Answered: every sign goes.
  await card.getByRole('button', { name: 'Allow', exact: true }).click()
  await finished()
  await expect(status()).toHaveText('Idle')
  await expect(needs()).toHaveCount(0)
  await expect(switcher(page)).not.toHaveAttribute('data-session', /./)
  await expect(switcher(page)).not.toHaveAttribute('aria-description', /./)
  await toggle().click()
  await expect(toggle()).toHaveAttribute('aria-label', 'Show session')
  await expect(toggle()).not.toHaveAttribute('aria-description', /./)
  await expect(toggle().locator('.session-sign')).toHaveCount(0)
  await toggle().click()
  await expect(dock()).toBeVisible()
})

// #132: the agent's own `ask` is a card of torno's in the chat, above the box, and the session needs input while it is open.
test('ask is a card above the box of the chat, the session needs input meanwhile, and the option clicked is what the tool returns', async () => {
  await openListed(page, 'bracket')
  if (await dock().getByRole('button', { name: 'New session' }).isVisible()) await newSession()
  await expect(composer()).toBeEnabled()
  await expect(status()).toHaveText('Idle')
  const { url, token } = await app.evaluate((_electron, id) => (globalThis as unknown as { __tornoMain: { mcpFor(id: string): { url: string; token: string } } }).__tornoMain.mcpFor(id), 'bracket')
  const client = new Client({ name: 'torno-e2e', version: '0' })
  await client.connect(new StreamableHTTPClientTransport(new URL(url), { requestInit: { headers: { [SESSION_HEADER]: token } } }))
  try {
    const waiting = client.callTool({ name: 'ask', arguments: { question: 'Which wall do you mean?', options: [{ label: 'The left wall', refs: ['base/F1'] }, { label: 'The right wall', refs: ['base/F2'] }] } })
    const card = chat().locator('.ask-question')
    await expect(card).toBeVisible()
    await expect(card.locator('.ask-text')).toHaveText('Which wall do you mean?')
    await expect(status()).toHaveText('Needs input')
    // The viewport does not show it twice while the chat is in sight.
    await expect(page.locator('.ask-question[data-where="view"]')).toHaveCount(0)
    await card.getByRole('button', { name: /The right wall/ }).hover()
    expect(await peeked()).toEqual(['base/F2'])
    await card.getByRole('button', { name: /The right wall/ }).click()
    const result = await waiting
    expect(JSON.parse((result.content as Array<{ text: string }>)[0].text)).toMatchObject({ answered: true, kind: 'option', index: 1, label: 'The right wall', refs: ['base/F2'] })
    await expect(card).toHaveCount(0)
    await expect(status()).toHaveText('Idle')
    expect(await peeked()).toEqual([])
  } finally {
    await client.close()
  }
})
