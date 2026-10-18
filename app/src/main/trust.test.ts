import { mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Trust, projectSettings } from './trust'

let home: string
let object: string
beforeEach(() => {
  home = mkdtempSync(join(realpathSync(tmpdir()), 'torno-trust-'))
  object = join(home, 'work', 'ws', 'box')
  mkdirSync(object, { recursive: true })
})
afterEach(() => rmSync(home, { recursive: true, force: true }))

const put = (path: string, text = '{}'): void => {
  mkdirSync(join(path, '..'), { recursive: true })
  writeFileSync(path, text)
}

describe('the project settings Claude Code would load', () => {
  it('are none in a folder that has none', async () => {
    expect(await projectSettings(object, home)).toEqual([])
  })

  it('are .mcp.json and the two settings files of the folder, relative to it', async () => {
    put(join(object, '.mcp.json'))
    put(join(object, '.claude', 'settings.json'))
    put(join(object, '.claude', 'settings.local.json'))
    put(join(object, '.claude', 'commands', 'x.md'))
    expect(await projectSettings(object, home)).toEqual(['.mcp.json', join('.claude', 'settings.json'), join('.claude', 'settings.local.json')])
  })

  it('are also those of each parent, up to but not including the home folder, nearest first', async () => {
    put(join(home, 'work', 'ws', '.claude', 'settings.json'))
    put(join(home, 'work', '.mcp.json'))
    // Never the person\'s own: `~/.claude` and `~/.mcp.json` are in the home folder.
    put(join(home, '.claude', 'settings.json'))
    put(join(home, '.mcp.json'))
    expect(await projectSettings(object, home)).toEqual([join('..', '.claude', 'settings.json'), join('..', '..', '.mcp.json')])
  })

  it('reports a .claude that is a link by its own path and does not follow it', async () => {
    mkdirSync(join(home, 'elsewhere'))
    put(join(home, 'elsewhere', 'settings.json'))
    symlinkSync(join(home, 'elsewhere'), join(object, '.claude'))
    expect(await projectSettings(object, home)).toEqual(['.claude'])
  })

  it('goes up to the root for a folder that is not under home', async () => {
    // `object` is under a temporary folder, not under this other "home".
    put(join(home, '.mcp.json'))
    // Nothing of the machine's own above the temporary folder is assumed.
    expect(await projectSettings(object, join(tmpdir(), 'not-an-ancestor'))).toContain(join('..', '..', '..', '.mcp.json'))
  })
})

describe('a home that is a link', () => {
  it('is the home all the same: its own settings are not reported, though the object is found by its real path', async () => {
    const real = join(home, 'real-home')
    const link = join(home, 'link-home')
    const obj = join(real, 'ws', 'box')
    mkdirSync(obj, { recursive: true })
    symlinkSync(real, link)
    put(join(real, '.claude', 'settings.json'))
    put(join(real, 'ws', '.mcp.json'))
    expect(await projectSettings(obj, link)).toEqual([join('..', '.mcp.json')])
    // And the other way round: the object by the link, the home by its real path.
    expect(await projectSettings(join(link, 'ws', 'box'), real)).toEqual([join('..', '.mcp.json')])
  })
})

describe('the folders the person let the chat start in', () => {
  it('asks for a folder with settings until it is accepted, and for one without never', async () => {
    const trust = new Trust(join(home, 'cfg', 'trusted.json'), home)
    expect(await trust.pending(object)).toEqual([])
    put(join(object, '.mcp.json'))
    expect(await trust.pending(object)).toEqual(['.mcp.json'])
    await trust.accept(object)
    expect(await trust.pending(object)).toEqual([])
    // Remembered by another instance: it is on file, whole, with no temp file beside it.
    expect(await new Trust(join(home, 'cfg', 'trusted.json'), home).pending(object)).toEqual([])
    expect(readdirSync(join(home, 'cfg'))).toEqual(['trusted.json'])
    expect(JSON.parse(readFileSync(join(home, 'cfg', 'trusted.json'), 'utf8')).folders).toEqual([object])
    // A change to the files does not ask again.
    put(join(object, '.claude', 'settings.json'))
    expect(await trust.pending(object)).toEqual([])
  })

  it('names the folder by its real path: a link to it is the same folder', async () => {
    put(join(object, '.mcp.json'))
    const trust = new Trust(null, home)
    await trust.accept(object)
    const link = join(home, 'link')
    symlinkSync(object, link)
    expect(await trust.pending(link)).toEqual([])
  })

  it('keeps the answer for this run only, with no file', async () => {
    put(join(object, '.mcp.json'))
    const trust = new Trust(null, home)
    await trust.accept(object)
    expect(await trust.pending(object)).toEqual([])
    expect(await new Trust(null, home).pending(object)).toEqual(['.mcp.json'])
  })

  it('asks again when the file is not one of ours', async () => {
    put(join(home, 'trusted.json'), 'not json')
    put(join(object, '.mcp.json'))
    expect(await new Trust(join(home, 'trusted.json'), home).pending(object)).toEqual(['.mcp.json'])
  })
})
