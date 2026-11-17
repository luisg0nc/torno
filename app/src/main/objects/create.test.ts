import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, symlinkSync, truncateSync, utimesSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { CreateRequest } from '../../shared/bridge'
import type { BoardFile } from '../../shared/board'
import { readBoardFile } from '../board/file'
import { reconcile } from '../board/sources'
import { listBoardReferences } from '../sessions/reference'
import { createObject, readPhoto, sweepStaleNew } from './create'
import template from './template.py.txt?raw'

const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3])
const JPG = Uint8Array.from([0xff, 0xd8, 0xff, 9, 9])

/** What a made folder holds of the board, beside what it was given. */
const BOARD = ['.torno/', '.torno/board/', '.torno/board/board.json']

let base: string
let ws: string
let files: string

/** Every file and folder under `dir`, relative, sorted. */
function tree(dir: string, prefix = ''): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    out.push(prefix + entry.name + (entry.isDirectory() ? '/' : ''))
    if (entry.isDirectory()) out.push(...tree(join(dir, entry.name), prefix + entry.name + '/'))
  }
  return out.sort()
}

function request(over: Partial<CreateRequest> = {}): CreateRequest {
  return { name: 'cable-clip', description: 'A clip for a 6 mm cable.', photos: [], doodles: [], steps: [], scans: [], objects: [], sizes: [], rules: '', links: [], pdfs: [], ...over }
}

const make = (req: CreateRequest, objects: string[] = [], hooks?: Parameters<typeof createObject>[1]['hooks']) => createObject(req, { root: ws, objects, hooks })

beforeEach(() => {
  base = mkdtempSync(join(realpathSync(tmpdir()), 'torno-create-'))
  ws = join(base, 'ws')
  files = join(base, 'files')
  mkdirSync(ws)
  mkdirSync(files)
  mkdirSync(join(ws, 'lid'))
  writeFileSync(join(ws, 'lid', 'lid.py'), '# lid\n')
})
afterEach(() => rmSync(base, { recursive: true, force: true }))

