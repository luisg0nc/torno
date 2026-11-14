import { expect, type Locator, type Page } from '@playwright/test'

/** The panels of the rail, by the word under their icons. */
export type PanelName = 'Projects' | 'Layers' | 'Params' | 'Scans' | 'Marks'

/** The rail's button for a panel, as a person finds it: by the word under its icon. */
export const railButton = (page: Page, name: PanelName): Locator => page.locator('[data-region="left"]').getByRole('button', { name, exact: true })

/** The name of the panel open beside the rail now, or null when none is. */
export async function openPanelName(page: Page): Promise<PanelName | null> {
  const pressed = page.locator('[data-region="left"] .rail-button[aria-pressed="true"]')
  return (await pressed.count()) === 0 ? null : ((await pressed.first().getAttribute('aria-label')) as PanelName)
}

/** Opens a panel through the rail, as a person does: pressing its icon. One that is open stays as it is (the icon is not pressed again). */
export async function openPanel(page: Page, name: PanelName): Promise<void> {
  const button = railButton(page, name)
  await expect(button).toBeVisible()
  if ((await button.getAttribute('aria-pressed')) !== 'true') await button.click()
  await expect(button).toHaveAttribute('aria-pressed', 'true')
}

/** Closes the panel open beside the rail, if one is: pressing its icon again. */
export async function closePanel(page: Page): Promise<void> {
  const open = await openPanelName(page)
  if (open === null) return
  await railButton(page, open).click()
  await expect(railButton(page, open)).toHaveAttribute('aria-pressed', 'false')
}
