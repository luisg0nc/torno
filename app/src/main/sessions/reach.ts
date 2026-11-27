import { readlinkSync } from 'node:fs'
import { basename, dirname, join, relative, resolve } from 'node:path'
import { isInsideFolder, realPathOrNearest } from './inside'

/** The tools that write a file, and the key of their input that names it. */
export const WRITERS: Record<string, string> = { Write: 'file_path', Edit: 'file_path', MultiEdit: 'file_path', NotebookEdit: 'notebook_path' }

/** The most links followed one after another, as Linux does: a circle of links ends there. */
const MOST_LINKS = 40

/**
 * Where a write of `path` lands, by real paths: a link as its last name is followed also when what it names is not
 * there yet, since the write would make it.
 */
export function writtenAt(path: string): string {
  let at = path
  for (let hop = 0; hop < MOST_LINKS; hop++) {
    const placed = join(realPathOrNearest(dirname(at)), basename(at))
    let target: string
    try {
      target = readlinkSync(placed)
    } catch {
      // Not a link, or nothing there.
      return realPathOrNearest(placed)
    }
    at = resolve(dirname(placed), target)
  }
  return at
}

/**
 * Why a tool of the agent is refused, or undefined when it may go on. A session writes only in its own project's
 * folder and in the workspace's `common/`: `Write`, `Edit` and `NotebookEdit` of any other path (another project, the
 * workspace's root, a new folder) are refused, judged by real paths (`isInsideFolder`). `Bash` is never judged: no
 * path can be read from a command, so the CLI's own card stays.
 */
export function refusalOf(dir: string, name: string, input: unknown, opts: { /** The one turn that moves Claude's old sections out of `brief.md` (#341) may write it. */ brief?: boolean } = {}): string | undefined {
  const key = WRITERS[name]
  if (!key || typeof input !== 'object' || input === null) return undefined
  const path = (input as Record<string, unknown>)[key]
  if (typeof path !== 'string' || path === '') return undefined
  if (isInsideFolder(join(dir, '.torno'), path)) return torno(dir, name, path)
  if (opts.brief !== true && realPathOrNearest(resolve(dir, path)) === realPathOrNearest(join(dir, 'brief.md'))) return BRIEF_REFUSAL(name)
  if (isInsideFolder(dir, path) || isInsideFolder(join(dirname(dir), 'common'), path)) return undefined
  return `This session works on the project in ${dir}. ${name} may write only there and in the workspace's common/ folder. ` +
    'Other projects and the workspace are the person\'s to open or make: ask them to open the other project, or to make a new one from torno\'s page.'
}

/**
 * Why Claude may not write `brief.md` (#337): it is the person's own words, and what Claude learns is a card of its own,
 * one per topic, which it changes rather than adding another.
 */
export const BRIEF_REFUSAL = (name: string): string =>
  `${name} may not write brief.md: it is the person's own words, and only they change it. Write down what you learned as a card of yours with add_card, ` +
  'one card per topic that begins with its name ("Mount: an adjustable arm, ..."); when a topic changes, change your card of it (card and text) rather than add another.'

/** What to use in place of a file of `.torno/`, which is torno's alone to write: ids, atomic writes and the rules of each file are its. */
const INSTEAD: Record<string, string> = {
  'marks.json': 'add_mark and resolve_mark',
  'sets.json': 'add_set',
  'tracings.json': 'add_tracing and add_layer',
  'params.json': 'try_params (the person sets the values in torno\'s window)',
  'scans.json': 'the scan tools (the person imports and aligns scans)'
}

function torno(dir: string, name: string, path: string): string {
  const file = relative(join(dir, '.torno'), resolve(dir, path)).split(/[\\/]/)[0] ?? ''
  const board = file === 'board' ? 'add_card and add_sketch' : undefined
  const tool = INSTEAD[basename(file)] ?? board
  return `${name} may not write under .torno/: it is torno's own, and a hand edit skips its rules. ` +
    (tool ? `Use ${tool} instead.` : 'torno has a tool for each thing it keeps there (marks, sets, tracings, the board); read a file there with Read.')
}

/** The `PreToolUse` answer that refuses a tool, with the reason the agent reads. */
export function deniedAnswer(reason: string): unknown {
  return { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason } }
}