describe('creating an object', () => {
  it('writes the template and the brief, and nothing else, when there is nothing to copy', async () => {
    expect(await make(request())).toEqual({ objectId: 'cable-clip' })
    expect(tree(join(ws, 'cable-clip'))).toEqual([...BOARD, 'brief.md', 'cable_clip.py'])
    expect(readFileSync(join(ws, 'cable-clip', 'cable_clip.py'), 'utf8')).toBe(template)
    expect(readFileSync(join(ws, 'cable-clip', 'brief.md'), 'utf8')).toBe('# cable-clip\n\nA clip for a 6 mm cable.\n')
    expect(tree(ws)).toEqual(['cable-clip/', ...BOARD.map((b) => `cable-clip/${b}`), 'cable-clip/brief.md', 'cable-clip/cable_clip.py', 'lid/', 'lid/lid.py'])
  })

  it('copies photos and doodles in the order given and lists every item in the brief, in order', async () => {
    writeFileSync(join(files, 'a.PNG'), PNG)
    writeFileSync(join(files, 'b.jpeg'), JPG)
    const scan = join(files, 'part.stl')
    writeFileSync(scan, 'solid')
    await make(
      request({
        description: '  A clip.\n\nSecond paragraph.  ',
        photos: [
          { path: join(files, 'b.jpeg'), note: 'the desk edge' },
          { path: join(files, 'a.PNG'), note: '' }
        ],
        doodles: [{ png: PNG, note: 'the shape,\nroughly' }],
        scans: [{ path: scan, note: 'the old clip' }],
        objects: [{ id: 'lid', note: 'mounts on this' }]
      }),
      ['lid']
    )
    const dir = join(ws, 'cable-clip')
    expect(tree(dir)).toEqual([...BOARD, 'brief.md', 'cable_clip.py', 'reference/', 'reference/doodle-1.png', 'reference/photo-1.jpeg', 'reference/photo-2.png'])
    expect([...readFileSync(join(dir, 'reference', 'photo-1.jpeg'))]).toEqual([...JPG])
    expect([...readFileSync(join(dir, 'reference', 'photo-2.png'))]).toEqual([...PNG])
    expect([...readFileSync(join(dir, 'reference', 'doodle-1.png'))]).toEqual([...PNG])
    expect(readFileSync(join(dir, 'brief.md'), 'utf8')).toBe(
      [
        '# cable-clip',
        '',
        'A clip.\n\nSecond paragraph.',
        '',
        '## References',
        '',
        '- reference/photo-1.jpeg: the desk edge',
        '- reference/photo-2.png',
        '- reference/doodle-1.png: the shape, roughly',
        `- scan ${scan}: the old clip`,
        '- ../lid/: mounts on this',
        ''
      ].join('\n')
    )
  })

  it('leaves no temp folder, and the workspace lists nothing before the rename', async () => {
    let seen: string[] = []
    await make(request(), [], {
      beforeRename: (temp) => {
        seen = readdirSync(ws)
        expect(tree(temp)).toEqual([...BOARD, 'brief.md', 'cable_clip.py'])
      }
    })
    expect(seen.filter((n) => !n.startsWith('.'))).toEqual(['lid'])
    expect(seen.some((n) => n.startsWith('.cable-clip.torno-new-'))).toBe(true)
    expect(readdirSync(ws).sort()).toEqual(['cable-clip', 'lid'])
  })

  it('refuses a name that is no good, or there already in any case, and writes nothing', async () => {
    for (const name of ['', '../x', 'a/b', '.x', 'class', 'LID', 'common']) {
      await expect(make(request({ name }))).rejects.toThrow()
    }
    expect(readdirSync(ws)).toEqual(['lid'])
    expect(readFileSync(join(ws, 'lid', 'lid.py'), 'utf8')).toBe('# lid\n')
  })

  it('refuses a folder with no model but something in it, or a plain file, of the same name', async () => {
    mkdirSync(join(ws, 'full'))
    writeFileSync(join(ws, 'full', 'x.txt'), 'x')
    writeFileSync(join(ws, 'notes'), 'x')
    await expect(make(request({ name: 'full' }))).rejects.toThrow(/there already/)
    await expect(make(request({ name: 'Notes' }))).rejects.toThrow(/there already/)
    expect(readdirSync(ws).sort()).toEqual(['full', 'lid', 'notes'])
  })

  it('takes an empty folder of the name as free (a crash left it between the claim and the rename)', async () => {
    mkdirSync(join(ws, 'cable-clip'))
    expect(await make(request())).toEqual({ objectId: 'cable-clip' })
    expect(tree(join(ws, 'cable-clip'))).toEqual([...BOARD, 'brief.md', 'cable_clip.py'])
    expect(readdirSync(ws).sort()).toEqual(['cable-clip', 'lid'])
  })

  it('does not take an empty folder as free in another case, or a link to one, and leaves an empty folder it failed on', async () => {
    mkdirSync(join(ws, 'Other'))
    await expect(make(request({ name: 'other' }))).rejects.toThrow(/there already/)
    mkdirSync(join(base, 'elsewhere'))
    symlinkSync(join(base, 'elsewhere'), join(ws, 'linked'))
    await expect(make(request({ name: 'linked' }))).rejects.toThrow(/there already/)
    expect(readdirSync(join(base, 'elsewhere'))).toEqual([])
    mkdirSync(join(ws, 'cable-clip'))
    await expect(make(request({ photos: [{ path: join(files, 'missing.png'), note: '' }] }))).rejects.toThrow(/not there/)
    expect(readdirSync(join(ws, 'cable-clip'))).toEqual([])
  })

  it('refuses the scan path that has a line break, and writes it into the brief as it is otherwise', async () => {
    await expect(make(request({ scans: [{ path: '/x/a\n- ../lid/: injected.stl', note: '' }] }))).rejects.toThrow(/scan/)
    await expect(make(request({ scans: [{ path: '/x/a\r.stl', note: '' }] }))).rejects.toThrow(/scan/)
    expect(readdirSync(ws)).toEqual(['lid'])
  })

  it('refuses a description that is empty, and items beyond the caps', async () => {
    await expect(make(request({ description: '  \n' }))).rejects.toThrow(/what it is/i)
    const photo = (i: number) => ({ path: join(files, `p${i}.png`), note: '' })
    await expect(make(request({ photos: Array.from({ length: 13 }, (_, i) => photo(i)) }))).rejects.toThrow(/photos/)
    await expect(make(request({ doodles: Array.from({ length: 7 }, () => ({ png: PNG, note: '' })) }))).rejects.toThrow(/doodles/)
    await expect(make(request({ scans: Array.from({ length: 5 }, () => ({ path: '/x/a.stl', note: '' })) }))).rejects.toThrow(/scans/)
    await expect(make(request({ objects: Array.from({ length: 9 }, () => ({ id: 'lid', note: '' })) }), ['lid'])).rejects.toThrow(/projects/)
    expect(readdirSync(ws)).toEqual(['lid'])
  })

  it('checks every note and refuses a file given twice before it makes anything, the photos last of all', async () => {
    writeFileSync(join(files, 'a.png'), PNG)
    const a = { path: join(files, 'a.png'), note: '' }
    const seen: string[] = []
    const hooks = { beforeRename: (t: string) => void seen.push(t) }
    const long = 'x'.repeat(2001)
    await expect(make(request({ photos: [a, { ...a }] }), [], hooks)).rejects.toThrow(/twice/)
    await expect(make(request({ photos: [{ ...a, note: long }] }), [], hooks)).rejects.toThrow(/note/)
    await expect(make(request({ doodles: [{ png: PNG, note: long }] }), [], hooks)).rejects.toThrow(/note/)
    await expect(make(request({ scans: [{ path: '/s/a.stl', note: long }] }), [], hooks)).rejects.toThrow(/note/)
    await expect(make(request({ objects: [{ id: 'lid', note: long }] }), ['lid'], hooks)).rejects.toThrow(/note/)
    await expect(make(request({ scans: [{ path: '/s/a.stl', note: '' }, { path: '/s/a.stl', note: '' }] }), [], hooks)).rejects.toThrow(/twice/)
    await expect(make(request({ objects: [{ id: 'lid', note: '' }, { id: 'lid', note: '' }] }), ['lid'], hooks)).rejects.toThrow(/twice/)
    expect(seen).toEqual([])
    // A note is 2,000 characters after it is folded to one line: this one is longer before, not after.
    await make(request({ photos: [{ ...a, note: `${'x '.repeat(900)}\n\n\n    ${'y'.repeat(100)}` }] }), [], hooks)
    expect(seen).toHaveLength(1)
  })

  it('writes a scan under the home folder with ~', async () => {
    const home = homedir()
    await make(request({ scans: [{ path: join(home, 'Downloads', 'desk.stl'), note: '' }, { path: '/mnt/scans/b.stl', note: '' }] }))
    const brief = readFileSync(join(ws, 'cable-clip', 'brief.md'), 'utf8')
    expect(brief).toContain('- scan ~/Downloads/desk.stl\n')
    expect(brief).toContain('- scan /mnt/scans/b.stl\n')
    expect(brief).not.toContain(home)
  })

  it('refuses an object that is not in the workspace, and a scan of a format scans do not have', async () => {
    await expect(make(request({ objects: [{ id: 'nope', note: '' }] }), ['lid'])).rejects.toThrow(/nope/)
    await expect(make(request({ objects: [{ id: '../x', note: '' }] }), ['lid'])).rejects.toThrow()
    await expect(make(request({ scans: [{ path: join(files, 'x.exe'), note: '' }] }))).rejects.toThrow(/scan/)
    await expect(make(request({ scans: [{ path: 'relative.stl', note: '' }] }))).rejects.toThrow(/scan/)
    expect(readdirSync(ws)).toEqual(['lid'])
  })

  describe('reading a photo for the window (its thumbnail, its scaled copy)', () => {
    it('gives the bytes of a plain image file', async () => {
      writeFileSync(join(files, 'a.PNG'), PNG)
      expect(new Uint8Array(await readPhoto(join(files, 'a.PNG')))).toEqual(PNG)
    })
    it('refuses a link, a folder, a file that is no image by its name, a relative path, one over 25 MB', async () => {
      writeFileSync(join(files, 'real.png'), PNG)
      symlinkSync(join(files, 'real.png'), join(files, 'link.png'))
      mkdirSync(join(files, 'dir.png'))
      writeFileSync(join(files, 'notes.txt'), 'x')
      writeFileSync(join(files, 'big.png'), PNG)
      truncateSync(join(files, 'big.png'), 25 * 1024 * 1024 + 1)
      for (const path of [join(files, 'link.png'), join(files, 'dir.png'), join(files, 'notes.txt'), 'real.png', join(files, 'big.png'), join(files, 'none.png')]) await expect(readPhoto(path)).rejects.toThrow()
    })
  })

  describe('a photo that cannot be taken', () => {
    const attempt = async (path: string) => {
      writeFileSync(join(files, 'good.png'), PNG)
      await expect(make(request({ photos: [{ path: join(files, 'good.png'), note: '' }, { path, note: '' }] }))).rejects.toThrow()
      // The first photo was copied into the temp folder before the second was found wanting: all of it is gone.
      expect(readdirSync(ws)).toEqual(['lid'])
    }

    it('is missing', () => attempt(join(files, 'missing.png')))
    it('is a link', async () => {
      writeFileSync(join(files, 'real.png'), PNG)
      symlinkSync(join(files, 'real.png'), join(files, 'link.png'))
      await attempt(join(files, 'link.png'))
    })
    it('is a folder', async () => {
      mkdirSync(join(files, 'dir.png'))
      await attempt(join(files, 'dir.png'))
    })
    it('is a FIFO', async () => {
      execFileSync('mkfifo', [join(files, 'pipe.png')])
      await attempt(join(files, 'pipe.png'))
    })
    it('is over 25 MB (not read whole)', async () => {
      const big = join(files, 'big.png')
      writeFileSync(big, PNG)
      truncateSync(big, 25 * 1024 * 1024 + 1)
      await attempt(big)
    })
    it('has a name that is no image', async () => {
      writeFileSync(join(files, 'doc.pdf'), PNG)
      await attempt(join(files, 'doc.pdf'))
    })
    it('is not an absolute path', () => attempt('photo.png'))
  })

  describe('a vendor STEP file (a bought part)', () => {
    const STEP = 'ISO-10303-21;\nHEADER;\nENDSEC;\n'
    const step = (name: string, text = STEP) => {
      writeFileSync(join(files, name), text)
      return join(files, name)
    }

    it('is copied into reference/ under its own name, and listed in the brief after the doodles', async () => {
      const a = step('608zz.STEP')
      const b = step('motor mount.stp', 'other')
      await make(request({ steps: [{ path: a, note: 'the bearing' }, { path: b, note: '' }] }))
      const dir = join(ws, 'cable-clip')
      expect(tree(dir)).toEqual([...BOARD, 'brief.md', 'cable_clip.py', 'reference/', 'reference/608zz.step', 'reference/motor_mount.stp'])
      expect(readFileSync(join(dir, 'reference', '608zz.step'), 'utf8')).toBe(STEP)
      expect(readFileSync(join(dir, 'brief.md'), 'utf8')).toContain('## References\n\n- reference/608zz.step: the bearing\n- reference/motor_mount.stp\n')
    })

    it('is numbered when two files have the same name', async () => {
      mkdirSync(join(files, 'b'))
      writeFileSync(join(files, 'b', 'part.step'), 'b')
      await make(request({ steps: [{ path: step('part.step'), note: '' }, { path: join(files, 'b', 'part.step'), note: '' }] }))
      expect(tree(join(ws, 'cable-clip', 'reference'))).toEqual(['part-2.step', 'part.step'])
    })

    it('is refused when it is a link, a folder, or no STEP file, and nothing is left', async () => {
      const real = step('real.step')
      symlinkSync(real, join(files, 'link.step'))
      mkdirSync(join(files, 'dir.step'))
      for (const path of [join(files, 'link.step'), join(files, 'dir.step'), join(files, 'missing.step')]) {
        await expect(make(request({ steps: [{ path: real, note: '' }, { path, note: '' }] }))).rejects.toThrow()
        expect(readdirSync(ws)).toEqual(['lid'])
      }
      await expect(make(request({ steps: [{ path: step('x.iges'), note: '' }] }))).rejects.toThrow(/STEP/)
      await expect(make(request({ steps: [{ path: 'relative.step', note: '' }] }))).rejects.toThrow(/STEP/)
      expect(readdirSync(ws)).toEqual(['lid'])
    })

    it('is refused over 50 MB, and the same file given twice, and more than four', async () => {
      const big = step('big.step')
      truncateSync(big, 50 * 1024 * 1024 + 1)
      await expect(make(request({ steps: [{ path: big, note: '' }] }))).rejects.toThrow(/50 MB/)
      const ok = step('ok.step')
      truncateSync(ok, 50 * 1024 * 1024)
      const fine = await make(request({ steps: [{ path: ok, note: '' }] }))
      expect(fine).toEqual({ objectId: 'cable-clip' })
      await expect(make(request({ name: 'two', steps: [{ path: ok, note: '' }, { path: ok, note: '' }] }))).rejects.toThrow(/twice/)
      await expect(make(request({ name: 'five', steps: Array.from({ length: 5 }, (_, i) => ({ path: `/x/${i}.step`, note: '' })) }))).rejects.toThrow(/bought parts/)
    })
  })

  it('refuses a doodle that is not a PNG, or too big, and removes what was copied', async () => {
    writeFileSync(join(files, 'good.png'), PNG)
    const photos = [{ path: join(files, 'good.png'), note: '' }]
    await expect(make(request({ photos, doodles: [{ png: JPG, note: '' }] }))).rejects.toThrow(/PNG/)
    await expect(make(request({ photos, doodles: [{ png: new Uint8Array(8 * 1024 * 1024 + 1).fill(1), note: '' }] }))).rejects.toThrow(/8 MB/)
    await expect(make(request({ photos, doodles: [{ png: 'x' as unknown as Uint8Array, note: '' }] }))).rejects.toThrow()
    expect(readdirSync(ws)).toEqual(['lid'])
  })

  it('does not replace a folder that appeared while it worked, and removes its own', async () => {
    await expect(
      make(request(), [], {
        beforeRename: () => {
          mkdirSync(join(ws, 'cable-clip'))
          writeFileSync(join(ws, 'cable-clip', 'mine.txt'), 'theirs')
        }
      })
    ).rejects.toThrow(/there already/)
    expect(readdirSync(ws).sort()).toEqual(['cable-clip', 'lid'])
    expect(readFileSync(join(ws, 'cable-clip', 'mine.txt'), 'utf8')).toBe('theirs')
  })

  it('does not replace an empty folder that appeared while it worked either', async () => {
    await expect(make(request(), [], { beforeRename: () => mkdirSync(join(ws, 'cable-clip')) })).rejects.toThrow(/there already/)
    expect(existsSync(join(ws, 'cable-clip', 'cable_clip.py'))).toBe(false)
    expect(readdirSync(ws).filter((n) => n.startsWith('.'))).toEqual([])
  })

  it('removes the temp folder when a hook fails mid-way', async () => {
    await expect(make(request(), [], { beforeRename: () => { throw new Error('disk full') } })).rejects.toThrow(/disk full/)
    expect(readdirSync(ws)).toEqual(['lid'])
  })
})

