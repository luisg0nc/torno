import { cpSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { deflateSync } from 'node:zlib'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { _electron as electron, expect, test, type ElectronApplication, type Locator, type Page } from '@playwright/test'
import type { TornoState } from '../src/renderer/state/store'
import type { NoteMark } from '../src/shared/marks'
import { SESSION_HEADER } from '../src/main/http'
import { openListed, projectCrumb, projectMenu, switcher } from './objects'
import { closeModelMenu, fromMore, inModelMenu, newSession as fromDock, onBrief, showBrief, showModel } from './helpers'

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
  await page.waitForSelector('[data-region="viewport"]')
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
  // The stand-in says the whole prompt back a word at a time: a note with its vectors takes a few seconds.
  await expect(turns()).toHaveCount(ended, { timeout: 20_000 })
}

async function newSession(): Promise<void> {
  ended = 0
  await fromDock(dock())
  await expect(composer()).toBeEnabled()
}

test('a request to use a tool is a card with the input, answered with Allow, Allow for this session or Deny and a reason', async () => {
  await openListed(page, 'bracket')
  await expect.poll(async () => (await state()).build, { timeout: 30_000 }).toMatchObject({ status: 'ok', revision: 1 })
  await fromDock(dock())
  await expect(chat()).toBeVisible()

  await say('ask Bash {"command":"ls"}')
  const card = asks().last()
  await expect(card).toContainText('Claude Code asks to use Bash')
  await expect(card.locator('.chat-ask-input')).toHaveText('ls')
  await expect(card).toHaveAttribute('data-state', 'open')
  await expect(status()).toHaveText('Needs you')
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

  // Nor from another field: a number typed in a parameter keeps the focus, and its digits are not answers to the question.
  const wall = { questions: [{ question: 'Which wall?', header: 'Wall', multiSelect: false, options: [{ label: '2 mm', description: 'thin' }, { label: '3 mm', description: 'thick' }] }] }
  await composer().focus()
  await page.keyboard.type('slow 1')
  await page.keyboard.press('Shift+Enter')
  await page.keyboard.type(`ask AskUserQuestion ${JSON.stringify(wall)}`)
  await page.keyboard.press('Enter')
  await page.evaluate(() => {
    const field = document.createElement('input')
    field.id = 'e2e-other-field'
    document.body.append(field)
    field.focus()
  })
  await page.keyboard.type('1')
  const question = asks().last()
  await expect(question).toHaveAttribute('data-state', 'open', { timeout: 10_000 })
  await expect(page.locator('#e2e-other-field')).toBeFocused()
  await page.keyboard.type('2.5')
  await expect(page.locator('#e2e-other-field')).toHaveValue('12.5')
  await expect(question.getByRole('button', { name: /^2 mm/ })).toHaveAttribute('aria-pressed', 'false')
  await expect(question.getByRole('button', { name: /^3 mm/ })).toHaveAttribute('aria-pressed', 'false')
  await page.evaluate(() => document.getElementById('e2e-other-field')?.remove())
  await question.getByRole('button', { name: /^3 mm/ }).click()
  await question.getByRole('button', { name: 'Submit', exact: true }).click()
  await finished()
})

