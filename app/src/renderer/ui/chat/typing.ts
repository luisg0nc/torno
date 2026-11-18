/**
 * What takes the keys of a person who is writing: a field, a select, an editable region, the terminal's hidden textarea
 * (xterm's helper), a slider or a spin button. A button, a checkbox or a link is not one.
 */
export const EDITABLE =
  'textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"], [role="slider"], [role="spinbutton"], [role="combobox"], ' +
  'input:not([type="button"]):not([type="checkbox"]):not([type="radio"]):not([type="submit"]):not([type="reset"]):not([type="image"])'

/** Whether the element (or one it is in) is somewhere the person types: a card that comes must not take the focus from it. */
export function isEditable(el: { closest(selector: string): unknown } | null | undefined): boolean {
  return !!el && !!el.closest(EDITABLE)
}
