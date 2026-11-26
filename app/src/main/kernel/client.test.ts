import { mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cannotStart, environmentCommand, kernelCommand, kernelEnv, KernelError, type RunningKernel, startKernel, startKernelCommand } from './client'

// These run the client against fake-kernel.mjs. client.itest.ts runs it against the real kernel.
const FAKE = join(__dirname, 'fake-kernel.mjs')

let kernel: RunningKernel | undefined
function start(mode = 'normal'): RunningKernel {
  kernel = startKernelCommand([process.execPath, FAKE, mode], tmpdir())
  return kernel
}
afterEach(async () => {
  await kernel?.dispose()
  kernel = undefined
})

function exitOf(k: RunningKernel): Promise<number | null> {
  return new Promise((resolve) => k.onExit(resolve))
}

describe('kernelCommand', () => {
  it('runs in the workspace project without syncing it, with the kernel layered on', () => {
    expect(kernelCommand({ workspaceRoot: '/ws', hasProject: true, kernelDir: '/repo/kernel' })).toEqual(
      ['uv', 'run', '--no-sync', '--project', '/ws', '--with-editable', '/repo/kernel', 'python', '-m', 'torno_kernel']
    )
  })

  it('runs in the kernel project when the workspace has none', () => {
    expect(kernelCommand({ workspaceRoot: '/ws', hasProject: false, kernelDir: '/repo/kernel' })).toEqual(
      ['uv', 'run', '--project', '/repo/kernel', 'python', '-m', 'torno_kernel']
    )
  })

  it('is frozen, in the kernel project, when packaged and the workspace has no project', () => {
    expect(kernelCommand({ workspaceRoot: '/ws', hasProject: false, kernelDir: '/Resources/kernel', frozen: true })).toEqual(
      ['uv', 'run', '--frozen', '--project', '/Resources/kernel', 'python', '-m', 'torno_kernel']
    )
    // With a project the workspace's environment is the one run, never synced: nothing more to say.
    expect(kernelCommand({ workspaceRoot: '/ws', hasProject: true, kernelDir: '/Resources/kernel', frozen: true })).toEqual(
      kernelCommand({ workspaceRoot: '/ws', hasProject: true, kernelDir: '/Resources/kernel' })
    )
  })
})

describe('environmentCommand', () => {
  it("syncs torno's own kernel project, never a workspace, and frozen when packaged", () => {
    expect(environmentCommand({ kernelDir: '/repo/kernel' })).toEqual(['uv', 'sync', '--project', '/repo/kernel'])
    expect(environmentCommand({ kernelDir: '/Resources/kernel', frozen: true })).toEqual(['uv', 'sync', '--frozen', '--project', '/Resources/kernel'])
  })
})

describe('kernelEnv', () => {
  it('puts the kernel environment under userData when packaged and the workspace has no project', () => {
    expect(kernelEnv({ packaged: true, userData: '/u/torno', hasProject: false })).toEqual({ UV_PROJECT_ENVIRONMENT: '/u/torno/kernel-env' })
  })

  it('is an absolute path whatever userData is', () => {
    const env = kernelEnv({ packaged: true, userData: 'rel/torno', hasProject: false })
    expect(env.UV_PROJECT_ENVIRONMENT).toBe(join(process.cwd(), 'rel', 'torno', 'kernel-env'))
  })

  it('adds nothing in development, nor over the .venv of a workspace project', () => {
    expect(kernelEnv({ packaged: false, userData: '/u/torno', hasProject: false })).toEqual({})
    expect(kernelEnv({ packaged: false, userData: '/u/torno', hasProject: true })).toEqual({})
    expect(kernelEnv({ packaged: true, userData: '/u/torno', hasProject: true })).toEqual({})
  })
})

