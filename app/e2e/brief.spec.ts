import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { _electron as electron, expect, test, type ElectronApplication, type Locator, type Page } from '@playwright/test'
import type { BoardFile } from '../src/shared/board'
import type { SizeFact, SizeSource } from '../src/shared/size'
import type { TornoState } from '../src/renderer/state/store'
import { newSession } from './helpers'
import { openListed } from './objects'

// The Brief page in the window: it swaps with the model on Ctrl+Tab, reads the project's board file as an inspection
// sheet (what we are making, sizes, rules, notes), and changes it through main. The window is hidden: state is read
// through hooks (`__tornoTest`) and the page's elements, never pixels.
const appDir = resolve(__dirname, '..')
const fixtures = resolve(appDir, '../kernel/tests/fixtures/ws')
const fakeAgent = resolve(appDir, 'test/fake-agent.mjs')

test.describe.configure({ mode: 'serial' })

let root: string
let app: ElectronApplication
let page: Page

test.beforeAll(async () => {
  root = mkdtempSync(join(realpathSync(tmpdir()), 'torno-e2e-brief-'))
  cpSync(fixtures, root, { recursive: true, filter: (source) => !source.endsWith('__pycache__') })
  writeFileSync(join(root, 'bracket', 'brief.md'), '# A bracket\n\nHolds the lid shut. Two screws.\n')
  app = await electron.launch({ args: ['.'], cwd: appDir, env: { ...process.env, TORNO_TEST: '1', TORNO_AGENT_CMD: `node ${fakeAgent}`, TORNO_WORKSPACE: root } })
  page = await app.firstWindow()
  await page.waitForSelector('[data-region="viewport"]')
})

test.afterAll(async () => {
  await app?.close()
  rmSync(root, { recursive: true, force: true })
})

const state = (): Promise<TornoState> => page.evaluate(() => window.__tornoTest!.state())
const switchButton = (name: 'Model' | 'Brief' | 'Tracing'): Locator => page.locator('.pboard-switch').getByRole('button', { name, exact: true })
const readBoard = (id = 'bracket'): Promise<BoardFile> => page.evaluate((o) => window.torno.board.read(o), id)
const boardPath = (id: string): string => join(root, id, '.torno', 'board', 'board.json')
const sheet = (): Locator => page.locator('.brief-page')
const sizeRows = (): Locator => page.locator('.brief-row[data-card]:not(.brief-rule)')
const size = (what: string, value: string, source: SizeSource = 'measured'): SizeFact => ({ what, value, unit: 'mm', source })

test('a project opens on the model, with the switch Model, Brief and + at the top left and no brief drawn', async () => {
  await openListed(page, 'bracket')
  await expect.poll(async () => (await state()).scene?.parts.length ?? 0, { timeout: 20_000 }).toBeGreaterThan(0)
  await expect(page.locator('.pboard-switch button')).toHaveText(['Model', 'Brief', '+'])
  await expect(switchButton('Model')).toHaveAttribute('aria-pressed', 'true')
  await expect(sheet()).toHaveCount(0)
  expect(await page.evaluate(() => window.__tornoTest!.paused())).toBe(false)
  // The switch comes first in the region, so that F6 lands on it.
  expect(await page.evaluate(() => document.querySelector('[data-region="viewport"] button')?.className)).toContain('pboard-switch-button')
})

test('Ctrl+Tab shows the brief and stops the view drawing; Ctrl+Tab again brings the model back', async () => {
  await page.keyboard.press('Control+Tab')
  await expect(sheet()).toBeVisible()
  await expect(switchButton('Brief')).toHaveAttribute('aria-pressed', 'true')
  expect(await page.evaluate(() => window.__tornoTest!.paused())).toBe(true)
  await expect(page.locator('.viewport-pane')).toBeHidden()
  await page.keyboard.press('Control+Tab')
  await expect(sheet()).toHaveCount(0)
  expect(await page.evaluate(() => window.__tornoTest!.paused())).toBe(false)
  await switchButton('Brief').click()
  await expect(sheet()).toBeVisible()
  expect(await page.evaluate(() => localStorage.getItem('torno.board.shown'))).toContain('"bracket":"brief"')
})

