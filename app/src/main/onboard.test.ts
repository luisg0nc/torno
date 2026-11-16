import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { OnboardDraft } from '../shared/bridge'
import type { Scene } from '../shared/scene'
import type { ObjectInfo } from '../shared/workspace'
import { TOOLS } from './mcp/schemas'
import { type ImageBytes, MOST_IMAGES, checkedImage, objectSummary, onboardObject, onboardPrompt, previewPrompt, readThumb, sessionRunning } from './onboard'

/** A PNG with the header of a picture w x h (and not a picture after it). */
function png(w: number, h: number): Uint8Array {
  const b = new Uint8Array(33)
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52])
  new DataView(b.buffer).setUint32(16, w)
  new DataView(b.buffer).setUint32(20, h)
  return b
}
/** A JPEG with a comment segment, then a start of frame of w x h. */
function jpeg(w: number, h: number): Uint8Array {
  const b = new Uint8Array(32)
  b.set([0xff, 0xd8, 0xff, 0xfe, 0, 6, 1, 2, 3, 4, 0xff, 0xc0, 0, 8, 8])
  const v = new DataView(b.buffer)
  v.setUint16(15, h)
  v.setUint16(17, w)
  return b
}
const image = (bytes: Uint8Array): ImageBytes => checkedImage(bytes)!

/** What the first prompt asks of the agent after the placeholder's line (#111), for a module named `m`. */
const ASK_FIRST = (m: string): string =>
  [
    `${m}.py is torno's placeholder (a 20 mm cube). Read brief.md and look at what was given. Then:`,
    '',
    "1. List the sizes that decide fit or function (overall size, wall, the sizes of the parts it mates with, hole and fastener sizes, clearances), and say where each comes from: the sizes the person gave (above, or size cards of the board), brief.md, a reference picture's note, a PDF, a scan (≈, to a few mm), another project, or nowhere.",
    '2. Ask only for sizes with no source, those from nowhere: a size the person gave is not asked again. For those, ask in one round, before you build, with AskUserQuestion: at most 4 questions, each with 2 to 4 options, one of them a typical value labelled as typical ("0.2 mm per side, usual for PLA at a 0.4 mm nozzle"); the person may answer "build with assumptions". Do not ask about what you can choose freely (a fillet radius, a chamfer). If every size has a source, ask nothing.',
    '3. Replace the placeholder with the real model, built with the answers. A size still unknown is built as assumed (a field of Params commented "assumed"), and your reply lists the assumptions.'
  ].join('\n')

describe('checkedImage', () => {
  it('takes a PNG or a JPEG whose long edge is at most 2000, and says which', () => {
    expect(checkedImage(png(1280, 720))).toMatchObject({ mediaType: 'image/png', width: 1280, height: 720 })
    expect(checkedImage(jpeg(2000, 1500))).toMatchObject({ mediaType: 'image/jpeg', width: 2000, height: 1500 })
  })

  it('refuses a longer edge, a WebP, a PDF, too few bytes, a size of 0 and a JPEG with no frame header', () => {
    expect(checkedImage(png(2001, 10))).toBeNull()
    expect(checkedImage(jpeg(10, 2001))).toBeNull()
    expect(checkedImage(png(0, 10))).toBeNull()
    expect(checkedImage(Uint8Array.from([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]))).toBeNull()
    expect(checkedImage(Uint8Array.from([0x25, 0x50, 0x44, 0x46, 0x2d]))).toBeNull()
    expect(checkedImage(new Uint8Array(0))).toBeNull()
    expect(checkedImage(Uint8Array.from([0xff, 0xd8, 0xff, 0xda, 0, 2]))).toBeNull()
    expect(checkedImage('nope' as unknown as Uint8Array)).toBeNull()
  })

  it('refuses a picture of more than 3.75 MB (its base64 would be over 5 MB)', () => {
    const ok = new Uint8Array(3_750_000)
    ok.set(png(10, 10))
    expect(checkedImage(ok)).not.toBeNull()
    const big = new Uint8Array(3_750_001)
    big.set(png(10, 10))
    expect(checkedImage(big)).toBeNull()
  })
})

