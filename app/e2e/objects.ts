import { expect, type Locator, type Page } from '@playwright/test'
import { railButton, showProjects } from './helpers'

// The projects of the folder as a person uses them: the page of projects (its cards, its New project), and, while one is open, the
// project crumb of the title bar with the menu of the folder's projects.

/** The menu of the folder's projects, hung from the project crumb of the title bar (All projects at its head). */
export const projectMenu = (page: Page): Locator => page.getByRole('menu', { name: 'Projects' })

/** The project crumb of the title bar: the open project, and the menu of the others. */
export const projectCrumb = (page: Page): Locator => page.locator('.title-row').getByRole('button', { name: /^Project / })

/** The rail's Projects button: it says (`data-session`, its description) that a session of any project works or waits. */
export const switcher = (page: Page) => railButton(page, 'Projects')

/** The card of a project on the page of projects. */
export const projectCard = (page: Page, name: string): Locator => page.locator(`.show .card[data-object="${name}"]`)

/** A shelf of the bench: `Needs you`, `Working` or `The rest`, with its heading, its projects and what they ask. */
export const shelfOf = (page: Page, name: 'Needs you' | 'Working' | 'The rest'): Locator => page.locator('section.show').getByRole('region', { name, exact: true })

/** The page of projects, as a person finds it: the section that holds the cards. */
export const projectsPage = (page: Page): Locator => page.locator('section.show')

/**
 * Opens a project by its name, as a person does: from the menu of the project crumb while one is open, else from its card on the
 * page of projects (reached through the rail's Projects). The one open already stays as it is.
 */
export async function openListed(page: Page, name: string): Promise<void> {
  const crumb = projectCrumb(page)
  if ((await crumb.count()) > 0) {
    if (((await crumb.getAttribute('aria-label')) ?? '') === `Project ${name}`) return
    await crumb.click()
    const item = projectMenu(page).getByRole('menuitem', { name, exact: true })
    await expect(item).toBeVisible()
    await item.click()
    return
  }
  await showProjects(page)
  const card = projectCard(page, name)
  await expect(card).toBeVisible()
  await card.click()
}

/** "New project", from the page of projects. */
export async function newFromList(page: Page): Promise<void> {
  if ((await page.locator('.new-layout').count()) > 0) return
  await showProjects(page)
  const button = projectsPage(page).getByRole('button', { name: 'New project', exact: true }).first()
  await expect(button).toBeVisible()
  await button.click()
}
