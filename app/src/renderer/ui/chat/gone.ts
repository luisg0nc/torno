import type { ChatImage } from '../../../shared/chat'

/** What the person's own message is called by its pictures (`Pictures`' `what`); a tool card passes its label. */
export const YOUR_MESSAGE = 'Your message'

/**
 * What a picture whose data is gone says in its place: a reference of the person's that could not be read again
 * from `reference/`, a picture a tool gave (it was of a build since gone by), or one of the person's that was never
 * kept (a view attached, a drawing).
 */
export function goneText(image: ChatImage, what: string): string {
  if (image.file) return `${image.file} is no longer there`
  if (what !== YOUR_MESSAGE) return 'Picture of an earlier build, not kept'
  return 'Picture not kept'
}
