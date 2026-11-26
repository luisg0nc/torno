import { takeGoBackNotice } from './goback'
import { takeRenameNotice } from './rename'

/**
 * What main left for the next prompt to tell Claude, first in its context: a Go back's notice (`takeGoBackNotice`) and a
 * rename's (`takeRenameNotice`), one line each. `done` lets both go, and is called once the answer that holds the text has
 * left (`PromptContext.delivered`), never before, so that a prompt whose answer never left tells them again. Null with none.
 */
export async function takeNotices(dir: string): Promise<{ text: string; done: () => Promise<void> } | null> {
  const wentBack = await takeGoBackNotice(dir).catch(() => null)
  const renamed = await takeRenameNotice(dir).catch(() => null)
  if (!wentBack && !renamed) return null
  return {
    text: [wentBack?.text, renamed?.text].filter((t): t is string => typeof t === 'string').join('\n'),
    done: async () => {
      await Promise.all([wentBack?.done(), renamed?.done()])
    }
  }
}
