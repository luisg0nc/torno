import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import type { Part } from '../../shared/scene'
import { asPictured, colouringNote, explodedNote, pictureExplode, pictureSize, scansNote, type PictureHost, type PicturePart, type PictureState, beyondNote, reachesBeyond, viewSaid } from './picture'

describe('the size of a picture', () => {
  it('is 1280 on its long edge when none is asked for, or what is asked for is no number', () => {
    expect(pictureSize(undefined, 4 / 3)).toEqual({ width: 1280, height: 960 })
    expect(pictureSize(Number.NaN, 4 / 3)).toEqual({ width: 1280, height: 960 })
    expect(pictureSize(Infinity, 4 / 3)).toEqual({ width: 1280, height: 960 })
  })

  it('is kept within 64 and 2000 pixels on its long edge', () => {
    expect(pictureSize(5000, 4 / 3)).toEqual({ width: 2000, height: 1500 })
    expect(pictureSize(10, 4 / 3)).toEqual({ width: 64, height: 48 })
    expect(pictureSize(-1, 1)).toEqual({ width: 64, height: 64 })
    expect(pictureSize(800.4, 2)).toEqual({ width: 800, height: 400 })
  })

  it("may be 4000 on its long edge for a picture the person keeps, which the agent's is not", () => {
    expect(pictureSize(5000, 4 / 3, true)).toEqual({ width: 4000, height: 3000 })
    expect(pictureSize(3000, 4 / 3, true)).toEqual({ width: 3000, height: 2250 })
    expect(pictureSize(5000, 4 / 3)).toEqual({ width: 2000, height: 1500 })
  })

  it('has its long edge upright for a canvas taller than wide, and no edge under a pixel', () => {
    expect(pictureSize(1000, 0.5)).toEqual({ width: 500, height: 1000 })
    expect(pictureSize(64, 1000)).toEqual({ width: 64, height: 1 })
    expect(pictureSize(64, 0.001)).toEqual({ width: 1, height: 64 })
  })
})

describe('the scans a picture has, in its caption', () => {
  it('are named after the parts, how thin only of one that is, and not at all when there is none', () => {
    const ok = { aligned: true, stale: null }
    expect(scansNote([{ id: 'S1', opacity: 0.6, ...ok }, { id: 'S2', opacity: 1, ...ok }], 'print')).toBe(' · scans S1 at 60 %, S2')
    expect(scansNote([], 'print')).toBe('')
  })

  // Milestone 5: the far plane cuts a scan that reaches past 200 times the parts, and a picture that shows a part of it says so.
  it('say of a scan that reaches further than the view is drawn that not all of it is in the picture', () => {
    const ok = { aligned: true, stale: null }
    expect(scansNote([{ id: 'S1', opacity: 1, ...ok, clipped: true }], 'print')).toBe(' · scans S1 (reaches beyond the view: not all of it is drawn)')
    expect(scansNote([{ id: 'S1', opacity: 0.6, ...ok, clipped: true, basis: 'by hand' }, { id: 'S2', opacity: 1, ...ok }], 'print')).toBe(' · scans S1 at 60 % (by hand; reaches beyond the view: not all of it is drawn), S2')
    expect(scansNote([{ id: 'S1', opacity: 1, aligned: false, stale: null, clipped: true }], 'print')).toBe(' · scans S1 (not aligned in print: drawn where it was imported; reaches beyond the view: not all of it is drawn)')
  })

  // Fix round 1 (I1): a scan that is not where the model is must not be read as one that is.
  it('say of a scan that it is not aligned in the layout drawn, or that its alignment may no longer hold', () => {
    expect(scansNote([{ id: 'S1', opacity: 1, aligned: false, stale: null }], 'print')).toBe(' · scans S1 (not aligned in print: drawn where it was imported)')
    expect(scansNote([{ id: 'S1', opacity: 0.5, aligned: false, stale: null }, { id: 'S2', opacity: 1, aligned: true, stale: 'torno has moved lid for display since it was aligned: check the alignment' }], 'assembly')).toBe(
      ' · scans S1 at 50 % (not aligned in assembly: drawn where it was imported), S2 (its alignment in assembly may no longer hold: torno has moved lid for display since it was aligned: check the alignment)'
    )
  })

  // Task 5: an alignment that is only rough is said to be, with its reason; one in doubt besides says that first.
  it('say of a scan that it is aligned only roughly', () => {
    const rough = 'it was placed by hand, with no pairs of points to say how well'
    expect(scansNote([{ id: 'S1', opacity: 1, aligned: true, stale: null, rough }], 'print')).toBe(` · scans S1 (aligned roughly in print: ${rough})`)
    expect(scansNote([{ id: 'S1', opacity: 1, aligned: true, stale: 'x: check the alignment', rough }], 'print')).toBe(` · scans S1 (its alignment in print may no longer hold: x: check the alignment; it is rough: ${rough})`)
    expect(scansNote([{ id: 'S1', opacity: 1, aligned: false, stale: null, rough: null }], 'print')).toBe(' · scans S1 (not aligned in print: drawn where it was imported)')
  })

  // Fix round 1 (R-basis, R-check): what an alignment rests on is said first, and what else is to be known of it last.
  it('say what each alignment rests on, that one was not checked against the build drawn, and what no build can say', () => {
    const scan = { id: 'S1', opacity: 1, aligned: true, stale: null, rough: null, note: null }
    expect(scansNote([{ ...scan, basis: 'floor only' }], 'print')).toBe(' · scans S1 (floor only)')
    expect(scansNote([{ ...scan, basis: 'by hand', note: 'tied to no point of the model: not checked against builds' }], 'print')).toBe(' · scans S1 (by hand; tied to no point of the model: not checked against builds)')
    expect(scansNote([{ ...scan, basis: '4 pairs, RMS 0.8 mm, scaled, then moved by hand' }], 'print')).toBe(' · scans S1 (4 pairs, RMS 0.8 mm, scaled, then moved by hand)')
    // Whether not being checked is all there is to say is a field of what is told (fix round 2, m1).
    expect(scansNote([{ ...scan, basis: '4 pairs, RMS 0.8 mm', stale: 'it was not checked against r13', waiting: true }], 'print')).toBe(' · scans S1 (4 pairs, RMS 0.8 mm; it was not checked against r13)')
    expect(scansNote([{ ...scan, basis: '2 pairs, RMS 0 mm', rough: 'it has 2 pairs of points', stale: 'x: check the alignment' }], 'print')).toBe(' · scans S1 (2 pairs, RMS 0 mm; its alignment in print may no longer hold: x: check the alignment; it is rough: it has 2 pairs of points)')
    expect(scansNote([{ ...scan, basis: '4 pairs, RMS 0.8 mm', note: 'confirmed by the user on r12' }], 'print')).toBe(' · scans S1 (4 pairs, RMS 0.8 mm; confirmed by the user on r12)')
  })
})

