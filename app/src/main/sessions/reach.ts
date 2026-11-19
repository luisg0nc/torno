import { dirname, join } from 'node:path'
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
  if (isInsideFolder(dir, path) || isInsideFolder(join(dirname(dir), 'common'), path)) return undefined
  return `This session works on the project in ${dir}. ${name} may write only there and in the workspace's common/ folder. ` +
    'Other projects and the workspace are the person\'s to open or make: ask them to open the other project, or to make a new one from torno\'s page.'
}

/** The `PreToolUse` answer that refuses a tool, with the reason the agent reads. */
export function deniedAnswer(reason: string): unknown {
  return { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason } }
}