describe('the board a new project starts with', () => {
  const PDF = Buffer.from('%PDF-1.7\n1 0 obj\n')
  const pdf = (name: string, bytes: Buffer | string = PDF) => {
    writeFileSync(join(files, name), bytes)
    return join(files, name)
  }
  const size = (what: string) => ({ what, value: '186 x 128', unit: 'mm' as const, source: 'measured' as const })
  const board = (name = 'cable-clip'): BoardFile => JSON.parse(readFileSync(join(ws, name, '.torno', 'board', 'board.json'), 'utf8'))
  const names = (b: BoardFile) => b.cards.filter((c) => c.kind === 'frame').map((c) => c.name)

  it('writes a board with a Brief frame and nothing else of .torno for a bare request', async () => {
    await make(request())
    expect(tree(join(ws, 'cable-clip'))).toEqual([...BOARD, 'brief.md', 'cable_clip.py'])
    expect(names(board())).toEqual(['Brief'])
  })

  it('writes the board, valid for the file reader, with a frame for each thing given, and copies the PDF', async () => {
    writeFileSync(join(files, 'desk.png'), PNG)
    writeFileSync(join(files, '608zz.step'), 'ISO-10303-21;')
    await make(
      request({
        photos: [{ path: join(files, 'desk.png'), note: 'the desk edge' }],
        doodles: [{ png: PNG, note: 'the shape', over: 0 }],
        steps: [{ path: join(files, '608zz.step'), note: 'bearing' }],
        pdfs: [{ path: pdf('Data Sheet.PDF'), note: 'the connector' }],
        sizes: [size('battery tray')],
        rules: 'No supports.',
        links: [{ url: 'https://example.com/a', note: 'vendor' }]
      })
    )
    const dir = join(ws, 'cable-clip')
    expect([...readFileSync(join(dir, 'reference', 'Data_Sheet.pdf'))]).toEqual([...PDF])
    const read = readBoardFile(board())
    expect(read?.dropped).toBe(0)
    expect(names(board())).toEqual(['Brief', 'Photos', 'Doodles', 'Sizes', 'Rules', 'Links', 'Bought parts', 'PDFs'])
    const caption = (source: string) => board().cards.find((c) => c.source === source)?.caption
    expect(caption('reference/photo-1.png')).toBe('the desk edge')
    expect(caption('reference/doodle-1.png')).toBe('the shape (drawn over reference/photo-1.png)')
    expect(caption('reference/Data_Sheet.pdf')).toBe('the connector')
    const brief = readFileSync(join(dir, 'brief.md'), 'utf8')
    expect(brief).toContain('- reference/doodle-1.png: the shape (drawn over reference/photo-1.png)\n')
    expect(brief).toContain('- reference/Data_Sheet.pdf: the connector\n')
    // Sizes, rules and links live on the board only.
    for (const absent of ['battery tray', 'No supports', 'example.com']) expect(brief).not.toContain(absent)
  })

  it('is what the first open would make: reconcile of the made folder changes nothing', async () => {
    writeFileSync(join(files, 'desk.png'), PNG)
    await make(request({ photos: [{ path: join(files, 'desk.png'), note: 'n' }], doodles: [{ png: PNG, note: '' }], pdfs: [{ path: pdf('a.pdf'), note: '' }] }))
    const dir = join(ws, 'cable-clip')
    const found = { brief: true, references: listBoardReferences(dir).map((n) => `reference/${n}`), marks: [], scans: [], rounds: [] }
    expect(found.references).toEqual(['reference/photo-1.png', 'reference/doodle-1.png', 'reference/a.pdf'])
    expect(reconcile(board(), found)).toBeNull()
  })

  it('says a doodle whose photo was taken away is drawn over a photo, naming no file', async () => {
    await make(request({ doodles: [{ png: PNG, note: 'the shape', onPhoto: true }, { png: PNG, note: '', onPhoto: true }] }))
    const caption = (source: string) => board().cards.find((c) => c.source === source)?.caption
    expect(caption('reference/doodle-1.png')).toBe('the shape (drawn over a photo)')
    expect(caption('reference/doodle-2.png')).toBe('drawn over a photo')
    expect(readFileSync(join(ws, 'cable-clip', 'brief.md'), 'utf8')).toContain('- reference/doodle-1.png: the shape (drawn over a photo)\n')
  })

  it('names a doodle drawn over a photo by the photo as it is copied, with its own ending', async () => {
    writeFileSync(join(files, 'a.PNG'), PNG)
    writeFileSync(join(files, 'b.jpeg'), JPG)
    await make(request({ photos: [{ path: join(files, 'a.PNG'), note: '' }, { path: join(files, 'b.jpeg'), note: '' }], doodles: [{ png: PNG, note: '', over: 1 }] }))
    expect(readFileSync(join(ws, 'cable-clip', 'brief.md'), 'utf8')).toContain('- reference/doodle-1.png: drawn over reference/photo-2.jpeg\n')
  })

  describe('is refused, and nothing is made, for', () => {
    // Refused before the hidden folder is made: no hook of the work in it is reached.
    const refused = async (req: CreateRequest, why?: RegExp) => {
      const reached: string[] = []
      const error = await make(req, [], { afterTemp: () => void reached.push('temp'), beforeBoard: () => void reached.push('board'), beforeRename: () => void reached.push('rename') }).then(
        () => null,
        (e: Error) => e
      )
      expect(error).not.toBeNull()
      if (why) expect(error?.message).toMatch(why)
      expect(reached).toEqual([])
      expect(readdirSync(ws)).toEqual(['lid'])
    }

    it('a PDF that is a link, a folder or not there', async () => {
      const real = pdf('real.pdf')
      symlinkSync(real, join(files, 'link.pdf'))
      mkdirSync(join(files, 'dir.pdf'))
      for (const path of [join(files, 'link.pdf'), join(files, 'dir.pdf'), join(files, 'missing.pdf'), 'relative.pdf', join(files, 'x.txt')]) {
        await refused(request({ pdfs: [{ path: real, note: '' }, { path, note: '' }] }))
      }
    })

    it('a PDF over 25 MB, and one that does not start %PDF-', async () => {
      const big = pdf('big.pdf')
      truncateSync(big, 25 * 1024 * 1024 + 1)
      await refused(request({ pdfs: [{ path: big, note: '' }] }), /25 MB/)
      await refused(request({ pdfs: [{ path: pdf('fake.pdf', 'PK\x03\x04 not a pdf'), note: '' }] }), /PDF/)
      const ok = pdf('ok.pdf')
      truncateSync(ok, 25 * 1024 * 1024)
      expect(await make(request({ pdfs: [{ path: ok, note: '' }] }))).toEqual({ objectId: 'cable-clip' })
    })

    it('a 7th PDF, and the same PDF twice', async () => {
      await refused(request({ pdfs: Array.from({ length: 7 }, (_, i) => ({ path: pdf(`${i}.pdf`), note: '' })) }), /At most 6 PDFs/)
      const one = pdf('one.pdf')
      await refused(request({ pdfs: [{ path: one, note: '' }, { path: one, note: '' }] }), /twice/)
    })

    it('a link that is not http or https, has a space or a control character, or is too long, and a 21st link', async () => {
      for (const url of ['javascript:alert(1)', 'file:///etc/passwd', 'ftp://x.org/a', 'example.com', 'https://', 'https://a b.com', 'https://a.com/\n', 'https://a.com/\u0007', `https://a.com/${'x'.repeat(2000)}`, 'HTTP:/x']) {
        await refused(request({ links: [{ url, note: '' }] }))
      }
      await refused(request({ links: [{ url: 'https://a.com', note: 'x'.repeat(301) }] }), /300/)
      await refused(request({ links: Array.from({ length: 21 }, (_, i) => ({ url: `https://a.com/${i}`, note: '' })) }), /At most 20 links/)
      const fine = [{ url: 'HTTPS://Example.com/a?b=1', note: 'x'.repeat(300) }, { url: `https://a.com/${'x'.repeat(1985)}`, note: '' }]
      expect(await make(request({ links: fine }))).toEqual({ objectId: 'cable-clip' })
      expect(board().cards.filter((c) => c.kind === 'text').map((c) => c.text?.split('\n')[0])).toEqual([fine[0].url, fine[1].url])
    })

    it('a 41st size, a size that is not whole, and rules of 4001 characters', async () => {
      await refused(request({ sizes: Array.from({ length: 41 }, (_, i) => size(`s${i}`)) }), /At most 40 sizes/)
      await refused(request({ sizes: [{ ...size('x'), value: '' }] }))
      await refused(request({ sizes: [{ ...size('x'), source: 'from Claude' }] }))
      await refused(request({ sizes: [{ ...size('x'), what: 'x'.repeat(201) }] }))
      await refused(request({ sizes: [{ ...size('x'), value: 'v'.repeat(61) }] }))
      await refused(request({ rules: 'r'.repeat(4001) }), /4000/)
      await refused(request({ rules: 7 as unknown as string }))
      const fine = await make(request({ sizes: Array.from({ length: 40 }, (_, i) => size(`s${i}`)), rules: 'r'.repeat(4000) }))
      expect(fine).toEqual({ objectId: 'cable-clip' })
      expect(board().cards.filter((c) => c.kind === 'size')).toHaveLength(40)
    })

    it('a doodle drawn over a photo that is not there', async () => {
      writeFileSync(join(files, 'a.png'), PNG)
      const photos = [{ path: join(files, 'a.png'), note: '' }]
      for (const over of [1, -1, 0.5, Number.NaN, '0' as unknown as number]) await refused(request({ photos, doodles: [{ png: PNG, note: '', over }] }))
      await refused(request({ doodles: [{ png: PNG, note: '', over: 0 }] }))
    })

    it('lists that are not lists', async () => {
      for (const key of ['sizes', 'links', 'pdfs'] as const) await refused({ ...request(), [key]: undefined } as unknown as CreateRequest, /not a list/)
    })
  })

  it('removes the temp folder when the board cannot be written', async () => {
    await expect(make(request(), [], { beforeBoard: (temp) => writeFileSync(join(temp, '.torno'), 'in the way') })).rejects.toThrow()
    expect(readdirSync(ws)).toEqual(['lid'])
  })
})