describe('a workspace with a pyproject.toml and no .venv', () => {
  // `uv run --no-sync --project <root>` would make <root>/.venv, and a workspace is never written to.
  let root: string
  const message = () => `This workspace has a pyproject.toml but no .venv. Run \`uv sync\` in ${root} once, then reopen it.`
  afterEach(() => rmSync(root, { recursive: true, force: true }))

  function workspace(withVenv: boolean): string {
    root = mkdtempSync(join(tmpdir(), 'torno-ws-'))
    writeFileSync(join(root, 'pyproject.toml'), '[project]\nname = "ws"\nversion = "0"\n')
    if (withVenv) mkdirSync(join(root, '.venv'))
    return root
  }

  it('starts no kernel: every build fails as a crash that says what to do, and nothing is created', async () => {
    kernel = startKernel({ workspaceRoot: workspace(false), hasProject: true, kernelDir: '/repo/kernel' })
    let exits = 0
    kernel.onExit(() => (exits += 1))
    expect(kernel.pid).toBeUndefined()
    for (let i = 0; i < 3; i += 1) {
      expect(await kernel.build(join(root, 'a'), 'a.py')).toEqual({ ok: false, error: { kind: 'crash', message: message() } })
    }
    await expect(kernel.ready).rejects.toMatchObject({ kind: 'crash', message: message() })
    await expect(kernel.query('/ws/a', 'describe', {})).rejects.toMatchObject({ kind: 'crash', message: message() })
    kernel.cancel()
    expect(kernel.stderrTail()).toBe('')
    expect(kernel.pid).toBeUndefined()
    expect(exits).toBe(0)
    await kernel.dispose()
    expect(readdirSync(root)).toEqual(['pyproject.toml'])
  })

  it('is the only case in which the kernel is not started', () => {
    expect(cannotStart({ workspaceRoot: workspace(false), hasProject: true })).toBe(message())
    expect(cannotStart({ workspaceRoot: root, hasProject: false })).toBeNull()
    mkdirSync(join(root, '.venv'))
    expect(cannotStart({ workspaceRoot: root, hasProject: true })).toBeNull()
  })
})

