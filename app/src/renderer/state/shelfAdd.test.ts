import { beforeEach, describe, expect, it, vi } from 'vitest'
import { addRequest, canAsk, idFromName, idProblem, shelfAdd, shelfAddStore, shelfPending, sizeIssue, takeDrop, type AddFile, type AddSize } from './shelfAdd'

const file = (name: string, size = 10) => ({ name, size })
const at = (f: { name: string }): string => `/home/x/${f.name}`
const MB = 1024 * 1024

describe('takeDrop', () => {
  it('takes pictures, PDFs and STEP files by the name they will have, with their kind and path', () => {
    const got = takeDrop([file('drawing.JPG'), file('sheet.pdf'), file('body.stp')], at)
    expect(got.said).toEqual([])
    expect(got.taken.map((t) => [t.name, t.kind, t.path])).toEqual([
      ['drawing.jpg', 'image', '/home/x/drawing.JPG'],
      ['sheet.pdf', 'pdf', '/home/x/sheet.pdf'],
      ['body.stp', 'step', '/home/x/body.stp']
    ])
  })

  it('leaves out, and says, a kind it does not take, a file with no path and one over its cap', () => {
    const got = takeDrop([file('notes.txt'), file('shot.png'), file('big.png', 26 * MB), file('huge.pdf', 26 * MB), file('ok.step', 40 * MB)], (f) => (f.name === 'shot.png' ? '' : at(f)))
    expect(got.taken.map((t) => t.name)).toEqual(['ok.step'])
    expect(got.said).toEqual([
      'notes.txt is not a PDF, a picture (png, jpg, webp) or a STEP file.',
      'shot.png: that file has no place on the disk.',
      'big.png is over 25 MB.',
      'huge.pdf is over 25 MB.'
    ])
  })

  it('takes at most eight files in all, counting those the form has, and says how many were left out', () => {
    const already: AddFile[] = Array.from({ length: 6 }, (_, n) => ({ path: `/h/o${n}.png`, name: `o${n}.png`, kind: 'image' as const, url: null }))
    const got = takeDrop([file('a.png'), file('b.png'), file('c.png'), file('d.png')], at, already)
    expect(got.taken.map((t) => t.name)).toEqual(['a.png', 'b.png'])
    expect(got.said).toEqual(['A part takes at most 8 files: 2 left out.'])
  })

  it('leaves out a file already given, and two that would have one name, in any case', () => {
    const already: AddFile[] = [{ path: '/home/x/a.png', name: 'a.png', kind: 'image', url: null }]
    const got = takeDrop([file('a.png'), file('b.png')], (f) => at(f), already)
    expect(got.taken.map((t) => t.name)).toEqual(['b.png'])
    expect(got.said).toEqual(['a.png is there already.'])
    const twice = takeDrop([file('B.png'), file('b.png')], (f) => `/dir/${f.name}`)
    expect(twice.taken).toHaveLength(1)
    expect(twice.said).toEqual(['Two files are called b.png: only the first is taken.'])
  })
})

describe('idFromName', () => {
  it.each([
    ['drawing.jpg', 'drawing'],
    ['MTS-101 datasheet.pdf', 'mts_101_datasheet'],
    ['/home/x/EC11 (rev 2).step', 'ec11_rev_2'],
    ['101-toggle.png', 'p_101_toggle'],
    ['Café Ø6.png', 'cafe_6'],
    ['class.png', 'class_part'],
    ['---.png', ''],
    ['.png', '']
  ])('%s -> %s', (name, id) => expect(idFromName(name)).toBe(id))
  it('is at most 48 characters, and always a part id or nothing', () => {
    const id = idFromName(`${'long name '.repeat(20)}.png`)
    expect(id.length).toBeLessThanOrEqual(48)
    expect(id).toMatch(/^[a-z_][a-z0-9_]*$/)
  })
})

describe('idProblem', () => {
  it('asks for a name, an identifier and a part that is not on the shelf', () => {
    expect(idProblem('', [])).toMatch(/Give the part a name/)
    expect(idProblem('mts-101', [])).toMatch(/lower-case/)
    expect(idProblem('MTS', [])).toMatch(/lower-case/)
    expect(idProblem('1ab', [])).toMatch(/lower-case/)
    expect(idProblem('class', [])).toMatch(/lower-case/)
    expect(idProblem('ec11', ['ec11'])).toBe('ec11 is already on the shelf.')
    expect(idProblem('mts_101', ['ec11'])).toBeNull()
  })
})

const row = (what: string, value: string, source: AddSize['source'] = 'datasheet'): AddSize => ({ uid: what + value, what, value, source })

