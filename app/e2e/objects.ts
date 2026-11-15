import { expect, type Page } from '@playwright/test'
import { openPanel, openPanelName, railButton } from './helpers'

// The list of projects as a person uses it: the Projects panel, opened through the rail, with a row for each
// project. It is the panel's, so a spec that opens one panel to look at another goes back to it.

/** The navigation of the projects in the Projects panel. */
export const objectList = (page: Page) => page.getByRole('navigation', { name: 'Projects' })

/** The rail's Projects button: it says (`data-session`, its description) that a session of any project works or waits. */
export const switcher = (page: Page) => railButton(page, 'Projects')

/**
 * Opens a project by its name, as a person does: its row in the Projects panel. The one open already stays as it is.
 * The panel that was open goes back to being open afterwards, so what a spec reads next is where it was.
 */
export async function openListed(page: Page, name: string): Promise<void> {
  const was = await openPanelName(page)
  await openPanel(page, 'Projects')
  const row = objectList(page).getByRole('button', { name, exact: true })
  await expect(row).toBeVisible()
  if ((await row.getAttribute('aria-current')) !== 'true') await row.click()
  if (was !== null && was !== 'Projects') await openPanel(page, was)
}

/** "New project", from the foot of the Projects panel. */
export async function newFromList(page: Page): Promise<void> {
  await openPanel(page, 'Projects')
  const button = objectList(page).getByRole('button', { name: 'New project' })
  await expect(button).toBeVisible()
  // The page of the new project is up already: the button says so, pressed.
  if ((await button.getAttribute('aria-pressed')) !== 'true') await button.click()
}