describe('kernel client', () => {
  it('fails the running build when the kernel sends a frame that cannot be read', async () => {
    const k = start()
    const result = await k.build('/ws/a', 'nan.py')
    expect(result).toEqual({ ok: false, error: { kind: 'crash', message: 'the kernel sent a reply that could not be read. Press Rebuild in the status line of torno (Ctrl+Shift+B) to build again' } })
    expect(k.stderrTail()).toContain('kernel: a frame that is not JSON')
    // The kernel itself is still there.
    expect(await k.build('/ws/a', 'a.py')).toMatchObject({ ok: true })
  })

  it('resolves a build with its scene and a blob of its own, after onStarted', async () => {
    const k = start()
    let started = 0
    const result = await k.build('/ws/a', 'a.py', { timeout: 7, onStarted: () => (started += 1) })
    expect(started).toBe(1)
    if (!result.ok) throw new Error(result.error.message)
    expect(result.scene.model).toBe('a.py')
    expect(result.scene.seconds).toBe(7) // the fake echoes the timeout it was sent
    expect([...result.blob]).toEqual([1, 2, 3, 4, 5])
    expect(result.blob.byteLength).toBe(5)
  })

  it('tells onStarted the folders whose builds the kernel let go to make room, and none when it names none', async () => {
    const k = start()
    const told: string[][] = []
    await k.build('/ws/a', 'a.py', { onStarted: (started) => told.push(started.retired) })
    await k.build('/ws/a', 'tight.py', { onStarted: (started) => told.push(started.retired) })
    expect(told).toEqual([[], ['/ws/a', '/ws/other']])
  })

  it('runs the kernel in the workspace root', async () => {
    const result = await start().build('/ws/a', 'a.py')
    expect(result.ok && result.scene.output).toBe(realpathSync(tmpdir()))
  })

  it('resolves a failed build with its error rather than rejecting', async () => {
    const result = await start().build('/ws/a', 'bad.py')
    expect(result).toEqual({ ok: false, error: { kind: 'exception', message: 'boom' } })
  })

  it('resolves the running build as cancelled when a newer one starts, or on cancel', async () => {
    const k = start()
    const first = k.build('/ws/a', 'hang.py')
    const second = k.build('/ws/a', 'hang.py')
    expect(await first).toMatchObject({ ok: false, error: { kind: 'cancelled' } })
    k.cancel()
    expect(await second).toMatchObject({ ok: false, error: { kind: 'cancelled', message: 'cancelled by request' } })
  })

  it('resolves a query with its result and rejects with the kernel\'s error kind', async () => {
    const k = start()
    expect(await k.query('/ws/a', 'echo', { ref: 'a:b' })).toMatchObject({ dir: '/ws/a', name: 'echo', args: { ref: 'a:b' } })
    const error = await k.query('/ws/a', 'bad-ref', {}).catch((e) => e)
    expect(error).toBeInstanceOf(KernelError)
    expect(error).toMatchObject({ kind: 'bad_ref', message: 'no part named x' })
  })

  it('gives the bytes a reply carries to whoever asks for them, and to no one else', async () => {
    const k = start()
    const made = await k.query<{ result: { bytes: number }; blob: Buffer }>('/ws/a', 'file', {}, { blob: true })
    expect(made.result).toEqual({ dir: '/ws/a', bytes: 3 })
    expect(made.blob.toString()).toBe('abc')
    expect(await k.query('/ws/a', 'file', {})).toEqual({ dir: '/ws/a', bytes: 3 })
    // A reply with none gives an empty one.
    expect((await k.query<{ blob: Buffer }>('/ws/a', 'echo', {}, { blob: true })).blob.length).toBe(0)
  })

  it('reads the shelf of a workspace and says why when it cannot', async () => {
    const root = mkdtempSync(join(tmpdir(), 'torno-shelf-'))
    try {
      mkdirSync(join(root, 'common', 'parts', 'ec11'), { recursive: true })
      writeFileSync(join(root, 'common', 'parts', 'ec11', 'part.py'), '')
      mkdirSync(join(root, 'common', 'parts', 'empty'))
      const k = start()
      expect(await k.shelf?.(root)).toEqual({ ok: true, parts: [{ id: 'ec11', name: 'ec11', what: '', params: [], files: [] }] })
      expect(await k.shelf?.('/ws/boom')).toMatchObject({ ok: false, error: { kind: 'exception', message: 'boom' } })
      // A read that is not answered fails when the kernel dies, as every pending request does.
      const stuck = k.shelf?.('/ws/hang')
      await k.build('/ws/a', 'die.py')
      expect(await stuck).toMatchObject({ ok: false, error: { kind: 'crash' } })
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('sends each query with the folder of the object it is about', async () => {
    const k = start()
    const [a, b] = await Promise.all([
      k.query<{ dir: string }>('/ws/a', 'echo', {}),
      k.query<{ dir: string }>('/ws/b', 'echo', {})
    ])
    expect([a.dir, b.dir]).toEqual(['/ws/a', '/ws/b'])
  })

  it('retries a cancelled query once, for the same folder', async () => {
    const k = start()
    expect(await k.query('/ws/a', 'cancelled-once', {})).toMatchObject({ dir: '/ws/a', name: 'cancelled-once' })
    await expect(k.query('/ws/a', 'always-cancelled', {})).rejects.toMatchObject({ kind: 'cancelled' })
    expect(await k.query('/ws/a', 'measure', { cancelOnce: true })).toMatchObject({ name: 'measure' })
  })

  it('does not retry an export, its check or a trial fillet: their answer is of the build that was replaced, and would hold up the new one', async () => {
    const k = start()
    await expect(k.query('/ws/a', 'export', { cancelOnce: true }, { blob: true })).rejects.toMatchObject({ kind: 'cancelled' })
    await expect(k.query('/ws/a', 'export_check', { cancelOnce: true })).rejects.toMatchObject({ kind: 'cancelled' })
    await expect(k.query('/ws/a', 'try_fillet', { cancelOnce: true })).rejects.toMatchObject({ kind: 'cancelled' })
    // Asked again, of the build there is now, they are answered.
    expect(await k.query('/ws/a', 'try_fillet', { cancelOnce: true })).toMatchObject({ name: 'try_fillet' })
  })

  it('fails what is pending with kind crash when the kernel dies, and restarts it once', async () => {
    const k = start()
    const before = await k.query<{ pid: number }>('/ws/a', 'echo', {})
    const query = k.query('/ws/a', 'hang', {}).catch((e) => e)
    const build = await k.build('/ws/a', 'die.py')
    expect(build).toMatchObject({ ok: false, error: { kind: 'crash' } })
    expect(await query).toMatchObject({ kind: 'crash' })

    const after = await k.query<{ pid: number }>('/ws/a', 'echo', {})
    expect(after.pid).not.toBe(before.pid)
    expect(await k.build('/ws/a', 'a.py')).toMatchObject({ ok: true })
  })

  it('stops after a second exit, reports it with the stderr tail, and starts again for the next build', async () => {
    const k = start()
    const exit = exitOf(k)
    await k.build('/ws/a', 'die.py')
    expect(await k.build('/ws/a', 'die.py')).toMatchObject({ ok: false, error: { kind: 'crash' } })
    expect(await exit).toBe(3)
    expect(k.stderrTail()).toMatch(/fake kernel \d+ starting/)
    await expect(k.query('/ws/a', 'echo', {})).rejects.toMatchObject({ kind: 'crash', message: 'kernel stopped' })

    expect(await k.build('/ws/a', 'a.py')).toMatchObject({ ok: true })
  })

  it('tells each start after the first, when it answers, and when it stops for good', async () => {
    const k = start()
    const events: string[] = []
    k.onState((e) => events.push(e.state))
    await k.ready
    await k.build('/ws/a', 'die.py') // exits: started again at once
    await expect.poll(() => events.filter((e) => e === 'ready').length).toBe(2)
    expect(events.slice(0, 3)).toEqual(['ready', 'starting', 'ready'])
    await k.build('/ws/a', 'die.py') // twice in a row: stopped for good
    await expect.poll(() => events.includes('failed')).toBe(true)
    const failed: unknown[] = []
    k.onState((e) => failed.push(e))
    // A build starts it again: told it is starting, then that it answered.
    expect(await k.build('/ws/a', 'a.py')).toMatchObject({ ok: true })
    await expect.poll(() => failed.map((e) => (e as { state: string }).state)).toEqual(['starting', 'ready'])
  })

  it('rejects ready when the kernel never starts', async () => {
    const k = start('die-at-start')
    const exit = exitOf(k)
    const error = await k.ready.catch((e) => e)
    expect(error).toMatchObject({ kind: 'crash' })
    expect(error.message).toMatch(/^kernel stopped\n/)
    expect(error.message).toContain('ModuleNotFoundError: no module named build123d')
    expect(await exit).toBe(1)
  })

  it('reports a command that cannot be run the same way', async () => {
    kernel = startKernelCommand(['/nonexistent/torno-uv'], tmpdir())
    const exit = exitOf(kernel)
    await expect(kernel.ready).rejects.toMatchObject({ kind: 'crash' })
    expect(await exit).toBeNull()
    expect(kernel.stderrTail()).toContain('could not run /nonexistent/torno-uv')
  })

  it("gives the kernel torno's environment without what an outer torno's session gave it, and with torno's switches", async () => {
    const before = process.env.TORNO_SESSION
    process.env.TORNO_SESSION = 'outer-token'
    try {
      const k = start('env')
      await k.ready
      expect(k.stderrTail()).toContain('TORNO_SESSION=none TORNO_KEEP_BUILDS=1')
    } finally {
      if (before === undefined) delete process.env.TORNO_SESSION
      else process.env.TORNO_SESSION = before
    }
  })

  it('keeps the last 200 lines of stderr', async () => {
    const k = start('noisy')
    await k.ready
    await k.query('/ws/a', 'echo', {})
    // stderr is a pipe of its own: its last chunk may land after the reply on stdout
    await vi.waitFor(() => expect(k.stderrTail().endsWith('no newline at the end')).toBe(true), { timeout: 10_000 })
    const lines = k.stderrTail().split('\n')
    expect(lines).toHaveLength(201) // 200 whole lines and the unfinished one
    expect(lines[0]).toBe('line 300')
    expect(lines.at(-1)).toBe('no newline at the end')
  })

  it('shuts the kernel down on dispose, cancelling what is pending, and does not restart it', async () => {
    const k = start()
    expect(await k.ready).toEqual({ versions: { fake: '1' } })
    const pid = k.pid!
    let exits = 0
    k.onExit(() => (exits += 1))
    const build = k.build('/ws/a', 'hang.py')
    await k.dispose()
    expect(await build).toMatchObject({ ok: false, error: { kind: 'cancelled' } })
    expect(() => process.kill(pid, 0)).toThrow()
    expect(k.pid).toBeUndefined()
    expect(exits).toBe(0)
    expect(await k.build('/ws/a', 'a.py')).toMatchObject({ ok: false, error: { kind: 'cancelled' } })
    await expect(k.query('/ws/a', 'echo', {})).rejects.toMatchObject({ kind: 'cancelled' })
  })
})
