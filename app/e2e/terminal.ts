import { execFileSync } from 'node:child_process'
import { mkdirSync, readdirSync, readlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Claude Code opens in a chat unless an object chooses its terminal. The specs that drive the terminal (typing into
 * it, reading what it shows) choose it in the temporary copy of the fixtures they work on, as a person would in
 * `.torno/agent.json`, and so keep testing the terminal and not the chat (`e2e/chat.spec.ts` tests that). With
 * no `objects`, every folder of the workspace that holds a model.
 */
export function inTerminal(root: string, objects?: string[]): void {
  const names = objects ?? readdirSync(root, { withFileTypes: true }).filter((e) => e.isDirectory() && readdirSync(join(root, e.name)).some((f) => f.endsWith('.py'))).map((e) => e.name)
  for (const name of names) {
    mkdirSync(join(root, name, '.torno'), { recursive: true })
    writeFileSync(join(root, name, '.torno', 'agent.json'), JSON.stringify({ agent: 'claude', view: 'terminal' }))
  }
}

/** The working folder of a process: `/proc/<pid>/cwd` on Linux, `lsof` elsewhere. Null when it is gone or not ours. */
export function cwdOf(pid: number): string | null {
  try {
    if (process.platform === 'linux') return readlinkSync(`/proc/${pid}/cwd`)
    const out = execFileSync('lsof', ['-a', '-d', 'cwd', '-p', String(pid), '-Fn'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
    return out.split('\n').find((line) => line.startsWith('n'))?.slice(1) ?? null
  } catch {
    return null
  }
}

/** The stand-in agents running in a folder (given by its real path, which is how a process sees its cwd), by pid. */
export function agentsIn(dir: string): number[] {
  let pids: number[]
  try {
    pids = execFileSync('pgrep', ['-f', 'fake-agent.mjs'], { encoding: 'utf8' }).split('\n').filter(Boolean).map(Number)
  } catch {
    return [] // pgrep exits 1 when nothing matches
  }
  return pids.filter((pid) => cwdOf(pid) === dir)
}