test('the questions of AskUserQuestion are one card, one question at a time: a step count, a list of rows, the keys 1 to 9, an Other line, and a last step that sends', async () => {
  const input = {
    questions: [
      { question: 'Which wall?', header: 'Wall', multiSelect: false, options: [{ label: '2 mm', description: 'thin' }, { label: '3 mm', description: 'thick' }] },
      { question: 'Finish?', header: 'Finish', multiSelect: true, options: [{ label: 'Matte', description: 'dull' }, { label: 'Gloss', description: 'shiny' }, { label: 'Brushed', description: 'lined' }] }
    ]
  }
  await say(`ask AskUserQuestion ${JSON.stringify(input)}`)
  const card = asks().last()
  // Only the first question is drawn, with its place among them.
  await expect(card).toContainText('Which wall?')
  await expect(card).toContainText('1 of 2')
  await expect(card).toContainText('thick')
  await expect(card).not.toContainText('Finish?')
  await expect(card.getByRole('button', { name: 'Submit' })).toHaveCount(0)
  await expect(card.getByRole('button', { name: 'Back' })).toBeDisabled()
  await expect(status()).toHaveText('Needs you')

  // The keys 1 to 9 choose among the options of the question in view; a single choice takes the person to the next.
  await expect(card.getByRole('button', { name: /^2 mm/ })).toHaveAttribute('aria-keyshortcuts', '1')
  await expect(card.getByRole('button', { name: /^3 mm/ })).toHaveAttribute('aria-keyshortcuts', '2')
  await expect(card.locator('.chat-ask-option .ask-key')).toHaveText(['1', '2'])
  await card.focus()
  await page.keyboard.press('1')
  await expect(card).toContainText('2 of 2')
  await expect(card).toContainText('Finish?')
  await expect(card.locator('.chat-ask-option .ask-key')).toHaveText(['1', '2', '3'])
  // A multiple one is toggled and stays.
  await page.keyboard.press('1')
  await page.keyboard.press('3')
  await expect(card.getByRole('button', { name: /^Matte/ })).toHaveAttribute('aria-pressed', 'true')
  await expect(card.getByRole('button', { name: /^Brushed/ })).toHaveAttribute('aria-pressed', 'true')
  await page.keyboard.press('3')
  await expect(card.getByRole('button', { name: /^Brushed/ })).toHaveAttribute('aria-pressed', 'false')
  // In the box, a digit is a digit.
  await composer().focus()
  await page.keyboard.type('12')
  await expect(composer()).toHaveValue('12')
  await expect(card.getByRole('button', { name: /^Gloss/ })).toHaveAttribute('aria-pressed', 'false')
  await composer().fill('')
  await card.getByRole('button', { name: /^Gloss/ }).click()
  // Back and forward keep the answers; choosing another takes the first back.
  await card.getByRole('button', { name: 'Back' }).click()
  await expect(card).toContainText('1 of 2')
  await expect(card.getByRole('button', { name: /^2 mm/ })).toHaveAttribute('aria-pressed', 'true')
  await card.getByRole('button', { name: /^3 mm/ }).click()
  await expect(card).toContainText('2 of 2')
  await expect(card.getByRole('button', { name: /^Matte/ })).toHaveAttribute('aria-pressed', 'true')
  await card.getByRole('button', { name: 'Next' }).click()
  // The last step reads the answers back; nothing is sent until it says so.
  await expect(card).toContainText('Review')
  await expect(card).toContainText('Matte, Gloss')
  await expect(card).toContainText('3 mm')
  await expect(card).toHaveAttribute('data-state', 'open')
  await card.getByRole('button', { name: 'Change the answer to Which wall?' }).click()
  await expect(card).toContainText('1 of 2')
  await card.getByRole('button', { name: 'Next' }).click()
  await card.getByRole('button', { name: 'Next' }).click()
  await card.getByRole('button', { name: 'Send answers', exact: true }).click()
  await expect(card).toHaveAttribute('data-state', 'allowed')
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
  await fromMore(dock(), 'End')
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
/** The view notes that are drafts: made by Done on the board, they wait in the list of marks until the next prompt carries them. */
const draftNotes = () => page.locator('.mark-row[data-status="draft"]').filter({ has: page.getByRole('img', { name: 'View note' }) })
/** That many draft notes are in the list of marks, which is on the Brief page (it is shown for the look, and the view is back after). */
const draftsAre = (count: number): Promise<void> => onBrief(page, () => expect(draftNotes()).toHaveCount(count))
/** What the ink of a note lies over, under the prompt it went with. */
const notesOf = (user: Locator) => user.locator('.chat-user-drawing[data-part="note"]')

test('Draw on view: a board over the agent\'s picture of the view; Done keeps a view note that goes with the next prompt only, with what its ink lies over', async () => {
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
  // The board is over the view: the Brief page cannot be shown meanwhile, so the store says there is no draft note.
  expect((await page.evaluate(() => window.__tornoTest!.state().marks)).filter((m) => m.kind === 'note' && m.status === 'draft')).toHaveLength(0)
  await drawingBoard().getByRole('button', { name: 'Done' }).click()
  await expect(drawingBoard()).toHaveCount(0)
  // The drawing is a note now, a draft among the marks, and it waits above the box.
  await expect(waitingNotes()).toHaveCount(1)
  // The keys are the box's again: what is typed next is the prompt, not a key of the view.
  await page.keyboard.type('thicker')
  await expect(composer()).toHaveValue('thicker')
  await composer().fill('')
  // (After the typing: the click on the Brief's switch takes the focus.)
  await draftsAre(1)

  await say('images')
  const user = chat().locator('.chat-user').last()
  await expect(user.locator('.chat-thumb')).toHaveCount(1, { timeout: 20_000 })
  await expect(user).not.toContainText('Picture:')
  // What the ink lies over is told under the prompt, by ref: a face of the part drawn across.
  await expect(notesOf(user)).toContainText('Over')
  await expect(notesOf(user).locator(`.ref-chip[data-ref^="${part}/F"]`).first()).toBeVisible()
  // The words of the note are not among the text of the prompt, and not the coordinates of the ink.
  await expect(notesOf(user)).not.toContainText('stroke 1, x')
  // The stand-in says the size of each picture, then each line of the words of the note.
  await expect(chat()).toContainText(/images: 1 (1280x\d+|\d+x1280)/, { timeout: 20_000 })
  await expect(chat()).toContainText('view note')
  await expect(chat()).toContainText('Under the ink, stroke by stroke')
  await expect(chat()).toContainText(new RegExp(`stroke 1, x \\d+–\\d+, y \\d+–\\d+: ${part}/F\\d+`))
  await finished()
  // Sent with that prompt: no draft is left.
  await draftsAre(0)

  // The next prompt carries none.
  await say('images')
  await expect(chat().locator('.chat-text').last()).toContainText('images: 0')
  await finished()
})

test('a stroke across a part and bare ground says it is partly over no part, under the prompt the note went with', async () => {
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
  await draftsAre(1)
  await say('images')
  await expect(notesOf(chat().locator('.chat-user').last())).toContainText('stroke 1 partly over no part', { timeout: 20_000 })
  await finished()
})

test('a drawing made while the camera moved says that what its ink lies over was not worked out', async () => {
  ended = await turns().count()
  await drawButton().click()
  await expect(drawingBoard()).toBeVisible()
  // The agent's `show` moves the view under the board.
  const show = (request: object): Promise<void> => app.evaluate(({ BrowserWindow }, req) => BrowserWindow.getAllWindows()[0].webContents.send('view:show', { id: 987701, request: req }), request)
  await show({ objectId: 'bracket', view: 'top' })
  await expect.poll(async () => (await page.evaluate(() => window.__tornoTest!.camera())).position[2]).toBeGreaterThan(0)
  await line(drawingBoard(), [0.45, 0.5], [0.55, 0.5])
  await drawingBoard().getByRole('button', { name: 'Done' }).click()
  await draftsAre(1)
  await say('images')
  const note = notesOf(chat().locator('.chat-user').last())
  const warn = note.locator('.over-warn')
  await expect(warn).toContainText('was not worked out', { timeout: 20_000 })
  await expect(note.locator('.over .ref-chip')).toHaveCount(0)
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
  await finished()
  await show({ objectId: 'bracket', view: 'iso' })
  await cameraSettled()
})

test('a board discarded keeps no note, and gives the keys back to the box', async () => {
  // Drawn, and put away with Cancel: nothing is kept.
  await drawButton().click()
  await line(drawingBoard(), [0.2, 0.2], [0.4, 0.3])
  await drawingBoard().getByRole('button', { name: 'Cancel' }).click()
  await page.getByRole('button', { name: 'Discard', exact: true }).click()
  await expect(drawingBoard()).toHaveCount(0)
  // Put away too, the board gives the keys back to the box.
  await page.keyboard.type('never mind')
  await expect(composer()).toHaveValue('never mind')
  await composer().fill('')
  // (After the typing: the click on the Brief's switch takes the focus.)
  await draftsAre(0)
})

/** A small picture of one colour as a PNG file, made here: nothing of the person's. */
function writePng(path: string, width = 96, height = 64): void {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    return c >>> 0
  })
  const crc = (buf: Buffer): number => {
    let c = 0xffffffff
    for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8)
    return (c ^ 0xffffffff) >>> 0
  }
  const chunk = (type: string, data: Buffer): Buffer => {
    const body = Buffer.concat([Buffer.from(type), data])
    const out = Buffer.alloc(body.length + 8)
    out.writeUInt32BE(data.length, 0)
    body.copy(out, 4)
    out.writeUInt32BE(crc(body), body.length + 4)
    return out
  }
  const head = Buffer.alloc(13)
  head.writeUInt32BE(width, 0)
  head.writeUInt32BE(height, 4)
  head[8] = 8
  head[9] = 2
  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(width * 3, 0x7f)])
  const data = deflateSync(Buffer.concat(Array.from({ length: height }, () => row)))
  writeFileSync(path, Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', head), chunk('IDAT', data), chunk('IEND', Buffer.alloc(0))]))
}

