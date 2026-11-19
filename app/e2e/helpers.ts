import { expect, type Locator, type Page } from '@playwright/test'

/** The sections still in the route card, by the name of their heads, and the id the card keeps each under (`data-section`). */
const SECTION = {
  Scans: 'scans',
  Tracings: 'tracings'
} as const

/** The blocks of the Brief page that were sections of the card before #277, by name, and the id each keeps (`data-section`). */
const HELD = { Checks: 'checks', Marks: 'marks' } as const

export type SectionName = keyof typeof SECTION | keyof typeof HELD

/** The bench's two tabs, which are no sections: Parameters and Parts. */
const TABS = { Parts: 'parts', Parameters: 'params' } as const
export type TabName = keyof typeof TABS

/** A tab of the bench, by the name on it. */
export const benchTab = (page: Page, name: TabName): Locator => page.locator(`[data-region="left"] .bench-tab[data-tab="${TABS[name]}"]`)

/** Opens a tab of the bench with a click, as a person does. A tab the project does not have (a one-part model has Parameters alone) is no tab: the spec fails there. */
export async function openTab(page: Page, name: TabName): Promise<void> {
  const tab = benchTab(page, name)
  await expect(tab).toBeVisible()
  if ((await tab.getAttribute('aria-selected')) !== 'true') await tab.click()
  await expect(tab).toHaveAttribute('aria-selected', 'true')
}

/** The Brief page, shown in the view's place. */
export const briefPage = (page: Page): Locator => page.locator('main.viewport .brief-page')

/** Shows the Brief page with a click on the view's switch, as a person does; one that is up stays as it is. */
export async function showBrief(page: Page): Promise<void> {
  const button = page.locator('.pboard-switch-button', { hasText: 'Brief' })
  if ((await button.getAttribute('aria-pressed')) !== 'true') await button.click()
  await expect(briefPage(page)).toBeVisible()
}

/** Shows the model again with a click on the view's switch. */
export async function showModel(page: Page): Promise<void> {
  const button = page.locator('.pboard-switch-button', { hasText: 'Model' })
  if ((await button.getAttribute('aria-pressed')) !== 'true') await button.click()
  await expect(briefPage(page)).toHaveCount(0)
}

/**
 * A section of the route card, whole (its head and its body), or a block of the Brief page: Checks and Marks are there since
 * #277, so they are drawn only while the Brief is shown (`openSection` shows it).
 */
export const cardSection = (page: Page, name: SectionName): Locator =>
  name === 'Checks' || name === 'Marks' ? page.locator(`.brief-page [data-section="${HELD[name]}"]`) : page.locator(`[data-region="left"] [data-section="${SECTION[name]}"].route-section`)

/** Brings a section into sight as a person does with no rail: the card is scrolled to it and its head is pressed if it is folded. It is unfolded afterwards. Checks and Marks are on the Brief page, which is shown (and stays up: `showModel` goes back). */
export async function openSection(page: Page, name: SectionName | TabName): Promise<void> {
  if (name === 'Parts' || name === 'Parameters') return openTab(page, name)
  if (name === 'Checks' || name === 'Marks') {
    await showBrief(page)
    await cardSection(page, name).scrollIntoViewIfNeeded()
    return
  }
  const section = cardSection(page, name)
  await expect(section).toBeVisible()
  await section.scrollIntoViewIfNeeded()
  // A head that says "none" does not unfold: it is pressed once there is something in it (a build that has not landed yet).
  await expect
    .poll(async () => {
      if ((await section.getAttribute('data-folded')) === null) return true
      if ((await section.getAttribute('data-empty')) === null) await section.locator('.route-head-button').click()
      return (await section.getAttribute('data-folded')) === null
    })
    .toBe(true)
}

/** Folds a section of the card to its head, as a person does: a click on the head. One that is folded stays as it is. */
export async function foldSection(page: Page, name: Exclude<SectionName, 'Checks' | 'Marks'>): Promise<void> {
  const section = cardSection(page, name)
  if ((await section.getAttribute('data-folded')) === null) await section.locator('.route-head-button').click()
  await expect(section).toHaveAttribute('data-folded', '')
}

/**
 * Shows the page of projects as a person does: "All projects" in the menu of the title bar's project crumb while a project is
 * open, else the key `W`. One that is up stays as it is.
 */
