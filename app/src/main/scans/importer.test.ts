import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { scanCommand } from '../kernel/client'
import { commandIn, processImporter, replyOf } from './importer'

describe('the import process', () => {
  it('is the kernel package with its scans extra, in the environment of the workspace and never synced', () => {
    expect(scanCommand({ workspaceRoot: '/ws', hasProject: true, kernelDir: '/torno/kernel' }, ['import', '/a.stl', '/out.bin'])).toEqual(
      ['uv', 'run', '--no-sync', '--project', '/ws', '--with-editable', '/torno/kernel[scans]', 'python', '-m', 'torno_kernel.scans', 'import', '/a.stl', '/out.bin'])
    expect(scanCommand({ workspaceRoot: '/ws', hasProject: false, kernelDir: '/torno/kernel' }, ['convert', '/m.bin'])).toEqual(
      ['uv', 'run', '--project', '/torno/kernel', '--extra', 'scans', 'python', '-m', 'torno_kernel.scans', 'convert', '/m.bin'])
  })

  it('is frozen when packaged and the workspace has no project, and unchanged with one', () => {
    expect(scanCommand({ workspaceRoot: '/ws', hasProject: false, kernelDir: '/Resources/kernel', frozen: true }, ['convert', '/m.bin'])).toEqual(
      ['uv', 'run', '--frozen', '--project', '/Resources/kernel', '--extra', 'scans', 'python', '-m', 'torno_kernel.scans', 'convert', '/m.bin'])
    expect(scanCommand({ workspaceRoot: '/ws', hasProject: true, kernelDir: '/Resources/kernel', frozen: true }, ['x'])).toEqual(
      scanCommand({ workspaceRoot: '/ws', hasProject: true, kernelDir: '/Resources/kernel' }, ['x']))
  })

  it('answers with the last line it wrote, or rejects with its own words', () => {
    expect(replyOf('noise\n{"ok": true, "unit": "mm", "triangles": 12}\n', 0, '')).toMatchObject({ unit: 'mm', triangles: 12 })
    expect(() => replyOf('{"ok": false, "error": {"kind": "no_triangles", "message": "cloud.ply has no triangles"}}\n', 1, '')).toThrow('cloud.ply has no triangles')
    expect(() => replyOf('', 2, 'error: No solution found when resolving `--with` dependencies\n  trimesh was not found in the cache')).toThrow(/the import could not be started: .*trimesh was not found in the cache/s)
    expect(() => replyOf('Traceback…', null, '')).toThrow('the import process ended without an answer')
  })

  it('stops a process that takes too long, and one whose workspace is left', async () => {
    const hang = processImporter(() => ['node', '-e', 'setInterval(() => {}, 1000)'], process.cwd(), 200)
    await expect(hang.import('/a.stl', '/out.bin', {})).rejects.toThrow('was stopped')
    const left = processImporter(() => ['node', '-e', 'setInterval(() => {}, 1000)'], process.cwd())
    const pending = left.import('/a.stl', '/out.bin', {})
    setTimeout(() => left.stop(), 100)
    await expect(pending).rejects.toThrow('the import was stopped: the workspace was closed')
  })

  it('hands on each stage the process names on stderr', async () => {
    const script = "console.error('stage: reading'); console.error('stage: writing'); console.log(JSON.stringify({ ok: true, unit: 'mm', up: 'z', triangles: 12 }))"
    const stages: string[] = []
    await processImporter(() => ['node', '-e', script], process.cwd()).import('/a.stl', '/out.bin', {}, (stage) => stages.push(stage))
    expect(stages).toEqual(['reading', 'writing'])
  })

  // Beyond the brief's tests.

  it('ends what the process started with it: nothing is written once it was given up on', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'torno-importer-'))
    try {
      // As `uv` and its Python: a process whose child goes on to write a file.
      const child = `setTimeout(() => require('fs').writeFileSync(${JSON.stringify(join(dir, 'late'))}, 'x'), 500)`
      const parent = `require('child_process').spawn(process.execPath, ['-e', ${JSON.stringify(child)}], { stdio: 'inherit' }); setInterval(() => {}, 1000)`
      await expect(processImporter(() => [process.execPath, '-e', parent], dir, 200).import('/a.stl', '/out.bin', {})).rejects.toThrow('the import took more than 0.2 s and was stopped')
      await new Promise((resolve) => setTimeout(resolve, 700))
      expect(existsSync(join(dir, 'late'))).toBe(false)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  // Final fix wave (K10): the paths come after `--`, so that none is ever read as a flag.
  it('gives the process its flags, then two dashes, then the paths', async () => {
    const asked: string[][] = []
    const answer = "console.log(JSON.stringify({ ok: true, unit: 'mm' }))"
    const one = processImporter((args) => (asked.push(args), ['node', '-e', answer]), process.cwd())
    await one.import('/a.stl', '/out.bin', { unit: 'm', up: 'y' })
    await one.import('-odd.stl', '/out.bin', {})
    await one.convert('/m.bin', { unit: 'mm', up: 'z' }, { unit: 'm', up: 'y' })
    expect(asked).toEqual([
      ['import', '--unit', 'm', '--up', 'y', '--', '/a.stl', '/out.bin'],
      ['import', '--', '-odd.stl', '/out.bin'],
      ['convert', '--from-unit', 'mm', '--to-unit', 'm', '--from-up', 'z', '--to-up', 'y', '--', '/m.bin']
    ])
  })

  it('runs one at a time, and starts nothing that was asked for before the workspace was left', async () => {
    const started: string[] = []
    const answer = "setTimeout(() => console.log(JSON.stringify({ ok: true, unit: 'mm' })), 150)"
    const one = processImporter((args) => (started.push(args[0]), ['node', '-e', answer]), process.cwd())
    const first = one.import('/a.stl', '/out.bin', {})
    const second = one.convert('/m.bin', { unit: 'mm', up: 'z' }, { unit: 'm', up: 'z' })
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(started).toEqual(['import'])
    await first
    await second
    expect(started).toEqual(['import', 'convert'])

    const left = processImporter((args) => (started.push(`left ${args[0]}`), ['node', '-e', 'setInterval(() => {}, 1000)']), process.cwd())
    const running = left.import('/a.stl', '/out.bin', {})
    const waiting = left.import('/b.stl', '/out.bin', {})
    setTimeout(() => left.stop(), 100)
    await expect(running).rejects.toThrow('the workspace was closed')
    await expect(waiting).rejects.toThrow('the workspace was closed')
    expect(started.filter((s) => s.startsWith('left'))).toEqual(['left import'])
  })

  it('says that the command could not be run at all', async () => {
    await expect(processImporter(() => ['torno-no-such-command'], process.cwd()).import('/a.stl', '/out.bin', {})).rejects.toThrow('the import could not be started: could not run torno-no-such-command')
  })

  // What the review found (task-2-review.md).

  // I3
  it('runs nothing more once it was stopped: whoever stopped it has left', async () => {
    const started: string[] = []
    const one = processImporter((args) => (started.push(args[0]), ['node', '-e', "console.log(JSON.stringify({ ok: true, unit: 'mm' }))"]), process.cwd())
    await one.import('/a.stl', '/out.bin', {})
    one.stop()
    await expect(one.import('/a.stl', '/out.bin', {})).rejects.toThrow('the workspace was closed')
    await expect(one.convert('/m.bin', { unit: 'mm', up: 'z' }, { unit: 'm', up: 'z' })).rejects.toThrow('the workspace was closed')
    expect(started).toEqual(['import'])
  })

  // M1
  it('asks whether the workspace may run a process as each one is started', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'torno-importer-'))
    try {
      let hasProject = false
      const command = commandIn(dir, () => hasProject, '/torno/kernel')
      expect(command(['import', '/a.stl'])).toEqual(scanCommand({ workspaceRoot: dir, hasProject: false, kernelDir: '/torno/kernel' }, ['import', '/a.stl']))
      // A pyproject.toml appeared while an import waited: with no .venv, uv would make one.
      hasProject = true
      expect(() => command(['import', '/a.stl'])).toThrow('no .venv')
      await expect(processImporter(command, dir).import('/a.stl', '/out.bin', {})).rejects.toThrow('no .venv')
      mkdirSync(join(dir, '.venv'))
      expect(command(['import', '/a.stl'])).toEqual(scanCommand({ workspaceRoot: dir, hasProject: true, kernelDir: '/torno/kernel' }, ['import', '/a.stl']))
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  // M3
  it('reads its answer after any amount of other output', async () => {
    const script = "const line = 'x'.repeat(1023) + '\\n'; for (let n = 0; n < 300; n++) { process.stdout.write(line); process.stderr.write(line) } process.stderr.write('y'.repeat(300000)); console.log(JSON.stringify({ ok: true, unit: 'mm', triangles: 12 }))"
    expect(await processImporter(() => ['node', '-e', script], process.cwd()).import('/a.stl', '/out.bin', {})).toMatchObject({ unit: 'mm', triangles: 12 })
  })

  // M4
  it('says which signal ended a process that gave no answer', async () => {
    expect(() => replyOf('', null, '', 'SIGKILL')).toThrow('the import process ended without an answer: it was ended by SIGKILL')
    await expect(processImporter(() => ['node', '-e', "process.kill(process.pid, 'SIGKILL')"], process.cwd()).import('/a.stl', '/out.bin', {})).rejects.toThrow('it was ended by SIGKILL')
  })
})