describe('sizeIssue', () => {
  it('is nothing for a blank row and a whole one, and holds back a half-filled one', () => {
    expect(sizeIssue(row('', ''))).toBeNull()
    expect(sizeIssue(row('  ', ' '))).toBeNull()
    expect(sizeIssue(row('lever', '10'))).toBeNull()
    expect(sizeIssue(row('lever', ''))).toMatch(/value/)
    expect(sizeIssue(row('', '10'))).toMatch(/what/)
  })
  it('takes a value as typed: a number, a × b, Ø n, or words', () => {
    for (const v of ['6', '13 × 8', '13x8', 'Ø 6.2', 'about 6']) expect(sizeIssue(row('a', v))).toBeNull()
  })
})

describe('canAsk', () => {
  const base = { id: 'mts_101', files: [{ name: 'a.png' }] as AddFile[], sizes: [row('lever', '10')] }
  it('needs a file, a new part\'s name and no half-filled row', () => {
    expect(canAsk(base, [])).toBe(true)
    expect(canAsk({ ...base, files: [] }, [])).toBe(false)
    expect(canAsk({ ...base, id: 'ec11' }, ['ec11'])).toBe(false)
    expect(canAsk({ ...base, id: 'no-no' }, [])).toBe(false)
    expect(canAsk({ ...base, sizes: [row('lever', ''), row('a', '1')] }, [])).toBe(false)
    expect(canAsk({ ...base, sizes: [row('', '')] }, [])).toBe(true)
  })
})

describe('addRequest', () => {
  const files = [{ name: 'drawing.jpg' }, { name: 'sizes.jpg' }]
  it('tells what, the id, each size as the skill\'s line, a guess as assumed, and where the files will be', () => {
    const text = addRequest({
      id: 'mts_101',
      what: 'MTS-101 mini toggle, SPST, two pins',
      sizes: [row('panel hole', 'Ø 6.2'), row('bushing', '6'), row('body', '13 × 8', 'measured'), row('lever', '10', 'guess'), row('pin pitch', '2.5', 'listing'), row('', '')],
      files
    })
    expect(text).toBe(
      'Put the MTS-101 mini toggle, SPST, two pins on the shelf as mts_101: Ø 6.2 panel hole (datasheet), 6 bushing (datasheet), 13 × 8 body (measured), 10 lever (assumed), 2.5 pin pitch (listing). Its files are in common/parts/mts_101/: drawing.jpg, sizes.jpg. Model it as the torno-model skill says.'
    )
  })
  it('has no colon of sizes when there are none, and says "part" when nothing was said of what it is', () => {
    expect(addRequest({ id: 'x1', what: '  ', sizes: [row('', '')], files: [{ name: 'a.pdf' }] })).toBe('Put the part on the shelf as x1. Its files are in common/parts/x1/: a.pdf. Model it as the torno-model skill says.')
  })
  it('folds a line break or spaces in what and the sizes to one space', () => {
    const text = addRequest({ id: 'x1', what: 'a   b\nc', sizes: [row('lever\n arm', ' 10  ')], files: [{ name: 'a.pdf' }] })
    expect(text).toContain('Put the a b c on the shelf')
    expect(text).toContain(': 10 lever arm (datasheet).')
  })
})

describe('the form', () => {
  beforeEach(() => shelfAdd.clear())
  const dropped = (...names: string[]): AddFile[] => names.map((name) => ({ path: `/h/${name}`, name, kind: 'image' as const, url: null }))

  it('opens with the files, the name made from the first, one empty size row', () => {
    shelfAdd.drop(dropped('MTS-101.png', 'b.png'), [])
    const form = shelfAddStore.getState().form!
    expect(form.id).toBe('mts_101')
    expect(form.files.map((f) => f.name)).toEqual(['MTS-101.png', 'b.png'])
    expect(form.sizes).toHaveLength(1)
  })

  it('takes more files from a second drop, and follows the first file unless the person typed a name', () => {
    shelfAdd.drop(dropped('a.png'), [])
    shelfAdd.drop(dropped('b.png'), ['x'])
    expect(shelfAddStore.getState().form!.files).toHaveLength(2)
    expect(shelfAddStore.getState().form!.said).toEqual(['x'])
    shelfAdd.setId('toggle')
    shelfAdd.removeFile('/h/a.png')
    expect(shelfAddStore.getState().form!.id).toBe('toggle')
    expect(shelfAddStore.getState().form!.files.map((f) => f.name)).toEqual(['b.png'])
  })

  it('closes when its last file is taken off, and on close', () => {
    shelfAdd.drop(dropped('a.png'), [])
    shelfAdd.removeFile('/h/a.png')
    expect(shelfAddStore.getState().form).toBeNull()
    shelfAdd.drop(dropped('a.png'), [])
    shelfAdd.close()
    expect(shelfAddStore.getState().form).toBeNull()
  })

  it('adds up to 20 size rows, and takes one off (the last one is emptied, not removed)', () => {
    shelfAdd.drop(dropped('a.png'), [])
    for (let n = 0; n < 30; n++) shelfAdd.addSize()
    expect(shelfAddStore.getState().form!.sizes).toHaveLength(20)
    const sizes = () => shelfAddStore.getState().form!.sizes
    shelfAdd.removeSize(sizes()[3].uid)
    expect(sizes()).toHaveLength(19)
    for (const s of [...sizes()]) shelfAdd.removeSize(s.uid)
    expect(sizes()).toHaveLength(1)
    shelfAdd.setSize(sizes()[0].uid, { what: 'lever', value: '10' })
    shelfAdd.removeSize(sizes()[0].uid)
    expect(sizes()[0]).toMatchObject({ what: '', value: '' })
  })
})