/** The view notes of the project as the window holds them. */
const notesNow = async (): Promise<NoteMark[]> => (await state()).marks.filter((m): m is NoteMark => m.kind === 'note')
const noteNow = async (id: string): Promise<NoteMark> => (await notesNow()).find((n) => n.id === id)!

test('a view note: two strokes, a label with an arrow, a comment and a reference are kept as a draft note, with its files; opened again, a changed comment is kept and a sent note is a draft again', async () => {
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
  const photo = join(home, 'reference.png')
  writePng(photo)
  await app.evaluate((_electron, picked) => void ((globalThis as unknown as { __tornoMain: { pickPhotos: string[] } }).__tornoMain.pickPhotos = picked), [photo])
  ended = await turns().count()
  await cameraSettled()

  await drawButton().click()
  const board = drawingBoard()
  await expect(board).toBeVisible()
  const canvas = board.locator('canvas')
  await line(board, [fx - 0.01, fy], [fx + 0.01, fy])
  await line(board, [fx, fy - 0.01], [fx, fy + 0.01])
  await expect(canvas).toHaveAttribute('data-strokes', '2')
  // The label tool is T, and a label is written where the picture was pressed.
  await page.keyboard.press('t')
  await expect(board.getByRole('button', { name: 'Label' })).toHaveAttribute('aria-pressed', 'true')
  const box = (await canvas.boundingBox())!
  const at = (x: number, y: number): [number, number] => [box.x + box.width * x, box.y + box.height * y]
  await page.mouse.click(...at(0.08, 0.1))
  await expect(board.getByRole('textbox', { name: 'Label text' })).toBeFocused()
  // T typed into a field is a letter: it does not take the tool again.
  await page.keyboard.type('thicker here')
  await page.keyboard.press('Enter')
  await expect(board.getByRole('textbox', { name: 'Label text' })).toHaveCount(0)
  await expect(board.locator('.label')).toHaveCount(1)
  // An arrow: a drag from the label to the part.
  const [lx, ly] = at(0.08, 0.1)
  await page.mouse.move(lx + 12, ly + 12)
  await page.mouse.down()
  await page.mouse.move(...at(fx, fy), { steps: 10 })
  await page.mouse.up()
  await expect(board.locator('.label[data-arrow]')).toHaveCount(1)
  await board.getByRole('textbox', { name: 'Comment' }).fill('make the lid thicker')
  await board.getByRole('button', { name: 'Add a reference' }).click()
  await expect(board.getByRole('img', { name: 'Reference 1' })).toBeVisible()
  await board.getByRole('textbox', { name: 'Comment on reference 1' }).fill('the part it mates with')
  await board.getByRole('button', { name: 'Done' }).click()
  await expect(board).toHaveCount(0)

  await draftsAre(1)
  const note = (await notesNow()).at(-1)!
  expect(note).toMatchObject({ status: 'draft', author: 'user', note: 'make the lid thicker' })
  expect(note.strokes).toHaveLength(2)
  expect(note.labels).toHaveLength(1)
  expect(note.labels[0]).toMatchObject({ text: 'thicker here' })
  expect(note.labels[0].to).toBeDefined()
  expect(note.references).toEqual([{ file: expect.stringMatching(/^r-[0-9a-f]{12}\.(png|jpg)$/), comment: 'the part it mates with' }])
  // What the ink lies over: a line for each stroke, then one for the head of the arrow, which is over the part.
  expect(note.under).toHaveLength(3)
  expect(note.under[2].refs[0]?.ref).toMatch(new RegExp(`^${part}/F\\d+$`))
  expect(note.anchor?.ref).toMatch(new RegExp(`^${part}/F\\d+$`))
  // Its files are in the project's folder, named by main: the plain picture, the one with the ink, the reference.
  const files = readdirSync(join(root, 'bracket', '.torno', 'notes'))
  expect(note.picture).toMatch(/^n-[0-9a-f]{12}\.png$/)
  expect(note.ink).toMatch(/^n-[0-9a-f]{12}\.ink\.png$/)
  for (const file of [note.picture, note.ink, note.references[0].file]) expect(files).toContain(file)
  // The picture with the ink on it is the plain one's size.
  const inkPng = readFileSync(join(root, 'bracket', '.torno', 'notes', note.ink))
  expect([inkPng.readUInt32BE(16), inkPng.readUInt32BE(20)]).toEqual([note.size.w, note.size.h])
  expect(Math.max(note.size.w, note.size.h)).toBe(1280)

  // Reopened and put away unchanged, it is left as it was.
  const id = note.id
  await page.evaluate((mark) => window.__tornoTest!.openNote('bracket', mark), id)
  await expect(board).toBeVisible()
  await expect(board.getByRole('textbox', { name: 'Comment' })).toHaveValue('make the lid thicker')
  await expect(board.locator('.label')).toHaveCount(1)
  await expect(canvas).toHaveAttribute('data-strokes', '2')
  await board.getByRole('button', { name: 'Cancel' }).click()
  await expect(board).toHaveCount(0)
  expect((await noteNow(id)).note).toBe('make the lid thicker')

  // The marks list has an Edit for it too: the same sheet, on the same note.
  await showBrief(page)
  await page.locator(`.mark-row[data-mark="${id}"]`).hover()
  await page.getByRole('button', { name: `Edit ${id}`, exact: true }).click()
  await expect(board).toBeVisible()
  await expect(board.getByRole('textbox', { name: 'Comment' })).toHaveValue('make the lid thicker')
  await board.getByRole('button', { name: 'Cancel' }).click()
  await expect(board).toHaveCount(0)
  await showModel(page)

  // It goes with a prompt: then it is sent.
  await say('images')
  await finished()
  await expect.poll(async () => (await noteNow(id)).status).toBe('sent')

  // Reopened, its comment changed, Done: the pictures were not made again, and the note is a draft once more, reopened.
  const before = (await noteNow(id)).ink
  await page.evaluate((mark) => window.__tornoTest!.openNote('bracket', mark), id)
  await expect(board).toBeVisible()
  await board.getByRole('textbox', { name: 'Comment' }).fill('make the lid thicker, 3 mm')
  await board.getByRole('button', { name: 'Done' }).click()
  await expect(board).toHaveCount(0)
  await expect.poll(async () => (await noteNow(id)).note).toBe('make the lid thicker, 3 mm')
  const after = await noteNow(id)
  expect(after).toMatchObject({ status: 'draft', reopened: true })
  expect(after.ink).toBe(before)
  expect(after.strokes).toHaveLength(2)
  expect(after.labels).toHaveLength(1)
  expect(after.references).toHaveLength(1)
  // Taking the reference away and changing a label: the picture with the ink is made again.
  await page.evaluate((mark) => window.__tornoTest!.openNote('bracket', mark), id)
  await board.getByRole('button', { name: 'Remove reference 1' }).click()
  await board.getByRole('button', { name: 'Label' }).click()
  const again = (await canvas.boundingBox())!
  await page.mouse.click(again.x + again.width * 0.08 + 12, again.y + again.height * 0.1 + 12)
  await page.keyboard.press('End')
  await page.keyboard.type(' now')
  await page.keyboard.press('Enter')
  await board.getByRole('button', { name: 'Done' }).click()
  await expect(board).toHaveCount(0)
  await expect.poll(async () => (await noteNow(id)).references.length).toBe(0)
  const edited = await noteNow(id)
  expect(edited.labels[0].text).toBe('thicker here now')
  expect(edited.ink).not.toBe(before)
  // A label's words alone changed: what the ink lies over is what it was.
  expect(edited.under).toHaveLength(3)
  await say('images')
  await finished()
  await expect.poll(async () => (await noteNow(id)).status).toBe('sent')
})

