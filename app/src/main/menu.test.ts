import type { MenuItemConstructorOptions } from 'electron'
import { describe, expect, it, vi } from 'vitest'
import { menuTemplate } from './menu'

function all(items: MenuItemConstructorOptions[]): MenuItemConstructorOptions[] {
  return items.flatMap((item) => [item, ...(Array.isArray(item.submenu) ? all(item.submenu) : [])])
}

describe('menuTemplate', () => {
  it('is null anywhere but macOS', () => {
    for (const platform of ['linux', 'win32'] as const) expect(menuTemplate(platform, { quit: () => {} })).toBeNull()
  })

  it('on macOS has the app, edit and window menus, and nothing that reloads, zooms or closes', () => {
    const quit = vi.fn()
    const items = all(menuTemplate('darwin', { quit })!)
    const roles = items.map((item) => item.role)
    for (const role of ['about', 'hide', 'hideOthers', 'unhide', 'editMenu', 'windowMenu']) expect(roles).toContain(role)
    for (const role of ['close', 'reload', 'forceReload', 'toggleDevTools', 'resetZoom', 'zoomIn', 'zoomOut', 'togglefullscreen', 'quit', 'viewMenu'])
      expect(roles).not.toContain(role)
    const exit = items.find((item) => item.label === 'Quit torno')!
    expect(exit.role).toBeUndefined()
    expect(exit.accelerator).toBe('Command+Q')
    ;(exit.click as () => void)()
    expect(quit).toHaveBeenCalledOnce()
  })

  it('takes no key of the table of keys: every accelerator is a Command one', () => {
    for (const item of all(menuTemplate('darwin', { quit: () => {} })!)) {
      if (item.accelerator) expect(String(item.accelerator)).toMatch(/^Command\+/)
    }
  })
})
