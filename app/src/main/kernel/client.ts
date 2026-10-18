import { REBUILD_HOW } from '../../shared/build'
import { type ChildProcessWithoutNullStreams, spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import type { BuildError } from '../../shared/build'
import type { Scene } from '../../shared/scene'
import { encodeFrame, FrameDecoder } from './frames'

const STDERR_LINES = 200
const RESTART_WINDOW_MS = 30_000 // a second unexpected exit this soon after the first is not retried
const SHUTDOWN_GRACE_MS = 3_000 // the kernel takes up to 1 s to flush its last replies

export type BuildResult = { ok: true; scene: Scene; blob: Buffer } | { ok: false; error: BuildError }

export class KernelError extends Error {
  constructor(
    readonly kind: string,
    message: string,
    /** Of a `no_build`: `memory` when the kernel let the build go to make room for another, and holds none until one of it succeeds. */
    readonly reason?: string
  ) {
    super(message)
    this.name = 'KernelError'
  }
}

/**
 * Whether a query was answered at once because the worker that holds the
 * build is still busy with one it was given up on (`_query` in
 * kernel/src/torno_kernel/supervisor.py). It has the kind of a query that
 * took too long itself, and is told apart by its words: this one says
 * nothing of what was asked, and is worth asking again. Known by its words
 * also once it is a plain error, as what the kernel says is passed on
 * (`plain` in marks/measure.ts).
 */
export function isBusy(e: unknown): boolean {
  if (!(e instanceof Error) || (e instanceof KernelError && e.kind !== 'timeout')) return false
  return /\bis still busy with a query it did not answer\b/.test(e.message)
}

export interface KernelClient {
  /** The first start. Rejects if the kernel stops for good before it is ever ready. */
  ready: Promise<{ versions: Record<string, string> }>
  /** Starting a build cancels the one running, which then resolves with kind `cancelled`. Never rejects. `onStarted` is told the folders whose builds the kernel let go to make room for it. */
  build(dir: string, model: string, opts?: { timeout?: number; onStarted?: (started: { retired: string[] }) => void }): Promise<BuildResult>
  /**
   * Ask about the last successful build of the object in the folder `dir`. The
   * kernel keeps one per folder, for a few folders. Rejects with
   * KernelError(kind, message): `no_build` when it holds none for that folder.
   */
  query<T = unknown>(dir: string, name: string, args: object): Promise<T>
  cancel(): void
  dispose(): Promise<void>
  /** Called when the kernel has exited unexpectedly and was not restarted. */
  onExit(cb: (code: number | null) => void): void
  /** The last lines the kernel wrote to stderr. */
  stderrTail(): string
}

/**
 * How `uv` is run for a workspace. `frozen` (a packaged app) has `uv` use the kernel's `uv.lock` as it is and never
 * write it: the kernel then lies in the bundle, which is not written to. It matters only without a project, where the
 * kernel's own project is the one run; with one, `--no-sync` already leaves everything as it is.
 */
export interface CommandOpts {
  workspaceRoot: string
  hasProject: boolean
  kernelDir: string
  frozen?: boolean
}

/** The command that runs the kernel for a workspace. */
export function kernelCommand(opts: CommandOpts): string[] {
  const run = opts.hasProject
    ? // The workspace's own environment, never synced, with the kernel layered on top.
      ['run', '--no-sync', '--project', opts.workspaceRoot, '--with-editable', opts.kernelDir]
    : ['run', ...(opts.frozen ? ['--frozen'] : []), '--project', opts.kernelDir]
  return ['uv', ...run, 'python', '-m', 'torno_kernel']
}

/**
 * The command that runs the kernel package's import process for a workspace:
 * the kernel's own, with the `scans` extra. Only this process asks for the
 * extra (trimesh, pillow): no kernel start depends on it.
 */
export function scanCommand(opts: CommandOpts, args: string[]): string[] {
  const run = opts.hasProject
    ? ['run', '--no-sync', '--project', opts.workspaceRoot, '--with-editable', `${opts.kernelDir}[scans]`]
    : ['run', ...(opts.frozen ? ['--frozen'] : []), '--project', opts.kernelDir, '--extra', 'scans']
  return ['uv', ...run, 'python', '-m', 'torno_kernel.scans', ...args]
}

/**
 * What a packaged app adds to the environment of the kernel and of the import process: the kernel's Python
 * environment under `userData`, outside the bundle (`uv run --project <Resources>/kernel` would make a `.venv` inside
 * it, which a read-only `/Applications` refuses and a signature does not survive). Only for a workspace with no
 * project of its own: with one, the environment is the workspace's `.venv`, which this must not replace. Nothing
 * otherwise, and nothing in development. Always an absolute path.
 */
export function kernelEnv(opts: { packaged: boolean; userData: string; hasProject: boolean }): Record<string, string> {
  if (!opts.packaged || opts.hasProject) return {}
  return { UV_PROJECT_ENVIRONMENT: resolve(opts.userData, 'kernel-env') }
}

type Pending =
  | { type: 'build'; resolve: (r: BuildResult) => void; onStarted?: (started: { retired: string[] }) => void }
  | { type: 'query'; resolve: (result: unknown) => void; reject: (e: KernelError) => void }

class Kernel implements KernelClient {
  readonly ready: Promise<{ versions: Record<string, string> }>
  private readyResolve!: (r: { versions: Record<string, string> }) => void
  private readyReject!: (e: KernelError) => void
  private readonly command: string[]
  private readonly cwd: string
  private proc: ChildProcessWithoutNullStreams | null = null
  private readonly pending = new Map<number, Pending>()
  private nextId = 1
  private readonly stderr: string[] = []
  private stderrPartial = ''
  private readonly exitCbs: Array<(code: number | null) => void> = []
  private lastExitAt: number | null = null
  private stopped = false // exited twice in a row; started again by the next build
  private disposed: Promise<void> | null = null

  constructor(command: string[], cwd: string, private readonly extraEnv: Record<string, string> = {}) {
    this.command = command
    this.cwd = cwd
    this.ready = new Promise((resolve, reject) => {
      this.readyResolve = resolve
      this.readyReject = reject
    })
    this.ready.catch(() => {}) // reported through onExit as well; not every caller awaits `ready`
    this.spawn()
  }

  build(dir: string, model: string, opts?: { timeout?: number; onStarted?: (started: { retired: string[] }) => void }): Promise<BuildResult> {
    if (this.disposed) return Promise.resolve(failure('cancelled', 'the kernel was shut down'))
    if (this.stopped) {
      this.stopped = false
      this.spawn()
    }
    return new Promise((resolve) => {
      const id = this.nextId++
      this.pending.set(id, { type: 'build', resolve, onStarted: opts?.onStarted })
      this.send({ id, op: 'build', dir, model, ...(opts?.timeout === undefined ? {} : { timeout: opts.timeout }) })
    })
  }

  async query<T = unknown>(dir: string, name: string, args: object): Promise<T> {
    try {
      return (await this.queryOnce(dir, name, args)) as T
    } catch (e) {
      // The build this query was sent to has just been replaced by a newer
      // one of the same object: ask the newer one.
      if (e instanceof KernelError && e.kind === 'cancelled' && !this.disposed) {
        return (await this.queryOnce(dir, name, args)) as T
      }
      throw e
    }
  }

  cancel(): void {
    if (this.proc) this.send({ id: this.nextId++, op: 'cancel' })
  }

  dispose(): Promise<void> {
    if (this.disposed) return this.disposed
    const proc = this.proc
    this.disposed = new Promise((resolve) => {
      if (!proc) return resolve()
      const kill = setTimeout(() => proc.kill('SIGKILL'), SHUTDOWN_GRACE_MS)
      proc.once('exit', () => {
        clearTimeout(kill)
        resolve()
      })
    })
    if (proc) {
      this.send({ id: this.nextId++, op: 'shutdown' })
      proc.stdin.end()
    }
    this.failPending('cancelled', 'the kernel was shut down')
    return this.disposed
  }

  onExit(cb: (code: number | null) => void): void {
    this.exitCbs.push(cb)
  }

  stderrTail(): string {
    return [...this.stderr, ...(this.stderrPartial ? [this.stderrPartial] : [])].join('\n')
  }

  /** The process started for the kernel (`uv`, whose child is Python). For diagnostics and tests. */
  get pid(): number | undefined {
    return this.proc?.pid
  }

  private queryOnce(dir: string, name: string, args: object): Promise<unknown> {
    if (this.disposed) return Promise.reject(new KernelError('cancelled', 'the kernel was shut down'))
    if (!this.proc) return Promise.reject(new KernelError('crash', 'kernel stopped'))
    return new Promise((resolve, reject) => {
      const id = this.nextId++
      this.pending.set(id, { type: 'query', resolve, reject })
      this.send({ id, op: 'query', dir, name, args })
    })
  }

  private spawn(): void {
    const [file, ...args] = this.command
    // Three separate pipes: the kernel makes its stdout non-blocking, which
    // would break its stderr too if the two shared one.
    // No bytecode: Python would write __pycache__ beside every model and common/
    // module it imports, and a workspace is only ever written under .torno/.
    const env = { ...process.env, ...this.extraEnv, PYTHONDONTWRITEBYTECODE: '1' }
    const proc = spawn(file, args, { cwd: this.cwd, env, stdio: ['pipe', 'pipe', 'pipe'] })
    this.proc = proc
    const decoder = new FrameDecoder()
    proc.stdout.on('data', (chunk: Buffer) => {
      for (const { header, blob } of decoder.push(chunk)) this.receive(header, blob)
    })
    proc.stderr.setEncoding('utf8')
    proc.stderr.on('data', (text: string) => this.keepStderr(text))
    proc.stdin.on('error', () => {}) // a write to a dead kernel; its exit is handled below

    // 'error' alone when the process could not be started, 'exit' otherwise.
    // Not 'close': that waits for the pipes, which a child of `uv` may still hold.
    let ended = false
    const end = (code: number | null) => {
      if (ended) return
      ended = true
      this.exited(proc, code)
    }
    proc.once('error', (e) => {
      this.keepStderr(`could not run ${file}: ${e.message}\n`)
      end(null)
    })
    proc.once('exit', (code) => end(code))
  }

  private send(header: object): void {
    const stdin = this.proc?.stdin
    if (stdin && !stdin.destroyed && !stdin.writableEnded) stdin.write(encodeFrame(header))
  }

  private receive(header: any, blob: Buffer): void {
    if (header === null || typeof header !== 'object') {
      // It cannot be said whose reply this was, and its request would wait for
      // ever: whatever is pending is failed. The kernel itself carries on.
      this.keepStderr('kernel: a frame that is not JSON\n')
      this.failPending('crash', `the kernel sent a reply that could not be read. ${REBUILD_HOW}`)
      return
    }
    if (header.event === 'ready') {
      this.readyResolve({ versions: header.versions ?? {} })
      return
    }
    const request = this.pending.get(header.id)
    if (!request) {
      // A reply with no request: the kernel rejected a frame it could not match to an id.
      if (header.ok === false) this.keepStderr(`kernel: ${header.error?.kind}: ${header.error?.message}\n`)
      return
    }
    if (header.event === 'build.started') {
      // `retired`: the folders whose live builds the kernel let go to make room for this one (memory).
      if (request.type === 'build') request.onStarted?.({ retired: Array.isArray(header.retired) ? header.retired.filter((dir: unknown): dir is string => typeof dir === 'string') : [] })
      return
    }
    this.pending.delete(header.id)
    if (request.type === 'build') {
      // The blob is a view into the read buffer: give the scene one of its own.
      if (header.ok) request.resolve({ ok: true, scene: header.scene, blob: Buffer.from(blob) })
      else request.resolve({ ok: false, error: header.error ?? { kind: 'crash', message: 'the build failed' } })
    } else if (header.ok) {
      request.resolve(header.result)
    } else {
      request.reject(new KernelError(header.error?.kind ?? 'crash', header.error?.message ?? 'the query failed', typeof header.error?.reason === 'string' ? header.error.reason : undefined))
    }
  }

  private exited(proc: ChildProcessWithoutNullStreams, code: number | null): void {
    // If `uv` died and Python did not, closing its stdin is what ends it.
    proc.stdin.destroy()
    if (this.proc !== proc) return
    this.proc = null
    if (this.disposed) return
    this.failPending('crash', `the kernel exited${code === null ? '' : ` with status ${code}`}. ${REBUILD_HOW}`)
    const now = Date.now()
    const again = this.lastExitAt !== null && now - this.lastExitAt < RESTART_WINDOW_MS
    this.lastExitAt = now
    if (!again) {
      this.spawn()
      return
    }
    this.stopped = true
    this.readyReject(new KernelError('crash', `kernel stopped\n${this.stderrTail()}`))
    for (const cb of this.exitCbs) cb(code)
  }

  private failPending(kind: string, message: string): void {
    const requests = [...this.pending.values()]
    this.pending.clear()
    for (const request of requests) {
      if (request.type === 'build') request.resolve(failure(kind, message))
      else request.reject(new KernelError(kind, message))
    }
  }

  private keepStderr(text: string): void {
    const lines = (this.stderrPartial + text).split('\n')
    this.stderrPartial = lines.pop() ?? ''
    this.stderr.push(...lines)
    if (this.stderr.length > STDERR_LINES) this.stderr.splice(0, this.stderr.length - STDERR_LINES)
  }
}

function failure(kind: string, message: string): BuildResult {
  return { ok: false, error: { kind, message } }
}

export type RunningKernel = KernelClient & { readonly pid: number | undefined }

/**
 * What stands in for the kernel of a workspace it cannot be started in. Every
 * build fails with the reason, as a crash; nothing is run, and nothing restarts.
 */
class NoKernel implements KernelClient {
  readonly ready: Promise<{ versions: Record<string, string> }>
  readonly pid = undefined

  constructor(private readonly reason: string) {
    this.ready = Promise.reject(new KernelError('crash', reason))
    this.ready.catch(() => {}) // the builds say it too; not every caller awaits `ready`
  }

  build(): Promise<BuildResult> {
    return Promise.resolve(failure('crash', this.reason))
  }
  query<T>(): Promise<T> {
    return Promise.reject(new KernelError('crash', this.reason))
  }
  cancel(): void {}
  dispose(): Promise<void> {
    return Promise.resolve()
  }
  onExit(): void {}
  stderrTail(): string {
    return ''
  }
}

/**
 * Why no kernel can be started for a workspace, or null when one can. A
 * workspace with a `pyproject.toml` and no `.venv` gets none: `uv run --no-sync
 * --project <root>` would create the environment there, and torno never writes
 * into a workspace.
 */
export function cannotStart(opts: { workspaceRoot: string; hasProject: boolean }): string | null {
  if (!opts.hasProject || existsSync(join(opts.workspaceRoot, '.venv'))) return null
  return `This workspace has a pyproject.toml but no .venv. Run \`uv sync\` in ${opts.workspaceRoot} once, then reopen it.`
}

/**
 * Start the kernel for a workspace. It is restarted once if it exits
 * unexpectedly. Where it cannot be started (`cannotStart`), every build fails
 * saying why.
 */
export function startKernel(opts: CommandOpts & { env?: Record<string, string> }): RunningKernel {
  const reason = cannotStart(opts)
  return reason === null ? new Kernel(kernelCommand(opts), opts.workspaceRoot, opts.env) : new NoKernel(reason)
}

/** As `startKernel`, with the command given: tests run a stand-in for the kernel. */
export function startKernelCommand(command: string[], cwd: string): RunningKernel {
  return new Kernel(command, cwd)
}
