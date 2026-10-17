import type { MenuItemConstructorOptions } from 'electron'

/** What the menu asks of the shell. */
export interface MenuActions {
  /** Quits through the window's own question ("Close torno?"), or at once when there is no window. */
  quit: () => void
}

/**
 * The application menu: macOS only, where the menu bar is global and a text field takes copy, paste, cut,
 * select all and undo from the roles of the menu. Anywhere else `null`: with a menu, even hidden, a lone Alt
 * shows the menu bar on Linux and resizes the viewport under the pointer.
 *
 * No Close item (closing the window ends torno, and there is no `Ctrl+W`), and no View menu (no reload, no
 * developer tools, no zoom: the developer keys are `devkeys.ts`). Quit is no role: it goes through the window.
 */
export function menuTemplate(platform: NodeJS.Platform, actions: MenuActions): MenuItemConstructorOptions[] | null {
  if (platform !== 'darwin') return null
  return [
    {
      label: 'torno',
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { label: 'Quit torno', accelerator: 'Command+Q', click: () => actions.quit() }
      ]
    },
    { role: 'editMenu' },
    { role: 'windowMenu' }
  ]
}
