import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { BuildState } from '../shared/build'
import type { Part, Scene } from '../shared/scene'
import type { ObjectInfo } from '../shared/workspace'
import { type PartSites, RENAME_LIMIT, type RenameDeps, keepRenameNotice, renamePart, takeRenameNotice } from './rename'

let root: string
let box: ObjectInfo

const MODEL = 'def assembly(p):\n    return {"shell": a(p), "lid": b(p)}\n\ndef groups(p):\n    return {"case": ["shell"]}\n'
const part = (name: string): Part => ({ key: `assembly:${name}`, name, layout: 'assembly' }) as Part
const scene = (): Scene => ({ model: 'model.py', layouts: ['assembly'], parts: [part('shell'), part('lid')], groups: [{ name: 'case', parts: ['shell'] }], seconds: 0.5, output: '' }) as Scene
const sha = (text: string): string => createHash('sha256').update(text).digest('hex')
const read = (path: string): string => readFileSync(join(root, path), 'utf8')

/** What the kernel would answer for MODEL: the two literals of shell. */
function kernelSites(text = MODEL, part = 'shell', to = 'front case'): PartSites {
  const sites = []
  let at = text.indexOf(`"${part}"`)
  while (at >= 0) {
    const start = Buffer.byteLength(text.slice(0, at))
    sites.push({ file: 'box/model.py', line: text.slice(0, at).split('\n').length, start, end: start + Buffer.byteLength(`"${part}"`), old: `"${part}"`, new: `"${to}"` })
    at = text.indexOf(`"${part}"`, at + 1)
  }
  return { sites, files: { 'box/model.py': sha(text) } }
}

function deps(over: Partial<RenameDeps> = {}): RenameDeps & { follow: ReturnType<typeof vi.fn> } {
  const follow = vi.fn(async () => {})
  return { scene, sites: async (p, t) => kernelSites(MODEL, p, t), builds: { state: () => ({ objectId: 'box', status: 'ok', revision: 3 }) as BuildState }, follow, ...over } as RenameDeps & { follow: ReturnType<typeof vi.fn> }
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'torno-rename-'))
  mkdirSync(join(root, 'box'), { recursive: true })
  writeFileSync(join(root, 'box', 'model.py'), MODEL)
  box = { id: 'box', name: 'box', dir: join(root, 'box'), model: 'model.py' }
})
afterEach(() => rmSync(root, { recursive: true, force: true }))

describe('renamePart', () => {
  it('writes the new name where the kernel found the old one, has torno\'s files follow and keeps the notice', async () => {
    const d = deps()
    const result = await renamePart(box, { from: 'shell', to: '  front case ' }, d)
    expect(result).toEqual({ done: true, to: 'front case', files: ['box/model.py'] })
    expect(read('box/model.py')).toBe(MODEL.replaceAll('"shell"', '"front case"'))
    expect(d.follow).toHaveBeenCalledWith('shell', 'front case')
    expect(JSON.parse(read('box/.torno/renamed.json')).renames).toMatchObject([{ from: 'shell', to: 'front case', files: ['model.py'] }])
    expect(read('box/.torno/.gitignore')).toContain('renamed.json')
  })

  it('refuses while Claude works, while a build runs and before a build worked, writing nothing', async () => {
    expect(await renamePart(box, { from: 'shell', to: 'case2' }, deps({ busy: () => 'Claude is working on this project. Wait for it to finish, or stop it, then rename.' }))).toEqual({ done: false, refused: expect.stringMatching(/then rename/) })
    expect(await renamePart(box, { from: 'shell', to: 'case2' }, deps({ builds: { state: () => ({ objectId: 'box', status: 'building', revision: 3 }) as BuildState } }))).toEqual({ done: false, refused: expect.stringMatching(/build is running/) })
    expect(await renamePart(box, { from: 'shell', to: 'case2' }, deps({ scene: () => undefined }))).toEqual({ done: false, refused: expect.stringMatching(/not built yet/) })
    expect(read('box/model.py')).toBe(MODEL)
  })

  it('refuses a name that is not one, or is taken by a part or a group, without asking the kernel', async () => {
    const sites = vi.fn()
    for (const to of ['', 'a/b', 'M3', 'lid', 'case']) expect((await renamePart(box, { from: 'shell', to }, deps({ sites }))).done).toBe(false)
    expect((await renamePart(box, { from: 'nope', to: 'x' }, deps({ sites }))).done).toBe(false)
    expect(sites).not.toHaveBeenCalled()
  })

  it('says what the kernel refused', async () => {
    const refused = 'shell is not written as a plain name in assembly(p) of model.py.'
    expect(await renamePart(box, { from: 'shell', to: 'x' }, deps({ sites: async () => ({ refused }) }))).toEqual({ done: false, refused })
    expect(existsSync(join(root, 'box/.torno/renamed.json'))).toBe(false)
  })

  it('refuses when the file changed since the kernel read it, or a span is not the old name', async () => {
    const stale = kernelSites()
    writeFileSync(join(root, 'box', 'model.py'), `${MODEL}# saved\n`)
    expect(await renamePart(box, { from: 'shell', to: 'x' }, deps({ sites: async () => stale }))).toEqual({ done: false, refused: expect.stringMatching(/changed while torno looked/) })
    writeFileSync(join(root, 'box', 'model.py'), MODEL)
    const off = kernelSites()
    if ('sites' in off) off.sites[0].start += 1
    expect(await renamePart(box, { from: 'shell', to: 'x' }, deps({ sites: async () => off }))).toEqual({ done: false, refused: expect.stringMatching(/not what the kernel read/) })
    expect(read('box/model.py')).toBe(MODEL)
  })

  it('never writes a file outside the project, nor through a link', async () => {
    const outside = kernelSites()
    if ('sites' in outside) outside.sites[0].file = 'common/model.py'
    expect((await renamePart(box, { from: 'shell', to: 'x' }, deps({ sites: async () => outside }))).done).toBe(false)
    writeFileSync(join(root, 'real.py'), MODEL)
    rmSync(join(root, 'box', 'model.py'))
    symlinkSync(join(root, 'real.py'), join(root, 'box', 'model.py'))
    expect(await renamePart(box, { from: 'shell', to: 'x' }, deps())).toEqual({ done: false, refused: expect.stringMatching(/cannot be written/) })
    expect(read('real.py')).toBe(MODEL)
  })
})