describe('a scan coloured by its distance to a part, in the caption', () => {
  const colours = { near: '#8A4594', far: '#D3D8DF', inside: '#22252A' }
  it('says which scan, to which part, over what range, and the very colours it is drawn in', () => {
    expect(colouringNote({ scan: 'S1', part: 'tub', range: 20 }, colours, true)).toBe(" · scan S1 coloured by the distance of its points to tub: 0 to 20 mm, inside the part marked and drawn over it (0 mm #8A4594, 20 mm and beyond #D3D8DF, inside the part #22252A; the colours are of the scan's points, shaded, and approximate; beyond 20 mm the scan is seen through)")
    expect(colouringNote({ scan: 'S1', part: 'tub', range: 2.5 }, colours, false)).toBe(" · scan S1 coloured by the distance of its points to tub: 0 to 2.5 mm (0 mm #8A4594, 2.5 mm and beyond #D3D8DF; the colours are of the scan's points, shaded, and approximate; beyond 2.5 mm the scan is seen through; tub is no solid, so nothing is marked as inside it)")
  })
})

// Final fix wave (F6): a scan is the surroundings, and a view fitted to the parts shows a corner of it.
describe('a scan that reaches beyond the picture', () => {
  it('is one with a corner past an edge of what the camera draws', () => {
    const camera = new THREE.OrthographicCamera(-50, 50, 40, -40, 1, 1000)
    camera.position.set(0, 0, 200)
    camera.lookAt(0, 0, 0)
    camera.updateProjectionMatrix()
    const box = (half: number): THREE.Box3 => new THREE.Box3(new THREE.Vector3(-half, -half, -10), new THREE.Vector3(half, half, 10))
    expect(reachesBeyond(camera, box(30))).toBe(false)
    expect(reachesBeyond(camera, box(45))).toBe(true)
    expect(reachesBeyond(camera, box(1200))).toBe(true)
  })

  it('is said in the caption, with what takes it in when the view was fitted to the parts', () => {
    expect(beyondNote([], true)).toBe('')
    expect(beyondNote(['S1'], true)).toBe(' · S1 reaches beyond the picture, which is fitted to the parts: frame "all" takes the scans in')
    expect(beyondNote(['S1', 'S2'], false)).toBe(' · S1, S2 reach beyond the picture')
  })
})