describe('shelfPending', () => {
  beforeEach(() => shelfPending.clear())
  const text = 'Put the toggle on the shelf as mts_101. Its files are in common/parts/mts_101/: a.png. Model it as the torno-model skill says.'
  const wait = (paths = ['/h/a.png', '/h/b.png']) => shelfPending.set({ id: 'mts_101', paths, text })

  it('lets a message with nothing waiting go, and copies nothing', async () => {
    const ask = vi.fn()
    expect(await shelfPending.beforeSend('hello', ask)).toBeNull()
    expect(ask).not.toHaveBeenCalled()
  })

  it('copies the files first when the message still names the folder, then lets it go and forgets', async () => {
    wait()
    const ask = vi.fn(async () => ({ copied: ['a.png', 'b.png'], refused: [] }))
    expect(await shelfPending.beforeSend(`${text} Thanks`, ask)).toBeNull()
    expect(ask).toHaveBeenCalledWith('mts_101', ['/h/a.png', '/h/b.png'])
    expect(shelfPending.get()).toBeNull()
    expect(await shelfPending.beforeSend(text, ask)).toBeNull()
    expect(ask).toHaveBeenCalledTimes(1)
  })

  it('drops the request when the message no longer names the folder: the person changed their mind', async () => {
    wait()
    const ask = vi.fn()
    expect(await shelfPending.beforeSend('Never mind, do it later', ask)).toBeNull()
    expect(ask).not.toHaveBeenCalled()
    expect(shelfPending.get()).toBeNull()
  })

  it('holds the message back on a refusal and keeps only the files left for a second send', async () => {
    wait()
    const ask = vi.fn(async () => ({ copied: ['a.png'], refused: [{ name: 'b.png', why: 'b.png is already there: torno never copies over a file.' }] }))
    const problem = await shelfPending.beforeSend(text, ask)
    expect(problem).toContain('b.png is already there')
    expect(problem).toContain('Nothing was sent')
    expect(shelfPending.get()?.paths).toEqual(['/h/b.png'])
    const again = vi.fn(async () => ({ copied: ['b.png'], refused: [] }))
    expect(await shelfPending.beforeSend(text, again)).toBeNull()
    expect(again).toHaveBeenCalledWith('mts_101', ['/h/b.png'])
  })

  it('holds the message back when main refuses the whole request, with its reason', async () => {
    wait()
    const ask = vi.fn(async () => {
      throw new Error("Error invoking remote method 'shelf:addFiles': Error: /w/common is a link, not a folder of the shelf.")
    })
    const problem = await shelfPending.beforeSend(text, ask)
    expect(problem).toBe('/w/common is a link, not a folder of the shelf. Nothing was sent.')
    expect(shelfPending.get()).not.toBeNull()
  })

  it('copies once for two sends at once', async () => {
    wait()
    const ask = vi.fn(async () => ({ copied: ['a.png', 'b.png'], refused: [] }))
    const [a, b] = await Promise.all([shelfPending.beforeSend(text, ask), shelfPending.beforeSend(text, ask)])
    expect([a, b]).toEqual([null, null])
    expect(ask).toHaveBeenCalledTimes(1)
  })

  it('holds says whether a message is the one that waits', () => {
    expect(shelfPending.holds(text)).toBe(false)
    wait()
    expect(shelfPending.holds(text)).toBe(true)
    expect(shelfPending.holds('hello')).toBe(false)
    expect(shelfPending.holds('see common/parts/other/')).toBe(false)
  })

  it('is gone when a workspace is left', () => {
    wait()
    shelfAdd.clear()
    expect(shelfPending.get()).toBeNull()
  })

  it('now copies at once, for a terminal, and says why it did not', async () => {
    const ok = vi.fn(async () => ({ copied: ['a.png'], refused: [] }))
    expect(await shelfPending.now('mts_101', ['/h/a.png'], ok)).toBeNull()
    const no = vi.fn(async () => ({ copied: [], refused: [{ name: 'a.png', why: 'a.png is a link: torno copies only plain files.' }] }))
    const said = await shelfPending.now('mts_101', ['/h/a.png'], no)
    expect(said).toContain('a.png is a link')
    expect(said).toContain('Nothing was put at the prompt')
  })
})
