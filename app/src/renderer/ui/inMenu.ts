/**
 * Whether a key was pressed with the focus in a menu, such as one of the title bar's opened over a sheet. A sheet that
 * hears keys before anything else leaves the menu its Escape, so the menu closes first and the next one is the sheet's.
 */
export const inMenu = (e: KeyboardEvent): boolean => e.target instanceof Element && e.target.closest('[role="menu"]') !== null