describe('sweeping what a crash left', () => {
  const stale = '.cable-clip.torno-new-0123456789ab'

  it('removes the hidden folders older than this run, with what is in them, and nothing else', () => {
    mkdirSync(join(ws, stale, 'reference'), { recursive: true })
    mkdirSync(join(ws, '.fresh.torno-new-0123456789ab'))
    mkdirSync(join(ws, '.odd.torno-new-xyz'))
    mkdirSync(join(ws, 'visible.torno-new-0123456789ab'))
    mkdirSync(join(ws, '.hidden'))
    for (const name of ['.odd.torno-new-xyz', 'visible.torno-new-0123456789ab', '.hidden']) utimesSync(join(ws, name), new Date(Date.now() - 3_600_000), new Date(Date.now() - 3_600_000))
    const hourAgo = new Date(Date.now() - 3_600_000)
    utimesSync(join(ws, stale), hourAgo, hourAgo)
    sweepStaleNew(ws, Date.now())
    expect(readdirSync(ws).sort()).toEqual(['.fresh.torno-new-0123456789ab', '.hidden', '.odd.torno-new-xyz', 'lid', 'visible.torno-new-0123456789ab'])
  })

  it('leaves a folder that holds files in reference/ (doodles that exist nowhere else), and removes one with none', () => {
    const kept = '.kept.torno-new-0123456789ab'
    mkdirSync(join(ws, kept, 'reference'), { recursive: true })
    writeFileSync(join(ws, kept, 'reference', 'doodle-1.png'), PNG)
    mkdirSync(join(ws, stale, 'reference'), { recursive: true })
    writeFileSync(join(ws, stale, 'brief.md'), 'x')
    const hourAgo = new Date(Date.now() - 3_600_000)
    for (const name of [kept, stale]) utimesSync(join(ws, name), hourAgo, hourAgo)
    sweepStaleNew(ws, Date.now())
    expect(readdirSync(ws).sort()).toEqual([kept, 'lid'])
    expect(existsSync(join(ws, kept, 'reference', 'doodle-1.png'))).toBe(true)
  })

  it('removes none that is under 10 minutes old, whenever this run began', () => {
    mkdirSync(join(ws, stale))
    const young = new Date(Date.now() - 9 * 60_000)
    utimesSync(join(ws, stale), young, young)
    sweepStaleNew(ws, Date.now())
    expect(readdirSync(ws)).toContain(stale)
    const old = new Date(Date.now() - 11 * 60_000)
    utimesSync(join(ws, stale), old, old)
    sweepStaleNew(ws, Date.now())
    expect(readdirSync(ws)).not.toContain(stale)
  })

  it('never follows a link: one named like a folder of ours is left alone, and so is what it leads to', () => {
    mkdirSync(join(base, 'precious'))
    writeFileSync(join(base, 'precious', 'keep.txt'), 'keep')
    symlinkSync(join(base, 'precious'), join(ws, stale))
    sweepStaleNew(ws, Date.now())
    expect(readFileSync(join(base, 'precious', 'keep.txt'), 'utf8')).toBe('keep')
    expect(readdirSync(ws)).toContain(stale)
  })

  it('does not fail on a workspace that is not there', () => {
    expect(() => sweepStaleNew(join(base, 'nowhere'), Date.now())).not.toThrow()
  })
})
