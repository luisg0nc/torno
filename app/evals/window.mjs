// Opening a project in the window as a person does, for the evals: what `e2e/objects.ts` `openListed` and
// `e2e/helpers.ts` `showProjects` do, in plain JavaScript (the runner is not compiled). Keep them alike.

/** Opens a project by its name: from the menu of the title bar's project crumb while one is open, else from its card on the page of projects. */
export async function openListed(page, name) {
  const crumb = page.locator('.title-row').getByRole('button', { name: /^Project / })
  if ((await crumb.count()) > 0) {
    if (((await crumb.getAttribute('aria-label')) ?? '') === `Project ${name}`) return
    await crumb.click()
    await page.getByRole('menu', { name: 'Projects' }).getByRole('menuitem', { name, exact: true }).click()
    return
  }
  if ((await page.evaluate(() => window.__tornoTest.state().page)) !== 'objects') await page.keyboard.press('w')
  const card = page.locator(`.show .card[data-object="${name}"]`)
  await card.waitFor()
  await card.click()
}