export async function showProjects(page: Page): Promise<void> {
  const shown = page.locator('section.show')
  if ((await page.evaluate(() => window.__tornoTest!.state().page)) !== 'objects') {
    // The page of a new project has its own way, which keeps the draft.
    const all = page.locator('.title-row').getByRole('button', { name: 'All projects', exact: true })
    if ((await all.count()) > 0) await all.click()
    else {
    const crumb = page.locator('.title-row').getByRole('button', { name: /^Project / })
    if ((await crumb.count()) > 0) {
      await crumb.click()
      await page.getByRole('menu', { name: 'Projects' }).getByRole('menuitem', { name: /^All projects/ }).click()
    } else await page.keyboard.press('w')
    }
  }
  await expect(shown).toBeVisible()
}

/** The keyboard's button at the right of the status line. */
export const keysButton = (page: Page): Locator => page.locator('.status [data-keys-button]')

/** The print profile chip of the status line. */
export const profileChip = (page: Page): Locator => page.locator('.status .status-profile')

/** The print profile's card, opened from its chip if it is not up. */
export async function openProfile(page: Page): Promise<Locator> {
  const card = page.getByRole('dialog', { name: 'Print profile' })
  if (!(await card.isVisible())) await profileChip(page).click()
  await expect(card).toBeVisible()
  return card
}

/** A choice of the dock's "More" menu, as a person makes it: the menu is opened from its button, then the item is pressed. */
export async function fromMore(dock: Locator, item: string): Promise<void> {
  await dock.getByRole('button', { name: 'More', exact: true }).click()
  await dock.page().getByRole('menu', { name: 'More' }).getByRole('menuitem', { name: item, exact: true }).click()
}

/**
 * "New session" in the dock, wherever a person finds it: the button of the pane with no session, or, with one (live or ended),
 * the item of the header's More menu.
 */
export async function newSession(dock: Locator): Promise<void> {
  const plain = dock.getByRole('button', { name: 'New session', exact: true })
  await expect(plain.or(dock.locator('.session-status'))).toBeVisible()
  if (await plain.isVisible()) await plain.click()
  else await fromMore(dock, 'New session')
}

/** The model, edits or effort list of the dock, as a person reaches it: the header's model button is pressed, if its menu is not up. */
export async function inModelMenu(dock: Locator, name: 'Model' | 'Edits' | 'Effort'): Promise<Locator> {
  const list = dock.getByRole('combobox', { name, exact: true })
  if (!(await list.isVisible())) await dock.locator('button.session-model').click()
  await expect(list).toBeVisible()
  return list
}

/** The model button's menu put away, if it is up. */
export async function closeModelMenu(dock: Locator): Promise<void> {
  if (await dock.getByRole('combobox', { name: 'Model', exact: true }).isVisible()) await dock.locator('button.session-model').click()
  await expect(dock.getByRole('combobox', { name: 'Model', exact: true })).toHaveCount(0)
}

/** What the dock's More menu offers right now, in order: it is opened, read and put away again. */
export async function moreItems(dock: Locator): Promise<string[]> {
  await dock.getByRole('button', { name: 'More', exact: true }).click()
  const menu = dock.page().getByRole('menu', { name: 'More' })
  await expect(menu).toBeVisible()
  const items = (await menu.getByRole('menuitem').allTextContents()).map((t) => t.trim())
  await dock.page().keyboard.press('Escape')
  await expect(menu).toHaveCount(0)
  return items
}

/** The dock's builds strip starts shut, one line; this opens it as a person does, by its line (it stays as it is when it is open already). */
export async function openStrip(page: Page): Promise<void> {
  const toggle = page.locator('[data-region="session"] .strip-toggle')
  await expect(toggle).toBeVisible()
  if ((await toggle.getAttribute('aria-expanded')) === 'false') await toggle.click()
  await expect(toggle).toHaveAttribute('aria-expanded', 'true')
}

/**
 * Reads something of the Brief page (a mark's row, a check's row) as a person does: the page is shown, `read` runs, and the model is
 * shown again so that the spec goes on with the view. Checks and Marks are on that page since #277.
 */
export async function onBrief<T>(page: Page, read: () => Promise<T>): Promise<T> {
  await showBrief(page)
  try {
    return await read()
  } finally {
    await showModel(page)
  }
}

/**
 * Presses and releases the left button where the mouse is, as one click. The view counts a release as a click only within 400 ms of
 * its press, by the time of the two events; `mouse.down()` returns once the window has handled the press, so a window busy with
 * a frame (software GL, as on CI) took longer than that and the release came too late. Both are sent at once, and stamped together.
 */
export async function clickHere(page: Page): Promise<void> {
  await Promise.all([page.mouse.down(), page.mouse.up()])
}