test('the brief card shows brief.md read only, and a project with nothing else says so', async () => {
  await expect(page.getByRole('heading', { name: 'What we are making' })).toBeVisible()
  await expect(sheet()).toContainText('Holds the lid shut', { timeout: 20_000 })
  await expect(sheet().getByRole('button', { name: 'Edit in your editor' })).toBeVisible()
  // The name torno wrote on top of brief.md is the project's, not part of the words.
  await expect(sheet().getByRole('region', { name: 'In your words' })).not.toContainText('A bracket')
  await expect(sizeRows()).toHaveCount(0)
  await expect(sheet().getByRole('region', { name: 'Sizes' })).toContainText('none yet')
})

test('Add a size opens a form that says what is missing, then puts the size in the ledger and in board.json', async () => {
  await sheet().getByRole('button', { name: 'Add a size' }).click()
  const form = page.locator('.brief-sizeform')
  await expect(form.getByLabel('What it measures')).toBeFocused()
  await form.getByRole('button', { name: 'Add', exact: true }).click()
  await expect(form).toContainText('A size has what it measures')
  await form.getByLabel('What it measures').fill('tab hole')
  await form.getByLabel('Value').fill('Ø6,6')
  await form.getByLabel('Note').fill('probably 7')
  await page.keyboard.press('Enter')
  await expect(form).toHaveCount(0)
  const row = sizeRows().first()
  await expect(row).toContainText('Ø 6.6')
  await expect(row).toContainText('tab hole')
  await expect(row).toContainText('measured · probably 7')
  // Nothing checks it yet: the column says so, and the head counts it.
  await expect(row).toContainText('nothing checks this')
  await expect(sheet().getByRole('region', { name: 'Sizes' })).toContainText('1 size, 1 not checked')
  const saved = (await readBoard()).cards.filter((c) => c.kind === 'size')
  expect(saved).toHaveLength(1)
  expect(saved[0]).toMatchObject({ by: 'person', size: { what: 'tab hole', value: 'Ø6,6', unit: 'mm', source: 'measured', note: 'probably 7' } })
})

test('Edit changes a size of yours, and Remove takes it off with an Undo that brings it back', async () => {
  const row = sizeRows().first()
  await row.hover()
  await row.getByRole('button', { name: 'Edit tab hole' }).click()
  const form = page.locator('.brief-sizeform')
  await form.getByLabel('Value').fill('6.8')
  await form.getByRole('button', { name: 'Done' }).click()
  await expect(sizeRows().first()).toContainText('6.8')
  expect((await readBoard()).cards.find((c) => c.kind === 'size')?.size?.value).toBe('6.8')
  await sizeRows().first().hover()
  await sizeRows().first().getByRole('button', { name: 'Remove tab hole' }).click()
  await expect(sizeRows()).toHaveCount(0)
  await expect(page.getByRole('status').filter({ hasText: 'Removed tab hole' })).toBeVisible()
  await page.getByRole('status').getByRole('button', { name: 'Undo' }).click()
  await expect(sizeRows()).toHaveCount(1)
  expect((await readBoard()).cards.find((c) => c.kind === 'size')?.size?.value).toBe('6.8')
})

test('Add a rule makes the frame named Rules once, and a rule and a note are fields: Enter keeps, Esc leaves', async () => {
  await sheet().getByRole('button', { name: 'Add a rule' }).click()
  await page.getByLabel('New rule').fill('Must not go soft next to the hot cooler')
  await page.keyboard.press('Enter')
  await expect(sheet().getByRole('region', { name: 'Rules' })).toContainText('Must not go soft')
  await expect(sheet().getByRole('region', { name: 'Rules' })).toContainText('1 rule, 1 not checked')
  await sheet().getByRole('button', { name: 'Add a rule' }).click()
  await page.getByLabel('New rule').fill('Printed in ABS')
  await page.keyboard.press('Enter')
  await expect(sheet().getByRole('region', { name: 'Rules' })).toContainText('2 rules')
  const frames = (await readBoard()).cards.filter((c) => c.kind === 'frame')
  expect(frames.map((f) => f.name)).toEqual(['Rules'])
  expect((await readBoard()).cards.filter((c) => c.kind === 'text' && c.frame === frames[0].id)).toHaveLength(2)
  // A note, the other text; Esc leaves a half-written one.
  await sheet().getByRole('button', { name: 'Add a note' }).click()
  await page.getByLabel('New note').fill('the datasheet is in reference')
  await page.keyboard.press('Escape')
  await expect(page.getByLabel('New note')).toHaveCount(0)
  expect((await readBoard()).cards.filter((c) => c.kind === 'text')).toHaveLength(2)
  await sheet().getByRole('button', { name: 'Add a note' }).click()
  await page.getByLabel('New note').fill('ask about the screws')
  await page.keyboard.press('Enter')
  await expect(sheet().getByRole('region', { name: 'Your notes' })).toContainText('ask about the screws')
  await expect(sheet().getByRole('region', { name: 'Your notes' })).toContainText('Added on this page')
  // A rule is not a note.
  await expect(sheet().getByRole('region', { name: 'Your notes' })).not.toContainText('Printed in ABS')
})