describe('the notice of a rename', () => {
  it('tells the next prompt once, and is let go only once the answer has left', async () => {
    await keepRenameNotice(box.dir, { from: 'shell', to: 'front case', files: ['model.py'], at: 'now' })
    const notice = await takeRenameNotice(box.dir)
    expect(notice?.text).toBe('The person renamed the part shell to front case in model.py; keep the new name.')
    expect(await takeRenameNotice(box.dir)).not.toBeNull()
    await notice!.done()
    expect(await takeRenameNotice(box.dir)).toBeNull()
  })

  it('folds a rename of a renamed part into it, drops one that puts a name back, and names several', async () => {
    await keepRenameNotice(box.dir, { from: 'shell', to: 'case', files: ['model.py'], at: '1' })
    await keepRenameNotice(box.dir, { from: 'case', to: 'front case', files: ['model.py'], at: '2' })
    expect((await takeRenameNotice(box.dir))?.text).toBe('The person renamed the part shell to front case in model.py; keep the new name.')
    await keepRenameNotice(box.dir, { from: 'lid', to: 'cover', files: ['model.py'], at: '3' })
    expect((await takeRenameNotice(box.dir))?.text).toBe('The person renamed parts in the model: shell to front case in model.py; lid to cover in model.py. Keep the new names.')
    await keepRenameNotice(box.dir, { from: 'cover', to: 'lid', files: ['model.py'], at: '4' })
    await keepRenameNotice(box.dir, { from: 'front case', to: 'shell', files: ['model.py'], at: '5' })
    expect(await takeRenameNotice(box.dir)).toBeNull()
  })

  it('keeps a notice made meanwhile when the one told is let go', async () => {
    await keepRenameNotice(box.dir, { from: 'shell', to: 'case', files: ['model.py'], at: '1' })
    const told = await takeRenameNotice(box.dir)
    await keepRenameNotice(box.dir, { from: 'lid', to: 'cover', files: ['model.py'], at: '2' })
    await told!.done()
    expect((await takeRenameNotice(box.dir))?.text).toContain('lid to cover')
  })

  it('is short whatever was renamed: long names are cut, and what does not fit is counted', async () => {
    for (let i = 0; i < 8; i++) await keepRenameNotice(box.dir, { from: `${'p'.repeat(70)}${i}`, to: `${'q'.repeat(70)}${i}`, files: ['model.py', 'a/b.py', 'c.py', 'd.py'], at: String(i) })
    const text = (await takeRenameNotice(box.dir))!.text
    expect(text.length).toBeLessThanOrEqual(RENAME_LIMIT)
    expect(text).toMatch(/and \d+ more\. Keep the new names\.$/)
  })
})
