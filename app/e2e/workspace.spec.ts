import { cpSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'

// Main, preload and the real kernel together: a workspace opened from
// TORNO_WORKSPACE, an object built, its scene delivered to the renderer.
const appDir = resolve(__dirname, '..')
const fixtures = resolve(appDir, '../kernel/tests/fixtures/ws')

// Each test carries on from the state the one before left.
test.describe.configure({ mode: 'serial' })

let root: string
let app: ElectronApplication
let page: Page

test.beforeAll(async () => {
  // A copy: the test edits a model, and Python writes __pycache__ beside it.
  root = mkdtempSync(join(realpathSync(tmpdir()), 'torno-e2e-'))
  cpSync(fixtures, root, { recursive: true, filter: (source) => !source.endsWith('__pycache__') })
  // TORNO_TEST=1 makes main create the window with show: false. Never launch without it.
  app = await electron.launch({
    args: ['.'],
    cwd: appDir,
    env: { ...process.env, TORNO_TEST: '1', TORNO_WORKSPACE: root }
  })
  page = await app.firstWindow()
  await page.waitForSelector('[data-region="viewport"]')
})

test.afterAll(async () => {
  await app?.close()
  rmSync(root, { recursive: true, force: true })
})

/** Collect the build and scene events that arrive in the page from here on. */
async function record(): Promise<void> {
  await page.evaluate(() => {
    const w = window as unknown as { seen: { builds: unknown[]; scenes: unknown[] }; recording?: boolean }
    w.seen = { builds: [], scenes: [] }
    if (w.recording) return
    w.recording = true
    window.torno.object.onBuild((s) => w.seen.builds.push(s))
    window.torno.object.onScene((m) =>
      w.seen.scenes.push({
        objectId: m.objectId,
        revision: m.revision,
        parts: m.scene.parts.map((p) => p.key).sort(),
        isArrayBuffer: m.blob instanceof ArrayBuffer,
        // Readable as the scene says: the first part's vertices.
        firstVertexCount: new Float32Array(m.blob, m.scene.parts[0].mesh.vertices.offset, 3).length
      })
    )
  })
}

function seen(): Promise<{ builds: Array<{ objectId: string; status: string; revision: number; stale: boolean; error?: { kind: string; message: string } }>; scenes: Array<Record<string, unknown>> }> {
  return page.evaluate(() => (window as unknown as { seen: never }).seen)
}

test('the workspace named by TORNO_WORKSPACE is open at start', async () => {
  const info = await page.evaluate(() => window.torno.workspace.current())
  expect(info?.root).toBe(root)
  expect(info?.hasProject).toBe(false)
  expect(info?.objects.map((o) => o.id)).toEqual(
    ['bracket', 'broken', 'chatty', 'crash', 'exits', 'gauge', 'grouped', 'hollow', 'makers', 'measures', 'morph', 'noscene', 'plain', 'slow', 'spread', 'two']
  )
})

test('opening an object builds it and delivers the scene with its blob', async () => {
  await record()
  const state = await page.evaluate(() => window.torno.object.open('bracket'))
  expect(state).toMatchObject({ objectId: 'bracket', status: 'building', revision: 0, stale: false })
  await expect.poll(async () => (await seen()).scenes.length, { timeout: 20_000 }).toBe(1)
  const { builds, scenes } = await seen()
  expect(scenes[0]).toEqual({
    objectId: 'bracket',
    revision: 1,
    parts: ['assembly:base', 'assembly:post', 'print:base', 'print:post'],
    isArrayBuffer: true,
    firstVertexCount: 3
  })
  expect(builds.at(-1)).toMatchObject({ objectId: 'bracket', status: 'ok', revision: 1, stale: false })
})

test('opening it again replays the last good scene without building', async () => {
  await record()
  const state = await page.evaluate(() => window.torno.object.open('bracket'))
  expect(state).toMatchObject({ status: 'ok', revision: 1 })
  await expect.poll(async () => (await seen()).scenes.length).toBe(1)
  const { builds, scenes } = await seen()
  expect(scenes[0]).toMatchObject({ objectId: 'bracket', revision: 1 })
  expect(builds).toEqual([])
})

test('saving the model rebuilds it; a broken save keeps the last good revision, stale', async () => {
  await record()
  writeFileSync(join(root, 'bracket', 'bracket.py'), 'raise RuntimeError("half-typed")\n')
  await expect.poll(async () => (await seen()).builds.at(-1)?.status, { timeout: 20_000 }).toBe('failed')
  const { builds, scenes } = await seen()
  expect(builds.map((b) => b.status)).toEqual(['building', 'failed'])
  expect(builds[1]).toMatchObject({ revision: 1, stale: true, error: { kind: 'exception', message: 'half-typed' } })
  expect(scenes).toEqual([])

  cpSync(join(fixtures, 'bracket', 'bracket.py'), join(root, 'bracket', 'bracket.py'))
  await expect.poll(async () => (await seen()).scenes.length, { timeout: 20_000 }).toBe(1)
  expect((await seen()).scenes[0]).toMatchObject({ objectId: 'bracket', revision: 2 })
})

test('an object with two candidate models fails with a message naming them, then builds once one is removed', async () => {
  await record()
  const state = await page.evaluate(() => window.torno.object.open('two'))
  expect(state).toMatchObject({ status: 'failed', revision: 0, error: { kind: 'no_model' } })
  expect(state.error?.message).toContain('a.py, b.py')

  await page.waitForTimeout(500) // the watch on the folder starts with the open
  rmSync(join(root, 'two', 'b.py'))
  const twoScenes = async () => (await seen()).scenes.filter((m) => m.objectId === 'two')
  await expect.poll(async () => (await twoScenes()).length, { timeout: 20_000 }).toBe(1)
  expect((await twoScenes())[0]).toMatchObject({ revision: 1, parts: ['main:first'] })
  const last = (await seen()).builds.filter((b) => b.objectId === 'two').at(-1)
  expect(last).toMatchObject({ status: 'ok', revision: 1, stale: false })
})

test('the model is chosen again even when another folder\'s change was scanned first', async () => {
  // An object of its own, with two candidates like `two`.
  mkdirSync(join(root, 'pair'))
  cpSync(join(fixtures, 'two', 'a.py'), join(root, 'pair', 'a.py'))
  cpSync(join(fixtures, 'two', 'b.py'), join(root, 'pair', 'b.py'))
  await record()
  const state = await page.evaluate(() => window.torno.object.open('pair'))
  expect(state).toMatchObject({ status: 'failed', error: { kind: 'no_model' } })
  await page.waitForTimeout(500) // the watches start with the open

  // The change in common/ is debounced first, so its scan already sees `pair`
  // with one model by the time `pair`'s own change is handled.
  mkdirSync(join(root, 'common'), { recursive: true })
  writeFileSync(join(root, 'common', 'shared.py'), 'X = 1\n')
  await page.waitForTimeout(100)
  rmSync(join(root, 'pair', 'b.py'))

  const last = async () => (await seen()).builds.filter((b) => b.objectId === 'pair').at(-1)
  await expect.poll(async () => (await last())?.status, { timeout: 20_000 }).toBe('ok')
  expect(await last()).toMatchObject({ revision: 1, stale: false })
})

test('an unknown object is refused by name', async () => {
  const message = await page.evaluate(() => window.torno.object.open('nope').catch((e: Error) => e.message))
  expect(message).toContain('no object named nope')
})

test('the renderer can reload itself, and cannot navigate elsewhere', async () => {
  await page.evaluate(() => {
    ;(window as unknown as { marker?: number }).marker = 1
    window.location.href = 'https://example.com/'
  })
  await page.waitForTimeout(300)
  expect(await page.evaluate(() => (window as unknown as { marker?: number }).marker)).toBe(1)
  expect(page.url()).toMatch(/^file:/)

  await Promise.all([page.waitForEvent('load'), page.evaluate(() => window.location.reload())])
  await page.waitForSelector('[data-region="viewport"]')
  expect(await page.evaluate(() => (window as unknown as { marker?: number }).marker)).toBeUndefined()
})