test('a ref to a card in the chat is a chip, and clicking it shows the brief with that card lit', async () => {
  const note = (await readBoard()).cards.find((c) => c.kind === 'text' && c.text === 'ask about the screws')!
  await switchButton('Model').click()
  await expect(sheet()).toHaveCount(0)
  await newSession(page.locator('[data-region="session"]'))
  const composer = page.locator('[data-region="session"] [data-chat-composer]')
  await composer.focus()
  await page.keyboard.type(`say look at ${note.id} and C999`)
  await page.keyboard.press('Enter')
  const chat = page.locator('[data-region="session"] .chat')
  const chip = chat.locator('.chat-text').last().locator(`.ref-chip[data-ref="${note.id}"]`)
  await expect(chip).toBeVisible({ timeout: 20_000 })
  await expect(chat.locator('.chat-text').last().locator('.ref-chip[data-ref="C999"]')).toHaveCount(0)
  await chip.click()
  await expect(sheet()).toBeVisible()
  await expect(page.locator(`.brief-note[data-card="${note.id}"]`)).toHaveAttribute('data-lit', '')
})

test('"Send with the next prompt" holds the whole brief, and the prompt carries it; the chip can be taken off', async () => {
  const dock = page.locator('[data-region="session"]')
  await page.getByRole('button', { name: 'Send with the next prompt' }).click()
  const chip = dock.getByRole('group', { name: 'Brief attached' })
  await expect(chip).toContainText('The whole brief')
  await chip.getByRole('button', { name: 'Remove' }).click()
  await expect(chip).toHaveCount(0)
  await page.getByRole('button', { name: 'Send with the next prompt' }).click()
  await dock.locator('[data-chat-composer]').focus()
  await page.keyboard.type('say what is attached')
  await page.keyboard.press('Enter')
  await expect(chip).toHaveCount(0)
  await expect(dock.locator('.chat-user-board').last()).toContainText(/^brief: /)
  await expect(dock.locator('.chat')).toContainText('Attached from the board by the person', { timeout: 20_000 })
})

test('an old board (the project `plain`) keeps every card: frames, arrows, view and build cards are in the file and not on the page, and Claude\'s notes keep their green edge', async () => {
  mkdirSync(join(root, 'plain', '.torno', 'board'), { recursive: true })
  const old: BoardFile = {
    tidied: true,
    next: 20,
    cards: [
      { id: 'C1', kind: 'frame', x: 0, y: 0, w: 400, h: 300, by: 'person', name: 'Latch' },
      { id: 'C2', kind: 'size', x: 10, y: 40, w: 240, h: 120, by: 'person', frame: 'C1', size: size('over the tabs', '327', 'from a manual or datasheet') },
      { id: 'C3', kind: 'size', x: 10, y: 170, w: 240, h: 120, by: 'agent', size: { what: 'cooler depth', value: '50.5', unit: 'mm', source: 'from Claude' } },
      { id: 'C4', kind: 'view', x: 500, y: 0, w: 240, h: 120, by: 'person', source: 'front' },
      { id: 'C5', kind: 'build', x: 500, y: 200, w: 240, h: 120, by: 'person' },
      { id: 'C6', kind: 'text', x: 0, y: 400, w: 280, h: 160, by: 'agent', text: 'Claude: widen the latch by 2 mm' },
      { id: 'C7', kind: 'frame', x: 0, y: 700, w: 300, h: 200, by: 'person', name: 'Rules' },
      { id: 'C8', kind: 'text', x: 10, y: 740, w: 280, h: 100, by: 'person', frame: 'C7', text: 'Strong: it carries the cooler' }
    ],
    arrows: [{ id: 'C9', from: 'C2', to: 'C3', by: 'person', label: 'like this' }]
  }
  writeFileSync(boardPath('plain'), JSON.stringify(old, null, 2))
  await openListed(page, 'plain')
  await expect.poll(async () => (await state()).objectId, { timeout: 20_000 }).toBe('plain')
  await switchButton('Brief').click()
  await expect(sizeRows()).toHaveCount(2)
  await expect(sizeRows().nth(0)).toContainText('327')
  await expect(sizeRows().nth(0)).toContainText('from a datasheet')
  await expect(sizeRows().nth(1)).toHaveAttribute('data-by', 'agent')
  await expect(sizeRows().nth(1)).toContainText('from Claude')
  await expect(page.locator('.brief-cn[data-by="agent"][data-kind="text"]')).toContainText('widen the latch')
  // Written before torno kept the prompt: one node for all of it.
  await expect(page.locator('.brief-node').first()).toContainText('Before torno kept the prompt')
  await expect(sheet().getByRole('region', { name: 'Rules' })).toContainText('Strong: it carries the cooler')
  // A rule is a judgement: no measure says it.
  await expect(sheet().getByRole('region', { name: 'Rules' })).toContainText('a judgement: no measure says it')
  // The view, the build, the frames and the arrow are not drawn, and an agent's size has no Edit.
  await expect(sheet()).not.toContainText('Latch')
  await sizeRows().nth(1).hover()
  await expect(sizeRows().nth(1).getByRole('button', { name: /^Edit/ })).toHaveCount(0)
  // A change on top: every card of the file is still there.
  await sheet().getByRole('button', { name: 'Add a note' }).click()
  await page.getByLabel('New note').fill('one more')
  await page.keyboard.press('Enter')
  await expect(sheet().getByRole('region', { name: 'Your notes' })).toContainText('one more')
  const after = JSON.parse(readFileSync(boardPath('plain'), 'utf8')) as BoardFile
  expect(after.cards.slice(0, old.cards.length)).toEqual(old.cards)
  expect(after.arrows).toEqual(old.arrows)
})