/** The section the person has on screen. */
const ON_SCREEN = { origin: [0, 0, 12], normal: [0, 0, 1] } satisfies PictureState['section']

/** A viewport showing `assembly`, with one of its two parts switched off, that writes down what is asked of it. */
function viewport(far: THREE.Box3 | null = null): { host: PictureHost; log: string[]; parts: PicturePart[]; visible: () => boolean[]; ground: THREE.Sphere } {
  const log: string[] = []
  const part = (layout: string, name: string, visible: boolean): PicturePart => ({ part: { key: `${layout}:${name}`, layout, name } as Part, built: { group: { visible } } })
  const parts = [part('assembly', 'base', true), part('assembly', 'post', false), part('print', 'base', false)]
  const ground = new THREE.Sphere(new THREE.Vector3(), 10)
  let active: string | null = 'M2'
  const renderer = {
    getViewport: (into: THREE.Vector4) => into.set(0, 0, 800, 600),
    setViewport: (x: THREE.Vector4 | number, _y?: number, width?: number, height?: number) => log.push(typeof x === 'number' ? `viewport ${width}×${height}` : `viewport ${x.z}×${x.w}`),
    setRenderTarget: (target: unknown) => log.push(`target ${String(target)}`)
  }
  const host: PictureHost = {
    renderer: renderer as unknown as THREE.WebGLRenderer,
    scene: new THREE.Scene(),
    marks: {
      get activeId() {
        return active
      },
      setActive: (id) => {
        active = id
        log.push(`active ${id}`)
      },
      setLights: () => {},
      show: (layout, hidden) => log.push(`marks ${layout} but on ${[...(hidden ?? [])].join(',') || 'none'}`),
      showDraft: (shown) => log.push(`draft ${shown ? 'on' : 'off'}`),
      extend: (sphere, layout) => {
        log.push(`extend ${layout}`)
        sphere.radius += 5
        return sphere
      },
      update: () => {},
      labels: () => [],
      split: () => []
    },
    scans: {
      showOnly: (ids, layout) => {
        log.push(`scans ${ids?.join(',') || 'none'} as in ${layout}`)
        return () => log.push('scans as on screen')
      },
      shown: () => [],
      box: () => far,
      boxIn: () => null,
      built: () => null,
      colourFor: (id, colours) => void log.push(colours ? `colour ${id} by ${colours.length / 3} colours` : 'colours off')
    },
    highlights: { setVisible: (visible, layers) => log.push(`highlights ${visible ? 'on' : 'off'}${layers ? ` ${layers.join(',')}` : ''}`) },
    closed: () => false,
    layouts: () => ['assembly', 'print'],
    layout: () => 'assembly',
    aspect: () => 4 / 3,
    parts: () => parts,
    currentView: () => ({ position: [0, -100, 0], target: [0, 0, 0], up: [0, 0, 1], ortho: true, fov: 35, zoom: 1 }),
    namedView: () => ({ position: [0, -100, 0], target: [0, 0, 0], up: [0, 0, 1], ortho: true, fov: 35, zoom: 1 }),
    cameraFor: () => new THREE.OrthographicCamera(),
    hiddenParts: () => new Set(),
    hideGizmo: () => {
      log.push('gizmo off')
      return () => log.push('gizmo on')
    },
    section: () => ON_SCREEN,
    cutBy: (plane, layout, decor) => log.push(`cut ${plane ? `at z ${plane.origin[2]}` : 'by nothing'} across ${layout}, plane ${decor ? 'drawn' : 'not drawn'}`),
    layGround: (layout) => {
      log.push(`ground ${layout}`)
      return layout === 'assembly' ? ground : new THREE.Sphere(new THREE.Vector3(), 20)
    },
    groundExtent: () => ground,
    tintPicks: (layout) => log.push(`tint ${layout}`),
    showMarks: () => log.push('marks as on screen'),
    explode: () => null,
    explodeFor: (explode, layout) => {
      log.push(`apart ${explode ? explode.amount : 'not'} in ${layout}`)
      return () => log.push('apart as on screen')
    },
    colours: () => ({ user: '#cf3f2c', agent: '#288156', paper: '#faf9f6', surface: '#f1efea', ink: '#22252a', muted: '#686d74' })
  }
  return { host, log, parts, visible: () => parts.map((p) => p.built.group.visible), ground }
}

