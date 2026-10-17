import { execFileSync } from 'node:child_process'
import { cpSync, mkdtempSync, readdirSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { bufView } from '../../shared/scene'
import { type RunningKernel, startKernel } from './client'
import { toArrayBuffer } from './frames'

const KERNEL_DIR = resolve(__dirname, '../../../../kernel')

// The test must not depend on what earlier runs left in the repository's
// fixtures, so the kernel works on a copy of the fixture workspace.
let root: string
let kernel: RunningKernel

beforeAll(() => {
  root = mkdtempSync(join(realpathSync(tmpdir()), 'torno-kernel-'))
  cpSync(join(KERNEL_DIR, 'tests/fixtures/ws'), root, {
    recursive: true,
    filter: (source) => !source.endsWith('__pycache__')
  })
  kernel = startKernel({ workspaceRoot: root, hasProject: false, kernelDir: KERNEL_DIR })
})

afterAll(async () => {
  await kernel.dispose()
  rmSync(root, { recursive: true, force: true })
})

/** The Python process: `uv run` stays as its parent. */
function pythonPid(uvPid: number): number {
  let children: string[] = []
  try {
    children = execFileSync('pgrep', ['-P', String(uvPid)], { encoding: 'utf8' }).trim().split(/\s+/).filter(Boolean)
  } catch {
    // pgrep exits 1 when there is no child
  }
  return children.length ? Number(children[0]) : uvPid
}

describe('the real kernel', () => {
  it('starts with build123d in its environment', async () => {
    const { versions } = await kernel.ready
    expect(versions.build123d).toMatch(/^\d+\.\d+/)
    expect(versions.python).toMatch(/^3\./)
  })

  it('refuses a query before any build', async () => {
    await expect(kernel.query(join(root, 'bracket'), 'describe', { ref: 'assembly:base' })).rejects.toMatchObject({ kind: 'no_build' })
  })

  it('builds the bracket: four parts, every buffer readable', async () => {
    let started = 0
    const result = await kernel.build(join(root, 'bracket'), 'bracket.py', { onStarted: () => (started += 1) })
    if (!result.ok) throw new Error(`${result.error.kind}: ${result.error.message}`)
    expect(started).toBe(1)
    expect(result.scene.parts.map((p) => p.key).sort()).toEqual(
      ['assembly:base', 'assembly:post', 'print:base', 'print:post']
    )
    const blob = toArrayBuffer(result.blob)
    for (const part of result.scene.parts) {
      const { mesh } = part
      const vertices = bufView(blob, mesh.vertices, Float32Array)
      expect(vertices.length).toBeGreaterThan(0)
      expect(bufView(blob, mesh.normals, Float32Array).length).toBe(vertices.length)
      const triangles = bufView(blob, mesh.triangles, Uint32Array)
      expect(triangles.length).toBe(part.triangleCount * 3)
      expect(Math.max(...triangles)).toBeLessThan(vertices.length / 3)
      expect(bufView(blob, mesh.edges, Float32Array).length % 6).toBe(0)
      expect(bufView(blob, mesh.trianglesPerFace, Uint32Array).length).toBe(part.faceCount)
      expect(bufView(blob, mesh.segmentsPerEdge, Uint32Array).length).toBe(part.edgeCount)
      expect(bufView(blob, mesh.faceTypes, Uint32Array).length).toBe(part.faceCount)
      expect(bufView(blob, mesh.edgeTypes, Uint32Array).length).toBe(part.edgeCount)
    }
  })

  it("gives a model's groups of parts with its scene, and none of a model without", async () => {
    const grouped = await kernel.build(join(root, 'grouped'), 'grouped.py')
    if (!grouped.ok) throw new Error(`${grouped.error.kind}: ${grouped.error.message}`)
    expect(grouped.scene.groups).toEqual([
      { name: 'flat', parts: ['flat-a', 'flat-b'] },
      { name: 'tall', parts: ['tall-a'] }
    ])
    const bracket = await kernel.build(join(root, 'bracket'), 'bracket.py')
    if (!bracket.ok) throw new Error(`${bracket.error.kind}: ${bracket.error.message}`)
    expect(bracket.scene.groups).toEqual([])
  })

  it('answers a query about the last good build', async () => {
    const part = await kernel.query<{ volume: number }>(join(root, 'bracket'), 'describe', { ref: 'assembly:base' })
    expect(part.volume).toBeCloseTo(6000, 6)
  })

  it('rejects a query for a part that does not exist', async () => {
    await expect(kernel.query(join(root, 'bracket'), 'describe', { ref: 'assembly:nope' })).rejects.toMatchObject({ kind: 'bad_ref' })
  })

  it('answers about each of two objects, whichever was built last', async () => {
    const bracket = join(root, 'bracket')
    const plain = join(root, 'plain')
    expect(await kernel.build(plain, 'plain.py')).toMatchObject({ ok: true })

    type Part = { volume: number; descriptor: string }
    const base = await kernel.query<Part>(bracket, 'describe', { ref: 'assembly:base' })
    expect(base.volume).toBeCloseTo(6000, 6)
    expect(base.descriptor).toBe('part, 40 × 30 × 5 mm, 6000 mm³, 6 faces')
    const plate = await kernel.query<Part>(plain, 'describe', { ref: 'main:plate' })
    expect(plate.volume).toBeCloseTo(800, 6)
    expect(plate.descriptor).toBe('part, 20 × 20 × 2 mm, 800 mm³, 6 faces')
    // Neither holds the other's parts.
    await expect(kernel.query(plain, 'describe', { ref: 'assembly:base' })).rejects.toMatchObject({ kind: 'bad_ref' })
    await expect(kernel.query(bracket, 'describe', { ref: 'main:plate' })).rejects.toMatchObject({ kind: 'bad_ref' })
    // A folder that was never built.
    await expect(kernel.query(join(root, 'chatty'), 'describe', { ref: 'assembly:plate' })).rejects.toMatchObject({
      kind: 'no_build'
    })
  })

  it('finds the face nearest to a point, in the object asked for', async () => {
    type Nearest = {
      anchors: Array<{ part: string; found: boolean; point?: number[]; normal?: number[]; ref?: string; distance?: number; descriptor?: string }>
    }
    const anchors = [
      { part: 'base', point: [5, 3, 5.5] },
      { part: 'gone', point: [0, 0, 0] }
    ]
    const result = await kernel.query<Nearest>(join(root, 'bracket'), 'nearest', { layout: 'assembly', anchors })
    const [above, gone] = result.anchors
    expect(above).toMatchObject({ part: 'base', found: true, descriptor: 'plane, normal +Z, z = 2.5, 1200 mm²' })
    expect(above.ref).toMatch(/^base\/F\d+$/)
    expect(above.distance).toBeCloseTo(3, 9)
    expect(above.point![2]).toBeCloseTo(2.5, 9)
    expect(above.normal![2]).toBeCloseTo(1, 9)
    expect(gone).toEqual({ part: 'gone', found: false })
    await expect(
      kernel.query(join(root, 'bracket'), 'nearest', { layout: 'exploded', anchors })
    ).rejects.toMatchObject({ kind: 'bad_ref', message: "no layout 'exploded'; the layouts are assembly, print" })
  })

  it('reports a model that raises as an exception, and keeps the last good build', async () => {
    const result = await kernel.build(join(root, 'broken'), 'broken.py')
    expect(result).toMatchObject({ ok: false, error: { kind: 'exception' } })
    if (!result.ok) expect(result.error.traceback).toContain('broken.py')
    const part = await kernel.query<{ volume: number }>(join(root, 'bracket'), 'describe', { ref: 'assembly:base' })
    expect(part.volume).toBeCloseTo(6000, 6)
  })

  it('cancels a running build when a newer one starts', async () => {
    const slow = kernel.build(join(root, 'slow'), 'slow.py')
    const bracket = kernel.build(join(root, 'bracket'), 'bracket.py')
    expect(await slow).toMatchObject({ ok: false, error: { kind: 'cancelled' } })
    expect(await bracket).toMatchObject({ ok: true })
  })

  it('stops a build that overruns its timeout', async () => {
    const result = await kernel.build(join(root, 'slow'), 'slow.py', { timeout: 1 })
    expect(result).toMatchObject({ ok: false, error: { kind: 'timeout' } })
  })

  it('restarts after the kernel process is killed, and the next build succeeds', async () => {
    const uvPid = kernel.pid!
    let started!: () => void
    const running = new Promise<void>((resolve) => (started = resolve))
    const slow = kernel.build(join(root, 'slow'), 'slow.py', { onStarted: started })
    await running
    process.kill(pythonPid(uvPid), 'SIGKILL')
    // What was pending fails; a request made once the exit is known goes to the new process.
    expect(await slow).toMatchObject({ ok: false, error: { kind: 'crash' } })

    const result = await kernel.build(join(root, 'bracket'), 'bracket.py')
    expect(result).toMatchObject({ ok: true })
    expect(kernel.pid).not.toBe(uvPid)
    const part = await kernel.query<{ volume: number }>(join(root, 'bracket'), 'describe', { ref: 'assembly:post' })
    expect(part.volume).toBeCloseTo(Math.PI * 16 * 20, 3)
  })

  it('writes nothing into the workspace: no __pycache__ beside the models it imported', () => {
    const written = readdirSync(root, { recursive: true, encoding: 'utf8' }).filter((path) => path.includes('__pycache__'))
    expect(written).toEqual([])
  })
})
