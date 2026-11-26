import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync, existsSync, lstatSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { addFiles } from './add'

let root: string
let from: string
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'torno-add-ws-'))
  from = mkdtempSync(join(tmpdir(), 'torno-add-from-'))
})
afterEach(() => {
  rmSync(root, { recursive: true, force: true })
  rmSync(from, { recursive: true, force: true })
})

const made = (name: string, text = 'bytes of ' + name): string => {
  const path = join(from, name)
  writeFileSync(path, text)
  return path
}
const folder = (id = 'mts_101'): string => join(root, 'common', 'parts', id)
const names = (dir: string): string[] => readdirSync(dir).sort()
/** What is under the workspace, all of it, so a test can say nothing else was made. */
function everything(dir: string, at = ''): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? [`${at}${e.name}/`, ...everything(join(dir, e.name), `${at}${e.name}/`)] : [`${at}${e.name}`])).sort()
}

describe('addFiles', () => {
  it('makes common/, common/parts/ and the part folder, and copies each file whole', async () => {
    const got = await addFiles(root, 'mts_101', [made('drawing.jpg'), made('Sizes.PNG'), made('sheet.pdf'), made('body.STEP')])
    expect(got).toEqual({ copied: ['drawing.jpg', 'Sizes.png', 'sheet.pdf', 'body.step'], refused: [] })
    expect(names(folder())).toEqual(['Sizes.png', 'body.step', 'drawing.jpg', 'sheet.pdf'])
    expect(readFileSync(join(folder(), 'drawing.jpg'), 'utf8')).toBe('bytes of drawing.jpg')
    // Nothing else: no part.py, no .torno, no temp file.
    expect(everything(root)).toEqual(['common/', 'common/parts/', 'common/parts/mts_101/', 'common/parts/mts_101/Sizes.png', 'common/parts/mts_101/body.step', 'common/parts/mts_101/drawing.jpg', 'common/parts/mts_101/sheet.pdf'])
  })

  it('adds to a part already on the shelf and never touches what is there', async () => {
    mkdirSync(folder(), { recursive: true })
    writeFileSync(join(folder(), 'part.py'), '"""x"""\n')
    writeFileSync(join(folder(), 'old.jpg'), 'old')
    const got = await addFiles(root, 'mts_101', [made('new.jpg')])
    expect(got.copied).toEqual(['new.jpg'])
    expect(names(folder())).toEqual(['new.jpg', 'old.jpg', 'part.py'])
    expect(readFileSync(join(folder(), 'part.py'), 'utf8')).toBe('"""x"""\n')
  })

  it('refuses a name that is taken, in any case, and says which; the others are copied', async () => {
    mkdirSync(folder(), { recursive: true })
    writeFileSync(join(folder(), 'Drawing.JPG'), 'mine')
    const got = await addFiles(root, 'mts_101', [made('drawing.jpg', 'theirs'), made('sizes.jpg')])
    expect(got.copied).toEqual(['sizes.jpg'])
    expect(got.refused).toEqual([{ name: 'drawing.jpg', why: expect.stringMatching(/already there/) }])
    expect(readFileSync(join(folder(), 'Drawing.JPG'), 'utf8')).toBe('mine')
    expect(names(folder())).toEqual(['Drawing.JPG', 'sizes.jpg'])
  })

  it('refuses a name taken by a link, even one that leads nowhere', async () => {
    mkdirSync(folder(), { recursive: true })
    symlinkSync(join(from, 'nowhere'), join(folder(), 'drawing.jpg'))
    const got = await addFiles(root, 'mts_101', [made('drawing.jpg')])
    expect(got.copied).toEqual([])
    expect(got.refused).toHaveLength(1)
    expect(existsSync(join(from, 'nowhere'))).toBe(false)
  })

  it('refuses two files that would have one name in the folder', async () => {
    mkdirSync(join(from, 'b'))
    const a = made('x.png')
    const b = join(from, 'b', 'X.png')
    writeFileSync(b, 'other')
    const got = await addFiles(root, 'mts_101', [a, b])
    expect(got.copied).toEqual(['x.png'])
    expect(got.refused).toEqual([{ name: 'X.png', why: expect.stringMatching(/Two files/) }])
  })

  it('refuses a link, a folder and a file that is not there, naming each, and copies the rest', async () => {
    const real = made('real.png')
    symlinkSync(real, join(from, 'link.png'))
    mkdirSync(join(from, 'dir.png'))
    const got = await addFiles(root, 'mts_101', [join(from, 'link.png'), join(from, 'dir.png'), join(from, 'gone.png'), real])
    expect(got.copied).toEqual(['real.png'])
    expect(got.refused.map((r) => r.name)).toEqual(['link.png', 'dir.png', 'gone.png'])
    expect(got.refused[0].why).toMatch(/link/)
    expect(got.refused[1].why).toMatch(/plain file/)
    expect(got.refused[2].why).toMatch(/not there/)
    expect(names(folder())).toEqual(['real.png'])
  })

  it('refuses a file of a kind the shelf does not take, and a path that is not absolute', async () => {
    const got = await addFiles(root, 'mts_101', [made('notes.txt'), made('part.py'), made('cloud.ply'), 'relative.png'])
    expect(got.copied).toEqual([])
    expect(got.refused.map((r) => r.name)).toEqual(['notes.txt', 'part.py', 'cloud.ply', 'relative.png'])
    expect(got.refused[0].why).toMatch(/pdf|png|step/i)
  })

  it('refuses a file over its cap: a picture or a PDF over 25 MB, a STEP over 50 MB', async () => {
    const big = (name: string, mb: number): string => {
      const path = join(from, name)
      writeFileSync(path, Buffer.alloc(mb * 1024 * 1024 + 1))
      return path
    }
    const got = await addFiles(root, 'mts_101', [big('a.png', 25), big('b.pdf', 25), big('c.step', 50)])
    expect(got.copied).toEqual([])
    expect(got.refused.map((r) => r.name)).toEqual(['a.png', 'b.pdf', 'c.step'])
    expect(got.refused.every((r) => /25 MB|50 MB/.test(r.why))).toBe(true)
  })

  it('takes a STEP of 30 MB, which is over a picture\'s cap and under its own', async () => {
    const path = join(from, 'x.stp')
    writeFileSync(path, Buffer.alloc(30 * 1024 * 1024, 1))
    const got = await addFiles(root, 'mts_101', [path])
    expect(got.copied).toEqual(['x.stp'])
    expect(lstatSync(join(folder(), 'x.stp')).size).toBe(30 * 1024 * 1024)
  })

  it('leaves no folder behind when every file is refused', async () => {
    const got = await addFiles(root, 'mts_101', [made('notes.txt')])
    expect(got.copied).toEqual([])
    expect(everything(root)).toEqual([])
  })

  it('refuses a bad id, no paths and more than eight files, and writes nothing', async () => {
    const a = made('a.png')
    for (const id of ['', '..', '../x', 'a/b', 'EC11', 'es-p', 'class', 'a'.repeat(49)]) {
      await expect(addFiles(root, id, [a])).rejects.toThrow(/not a part/)
    }
    await expect(addFiles(root, 7 as unknown as string, [a])).rejects.toThrow(/not a part/)
    await expect(addFiles(root, 'ok', [])).rejects.toThrow(/at least one|no file/i)
    await expect(addFiles(root, 'ok', 'a.png' as unknown as string[])).rejects.toThrow(/list of files/)
    await expect(addFiles(root, 'ok', [a, 3 as unknown as string])).rejects.toThrow(/path/)
    await expect(addFiles(root, 'ok', Array.from({ length: 9 }, (_, n) => made(`f${n}.png`)))).rejects.toThrow(/at most 8/)
    await expect(addFiles(null, 'ok', [a])).rejects.toThrow(/no workspace/i)
    expect(everything(root)).toEqual([])
  })

  it('refuses a link at each level of the way, writing nothing through it', async () => {
    const elsewhere = mkdtempSync(join(tmpdir(), 'torno-add-else-'))
    try {
      // common is a link
      symlinkSync(elsewhere, join(root, 'common'))
      await expect(addFiles(root, 'mts_101', [made('a.png')])).rejects.toThrow(/link/)
      expect(readdirSync(elsewhere)).toEqual([])
      rmSync(join(root, 'common'))
      // common/parts is a link
      mkdirSync(join(root, 'common'))
      symlinkSync(elsewhere, join(root, 'common', 'parts'))
      await expect(addFiles(root, 'mts_101', [made('a.png')])).rejects.toThrow(/link/)
      expect(readdirSync(elsewhere)).toEqual([])
      rmSync(join(root, 'common', 'parts'))
      // the part's folder is a link
      mkdirSync(join(root, 'common', 'parts'))
      symlinkSync(elsewhere, folder())
      await expect(addFiles(root, 'mts_101', [made('a.png')])).rejects.toThrow(/link/)
      expect(readdirSync(elsewhere)).toEqual([])
    } finally {
      rmSync(elsewhere, { recursive: true, force: true })
    }
  })

  it('refuses a level that is a file', async () => {
    mkdirSync(join(root, 'common'))
    writeFileSync(join(root, 'common', 'parts'), 'x')
    await expect(addFiles(root, 'mts_101', [made('a.png')])).rejects.toThrow(/not a folder/)
  })

  it('leaves no temp file and no new folder when a copy fails', async () => {
    const gone = made('a.png')
    // A file that is a folder where a name is wanted makes the copy fail after the folders are made: the dest is a real folder.
    mkdirSync(join(root, 'common', 'parts', 'mts_101', 'a.png'), { recursive: true })
    const got = await addFiles(root, 'mts_101', [gone])
    expect(got.copied).toEqual([])
    expect(got.refused).toHaveLength(1)
    expect(names(folder())).toEqual(['a.png'])
    expect(lstatSync(join(folder(), 'a.png')).isDirectory()).toBe(true)
  })

  it('takes the folders it made away again when the one file it could copy was gone by the time it came to it', async () => {
    const path = made('a.png')
    const got = await addFiles(root, 'mts_101', [path], { afterFolders: () => rmSync(path) })
    expect(got.copied).toEqual([])
    expect(got.refused).toEqual([{ name: 'a.png', why: expect.stringMatching(/not there/) }])
    expect(everything(root)).toEqual([])
  })

  it('keeps a folder that was there before, when nothing is copied', async () => {
    mkdirSync(folder(), { recursive: true })
    const path = made('a.png')
    await addFiles(root, 'mts_101', [path], { afterFolders: () => rmSync(path) })
    expect(everything(root)).toEqual(['common/', 'common/parts/', 'common/parts/mts_101/'])
  })

  it('never writes a hidden temp file that is left once it is done', async () => {
    await addFiles(root, 'mts_101', [made('a.png'), made('b.png')])
    expect(names(folder()).filter((n) => n.startsWith('.') || n.endsWith('.tmp'))).toEqual([])
  })
})