test('a note whose ink was drawn while the view moved says so in the sheet, before Done', async () => {
  await drawButton().click()
  await expect(drawingBoard()).toBeVisible()
  await expect(drawingBoard().locator('.note-warn')).toHaveCount(0)
  // The agent's `show` moves the view under the sheet.
  const show = (request: object): Promise<void> => app.evaluate(({ BrowserWindow }, req) => BrowserWindow.getAllWindows()[0].webContents.send('view:show', { id: 987703, request: req }), request)
  await show({ objectId: 'bracket', view: 'top' })
  await expect(drawingBoard().locator('.note-warn')).toContainText('could not be worked out')
  await drawingBoard().getByRole('button', { name: 'Cancel' }).click()
  await expect(drawingBoard()).toHaveCount(0)
  await show({ objectId: 'bracket', view: 'iso' })
  await cameraSettled()
})

/** The notes that wait above the box for the next prompt, a row each. */
const waitingNotes = () => dock().locator('.chat-note-wait')
/** A point of the canvas over a part: the same fraction of the picture is over it too (one camera, one aspect). */
const partSpot = () =>
  page.evaluate(() => {
    for (const fy of [0.5, 0.45, 0.55, 0.4, 0.6, 0.35, 0.65]) {
      for (const fx of [0.5, 0.45, 0.55, 0.4, 0.6, 0.35, 0.65]) {
        const hit = window.__tornoTest!.pickAt(fx, fy, { edges: false })
        if (hit) return { fx, fy, part: hit.part }
      }
    }
    return null
  })