test('a window that kept "board" as its choice opens the project on the brief', async () => {
  await page.evaluate(() => localStorage.setItem('torno.board.shown', JSON.stringify({ plain: 'board' })))
  await switchButton('Model').click()
  await page.evaluate(() => localStorage.setItem('torno.board.shown', JSON.stringify({ plain: 'board' })))
  await openListed(page, 'bracket')
  await openListed(page, 'plain')
  await expect(sheet()).toBeVisible({ timeout: 20_000 })
  await expect(switchButton('Brief')).toHaveAttribute('aria-pressed', 'true')
})

test('a board file that cannot be read is kept aside and said on the page, with Dismiss', async () => {
  mkdirSync(join(root, 'two', '.torno', 'board'), { recursive: true })
  writeFileSync(join(root, 'two', '.torno', 'board', 'board.json'), '<<<<<<< HEAD\n{}\n=======\n{}\n>>>>>>> other\n')
  await openListed(page, 'two')
  await expect.poll(async () => (await state()).objectId, { timeout: 20_000 }).toBe('two')
  await switchButton('Brief').click()
  const notice = sheet().locator('.brief-problem')
  await expect(notice).toBeVisible({ timeout: 20_000 })
  await expect(notice).toContainText('could not be read')
  await expect(notice).toContainText('board.json.corrupt-')
  await notice.getByRole('button', { name: 'Dismiss' }).click()
  await expect(notice).toHaveCount(0)
  expect(await page.evaluate(() => window.torno.board.problem('two'))).toBeNull()
})

