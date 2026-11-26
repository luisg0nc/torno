import { cpSync, existsSync, mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import type { TornoState } from '../src/renderer/state/store'
import { benchTab, newSession as fromDock } from './helpers'
import { openListed } from './objects'

// Claude asks before it puts a part it researched on the shelf (#354): the question with the header `Shelf` is a card with a table of the sizes
// and their sources, its buttons answer, and a write to `common/parts/<id>/` has a slip under it with "Open it". The agent is the stand-in: it asks,
// and writes the part only after the answer, as the torno-model skill tells Claude to.
const appDir = resolve(__dirname, '..')
const fixtures = resolve(appDir, '../kernel/tests/fixtures/ws')
const fakeAgent = resolve(appDir, 'test/fake-agent.mjs')

test.describe.configure({ mode: 'serial' })

let root: string
let home: string
let app: ElectronApplication
let page: Page

test.beforeAll(async () => {
  root = mkdtempSync(join(realpathSync(tmpdir()), 'torno-e2e-shelfask-'))
  home = mkdtempSync(join(realpathSync(tmpdir()), 'torno-e2e-shelfask-home-'))
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
const dock = () => page.locator('[data-region="session"]')
const chat = () => dock().locator('.chat')
const composer = () => dock().locator('[data-chat-composer]')
const turns = () => chat().locator('.chat-turn')
const asks = () => chat().locator('.chat-ask')
const slips = () => chat().locator('.chat-shelf-slip')

/** Put a script in the box, one command a line, and send it. */
async function script(lines: string[]): Promise<void> {
  await composer().focus()
  await composer().fill(lines.join('\n'))
  await page.keyboard.press('Enter')
}

let ended = 0
async function finished(): Promise<void> {
  ended += 1
  await expect(turns()).toHaveCount(ended, { timeout: 20_000 })
}

const TITLE = 'Put the Waveshare board on the parts shelf?'
const question = (title: string) => ({
  questions: [
    {
      header: 'Shelf',
      multiSelect: false,
      question: [title, 'Then the next project that uses it takes these sizes.', '40.9 × 19.7 board outline (datasheet)', '1.6 board thickness (datasheet)', '7.5 thickness with the screen (assumed)', '12 × 25 room for the USB-C plug (assumed)'].join('\n'),
      options: [{ label: 'Put it on the shelf', description: 'Writes common/parts/waveshare_147/' }, { label: 'Not this one', description: 'Leaves the shelf alone' }]
    }
  ]
})
const ask = (title = TITLE): string => `ask AskUserQuestion ${JSON.stringify(question(title))}`

/** The fixture's ec11, as a part of another name: a small valid part for the stand-in to write. */
const partText = (name: string): string => readFileSync(join(root, 'common/parts/ec11/part.py'), 'utf8').replace('EC11 rotary encoder', name).replaceAll('\n', '\\n')
const partFile = (id: string): string => join(root, 'common', 'parts', id, 'part.py')

test('the question with the header Shelf is a card: its title, the sizes as a table with the assumed ones in warn, and buttons that answer', async () => {
  await openListed(page, 'hollow')
  await expect.poll(async () => { const s = await state(); return s.objectId === 'hollow' && s.build?.status }, { timeout: 30_000 }).toBe('ok')
  await expect(benchTab(page, 'Shelf')).toHaveText(/^Shelf\s*1$/)
  await fromDock(dock())
  await expect(composer()).toBeEnabled()

  await script([ask(), `write ${partFile('waveshare_147')} ${partText('Waveshare 1.47 touch LCD')}`])
  const card = asks().last()
  await expect(card).toHaveAttribute('data-state', 'open', { timeout: 10_000 })
  await expect(card.locator('.chat-ask-text')).toHaveText(TITLE)
  await expect(card.locator('.chat-offer-note')).toHaveText('Then the next project that uses it takes these sizes.')
  await expect(card.locator('.chat-offer-size')).toHaveCount(4)
  await expect(card.locator('.chat-offer-size dt')).toHaveText(['40.9 × 19.7', '1.6', '7.5', '12 × 25'])
  await expect(card.locator('.chat-offer-what')).toHaveText(['board outline', 'board thickness', 'thickness with the screen', 'room for the USB-C plug'])
  await expect(card.locator('.chat-offer-source')).toHaveText(['datasheet', 'datasheet', 'assumed', 'assumed'])
  expect(await card.locator('.chat-offer-size').evaluateAll((els) => els.map((el) => el.getAttribute('data-tone')))).toEqual(['plain', 'plain', 'warn', 'warn'])
  // The values are in the face of numbers; assumed is in the warning colour, a datasheet's is not.
  expect(await card.locator('.chat-offer-size dt').first().evaluate((el) => getComputedStyle(el).fontFamily)).toContain('Mono')
  const colour = (n: number) => card.locator('.chat-offer-source').nth(n).evaluate((el) => getComputedStyle(el).color)
  expect(await colour(2)).toBe(await colour(3))
  expect(await colour(2)).not.toBe(await colour(0))
  // Its answers are the card's buttons, the first the primary one, and the field is there for the person's own words.
  await expect(card.getByRole('button', { name: 'Put it on the shelf' })).toHaveClass(/button-primary/)
  await expect(card.getByRole('button', { name: 'Not this one' })).not.toHaveClass(/button-primary/)
  await expect(card.getByPlaceholder('or answer in your words')).toBeVisible()
  // The field has room for all of its words (it wraps under the buttons when it does not fit beside them).
  expect(await card.getByPlaceholder('or answer in your words').evaluate((el: HTMLInputElement) => el.scrollWidth <= el.clientWidth && el.clientWidth >= 150)).toBe(true)
  // Nothing is written before the answer.
  expect(existsSync(partFile('waveshare_147'))).toBe(false)
  await expect(slips()).toHaveCount(0)

  await card.getByRole('button', { name: 'Put it on the shelf' }).click()
  await expect(card).toHaveAttribute('data-state', 'allowed')
  await finished()
})

test('after a yes the part is written, the shelf takes it in, and a slip under the Write says so and opens it', async () => {
  expect(existsSync(partFile('waveshare_147'))).toBe(true)
  // The answered card in the transcript is the offer's title and table and the answer's line, with no raw text box.
  const done = asks().last()
  await expect(done).toHaveAttribute('data-state', 'allowed')
  await expect(done.locator('.chat-ask-text')).toHaveText(TITLE)
  await expect(done.locator('.chat-offer-size')).toHaveCount(4)
  await expect(done.locator('.chat-offer-size dt')).toHaveText(['40.9 × 19.7', '1.6', '7.5', '12 × 25'])
  await expect(done.locator('.chat-ask-outcome')).toHaveText('Answered: Put it on the shelf')
  await expect(done.locator('.chat-ask-answers')).toHaveCount(0)
  const slip = slips().last()
  await expect(slip).toHaveAttribute('data-part', 'waveshare_147')
  await expect(slip.locator('.chat-shelf-slip-head')).toHaveText(/On the shelf:\s*waveshare_147\s*part\.py/)
  expect(await slip.locator('.chat-shelf-slip-id').evaluate((el) => getComputedStyle(el).fontFamily)).toContain('Mono')
  // The store reads the folder again, and the slip has the part's own row pieces: its name, what it cuts and its rules.
  await expect(benchTab(page, 'Shelf')).toHaveText(/^Shelf\s*2$/, { timeout: 15_000 })
  await expect(slip.locator('.shelf-name')).toHaveText('Waveshare 1.47 touch LCD')
  await expect(slip.locator('.shelf-hole')).toHaveText('hole Ø7.2')
  await expect(slip.locator('.shelf-rules i')).toHaveCount(7)
  await expect(slip.locator('svg.shelf-draw')).toBeVisible()
  // It stands under the card of the tool that wrote it.
  await expect(chat().locator('.chat-group:has(.chat-tool[data-kind="tool"]) .chat-shelf-slip')).toHaveCount(1)

  await slip.getByRole('button', { name: 'Open it' }).click()
  await expect.poll(async () => (await state()).shelfOpen).toBe('waveshare_147')
  await expect(page.locator('main.viewport .part-page[data-part-page="waveshare_147"]')).toBeVisible()
})

test('a no writes nothing: no folder, no slip, and the shelf stays as it was', async () => {
  await script([ask('Put the Waveshare board on the parts shelf, again?'), 'say left alone'])
  const card = asks().last()
  await expect(card).toHaveAttribute('data-state', 'open', { timeout: 10_000 })
  await card.getByRole('button', { name: 'Not this one' }).click()
  await expect(card).toHaveAttribute('data-state', 'allowed')
  await finished()
  await expect(card).toContainText('Not this one')
  expect(existsSync(partFile('other'))).toBe(false)
  await expect(slips()).toHaveCount(1)
  await expect(benchTab(page, 'Shelf')).toHaveText(/^Shelf\s*2$/)
})

test('several writes to one part in a turn are one slip, under the last, and a part that does not build says so in warn', async () => {
  const broken = '"""Broken one\\nA part that cannot be read.\\n"""\\nraise ValueError(\\"no\\")'
  await script([`write ${partFile('broken_one')} ${broken}`, `edit ${partFile('broken_one')} "ValueError(" "ValueError('so', "`, 'say done'])
  await finished()
  const slip = slips().last()
  await expect(slip).toHaveAttribute('data-part', 'broken_one')
  await expect(slips()).toHaveCount(2)
  await expect(slip.locator('.chat-shelf-slip-files')).toHaveText('part.py')
  await expect(slip.locator('.shelf-broken')).toHaveText('does not build', { timeout: 15_000 })
  // The warning colour is the tab's: the same as an assumed rule's.
  await expect(benchTab(page, 'Shelf')).toBeVisible()
  const warn = await page.evaluate(() => {
    const probe = document.createElement('i')
    probe.style.color = 'var(--warn)'
    document.body.append(probe)
    const colour = getComputedStyle(probe).color
    probe.remove()
    return colour
  })
  expect(await slip.locator('.shelf-broken').evaluate((el) => getComputedStyle(el).color)).toBe(warn)
  // The slip is under the edit, the last of the two.
  const group = chat().locator('.chat-group:has(.chat-shelf-slip[data-part="broken_one"])')
  await expect(group).toHaveCount(1)
  await expect(group.locator('.chat-tool-label')).toContainText('Edit')
})