test('notes wait above the box with their thumbnails: Edit opens one, Remove takes one away and Undo brings it back, and one prompt carries them all, each shown under it', async () => {
  const spot = await partSpot()
  expect(spot).not.toBeNull()
  const { fx, fy, part } = spot!
  ended = await turns().count()
  await expect(waitingNotes()).toHaveCount(0)
  // "Draw on view" stays enabled while a note waits: a second one is made.
  for (const [dx, dy] of [[0.01, 0], [0, 0.01]] as const) {
    await expect(drawButton()).toBeEnabled()
    await drawButton().click()
    await line(drawingBoard(), [fx - dx, fy - dy], [fx + dx, fy + dy])
    await drawingBoard().getByRole('textbox', { name: 'Comment' }).fill(dx > 0 ? 'first one' : 'second one')
    await drawingBoard().getByRole('button', { name: 'Done' }).click()
    await expect(drawingBoard()).toHaveCount(0)
  }
  await expect(waitingNotes()).toHaveCount(2)
  const [one, two] = (await notesNow()).filter((n) => n.status === 'draft').map((n) => n.id)
  const first = waitingNotes().filter({ has: page.locator(`[data-ref="${one}"]`) })
  const second = waitingNotes().filter({ has: page.locator(`[data-ref="${two}"]`) })
  await expect(first).toContainText('first one')
  await expect(second).toContainText('second one')
  // Each has the thumbnail of its picture.
  for (const row of [first, second]) {
    await expect(row.locator('img')).toBeVisible()
    expect(await row.locator('img').evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0)
  }
  // What the ink lies over is told before it is sent, as chips that are live: a face of the part, lit in the view by the pointer.
  const over = first.locator('.over[data-over="known"]')
  await expect(over).toContainText('Over')
  const face = over.locator(`.ref-chip[data-ref^="${part}/F"]`).first()
  await expect(face).toBeVisible()
  const ref = (await face.getAttribute('data-ref'))!
  expect(await peeked()).toEqual([])
  await face.hover()
  await expect.poll(peeked).toEqual([ref])
  await page.mouse.move(0, 0)
  await expect.poll(peeked).toEqual([])

  // Edit opens the sheet over it, with its strokes; put away unchanged, the note is as it was.
  await first.getByRole('button', { name: 'Edit' }).click()
  await expect(drawingBoard()).toBeVisible()
  await expect(drawingBoard().getByRole('textbox', { name: 'Comment' })).toHaveValue('first one')
  await expect(drawingBoard().locator('canvas')).toHaveAttribute('data-strokes', '1')
  await drawingBoard().getByRole('button', { name: 'Cancel' }).click()
  await expect(drawingBoard()).toHaveCount(0)
  await expect(waitingNotes()).toHaveCount(2)

  // Remove deletes the mark, and Undo puts it back.
  await second.getByRole('button', { name: 'Remove' }).click()
  await expect(waitingNotes()).toHaveCount(1)
  expect((await notesNow()).map((n) => n.id)).not.toContain(two)
  await dock().getByRole('status').filter({ hasText: `Removed ${two}` }).getByRole('button', { name: 'Undo' }).click()
  await expect(waitingNotes()).toHaveCount(2)
  expect((await notesNow()).map((n) => n.id)).toContain(two)

  // The pictures of one note are not on this computer (the files are not in git): it says so, and still goes with the prompt as words.
  const dir = join(root, 'bracket', '.torno', 'notes')
  const gone = await noteNow(two)
  for (const file of [gone.picture, gone.ink]) rmSync(join(dir, file))
  await second.getByRole('button', { name: 'Remove' }).click()
  await expect(waitingNotes()).toHaveCount(1)
  await dock().getByRole('status').filter({ hasText: `Removed ${two}` }).getByRole('button', { name: 'Undo' }).click()
  await expect(waitingNotes()).toHaveCount(2)
  await expect(second).toContainText('picture not on this computer')
  await expect(second.locator('img')).toHaveCount(0)
  await expect(first).not.toContainText('picture not on this computer')

  // One prompt carries both: the rows empty, the marks are sent, and each note is shown under the prompt.
  await say('images')
  await expect(waitingNotes()).toHaveCount(0)
  const user = chat().locator('.chat-user').last()
  await expect(notesOf(user)).toHaveCount(2, { timeout: 20_000 })
  await expect(notesOf(user).nth(0).locator(`.ref-chip[data-ref="${one}"]`)).toBeVisible()
  await expect(notesOf(user).nth(1).locator(`.ref-chip[data-ref="${two}"]`)).toBeVisible()
  await expect(notesOf(user).first()).toContainText('Over')
  await finished()
  await expect.poll(async () => (await notesNow()).filter((n) => [one, two].includes(n.id)).map((n) => n.status)).toEqual(['sent', 'sent'])
})

