import { expect, type Locator, type Page } from '@playwright/test'

/** The sections of the route card, by the name of their rail buttons (a tip on hover, no word under the icon), and the id the card keeps each under (`data-section`). */
const SECTION = {
  Parts: 'parts',
  Parameters: 'params',
  Checks: 'checks',
  Marks: 'marks',
  Scans: 'scans',
  Tracings: 'tracings',
  'Print profile': 'profile'
} as const

export type SectionName = keyof typeof SECTION

/** The rail's buttons: Projects and Keys, and the index of the card's sections. */
export type RailName = 'Projects' | 'Keys' | SectionName

/** The rail's button for a section, or Projects or Keys, as a person finds it: by its name. */
export const railButton = (page: Page, name: RailName): Locator => page.locator('[data-region="left"] .rail').getByRole('button', { name, exact: true })

/** A section of the route card, whole: its head and its body. */
export const cardSection = (page: Page, name: SectionName): Locator => page.locator(`[data-region="left"] [data-section="${SECTION[name]}"].route-section`)

/** Brings a section into sight through the rail's index, as a person does: pressing its icon. It is unfolded afterwards (a press on the icon unfolds a folded one). */
export async function openSection(page: Page, name: SectionName): Promise<void> {
  const button = railButton(page, name)
  await expect(button).toBeVisible()
  await button.click()
  await expect(cardSection(page, name)).not.toHaveAttribute('data-folded', '')
}

/** Folds a section of the card to its head, as a person does: a click on the head. One that is folded stays as it is. */
export async function foldSection(page: Page, name: SectionName): Promise<void> {
  const section = cardSection(page, name)
  if ((await section.getAttribute('data-folded')) === null) await section.locator('.route-head-button').click()
  await expect(section).toHaveAttribute('data-folded', '')
}

/** Shows the page of projects through the rail's Projects button, as a person does. One that is up stays as it is. */
export async function showProjects(page: Page): Promise<void> {
  const button = railButton(page, 'Projects')
  await expect(button).toBeVisible()
  if ((await button.getAttribute('aria-pressed')) !== 'true') await button.click()
  await expect(button).toHaveAttribute('aria-pressed', 'true')
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