describe('what the scene is while a picture of it is drawn', () => {
  it('is the picture’s parts, layout, marks and section, with nothing of what the person points at or holds; and the screen’s again after, in this order', () => {
    const { host, log, parts, visible } = viewport()
    const state: PictureState = { layout: 'print', shown: [parts[2]], withMarks: true, scans: ['S1'], section: { origin: [0, 0, 4], normal: [0, 0, 1] }, notDrawn: new Set(['lid']), width: 640, height: 480 }
    const radius = asPictured(host, state, (extent) => {
      expect(visible()).toEqual([false, false, true])
      log.push('draw')
      return extent.radius
    })

    expect(radius).toBe(25) // the other layout's ground, and its marks
    expect(log).toEqual([
      'highlights off',
      'gizmo off',
      'viewport 640×480',
      'scans S1 as in print',
      'cut at z 4 across print, plane not drawn',
      'ground print',
      'active null',
      'marks print but on lid',
      'draft off',
      'extend print',
      'highlights on userMark,userDont,agentMark',
      'tint print',
      'draw',
      'viewport 800×600',
      'target null',
      'scans as on screen',
      'cut at z 12 across assembly, plane drawn',
      'gizmo on',
      'highlights on',
      'active M2',
      'marks as on screen',
      'draft on',
      'ground assembly',
      'tint assembly'
    ])
    expect(visible()).toEqual([true, false, false])
  })

  it('leaves the ground and the tints alone for a picture of the layout on screen without its marks', () => {
    const { host, log, parts, visible, ground } = viewport()
    asPictured(host, { layout: 'assembly', shown: [parts[1]], withMarks: false, scans: null, section: null, notDrawn: new Set(), width: 64, height: 48 }, (extent) => {
      expect(extent).toBe(ground)
      expect(visible()).toEqual([false, true, false])
    })

    expect(log).toEqual(['highlights off', 'gizmo off', 'viewport 64×48', 'scans none as in assembly', 'cut by nothing across assembly, plane not drawn', 'active null', 'marks null but on none', 'draft off', 'viewport 800×600', 'target null', 'scans as on screen', 'cut at z 12 across assembly, plane drawn', 'gizmo on', 'highlights on', 'active M2', 'marks as on screen', 'draft on'])
    expect(visible()).toEqual([true, false, false])
    expect(ground.radius).toBe(10) // what the marks add is added to a copy
  })

  it('puts everything back when the drawing fails', () => {
    const { host, log, parts, visible } = viewport()
    const state: PictureState = { layout: 'print', shown: [parts[2]], withMarks: true, scans: ['S1', 'S2'], section: ON_SCREEN, notDrawn: new Set(), width: 640, height: 480 }
    expect(() =>
      asPictured(host, state, () => {
        throw new Error('no context')
      })
    ).toThrow('no context')

    expect(log.slice(log.indexOf('tint print') + 1)).toEqual(['viewport 800×600', 'target null', 'scans as on screen', 'cut at z 12 across assembly, plane drawn', 'gizmo on', 'highlights on', 'active M2', 'marks as on screen', 'draft on', 'ground assembly', 'tint assembly'])
    expect(log).toContain('scans S1,S2 as in print')
    expect(visible()).toEqual([true, false, false])
  })

  it('colours a scan for the picture once it stands and is cut as the picture has it, and takes the colours off again, also when they cannot be worked out', () => {
    const { host, log, parts } = viewport()
    const state: PictureState = { layout: 'print', shown: [parts[2]], withMarks: false, scans: ['S1'], section: null, notDrawn: new Set(), width: 64, height: 48, colour: { scan: 'S1', colours: () => new Uint16Array(24), of: { far: [1, 1, 1], inside: null } } }
    asPictured(host, state, () => log.push('draw'))
    expect(log.slice(log.indexOf('scans S1 as in print'), log.indexOf('draw') + 1)).toEqual(['scans S1 as in print', 'cut by nothing across print, plane not drawn', 'colour S1 by 8 colours', 'ground print', 'active null', 'marks null but on none', 'draft off', 'draw'])
    expect(log.slice(log.indexOf('target null'), log.indexOf('target null') + 3)).toEqual(['target null', 'colours off', 'scans as on screen'])
    const failing = viewport()
    const refused = { ...state, shown: [failing.parts[2]], colour: { scan: 'S1', of: { far: [1, 1, 1], inside: null }, colours: () => { throw new Error('too many points') } } }
    expect(() => asPictured(failing.host, refused, () => failing.log.push('draw'))).toThrow('too many points')
    expect(failing.log).not.toContain('draw')
    expect(failing.log).toContain('colours off')
    expect(failing.visible()).toEqual([true, false, false])
    // A picture with no scan coloured asks nothing of the colours.
    const plain = viewport()
    asPictured(plain.host, { ...state, shown: [plain.parts[2]], colour: undefined }, () => {})
    expect(plain.log.filter((line) => line.startsWith('colour'))).toEqual([])
  })

  it('has the scans it draws within what the camera reaches, however far they stand from the parts', () => {
    const { host, parts, ground } = viewport(new THREE.Box3(new THREE.Vector3(990, -10, -10), new THREE.Vector3(1010, 10, 10)))
    const extent = asPictured(host, { layout: 'assembly', shown: [parts[0]], withMarks: false, scans: ['S1'], section: null, notDrawn: new Set(), width: 64, height: 48 }, (extent) => extent)
    for (const corner of [new THREE.Vector3(1010, 10, 10), new THREE.Vector3(0, 0, -10)]) expect(extent.distanceToPoint(corner)).toBeLessThanOrEqual(1e-6)
    expect(ground.radius).toBe(10) // what the scans add is added to a copy
  })

  it('draws nothing of a scan that is not there, and changes nothing on screen for it', () => {
    const { host, log, parts, visible } = viewport()
    host.scans.showOnly = () => {
      throw new Error('no scan S9; scans: S1')
    }
    expect(() => asPictured(host, { layout: 'assembly', shown: [parts[1]], withMarks: false, scans: ['S9'], section: null, notDrawn: new Set(), width: 64, height: 48 }, () => log.push('draw'))).toThrow('no scan S9; scans: S1')
    expect(log).not.toContain('draw')
    expect(visible()).toEqual([true, false, false])
  })
})