test('the eraser is kept in a note: a reopened note shows the erased ink erased, and the picture made again is the one made first', async () => {
  const picked = async (id: string, which: 'ink' | 'plain', at: Array<[number, number]>): Promise<number[][]> =>
    page.evaluate(
      async ({ id, which, at }) => {
        const bytes = await window.torno.notes.picture('bracket', id, which)
        const bitmap = await createImageBitmap(new Blob([bytes as BlobPart], { type: 'image/png' }))
        const canvas = new OffscreenCanvas(bitmap.width, bitmap.height)
        const ctx = canvas.getContext('2d')!
        ctx.drawImage(bitmap, 0, 0)
        return at.map(([fx, fy]) => [...ctx.getImageData(Math.round(fx * bitmap.width), Math.round(fy * bitmap.height), 1, 1).data])
      },
      { id, which, at }
    )
  ended = await turns().count()
  const row = 0.2
  const samples: Array<[number, number]> = [[0.3, row], [0.5, row], [0.7, row]]
  await drawButton().click()
  const board = drawingBoard()
  await expect(board).toBeVisible()
  // A thick line across, and the eraser through the middle of it.
  await board.getByRole('button', { name: 'Thick pen' }).click()
  await line(board, [0.2, row], [0.8, row])
  await board.getByRole('button', { name: 'Eraser' }).click()
  await line(board, [0.45, row], [0.55, row])
  await board.getByRole('button', { name: 'Done' }).click()
  await expect(board).toHaveCount(0)
  const note = (await notesNow()).at(-1)!
  expect(note.strokes.map((s) => s.erase === true)).toEqual([false, true])
  // The eraser lies over nothing: only the pen stroke has a line of what it lies over.
  expect(note.under.length).toBeLessThanOrEqual(1)
  const first = await picked(note.id, 'ink', samples)
  const plain = await picked(note.id, 'plain', samples)
  // Ink where it was left, the picture itself where the eraser went.
  expect(first[0]).not.toEqual(plain[0])
  expect(first[1]).toEqual(plain[1])
  expect(first[2]).not.toEqual(plain[2])

  // Opened again and a label added: the ink is made again from the strokes it kept, and the erased part is erased still.
  await page.evaluate((mark) => window.__tornoTest!.openNote('bracket', mark), note.id)
  await expect(board).toBeVisible()
  await expect(board.locator('canvas')).toHaveAttribute('data-strokes', '2')
  await board.getByRole('button', { name: 'Label' }).click()
  const box = (await board.locator('canvas').boundingBox())!
  await page.mouse.click(box.x + box.width * 0.1, box.y + box.height * 0.8)
  await page.keyboard.type('later')
  await page.keyboard.press('Enter')
  await board.getByRole('button', { name: 'Done' }).click()
  await expect(board).toHaveCount(0)
  await expect.poll(async () => (await noteNow(note.id)).labels.length).toBe(1)
  const again = await noteNow(note.id)
  expect(again.ink).not.toBe(note.ink)
  expect(again.strokes.map((s) => s.erase === true)).toEqual([false, true])
  expect(await picked(note.id, 'ink', samples)).toEqual(first)

  await say('images')
  await finished()
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
  await draftsAre(1)
  await say('images')
  await expect(notesOf(chat().locator('.chat-user').last()).locator('.over')).toContainText(`the cut face of ${part}`, { timeout: 20_000 })
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
  const menu = await inModelMenu(dock(), 'Model')
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
  await closeModelMenu(dock())
})