describe('objectSummary', () => {
  const part = (name: string, min: number[], max: number[], exact?: boolean) => ({ name, layout: 'assembly', bbox: { min, max }, ...(exact === undefined ? {} : { bboxExact: exact }) })
  const scene = (parts: unknown[], layouts = ['assembly']) => ({ model: 'x', layouts, parts }) as unknown as Scene

  it('says "not built in this run" with no build', () => {
    expect(objectSummary(undefined)).toBe('not built in this run')
  })

  it('names the parts and gives the box of the first layout, and whether the kernel says it is exact', () => {
    expect(objectSummary(scene([part('base', [0, 0, 0], [40, 20, 5], true), part('lid', [0, 0, 5], [40, 20, 10], true)]))).toBe('2 parts: base, lid; box 40 x 20 x 10 mm, exact')
    expect(objectSummary(scene([part('base', [0, 0, 0], [40, 20, 5], true), part('lid', [0, 0, 5], [40, 20, 10], false)]))).toContain('mm, approximate')
    expect(objectSummary(scene([part('base', [0, 0, 0], [40.123456, 20, 5])]))).toContain('box 40.12 x 20 x 5 mm, approximate')
  })

  it('shortens a long list of parts, and says when there are none', () => {
    const many = Array.from({ length: 12 }, (_, i) => part(`p${i}`, [0, 0, 0], [1, 1, 1], true))
    expect(objectSummary(scene(many))).toContain('12 parts: p0, p1, p2, p3, p4, p5, p6, p7 and 4 more;')
    expect(objectSummary(scene([]))).toBe('built, with no parts')
    expect(objectSummary(scene([part('only', [0, 0, 0], [1, 2, 3], true)]))).toMatch(/^1 part: only;/)
  })
})

const full = () => ({
  name: 'cable-clip',
  description: 'A clip that holds a 6 mm cable\nto the edge of a desk.',
  items: [
    { file: 'reference/photo-1.jpg', note: 'the desk edge', image: image(jpeg(1280, 960)) },
    { file: 'reference/doodle-1.png', note: 'the shape I want', image: image(png(1200, 800)) }
  ],
  scans: [
    { id: 'S1', file: 'desk.stl', note: 'the edge, scanned' },
    { id: null, file: 'bad.stl', note: 'another try', problem: 'the file has no triangles' }
  ],
  objects: [
    { name: 'lid', summary: '1 part: lid; box 40 x 20 x 5 mm, exact', note: 'mounts on this', thumb: image(png(480, 360)) },
    { name: 'base', summary: 'not built in this run', note: '' }
  ]
})

