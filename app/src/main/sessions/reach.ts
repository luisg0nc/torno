import { basename, dirname, join, relative, resolve } from 'node:path'
import { isInsideFolder } from './inside'

/** The tools that write a file, and the key of their input that names it. */
const WRITERS: Record<string, string> = { Write: 'file_path', Edit: 'file_path', MultiEdit: 'file_path', NotebookEdit: 'notebook_path' }

/**
 * Why a tool of the agent is refused, or undefined when it may go on. A session writes only in its own project's
 * folder and in the workspace's `common/`: `Write`, `Edit` and `NotebookEdit` of any other path (another project, the
 * workspace's root, a new folder) are refused, judged by real paths (`isInsideFolder`). `Bash` is never judged: no
 * path can be read from a command, so the CLI's own card stays.
 */
export function refusalOf(dir: string, name: string, input: unknown): string | undefined {
  const key = WRITERS[name]
  if (!key || typeof input !== 'object' || input === null) return undefined
  const path = (input as Record<string, unknown>)[key]
  if (typeof path !== 'string' || path === '') return undefined
  if (isInsideFolder(join(dir, '.torno'), path)) return torno(dir, name, path)
  if (isInsideFolder(dir, path) || isInsideFolder(join(dirname(dir), 'common'), path)) return undefined
  return `This session works on the project in ${dir}. ${name} may write only there and in the workspace's common/ folder. ` +
    'Other projects and the workspace are the person\'s to open or make: ask them to open the other project, or to make a new one from torno\'s page.'
}

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