test('the effort menu offers what the model takes, and sets the effort of the session only', async () => {
  const menu = await inModelMenu(dock(), 'Effort')
  // The person's default until one is chosen; the model is Haiku now, which the CLI says takes three.
  await expect(menu).toHaveValue('')
  await expect(menu.locator('option')).toHaveText(['Default effort', 'Low', 'Medium', 'High'])
  await menu.selectOption({ label: 'Medium' })
  await expect(menu).toHaveValue('medium')
  await expect(chat().locator('.chat-note').last()).toContainText('Effort: medium')
  await say('say with the new effort')
  await expect(turns().last()).toContainText('Done in')
  await expect(menu).toHaveValue('medium')
  await closeModelMenu(dock())
})

test('the edits menu sets how edits are asked for this session only, and the CLI reports it', async () => {
  const menu = await inModelMenu(dock(), 'Edits')
  await expect(menu.locator('option')).toHaveText(['Ask before edits', 'Accept edits', 'Plan first'])
  await menu.selectOption({ label: 'Accept edits' })
  await expect(menu).toHaveValue('acceptEdits')
  await expect(chat().locator('.chat-note').last()).toContainText('Edits: accept edits')
  await say('say with the new mode')
  await expect(turns().last()).toContainText('Done in')
  await expect(menu).toHaveValue('acceptEdits')
  await closeModelMenu(dock())
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
  await expect(status()).toHaveText('Needs you')
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
  const item = (name: string) => projectMenu(page).getByRole('menuitem', { name, exact: true })
  const needs = () => page.locator('.status-needs')
  await newSession()
  await say('ask Bash {"command":"ls"}')
  const card = asks().last()
  await expect(card).toHaveAttribute('data-state', 'open')
  await expect(status()).toHaveText('Needs you')
  // The dock shown: its pane says it, the toggle has no dot.
  await expect(toggle().locator('.session-sign')).toHaveCount(0)

  // The dock hidden: the dot is on the toggle, and its name says what it is.
  await toggle().click()
  await expect(dock()).toBeHidden()
  await expect(toggle()).toHaveAttribute('aria-label', 'Show session')
  await expect(toggle()).toHaveAttribute('aria-description', 'Claude Code needs you')
  await expect(toggle()).toHaveAttribute('title', 'Show session: Claude Code needs you')
  await expect(toggle().locator('.session-sign[data-sign="needs_input"]')).toBeVisible()
  // The title bar has no pill for the open object's own session (the toggle has the dot), and the status line has the button.
  await expect(switcher(page)).toHaveCount(0)
  await expect(needs()).toContainText('bracket needs you')

  // Another object shown: the Projects icon carries the sign of the one that asks, and names it; so does its row of
  // the list; and the toggle (of an object with no session) has none.
  await openListed(page, 'hollow')
  await expect.poll(async () => (await state()).objectId).toBe('hollow')
  await expect(switcher(page)).toHaveAttribute('data-sign', 'needs_input')
  await expect(switcher(page)).toHaveAccessibleName('bracket')
  await projectCrumb(page).click()
  await expect(item('bracket')).toHaveAttribute('data-session', 'needs_input')
  await expect(item('bracket')).toHaveAttribute('aria-description', 'session needs you')
  await expect(item('hollow')).not.toHaveAttribute('data-session', /./)
  await page.keyboard.press('Escape')
  await expect(projectMenu(page)).toHaveCount(0)
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
  await expect(switcher(page)).toHaveCount(0)
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
  if (await dock().getByRole('button', { name: 'New session', exact: true }).isVisible()) await newSession()
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
    await expect(status()).toHaveText('Needs you')
    // It takes the foot of the dock: nowhere else shows it, not the view and not a second time in the dock.
    await expect(page.locator('.ask-question')).toHaveCount(1)
    await expect(card).toHaveAttribute('data-ask-takeover', 'question')
    await expect(card).toHaveAttribute('data-where', 'chat')
    await card.getByRole('button', { name: /The right wall/ }).hover()
    expect(await peeked()).toEqual(['base/F2'])
    // Pointing at an option rings its ref (`data-hot`), and lets go of it with the pointer.
    await expect(card.getByRole('button', { name: /The right wall/ }).locator('.ask-ref[data-hot]')).toHaveCount(1)
    await expect(card.getByRole('button', { name: /The left wall/ }).locator('.ask-ref[data-hot]')).toHaveCount(0)
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

// Task 32: an ask takes the foot of the dock (spec 2026-11-18, "An ask").
test('torno\'s ask takes the foot: a warn top edge, options with the keys 1 to 3, the ref of the one pointed at ringed, None of these, and the dock shown from the status line', async () => {
  await openListed(page, 'bracket')
  if (await dock().getByRole('button', { name: 'New session', exact: true }).isVisible()) await newSession()
  await expect(composer()).toBeEnabled()
  const { url, token } = await app.evaluate((_electron, id) => (globalThis as unknown as { __tornoMain: { mcpFor(id: string): { url: string; token: string } } }).__tornoMain.mcpFor(id), 'bracket')
  const client = new Client({ name: 'torno-e2e', version: '0' })
  await client.connect(new StreamableHTTPClientTransport(new URL(url), { requestInit: { headers: { [SESSION_HEADER]: token } } }))
  try {
    const options = [{ label: 'The left wall', refs: ['base/F1'] }, { label: 'The right wall', refs: ['base/F2'] }, { label: 'The floor', refs: ['base/F0'] }]
    const take = (): Promise<unknown> => client.callTool({ name: 'ask', arguments: { question: 'Which part do you mean?', options } })
    const card = dock().locator('.ask-question')

    // None of these is today's decline; the block is the foot's: after the transcript, with the box under it, a warn edge on top.
    let waiting = take()
    await expect(card).toBeVisible()
    await expect(card.locator('.ask-option')).toHaveCount(3)
    await expect(card.locator('.ask-key')).toHaveText(['1', '2', '3'])
    expect(await card.evaluate((el) => getComputedStyle(el).borderTopWidth)).toBe('3px')
    expect(await card.evaluate((el) => getComputedStyle(el).borderTopColor)).toBe(await page.evaluate(() => { const probe = document.createElement('i'); probe.style.color = 'var(--warn)'; document.body.append(probe); const c = getComputedStyle(probe).color; probe.remove(); return c }))
    const order = await chat().evaluate((el) => [...el.children].map((c) => c.className.split(' ')[0]))
    expect(order.indexOf('chat-scroll')).toBeLessThan(order.indexOf('ask-takeover'))
    expect(order.indexOf('ask-takeover')).toBeLessThan(order.indexOf('chat-foot'))
    await card.getByRole('button', { name: 'None of these' }).click()
    expect(JSON.parse(((await waiting) as { content: Array<{ text: string }> }).content[0].text)).toMatchObject({ answered: false })
    await expect(card).toHaveCount(0)
    await page.mouse.move(0, 0)

    // Pointing at an option lights its ref in the view and rings its chip; the key 3 answers with the third.
    waiting = take()
    await expect(card).toBeVisible()
    const floor = card.getByRole('button', { name: /The floor/ })
    await expect(floor).toBeEnabled()
    await floor.hover()
    await expect(floor.locator('.ask-ref[data-hot]')).toHaveText('base/F0')
    expect(await peeked()).toEqual(['base/F0'])
    await page.mouse.move(0, 0)
    await expect(card.locator('[data-hot]')).toHaveCount(0)
    await card.focus()
    await page.keyboard.press('3')
    expect(JSON.parse(((await waiting) as { content: Array<{ text: string }> }).content[0].text)).toMatchObject({ answered: true, kind: 'option', index: 2, label: 'The floor' })
    await expect(card).toHaveCount(0)

    // With the dock hidden the status line's button shows it and brings the person to the block.
    waiting = take()
    await expect(card).toBeVisible()
    await page.locator('.dock-toggle').click()
    await expect(dock()).toBeHidden()
    await page.locator('.status-needs').click()
    await expect(dock()).toBeVisible()
    await expect(card).toBeFocused()
    await card.getByRole('button', { name: 'None of these' }).click()
    await waiting
  } finally {
    await client.close()
  }
})

test('a request of the agent\'s takes the foot too: the transcript holds a line, and keeps the card once it is answered', async () => {
  await newSession()
  await say('ask Bash {"command":"ls"}')
  const foot = dock().locator('.ask-takeover.chat-ask')
  await expect(foot).toHaveAttribute('data-state', 'open')
  await expect(foot).toHaveAttribute('data-ask-takeover', 'request')
  await expect(chat().locator('.chat-transcript .chat-ask')).toHaveCount(0)
  await expect(chat().locator('.chat-transcript .chat-ask-below')).toBeVisible()
  await foot.getByRole('button', { name: 'Allow', exact: true }).click()
  await expect(dock().locator('.ask-takeover')).toHaveCount(0)
  await expect(chat().locator('.chat-transcript .chat-ask')).toHaveAttribute('data-state', 'allowed')
  await finished()
})

test('an ask that arrives while the export is open turns the dock\'s foot band to "needs you", and Answer brings the ask back', async () => {
  await newSession()
  // A tool that takes two seconds, then an ask: the export is brought up in between.
  await composer().focus()
  await page.keyboard.type('work 2')
  await page.keyboard.press('Shift+Enter')
  await page.keyboard.type('ask Bash {"command":"ls"}')
  await page.keyboard.press('Enter')
  await page.keyboard.press('Control+Shift+E')
  const exporting = dock().locator('.export-dock')
  await expect(exporting).toBeVisible()
  // The conversation is folded to a band at the foot, and the builds strip stays above the export.
  const fold = dock().locator('.export-fold')
  await expect(fold).toContainText('Claude Code')
  await expect(fold).toContainText('working')
  await expect(dock().locator('.strip')).toBeVisible()
  await expect(fold).toContainText('needs you', { timeout: 30_000 })
  await expect(fold).toHaveAttribute('data-asks', '')
  // Answer puts the export away: the dock shows the ask.
  await fold.getByRole('button', { name: 'Answer' }).click()
  await expect(exporting).toHaveCount(0)
  const foot = dock().locator('.ask-takeover.chat-ask')
  await expect(foot).toHaveAttribute('data-state', 'open')
  await foot.getByRole('button', { name: 'Allow', exact: true }).click()
  await finished()
})