// #338: the brief in two voices. The person's words of brief.md set as a page; Claude's cards on a spine of the prompts that wrote them.
const CONV = '0a1b2c3d-0000-4000-8000-0000000000aa'
const turn = (n: number) => ({ prompt: `u${n}`, conversation: CONV })
const voices = (): void => {
  const dir = join(root, 'hollow')
  writeFileSync(join(dir, 'brief.md'), '# hollow\n\nWe want a box for a panel.\n\n- 5 toggles\n- ESP32 with a screen\n\nThe cockpit: https://cdn.example.com/files/GT1-EVO_cockpit.pdf?v=1\n')
  mkdirSync(join(dir, '.torno', 'board'), { recursive: true })
  mkdirSync(join(dir, '.torno', 'chat'), { recursive: true })
  writeFileSync(join(dir, '.torno', 'session.json'), JSON.stringify({ conversationId: CONV }))
  // Three prompts, so numbered 1, 2 and 3 across the project.
  const said = [[2, 'Put the box on the shifter arm.'], [6, 'Try a tube.'], [11, 'Make the mount an arm with teeth.']] as const
  writeFileSync(join(dir, '.torno', 'chat', `${CONV}.jsonl`), said.map(([n, text]) => JSON.stringify({ kind: 'user', id: `u${n}`, text, images: [], at: Date.UTC(2026, 10, 25, 14, n), state: 'sent' })).join('\n') + '\n')
  const board: BoardFile = {
    next: 30,
    arrows: [],
    cards: [
      { id: 'C1', kind: 'brief', x: 0, y: 0, w: 300, h: 200, by: 'torno', source: 'brief' },
      { id: 'C10', kind: 'text', x: 0, y: 300, w: 240, h: 120, by: 'agent', text: 'Where: on the outer side of the right shifter arm.', turn: turn(2) },
      { id: 'C13', kind: 'text', x: 0, y: 500, w: 240, h: 120, by: 'agent', text: 'Mount: an adjustable arm with face teeth.', turn: turn(11), was: [{ text: 'Mount: a flat blade.', turn: turn(2) }, { text: 'Mount: a one-piece tube.', turn: turn(6) }] },
      { id: 'C14', kind: 'size', x: 0, y: 700, w: 240, h: 120, by: 'agent', turn: turn(2), size: { what: 'screen board', value: '40.9 x 19.7', unit: 'mm', source: 'from Claude' } },
      { id: 'C6', kind: 'size', x: 0, y: 900, w: 240, h: 120, by: 'person', size: size('push button hole', 'Ø 16', 'from a manual or datasheet') }
    ]
  }
  writeFileSync(boardPath('hollow'), JSON.stringify(board, null, 2))
}

test('the brief in two voices: your words set as a page, Claude\'s cards on a spine of the prompts that wrote them, and the way to a prompt in the chat (#338)', async () => {
  voices()
  await openListed(page, 'hollow')
  await expect.poll(() => page.evaluate(() => window.__tornoTest?.state().objectId), { timeout: 20_000 }).toBe('hollow')
  await switchButton('Brief').click()
  const yours = sheet().getByRole('region', { name: 'In your words' })
  await expect(yours).toContainText('We want a box for a panel.', { timeout: 20_000 })
  await expect(yours.locator('.brief-words li')).toHaveText(['5 toggles', 'ESP32 with a screen'])
  // A web address is a link with its host, never the address itself.
  await expect(yours.locator('.brief-weblink')).toContainText('GT1 EVO cockpit, PDF')
  await expect(yours.locator('.brief-weblink')).toContainText('cdn.example.com')
  await expect(yours).not.toContainText('?v=1')
  const spine = sheet().getByRole('region', { name: 'What Claude wrote down' })
  await expect(spine.locator('.brief-node .brief-node-head b')).toHaveText(['Prompt 1', 'Prompt 2', 'Prompt 3'])
  const two = spine.locator('.brief-node[data-prompt="u2"]')
  await expect(two.locator('.brief-asked')).toContainText('You: Put the box on the shifter arm.')
  await expect(two.locator('.brief-cn')).toHaveCount(2)
  // What C13 said in prompt 2, struck there, with the prompt that changed it.
  await expect(two.locator('.brief-ghost')).toContainText('Mount: a flat blade. Changed in prompt 2.')
  await expect(spine.locator('.brief-node[data-prompt="u6"] .brief-ghost')).toContainText('Changed in prompt 3.')
  // The ledger says whose each size is.
  await expect(sizeRows().filter({ hasText: 'screen board' }).locator('.brief-hand')).toHaveText('Claude, prompt 1')
  await expect(sizeRows().filter({ hasText: 'push button hole' }).locator('.brief-hand')).toHaveText('You')
  // Pointing at a card opens what it replaced and the way to its prompt.
  const mount = spine.locator('.brief-cn[data-card="C13"]')
  await mount.click()
  await expect(mount.locator('.brief-cn-id')).toHaveAttribute('aria-expanded', 'true')
  await expect(mount).toContainText('It replaced Mount: a flat blade. (prompt 1), then Mount: a one-piece tube. (prompt 2).')
  await expect(spine.locator('.brief-node[data-prompt="u11"]')).toHaveAttribute('data-open', '')
  await mount.getByRole('button', { name: 'Show prompt 3 in the chat' }).click()
  await expect(page.locator('[data-region="session"] .chat-group[data-id="u11"]')).toHaveAttribute('data-shown', '', { timeout: 10_000 })
  await page.keyboard.press('Escape')
})