describe('a picture whose parts are drawn apart', () => {
  const Z = { amount: 1, scale: 1, axis: 'z' } as const
  const HALF = { amount: 0.5, scale: 1, axis: 'centre' } as const
  const CUT = { origin: [0, 0, 3] as [number, number, number], normal: [0, 0, 1] as [number, number, number] }
  const box = (name: string, min: [number, number, number], max: [number, number, number]) => ({ name, bbox: { min, max } })
  const TWO = [box('tub', [-20, -20, 0], [20, 20, 38]), box('lid', [-20, -20, 38], [20, 20, 40])]
  const NESTED = [box('ring', [-20, -20, 0], [20, 20, 10]), box('shaft', [-3, -3, -15], [3, 3, 25])]
  const on = (over: Partial<Parameters<typeof pictureExplode>[1]> = {}): Parameters<typeof pictureExplode>[1] => ({ layout: 'assembly', onScreen: 'assembly', current: null, section: null, parts: TWO, coloured: false, ...over })
  const NOTE = 'the parts are drawn apart for display: every position, ref and number told is of the parts as assembled'

  it('says so in its caption, with the sentence that nothing in it is where it is', () => {
    expect(explodedNote(Z, false)).toBe(` · exploded 100 % along z (${NOTE})`)
    expect(explodedNote(HALF, false)).toBe(` · exploded 50 % from the centre (${NOTE})`)
    expect(explodedNote(null, true)).toBe('')
    expect(explodedNote({ amount: 0, scale: 2, axis: 'z' }, true, ['M5'])).toBe('')
  })

  it('says that the scans drawn with them have not moved, and which marks span parts drawn apart', () => {
    expect(explodedNote(Z, true)).toMatch(/as assembled\) · scans are where they are$/)
    expect(explodedNote(Z, false, ['M5'])).toMatch(/as assembled\) · M5 spans parts drawn apart: it is drawn dashed between them, as long as they are apart, which measures nothing$/)
    expect(explodedNote(Z, true, ['M5', 'M7'])).toMatch(/ · scans are where they are · M5, M7 span parts drawn apart: they are drawn dashed between them, as long as they are apart, which measures nothing$/)
  })

  it('is drawn as on screen unless it says how: of the layout on screen, by the explode there; of another, together', () => {
    expect(pictureExplode(undefined, on({ current: Z }))).toEqual({ explode: Z, said: '' })
    expect(pictureExplode('current', on({ current: Z })).explode).toEqual(Z)
    expect(pictureExplode('current', on({ current: Z, layout: 'print' })).explode).toBeNull()
    expect(pictureExplode(undefined, on())).toEqual({ explode: null, said: '' })
    expect(pictureExplode(null, on({ current: Z })).explode).toBeNull()
    expect(pictureExplode(HALF, on({ current: Z })).explode).toEqual(HALF)
    expect(pictureExplode(HALF, on({ layout: 'print' })).explode).toEqual(HALF)
    expect(pictureExplode({ amount: 0, scale: 2, axis: 'z' }, on()).explode).toBeNull()
  })

  it('says why when it is asked to draw apart what cannot be: one part, or parts that share the centre they would go from (M2)', () => {
    expect(() => pictureExplode(HALF, on({ parts: TWO.slice(0, 1) }))).toThrow('nothing can be drawn apart in layout assembly: it has fewer than two parts (explode: null draws it as it is)')
    expect(() => pictureExplode(HALF, on({ parts: NESTED, layout: 'print' }))).toThrow('nothing is drawn apart from the centre in layout print: its parts share a centre; give an axis, {"amount": 0.5, "axis": "z"}')
    expect(pictureExplode(Z, on({ parts: NESTED })).explode).toEqual(Z)
    // As on screen, there is nothing to say: the screen does not draw them apart either.
    expect(pictureExplode('current', on({ current: HALF, parts: NESTED }))).toEqual({ explode: null, said: '' })
    expect(pictureExplode(undefined, on({ current: Z, parts: [] }))).toEqual({ explode: null, said: '' })
  })

  it('is never cut: asked for both it is refused, and a cut of the picture\'s own is drawn of the parts together', () => {
    expect(() => pictureExplode(HALF, on({ section: CUT }))).toThrow('a section is not drawn exploded: give explode or section, not both (explode: null draws the parts together, section: null draws them whole)')
    // Apart only because the screen is: the cut is what was asked for.
    expect(pictureExplode('current', on({ current: Z, section: CUT })).explode).toBeNull()
    expect(pictureExplode(undefined, on({ current: Z, section: CUT })).explode).toBeNull()
    expect(pictureExplode(null, on({ section: CUT })).explode).toBeNull()
  })

  it('is never taken with a scan coloured by its distance to a part: the part is drawn where it is, and the caption says so (M5)', () => {
    const TOGETHER = ' · the parts are drawn together: the scan is coloured by its distance to the part where it is'
    expect(pictureExplode(undefined, on({ current: Z, coloured: true }))).toEqual({ explode: null, said: TOGETHER })
    expect(pictureExplode(HALF, on({ coloured: true }))).toEqual({ explode: null, said: TOGETHER })
    // Together anyway: nothing to say.
    expect(pictureExplode(undefined, on({ coloured: true }))).toEqual({ explode: null, said: '' })
    expect(pictureExplode(null, on({ current: Z, coloured: true }))).toEqual({ explode: null, said: '' })
  })
})