describe('onboardPrompt', () => {
  it('says a doodle drawn over a photo is the person\'s ink over that photo, not a drawing on a grid', () => {
    const over = { ...full(), items: [{ file: 'reference/doodle-1.png', note: 'the shape (drawn over reference/photo-1.jpg)', image: image(png(1200, 800)) }] }
    const { text } = onboardPrompt(over)
    expect(text).not.toContain('light grid')
    expect(text).toContain("A doodle drawn over a photo is the person's ink over that photo")
    // One of each says both.
    const both = { ...full(), items: [...over.items, { file: 'reference/doodle-2.png', note: 'a plain one', image: image(png(1200, 800)) }] }
    expect(onboardPrompt(both).text).toContain('light grid')
    expect(onboardPrompt(both).text).toContain("the person's ink over that photo")
  })

  it('names only tools torno has (TOOLS), so a tool that does not exist is caught here (#119)', () => {
    const { text } = onboardPrompt(full())
    const named = [...text.matchAll(/mcp__torno__([A-Za-z_]+)/g)].map((m) => m[1])
    expect(named.filter((name) => !(name in TOOLS))).toEqual([])
  })

  it('writes the text of the plan, with every kind of item', () => {
    const { text, blocks } = onboardPrompt(full())
    expect(text).toBe(
      [
        'This is a new project, cable-clip, made in torno just now. What it is, in the person\'s words:',
        '',
        'A clip that holds a 6 mm cable\nto the edge of a desk.',
        '',
        'What they gave (all of it is also in brief.md; files are in reference/):',
        '- reference/photo-1.jpg: the desk edge (attached: picture 1)',
        '- reference/doodle-1.png: the shape I want (attached: picture 2)',
        '- Scan S1 "desk.stl": the edge, scanned. It is imported into this project and is not aligned yet: the person aligns it in torno. mcp__torno__scans says how it stands; once it is aligned, mcp__torno__section with "scan" cuts it, and mcp__torno__scan_clash and mcp__torno__scan_deviation measure against it.',
        '- Scan "bad.stl": another try. It could not be imported (the file has no triangles); the file is the person\'s to give again.',
        '- ../lid/ (another project of this workspace: 1 part: lid; box 40 x 20 x 5 mm, exact; its picture is attached: picture 3): mounts on this',
        '- ../base/ (another project of this workspace: not built in this run)',
        '',
        'A doodle is drawn over a light grid: 1 square = 40 px of the board, with no scale. Read proportions from it, not sizes.',
        '',
        ASK_FIRST('cable_clip')
      ].join('\n')
    )
    expect(blocks).toHaveLength(7)
    expect(blocks[0]).toEqual({ type: 'text', text })
    expect(blocks.map((b) => b.type)).toEqual(['text', 'text', 'image', 'text', 'image', 'text', 'image'])
    expect(blocks.filter((b) => b.type === 'text').slice(1)).toEqual([
      { type: 'text', text: 'Picture 1: reference/photo-1.jpg (the person\'s photo): the desk edge' },
      { type: 'text', text: 'Picture 2: reference/doodle-1.png (the person\'s doodle): the shape I want' },
      { type: 'text', text: 'Picture 3: ../lid/ as torno last drew it (its thumbnail): mounts on this' }
    ])
    expect(blocks.filter((b) => b.type === 'image').map((b) => (b as { source: { media_type: string } }).source.media_type)).toEqual(['image/jpeg', 'image/png', 'image/png'])
  })

  it('captions only the pictures that are attached, numbered in order, and folds a note to one line', () => {
    const { blocks } = onboardPrompt({
      name: 'x',
      description: 'd',
      items: [{ file: 'reference/photo-1.jpg', note: 'no picture' }, { file: 'reference/doodle-1.png', note: 'a\nb', image: image(png(100, 100)) }, { file: 'reference/doodle-2.png', note: '', image: image(png(100, 100)) }],
      scans: [],
      objects: []
    })
    expect(blocks.map((b) => b.type)).toEqual(['text', 'text', 'image', 'text', 'image'])
    expect((blocks[1] as { text: string }).text).toBe("Picture 1: reference/doodle-1.png (the person's doodle): a b")
    expect((blocks[3] as { text: string }).text).toBe("Picture 2: reference/doodle-2.png (the person's doodle)")
  })

  it('writes a text to hold that says no picture is attached and names the files of the pictures', () => {
    const { text, held } = onboardPrompt(full())
    expect(text).toContain('(attached: picture 1)')
    expect(held).not.toContain('attached: picture')
    expect(held).not.toContain('Picture 1')
    expect(held).toContain('- reference/photo-1.jpg: the desk edge (not attached: read reference/photo-1.jpg)')
    expect(held).toContain('- reference/doodle-1.png: the shape I want (not attached: read reference/doodle-1.png)')
    expect(held).toContain('; its picture: ../lid/.torno/thumb.png): mounts on this')
    expect(held).toContain('- ../base/ (another project of this workspace: not built in this run)')
  })

  it('attaches the pictures in order: photos and doodles, then the pictures of the objects, and no more than 6', () => {
    const input = full()
    input.items = Array.from({ length: 5 }, (_, i) => ({ file: `reference/photo-${i + 1}.png`, note: `n${i + 1}`, image: image(png(10 + i, 10)) }))
    input.items.push({ file: 'reference/doodle-1.png', note: 'last', image: image(png(99, 10)) })
    input.items.push({ file: 'reference/doodle-2.png', note: 'beyond', image: image(png(98, 10)) })
    const { text, blocks } = onboardPrompt(input)
    expect(MOST_IMAGES).toBe(6)
    const images = blocks.filter((b) => b.type === 'image')
    expect(images).toHaveLength(6)
    const widths = images.map((b) => new DataView(new Uint8Array(Buffer.from((b as { source: { data: string } }).source.data, 'base64')).buffer).getUint32(16))
    expect(widths).toEqual([10, 11, 12, 13, 14, 99])
    expect(text).toContain('- reference/doodle-2.png: beyond (not attached: read reference/doodle-2.png)')
    expect(text).toContain('- ../lid/ (another project of this workspace: 1 part: lid; box 40 x 20 x 5 mm, exact; its picture is not attached): mounts on this')
  })

  it('names an item with no usable picture as not attached, and takes every note as one line', () => {
    const input = full()
    input.items = [{ file: 'reference/photo-1.webp', note: 'line one\n\n- injected: yes\t  end', image: undefined as unknown as ImageBytes }]
    input.scans = []
    input.objects = []
    const { text, blocks } = onboardPrompt(input)
    expect(text).toContain('- reference/photo-1.webp: line one - injected: yes end (not attached: read reference/photo-1.webp)')
    expect(blocks).toHaveLength(1)
  })

  it('folds the name of a scan file and of an object to one line', () => {
    const { text } = onboardPrompt({ name: 'x', description: 'd', items: [], scans: [{ id: 'S1', file: 'a\n- injected.stl', note: '' }], objects: [{ name: 'o\n- injected', summary: 's', note: '' }] })
    expect(text).not.toMatch(/^- injected/m)
  })

  it('leaves out the list of what they gave when they gave nothing', () => {
    const { text } = onboardPrompt({ name: 'x', description: 'A thing.', items: [], scans: [], objects: [] })
    expect(text).toBe(
      'This is a new project, x, made in torno just now. What it is, in the person\'s words:\n\nA thing.\n\n' + ASK_FIRST('x')
    )
  })

  it('says the sizes, rules, links and PDFs the person gave, after what they gave, and asks only for sizes with no source', () => {
    const given = {
      name: 'x',
      description: 'A tray.',
      items: [{ file: 'reference/photo-1.jpg', note: 'the desk' }],
      scans: [],
      objects: [],
      sizes: [
        { what: 'battery tray', value: '186 x 128', unit: 'mm' as const, source: 'measured' as const },
        { what: 'screw', value: '4', unit: 'mm' as const, source: 'from a manual or datasheet' as const, note: 'M4' }
      ],
      rules: 'Print without supports.\nWalls at least 2 mm.',
      links: [{ url: 'https://example.com/tray', note: 'the vendor page' }, { url: 'https://example.com/b', note: '' }],
      pdfs: [{ file: 'reference/datasheet.pdf', note: 'the cell' }, { file: 'reference/other.pdf', note: '' }]
    }
    const { text, held } = onboardPrompt(given)
    for (const out of [text, held]) {
      expect(out).toBe(
        [
          "This is a new project, x, made in torno just now. What it is, in the person's words:",
          '',
          'A tray.',
          '',
          'What they gave (all of it is also in brief.md; files are in reference/):',
          '- reference/photo-1.jpg: the desk (not attached: read reference/photo-1.jpg)',
          '- reference/datasheet.pdf: the cell. A PDF; read it with your own tools if it helps.',
          '- reference/other.pdf. A PDF; read it with your own tools if it helps.',
          '',
          'Sizes the person gave:',
          '- battery tray 186 × 128 mm (measured)',
          '- screw 4 mm (from a manual or datasheet: M4)',
          '',
          'Rules:',
          'Print without supports.\nWalls at least 2 mm.',
          '',
          'Links (torno does not open links; read one only if it helps):',
          '- https://example.com/tray: the vendor page',
          '- https://example.com/b',
          '',
          ASK_FIRST('x')
        ].join('\n')
      )
    }
    expect(text).toContain('Ask only for sizes with no source')
    const named = [...text.matchAll(/mcp__torno__([A-Za-z_]+)/g)].map((m) => m[1])
    expect(named.filter((name) => !(name in TOOLS))).toEqual([])
  })

  it('says nothing of sizes, rules, links and PDFs that were not given', () => {
    const { text } = onboardPrompt({ name: 'x', description: 'A thing.', items: [], scans: [], objects: [], sizes: [], rules: '  \n', links: [], pdfs: [] })
    expect(text).not.toMatch(/Sizes the person gave:|Rules:|Links \(|A PDF;/)
  })

  it('folds a size, a link and a PDF to one line each', () => {
    const { text } = onboardPrompt({ name: 'x', description: 'd', items: [], scans: [], objects: [], links: [{ url: 'https://a.example/x', note: 'a\n- injected' }], pdfs: [{ file: 'reference/a.pdf', note: 'a\n- injected' }] })
    expect(text).not.toMatch(/^- injected/m)
  })

  it('asks for the missing sizes in one round before the first build', () => {
    const { text, held } = onboardPrompt({ name: 'x', description: 'A thing.', items: [], scans: [], objects: [] })
    for (const said of ['List the sizes that decide fit or function', 'or nowhere.', 'ask in one round, before you build, with AskUserQuestion', 'at most 4 questions, each with 2 to 4 options', 'labelled as typical', '"build with assumptions"', 'Do not ask about what you can choose freely', 'built as assumed']) {
      expect(text).toContain(said)
      expect(held).toContain(said)
    }
    expect(text).not.toContain('ask what you need to know')
  })
})

describe('readThumb', () => {
  let base: string
  beforeEach(() => void (base = mkdtempSync(join(realpathSync(tmpdir()), 'torno-thumb-'))))
  afterEach(() => rmSync(base, { recursive: true, force: true }))

  it('reads the picture on file, and nothing that is no picture, a link or too big', async () => {
    const dir = join(base, 'o')
    mkdirSync(join(dir, '.torno'), { recursive: true })
    expect(await readThumb(dir)).toBeUndefined()
    writeFileSync(join(dir, '.torno', 'thumb.png'), png(480, 360))
    expect(await readThumb(dir)).toMatchObject({ mediaType: 'image/png', width: 480 })
    writeFileSync(join(dir, '.torno', 'thumb.png'), 'not a picture')
    expect(await readThumb(dir)).toBeUndefined()
    rmSync(join(dir, '.torno', 'thumb.png'))
    writeFileSync(join(base, 'elsewhere.png'), png(480, 360))
    symlinkSync(join(base, 'elsewhere.png'), join(dir, '.torno', 'thumb.png'))
    expect(await readThumb(dir)).toBeUndefined()
  })
})

describe('sessionRunning', () => {
  it('is true for a session that runs and for one that is starting, false otherwise', () => {
    const sessions = (running: boolean, starting: boolean) => ({ current: () => (running ? ({} as never) : null), isStarting: () => starting })
    expect(sessionRunning(sessions(true, false), 'x')).toBe(true)
    expect(sessionRunning(sessions(false, true), 'x')).toBe(true)
    expect(sessionRunning(sessions(false, false), 'x')).toBe(false)
    expect(sessionRunning(null, 'x')).toBe(false)
  })
})

describe('onboardObject', () => {
  let base: string
  const calls: string[] = []
  let sent: Array<{ sessionId: string; blocks: Array<{ type: string; text?: string }> }>
  const obj = (id: string): ObjectInfo => ({ id, name: id, dir: join(base, id), model: null })

  function deps(over: Partial<Parameters<typeof onboardObject>[0]> = {}): Parameters<typeof onboardObject>[0] {
    return {
      object: (id) => (['cable-clip', 'lid', 'base'].includes(id) ? obj(id) : undefined),
      running: () => false,
      importScan: async (_id, path) => {
        calls.push(`import ${path}`)
        return { id: 'S1', name: 'desk' }
      },
      start: async (o) => {
        calls.push(`start ${o.id}`)
        return { sessionId: 'sess', view: 'chat' }
      },
      prompt: (sessionId, blocks) => {
        calls.push('prompt')
        sent.push({ sessionId, blocks })
      },
      boardTold: async (id) => void calls.push(`told ${id}`),
      scene: () => undefined,
      ...over
    }
  }
  const draft = (over: Partial<OnboardDraft> = {}): OnboardDraft => ({ description: 'A clip.', items: [], steps: [], scans: [], objects: [], sizes: [], rules: '', links: [], pdfs: [], ...over })

  beforeEach(() => {
    base = mkdtempSync(join(realpathSync(tmpdir()), 'torno-onboard-'))
    for (const id of ['cable-clip', 'lid', 'base']) mkdirSync(join(base, id, 'reference'), { recursive: true })
    writeFileSync(join(base, 'cable-clip', 'reference', 'photo-1.jpg'), 'x')
    writeFileSync(join(base, 'cable-clip', 'reference', 'doodle-1.png'), 'x')
    calls.length = 0
    sent = []
  })
  afterEach(() => rmSync(base, { recursive: true, force: true }))

  it('names a vendor STEP file in the prompt, as a reference body to place with import_step, and previews the same (#57)', async () => {
    writeFileSync(join(base, 'cable-clip', 'reference', '608zz.step'), 'x')
    const steps = [{ file: 'reference/608zz.step', note: 'the bearing' }]
    const shown = await previewPrompt(deps(), 'cable-clip', { description: 'A clip.', items: [], steps, scans: [], objects: [], sizes: [], rules: '', links: [], pdfs: [] })
    expect(shown.text).toContain('- reference/608zz.step: the bearing. A vendor\'s STEP file of a bought part')
    expect(shown.text).toContain('import_step(Path(__file__).parent / "reference" / "608zz.step")')
    expect(shown.text).toContain('references(p)')
    await onboardObject(deps(), 'cable-clip', draft({ steps }))
    expect(shown.text).toBe(sent[0].blocks[0].text)
    await expect(onboardObject(deps(), 'cable-clip', draft({ steps: [{ file: '../../etc/x.step', note: '' }] }))).rejects.toThrow(/STEP file of reference/)
  })

  it('previews the very text it sends, writing and starting nothing (#84)', async () => {
    mkdirSync(join(base, 'lid', '.torno'))
    writeFileSync(join(base, 'lid', '.torno', 'thumb.png'), png(480, 360))
    const d = draft({
      items: [{ file: 'reference/photo-1.jpg', note: 'desk', image: jpeg(1280, 960) }, { file: 'reference/doodle-1.png', note: 'shape', image: png(1200, 800) }],
      scans: [{ path: '/s/desk.stl', note: 'the edge' }],
      objects: [{ id: 'lid', note: 'mounts on this' }, { id: 'nope', note: '' }]
    })
    const shown = await previewPrompt(deps(), 'cable-clip', {
      description: d.description,
      items: d.items.map((i) => ({ file: i.file, note: i.note, picture: true })),
      steps: d.steps,
      scans: d.scans,
      objects: d.objects,
      sizes: [],
      rules: '',
      links: [],
      pdfs: []
    })
    expect(calls).toEqual([])
    expect(shown.attached).toEqual([1, 2])
    expect(shown.pictured).toEqual([3])
    await onboardObject(deps(), 'cable-clip', { ...d, objects: [{ id: 'lid', note: 'mounts on this' }] })
    expect(shown.text).toBe(sent[0].blocks[0].text)
  })

  it('counts the board as told just before the prompt goes, so that its line says no card is new, and not when nothing is sent', async () => {
    await onboardObject(deps(), 'cable-clip', draft())
    expect(calls).toEqual(['start cable-clip', 'told cable-clip', 'prompt'])
    calls.length = 0
    await onboardObject(deps({ start: async () => { throw new Error('no') } }), 'cable-clip', draft())
    await onboardObject(deps({ start: async () => ({ sessionId: 'sess', view: 'terminal' }) }), 'cable-clip', draft())
    expect(calls).toEqual([])
  })

  it('sends the prompt all the same when the board cannot be counted as told: its line then calls the cards new, which does no harm', async () => {
    const out = await onboardObject(deps({ boardTold: async () => { throw new Error('disk full') } }), 'cable-clip', draft())
    expect(out).toMatchObject({ sessionId: 'sess' })
    expect(out.problem).toBeUndefined()
    expect(sent).toHaveLength(1)
  })

  it('says the sizes, rules, links and PDFs of the draft, and previews the very same text', async () => {
    writeFileSync(join(base, 'cable-clip', 'reference', 'datasheet.pdf'), '%PDF-1.4')
    const given = {
      sizes: [{ what: 'cable', value: 'Ø6', unit: 'mm' as const, source: 'measured' as const }],
      rules: 'No supports.',
      links: [{ url: 'https://example.com/clip', note: 'the vendor' }],
      pdfs: [{ file: 'reference/datasheet.pdf', note: 'the cable' }]
    }
    const shown = await previewPrompt(deps(), 'cable-clip', { description: 'A clip.', items: [], steps: [], scans: [], objects: [], ...given })
    await onboardObject(deps(), 'cable-clip', draft(given))
    expect(sent[0].blocks[0].text).toBe(shown.text)
    for (const said of ['Sizes the person gave:\n- cable Ø 6 mm (measured)', 'Rules:\nNo supports.', 'Links (torno does not open links; read one only if it helps):\n- https://example.com/clip: the vendor', '- reference/datasheet.pdf: the cable. A PDF; read it with your own tools if it helps.']) expect(shown.text).toContain(said)
  })

  it('refuses sizes, rules, links and PDFs that are not what they may be, before anything is done', async () => {
    writeFileSync(join(base, 'cable-clip', 'reference', 'a.pdf'), '%PDF-1.4')
    const size = { what: 'cable', value: '6', unit: 'mm', source: 'measured' }
    const bad: Array<[Partial<OnboardDraft>, RegExp]> = [
      [{ sizes: 'no' as never }, /sizes/],
      [{ sizes: Array.from({ length: 41 }, () => size) as never }, /At most 40 sizes/],
      [{ sizes: [{ ...size, source: 'from Claude' }] as never }, /from Claude/],
      [{ sizes: [{ ...size, value: 'a\nb' }] as never }, /one line/],
      [{ rules: 3 as never }, /rules/],
      [{ rules: 'x'.repeat(4001) }, /rules/],
      [{ links: 'no' as never }, /links/],
      [{ links: Array.from({ length: 21 }, () => ({ url: 'https://example.com', note: '' })) }, /At most 20 links/],
      [{ links: [{ url: 'file:///etc/passwd', note: '' }] }, /http or https/],
      [{ links: [{ url: 'javascript:alert(1)', note: '' }] }, /http or https/],
      [{ links: [{ url: `https://example.com/${'a'.repeat(2000)}`, note: '' }] }, /2000/],
      [{ links: [{ url: 'https://example.com/a b', note: '' }] }, /space/],
      [{ links: [{ url: 'https://example.com', note: 'x'.repeat(301) }] }, /300/],
      [{ pdfs: 'no' as never }, /PDFs/],
      [{ pdfs: Array.from({ length: 7 }, (_, i) => ({ file: `reference/a${i}.pdf`, note: '' })) }, /At most 6 PDFs/],
      [{ pdfs: [{ file: '../../etc/a.pdf', note: '' }] }, /PDF/],
      [{ pdfs: [{ file: 'reference/a.txt', note: '' }] }, /PDF/],
      [{ pdfs: [{ file: 'reference/sub/a.pdf', note: '' }] }, /PDF/],
      [{ pdfs: [{ file: 'reference/missing.pdf', note: '' }] }, /not there/],
      [{ pdfs: [{ file: 'reference/a.pdf', note: '' }, { file: 'reference/a.pdf', note: '' }] }, /twice/]
    ]
    for (const [over, why] of bad) await expect(onboardObject(deps(), 'cable-clip', draft(over)), JSON.stringify(over).slice(0, 80)).rejects.toThrow(why)
    expect(calls).toEqual([])
    await expect(onboardObject(deps(), 'cable-clip', draft({ pdfs: [{ file: 'reference/a.pdf', note: 'ok' }] }))).resolves.toMatchObject({ sessionId: 'sess' })
  })

  it('refuses a PDF that is a link, not a plain file', async () => {
    symlinkSync('/etc/hostname', join(base, 'cable-clip', 'reference', 'l.pdf'))
    await expect(onboardObject(deps(), 'cable-clip', draft({ pdfs: [{ file: 'reference/l.pdf', note: '' }] }))).rejects.toThrow(/not there/)
  })

  it('imports the scans, then starts the session, then sends one prompt with everything', async () => {
    mkdirSync(join(base, 'lid', '.torno'))
    writeFileSync(join(base, 'lid', '.torno', 'thumb.png'), png(480, 360))
    const out = await onboardObject(
      deps({ scene: (id) => (id === 'lid' ? ({ model: 'lid', layouts: ['assembly'], parts: [{ name: 'lid', layout: 'assembly', bbox: { min: [0, 0, 0], max: [40, 20, 5] }, bboxExact: true }] } as unknown as Scene) : undefined) }),
      'cable-clip',
      draft({
        items: [{ file: 'reference/photo-1.jpg', note: 'desk', image: jpeg(1280, 960) }, { file: 'reference/doodle-1.png', note: 'shape', image: png(1200, 800) }],
        scans: [{ path: '/s/desk.stl', note: 'the edge' }],
        objects: [{ id: 'lid', note: 'mounts on this' }, { id: 'base', note: '' }]
      })
    )
    expect(calls).toEqual(['import /s/desk.stl', 'start cable-clip', 'told cable-clip', 'prompt'])
    expect(out.sessionId).toBe('sess')
    expect(out.problem).toBeUndefined()
    expect(sent).toHaveLength(1)
    expect(sent[0].blocks.map((b) => b.type)).toEqual(['text', 'text', 'image', 'text', 'image', 'text', 'image'])
    const text = sent[0].blocks[0].text!
    expect(out.prompt).toBe(text)
    expect(out.held).not.toContain('attached: picture')
    for (const note of ['desk', 'shape', 'the edge', 'mounts on this']) expect(text).toContain(note)
    expect(text).toContain('Scan S1 "desk.stl"')
    expect(text).toContain('../lid/ (another project of this workspace: 1 part: lid; box 40 x 20 x 5 mm, exact; its picture is attached: picture 3)')
    expect(text).toContain('../base/ (another project of this workspace: not built in this run)')
  })

  it('starts the session on the model and effort chosen on the page, and on the person\'s defaults for what is not one', async () => {
    const chosen: unknown[] = []
    const starting = deps({ start: async (_o, choice) => (chosen.push(choice), { sessionId: 'sess', view: 'chat' }) })
    await onboardObject(starting, 'cable-clip', draft({ choice: { model: 'opus', effort: 'high' } }))
    await onboardObject(starting, 'cable-clip', draft({ choice: { model: '-x', effort: 'loud' } as never }))
    await onboardObject(starting, 'cable-clip', draft())
    expect(chosen).toEqual([{ model: 'opus', effort: 'high' }, {}, {}])
  })

  it('does not attach a picture that is not one, and says so in the text', async () => {
    const out = await onboardObject(deps(), 'cable-clip', draft({ items: [{ file: 'reference/photo-1.jpg', note: 'desk', image: new Uint8Array([1, 2, 3]) }] }))
    expect(sent[0].blocks.map((b) => b.type)).toEqual(['text'])
    expect(out.prompt).toContain('(not attached: read reference/photo-1.jpg)')
  })

  it('goes on when a scan cannot be imported, and says in the text that it could not', async () => {
    const out = await onboardObject(deps({ importScan: async () => { throw new Error('not a mesh') } }), 'cable-clip', draft({ scans: [{ path: '/s/bad.stl', note: 'n' }] }))
    expect(out.sessionId).toBe('sess')
    expect(out.prompt).toContain('- Scan "bad.stl": n. It could not be imported (not a mesh)')
  })

  it('answers with no session, the prompt and the reason when the session cannot be started, and sends nothing', async () => {
    const out = await onboardObject(deps({ start: async () => { throw new Error("cannot start the agent: 'claude' was not found on PATH") } }), 'cable-clip', draft({ scans: [{ path: '/s/desk.stl', note: '' }] }))
    expect(out).toMatchObject({ sessionId: null, problem: "cannot start the agent: 'claude' was not found on PATH" })
    expect(out.prompt).toContain('Scan S1 "desk.stl"')
    expect(out.held).toContain('Scan S1 "desk.stl"')
    expect(sent).toEqual([])
  })

  it('holds the prompt again, with the reason, when the session ends without having taken it up', async () => {
    const out = await onboardObject(deps({ began: async () => ({ began: false as const, why: 'Claude Code stopped (exit code 1): not logged in' }) }), 'cable-clip', draft())
    expect(out).toMatchObject({ sessionId: 'sess', problem: 'Claude Code stopped (exit code 1): not logged in' })
    expect(out.held).toContain('This is a new project, cable-clip')
    const fine = await onboardObject(deps({ began: async () => ({ began: true as const }) }), 'cable-clip', draft())
    expect(fine.problem).toBeUndefined()
  })

  it('keeps the session and the prompt, and says why, when the agent has no chat to send it to', async () => {
    const out = await onboardObject(deps({ start: async () => ({ sessionId: 'term', view: 'terminal' }) }), 'cable-clip', draft())
    expect(out.sessionId).toBe('term')
    expect(out.problem).toMatch(/chat/)
    expect(sent).toEqual([])
  })

  it('refuses an object that is not of the workspace, or has a session already, and does nothing', async () => {
    await expect(onboardObject(deps(), 'nope', draft({ scans: [{ path: '/s/a.stl', note: '' }] }))).rejects.toThrow(/no project/i)
    await expect(onboardObject(deps({ running: () => true }), 'cable-clip', draft({ scans: [{ path: '/s/a.stl', note: '' }] }))).rejects.toThrow(/session/)
    expect(calls).toEqual([])
    expect(sent).toEqual([])
  })

  it('refuses a draft that is not what it may be, before anything is done', async () => {
    const bad: Array<[unknown, RegExp]> = [
      [{ ...draft(), description: 3 }, /description/],
      [{ ...draft(), items: [{ file: '../../etc/passwd', note: '' }] }, /reference/],
      [{ ...draft(), items: [{ file: 'reference/photo-9.png', note: '' }] }, /not there/],
      [{ ...draft(), items: [{ file: 'reference/photo-1.jpg', note: 5 }] }, /note/],
      [{ ...draft(), scans: [{ path: 'relative.stl', note: '' }] }, /scan/],
      [{ ...draft(), scans: [{ path: '/s/a.txt', note: '' }] }, /scan/],
      [{ ...draft(), scans: Array.from({ length: 5 }, () => ({ path: '/s/a.stl', note: '' })) }, /scans/],
      [{ ...draft(), objects: [{ id: 'nope', note: '' }] }, /nope/],
      [{ ...draft(), objects: [{ id: 'cable-clip', note: '' }] }, /itself/],
      [{ ...draft(), objects: Array.from({ length: 9 }, () => ({ id: 'lid', note: '' })) }, /projects/],
      [null, /draft/]
    ]
    for (const [d, why] of bad) await expect(onboardObject(deps(), 'cable-clip', d as OnboardDraft), JSON.stringify(d)).rejects.toThrow(why)
    expect(calls).toEqual([])
  })

  it('lets one call at a time onboard an object: a second, while the first imports, rejects before it imports anything', async () => {
    let release!: () => void
    const gate = new Promise<void>((r) => (release = r))
    const d = deps({ importScan: async (_id, path) => { calls.push(`import ${path}`); await gate; return { id: 'S1', name: 'desk' } } })
    const first = onboardObject(d, 'cable-clip', draft({ scans: [{ path: '/s/desk.stl', note: '' }] }))
    await expect(onboardObject(d, 'cable-clip', draft({ scans: [{ path: '/s/desk.stl', note: '' }] }))).rejects.toThrow(/already/)
    release()
    expect((await first).sessionId).toBe('sess')
    expect(calls.filter((c) => c.startsWith('import'))).toHaveLength(1)
    expect(sent).toHaveLength(1)
    // And once it ended, the object may be onboarded again (a rejected call frees it too).
    await expect(onboardObject(deps({ start: async () => { throw new Error('no') } }), 'cable-clip', draft())).resolves.toMatchObject({ sessionId: null })
    await expect(onboardObject(deps(), 'cable-clip', draft({ description: 3 as never }))).rejects.toThrow()
    await expect(onboardObject(deps(), 'cable-clip', draft())).resolves.toMatchObject({ sessionId: 'sess' })
  })

  it('checks every note and every scan path before it imports anything', async () => {
    const long = 'x'.repeat(2001)
    const bad: Array<[Partial<OnboardDraft>, RegExp]> = [
      [{ scans: [{ path: '/s/a.stl', note: '' }, { path: '/s/b.stl', note: long }] }, /note/],
      [{ scans: [{ path: '/s/a.stl', note: '' }, { path: '/s/b\n- injected.stl', note: '' }] }, /scan/],
      [{ scans: [{ path: '/s/a.stl', note: '' }], items: [{ file: 'reference/photo-1.jpg', note: long }] }, /note/],
      [{ scans: [{ path: '/s/a.stl', note: '' }], objects: [{ id: 'lid', note: long }] }, /note/]
    ]
    for (const [over, why] of bad) await expect(onboardObject(deps(), 'cable-clip', draft(over)), JSON.stringify(over)).rejects.toThrow(why)
    expect(calls).toEqual([])
  })

  it('refuses the same file, scan or object twice', async () => {
    const photo = { file: 'reference/photo-1.jpg', note: '' }
    await expect(onboardObject(deps(), 'cable-clip', draft({ items: [photo, photo] }))).rejects.toThrow(/twice/)
    await expect(onboardObject(deps(), 'cable-clip', draft({ scans: [{ path: '/s/a.stl', note: '' }, { path: '/s/a.stl', note: '' }] }))).rejects.toThrow(/twice/)
    await expect(onboardObject(deps(), 'cable-clip', draft({ objects: [{ id: 'lid', note: '' }, { id: 'lid', note: '' }] }))).rejects.toThrow(/twice/)
    expect(calls).toEqual([])
  })

  it('keeps the session and the prompt, and says why, when the prompt cannot be sent', async () => {
    const out = await onboardObject(deps({ prompt: () => { throw new Error('This session has ended') } }), 'cable-clip', draft())
    expect(out).toMatchObject({ sessionId: 'sess', problem: 'This session has ended' })
    expect(out.prompt).toContain('This is a new project')
  })
})
