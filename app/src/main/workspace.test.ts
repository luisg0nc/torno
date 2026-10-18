import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { scanOrder, scanWorkspace } from './workspace'

const FIXTURES = resolve(__dirname, '../../../kernel/tests/fixtures/ws')

describe('scanWorkspace on the fixture workspace', () => {
  it('lists every folder that holds a .py file, sorted by name, and skips the rest', async () => {
    const info = await scanWorkspace(FIXTURES)
    expect(info.root).toBe(FIXTURES)
    expect(info.hasProject).toBe(false)
    expect(info.objects.map((o) => o.id)).toEqual(
      ['bracket', 'broken', 'chatty', 'crash', 'exits', 'gauge', 'grouped', 'hollow', 'makers', 'measures', 'morph', 'noscene', 'plain', 'slow', 'spread', 'two']
    )
  })

  it('names the one model file, leaving test files out', async () => {
    const { objects } = await scanWorkspace(FIXTURES)
    const bracket = objects.find((o) => o.id === 'bracket')
    expect(bracket).toEqual({ id: 'bracket', name: 'bracket', dir: join(FIXTURES, 'bracket'), model: 'bracket.py' })
  })

  it('leaves the model null and names both files when there are two candidates', async () => {
    const { objects } = await scanWorkspace(FIXTURES)
    const two = objects.find((o) => o.id === 'two')!
    expect(two.model).toBeNull()
    expect(two.problem).toBe(`more than one model file in ${join(FIXTURES, 'two')}: a.py, b.py`)
  })
})

describe('scanWorkspace', () => {
  const root = mkdtempSync(join(tmpdir(), 'torno-ws-'))
  afterAll(() => rmSync(root, { recursive: true, force: true }))

  function object(name: string, files: string[]): void {
    mkdirSync(join(root, name), { recursive: true })
    for (const file of files) writeFileSync(join(root, name, file), '')
  }

  it('skips hidden, private and reserved folders, and files at the top level', async () => {
    writeFileSync(join(root, 'pyproject.toml'), '')
    writeFileSync(join(root, 'loose.py'), '')
    for (const name of ['.hidden', '_private', 'common', 'tests', 'out']) object(name, ['m.py'])
    object('gear', ['gear.py'])
    object('onlytests', ['test_x.py', 'x_test.py', 'conftest.py'])
    mkdirSync(join(root, 'nested', 'deep.py'), { recursive: true })

    const info = await scanWorkspace(root)
    expect(info.hasProject).toBe(true)
    expect(info.objects.map((o) => o.id)).toEqual(['gear', 'onlytests'])
    expect(info.objects[0].model).toBe('gear.py')
    expect(info.objects[1].model).toBeNull()
    expect(info.objects[1].problem).toBe(`no model file in ${join(root, 'onlytests')}`)
  })

  it('prefers the candidate named after the folder, with - and _ alike', async () => {
    object('helmet-stand', ['helmet_stand.py', 'scratch.py', 'measure.py'])
    object('speaker_stand', ['speaker-stand.py', 'notes.py'])
    object('Lamp', ['lamp.py', 'Lamp.py'])
    // On a case-insensitive filesystem (macOS) the two names are one file: nothing to tell them apart by.
    const caseSensitive = readdirSync(join(root, 'Lamp')).length === 2
    const { objects } = await scanWorkspace(root)
    const of = (id: string) => objects.find((o) => o.id === id)
    expect(of('helmet-stand')).toEqual({ id: 'helmet-stand', name: 'helmet-stand', dir: join(root, 'helmet-stand'), model: 'helmet_stand.py' })
    expect(of('speaker_stand')?.model).toBe('speaker-stand.py')
    // Case is not folded: exactly one file is named as the folder is.
    if (caseSensitive) expect(of('Lamp')?.model).toBe('Lamp.py')
  })

  it('reports several candidates only when none, or more than one, is named after the folder', async () => {
    object('clip', ['a.py', 'b.py'])
    object('two-names', ['two-names.py', 'two_names.py', 'other.py'])
    const { objects } = await scanWorkspace(root)
    expect(objects.find((o) => o.id === 'clip')).toMatchObject({ model: null, problem: `more than one model file in ${join(root, 'clip')}: a.py, b.py` })
    expect(objects.find((o) => o.id === 'two-names')).toMatchObject({
      model: null,
      problem: `more than one model file in ${join(root, 'two-names')}: other.py, two-names.py, two_names.py`
    })
  })

  it('never takes __init__.py or a dotfile for a model', async () => {
    object('pkg', ['__init__.py', '.draft.py', 'pkg_part.py'])
    object('initonly', ['__init__.py', '.hidden.py'])
    const { objects } = await scanWorkspace(root)
    expect(objects.find((o) => o.id === 'pkg')?.model).toBe('pkg_part.py')
    expect(objects.find((o) => o.id === 'initonly')).toBeUndefined()
  })

  it('rejects a root that is not a folder', async () => {
    await expect(scanWorkspace(join(root, 'missing'))).rejects.toThrow(/missing/)
  })
})

describe('scanOrder', () => {
  it('keeps scans that end in the order they began', () => {
    const begin = scanOrder()
    const first = begin()
    expect(first()).toBe(true)
    const second = begin()
    expect(second()).toBe(true)
  })

  it('drops a scan that ends after one begun later has been kept', () => {
    const begin = scanOrder()
    const older = begin()
    const newer = begin()
    expect(newer()).toBe(true)
    expect(older()).toBe(false)
    // And the next one is kept again.
    expect(begin()()).toBe(true)
  })

  it('keeps an older scan while the newer one has not ended, which then replaces it', () => {
    const begin = scanOrder()
    const older = begin()
    const newer = begin()
    expect(older()).toBe(true)
    expect(newer()).toBe(true)
  })
})