describe('the view a caption names', () => {
  it('is the saved view by its name in quotes, else the standard view, the user\'s own, or a camera given', () => {
    const camera = { position: [1, 2, 3], target: [0, 0, 0], up: [0, 0, 1], ortho: false, fov: 35, zoom: 1 } as const
    expect(viewSaid(camera as never, 'Hinge side')).toBe('"Hinge side"')
    expect(viewSaid('top')).toBe('top')
    expect(viewSaid('current')).toBe('current')
    expect(viewSaid(undefined)).toBe('current')
    expect(viewSaid(camera as never)).toBe('custom')
  })
})

// Final review I7, the sweep's finding 9 and Task 4's 1,001 ms: `convertToBlob` has its PNG written in the
// window's idle time, and a window with a frame pending that it is not given (one nobody looks at) has none: the
// picture then waits a second for Chromium to give up waiting. A picture is encoded at once (`pngBytes`).
it('encodes no picture in the window\'s idle time', async () => {
  const { readFileSync, readdirSync } = await import('node:fs')
  const { join } = await import('node:path')
  const found: string[] = []
  for (const dir of [__dirname, join(__dirname, 'marks'), join(__dirname, '../state'), join(__dirname, '../ui')]) {
    for (const name of readdirSync(dir)) {
      if (!/\.tsx?$/.test(name) || /\.test\.tsx?$/.test(name)) continue
      const source = readFileSync(join(dir, name), 'utf8').replace(/^\s*(\/\/|\*|\/\*).*$/gm, '')
      if (/convertToBlob\s*\(|\.toBlob\s*\(/.test(source)) found.push(name)
    }
  }
  expect(found).toEqual([])
})
