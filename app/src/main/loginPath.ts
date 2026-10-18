import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { delimiter, isAbsolute, join } from 'node:path'

const MARK = '__TORNO_PATH__'
/** How long the login shell has to answer before it is killed. */
export const SHELL_TIMEOUT_MS = 5000

/** Where the tools torno starts are usually found, though a Finder start does not have them on its PATH. */
export function fallbackDirs(home: string): string[] {
  return [join(home, '.local', 'bin'), '/opt/homebrew/bin', '/usr/local/bin', join(home, '.claude', 'local')]
}

/**
 * The shell's entries first, then those of the current PATH it lacks, then those of the fallbacks it still lacks
 * and that exist. No entry comes twice, and none is empty or relative.
 */
export function mergedPath(fromShell: string | null, current: string, home: string, exists: (dir: string) => boolean): string {
  const seen = new Set<string>()
  const out: string[] = []
  const add = (dir: string, needExist: boolean): void => {
    if (dir === '' || !isAbsolute(dir) || seen.has(dir) || (needExist && !exists(dir))) return
    seen.add(dir)
    out.push(dir)
  }
  for (const dir of (fromShell ?? '').split(delimiter)) add(dir, false)
  for (const dir of current.split(delimiter)) add(dir, false)
  for (const dir of fallbackDirs(home)) add(dir, true)
  return out.join(delimiter)
}

/** What lies between the markers of the shell's output (its rc files may print), or null. */
export function pathBetweenMarkers(output: string): string | null {
  const start = output.indexOf(MARK)
  if (start < 0) return null
  const end = output.indexOf(MARK, start + MARK.length)
  return end < 0 ? null : output.slice(start + MARK.length, end)
}

/** Asks the login shell for its PATH: null when it fails, says nothing useful or is not back in time. */
export function shellPath(shell: string, timeoutMs = SHELL_TIMEOUT_MS): Promise<string | null> {
  return new Promise((resolve) => {
    let out = ''
    let done = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const finish = (value: string | null): void => {
      if (done) return
      done = true
      clearTimeout(timer)
      resolve(value)
    }
    const child = spawn(shell, ['-ilc', `printf "\\n${MARK}%s${MARK}\\n" "$PATH"`], { stdio: ['ignore', 'pipe', 'ignore'] })
    timer = setTimeout(() => {
      child.kill('SIGKILL')
      finish(null)
    }, timeoutMs)
    child.stdout.on('data', (chunk: Buffer) => (out += chunk.toString('utf8')))
    child.on('error', () => finish(null))
    child.on('close', () => finish(pathBetweenMarkers(out)))
  })
}

/**
 * On macOS, outside a test: sets `process.env.PATH` to the login shell's, with the fallbacks. A start from the
 * Finder, the Dock or `open` has launchd's PATH, in which neither `uv` nor `claude` is. Everything torno starts
 * takes its environment from `process.env`.
 */
export async function applyLoginPath(
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
  timeoutMs = SHELL_TIMEOUT_MS
): Promise<void> {
  if (platform !== 'darwin' || env.TORNO_TEST === '1') return
  const shell = env.SHELL || '/bin/zsh'
  const found = await shellPath(shell, timeoutMs)
  if (found === null) console.error(`torno: the login shell ${shell} gave no PATH; using the usual folders only`)
  env.PATH = mergedPath(found, env.PATH ?? '', homedir(), existsSync)
}