test('Make it yours turns a card of Claude\'s into the person\'s, with the red edge, edited where it stands (#339)', async () => {
  const spine = sheet().getByRole('region', { name: 'What Claude wrote down' })
  const where = spine.locator('.brief-cn[data-card="C10"]')
  await where.locator('.brief-cn-id').click()
  await where.getByRole('button', { name: 'Make it yours' }).click()
  const field = where.getByLabel('Note')
  await expect(field).toBeFocused()
  await expect(where).toContainText('Yours now, so you can change it. Claude is told at the next prompt. Made yours just now. Claude wrote it in prompt 1.')
  await field.press('End')
  await page.keyboard.type(' Measured on the car.')
  await page.keyboard.press('Enter')
  await expect(where).toHaveAttribute('data-by', 'person')
  await expect(where).toContainText('Measured on the car.')
  await expect(where).toContainText('Claude wrote it in prompt 1.')
  const card = (await readBoard('hollow')).cards.find((c) => c.id === 'C10')!
  expect(card).toMatchObject({ by: 'person', text: 'Where: on the outer side of the right shifter arm. Measured on the car.', from: { by: 'agent', turn: { prompt: 'u2' } } })
  // A size of Claude's made the person's keeps its source until they say where it came from; Cancel leaves it as it was, and yours.
  const screen = spine.locator('.brief-cn[data-card="C14"]')
  await screen.locator('.brief-cn-id').click()
  await screen.getByRole('button', { name: 'Make it yours' }).click()
  await expect(screen.getByLabel('Where it came from')).toHaveValue('from Claude')
  await screen.getByRole('button', { name: 'Cancel' }).click()
  await expect(sizeRows().filter({ hasText: 'screen board' }).locator('.brief-hand')).toHaveText('Yours, from prompt 1')
  await expect(sizeRows().filter({ hasText: 'screen board' })).toHaveAttribute('data-by', 'person')
})

test('what Claude wrote down since the person last looked is new: the band, the accent node, and what was seen folded to one line (#340)', async () => {
  // The brief was on screen: leaving it keeps what it showed.
  await switchButton('Model').click()
  await expect(sheet()).toHaveCount(0)
  await expect.poll(() => existsSync(join(root, 'hollow', '.torno', 'board', 'seen.json'))).toBe(true)
  // Claude writes a card in the third prompt while the model is shown (here, as a pull of the file would bring it).
  const file = JSON.parse(readFileSync(boardPath('hollow'), 'utf8')) as BoardFile
  file.cards.push({ id: 'C20', kind: 'text', x: 0, y: 1100, w: 240, h: 120, by: 'agent', text: 'Controls: 9 buttons and 2 encoders.', turn: turn(11) })
  file.next = 40
  writeFileSync(boardPath('hollow'), JSON.stringify(file, null, 2))
  await expect.poll(async () => (await readBoard('hollow')).cards.some((c) => c.id === 'C20'), { timeout: 10_000 }).toBe(true)
  await switchButton('Brief').click()
  const band = sheet().locator('.brief-band')
  await expect(band).toContainText('New since you looked at')
  await expect(band).toContainText('what Claude wrote down in prompt 3.')
  const spine = sheet().getByRole('region', { name: 'What Claude wrote down' })
  await expect(spine.locator('.brief-node[data-prompt="u11"]')).toHaveAttribute('data-fresh', '')
  await expect(spine.locator('.brief-node[data-prompt="u11"] .brief-newpill')).toHaveText('new')
  await expect(spine.locator('.brief-cn[data-card="C20"]')).toHaveAttribute('data-fresh', '')
  // What was seen is one line, and comes back with Show them.
  await expect(spine.locator('.brief-fold')).toContainText('Seen before:')
  await expect(spine.locator('.brief-node[data-prompt="u2"]')).toHaveCount(0)
  await spine.getByRole('button', { name: 'Show them' }).click()
  await expect(spine.locator('.brief-node[data-prompt="u2"]')).toHaveCount(1)
  await band.getByRole('button', { name: 'Mark as seen' }).click()
  await expect(band).toHaveCount(0)
  await expect(spine.locator('.brief-cn[data-fresh]')).toHaveCount(0)
  const seen = JSON.parse(readFileSync(join(root, 'hollow', '.torno', 'board', 'seen.json'), 'utf8')) as { cards: Record<string, string> }
  expect(Object.keys(seen.cards)).toContain('C20')
})
