import { expect, type Locator, type Page } from '@playwright/test'

/** The sections of the route card, by the name of their rail buttons (a tip on hover, no word under the icon), and the id the card keeps each under (`data-section`). */
const SECTION = {
  'Needs you': 'needs',
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
