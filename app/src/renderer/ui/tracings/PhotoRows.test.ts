import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { plainText } from '../../../test/plainText'
import type { TracingPhoto } from '../../../shared/tracings'
import { AddPhoto, photoFigures, PhotoRows, type PhotoRowsProps } from './PhotoRows'

const photo = (over: Partial<TracingPhoto> = {}): TracingPhoto => ({
  file: 'p-0123456789ab.jpg',
  sha256: 'a'.repeat(64),
  width: 4000,
  height: 3000,
  pairs: [{ photo: [1, 1], uv: [0, 0] }, { photo: [9, 1], uv: [2, 0] }, { photo: [9, 9], uv: [2, 2] }, { photo: [1, 9], uv: [0, 2] }, { photo: [5, 5], uv: [1, 1] }],
  method: 'straight',
  transform: [1, 0, 0, 0, 1, 0, 0, 0, 1],
  scale: 4.7312,
  angle: 2.1,
  fit: 0.4,
  straightened: 's-0123456789ab.png',
  fade: 0.5,
  ...over
})
const html = (over: Partial<PhotoRowsProps> = {}, p: TracingPhoto = photo()): string => renderToStaticMarkup(createElement(PhotoRows, { photo: p, thumb: 'blob:thumb', here: true, ...over }))

describe('what a photo row says of the line-up', () => {
  it('gives the scale, the angle and how it was made, and says not exact beside them', () => {
    const said = photoFigures(photo())
    expect(said.scale).toBe('4.731 px/mm')
    expect(said.angle).toBe('2.1°')
    expect(said.how).toBe('5 points, straightened, fit 0.4 mm')
    const text = plainText(html())
    expect(text).toContain('4.731 px/mm')
    expect(text).toContain('2.1°')
    expect(text).toMatch(/4\.731 px\/mm.*2\.1°.*not exact/)
  })

  it('says there is no spare point to check a line-up of exactly as many points as its method needs', () => {
    const two = photo({ method: 'similar', pairs: [{ photo: [1, 1], uv: [0, 0] }, { photo: [9, 9], uv: [4, 4] }], fit: undefined })
    delete two.fit
    expect(photoFigures(two).how).toBe('2 points, no spare point to check it')
    expect(photoFigures(photo({ method: 'similar', fit: 1.25 })).how).toBe('5 points, fit 1.25 mm')
  })

  it('says a photo not lined up yet is not, and offers to line it up', () => {
    const swapped = photo({ pairs: [{ uv: [0, 0] }, { uv: [2, 0] }], transform: undefined, scale: undefined, angle: undefined, fit: undefined, straightened: undefined })
    const text = plainText(html({}, swapped))
    expect(text).toContain('not lined up yet')
    expect(text).not.toContain('px/mm')
    expect(text).toContain('Line up')
  })

  it('offers Line up again, Swap photo and Remove photo, a fade slider and Hide', () => {
    const markup = html()
    const text = plainText(markup)
    expect(text).toContain('Line up again')
    expect(text).toContain('Swap photo')
    expect(text).toContain('Remove photo')
    expect(text).toContain('Hide')
    expect(markup).toMatch(/<input[^>]*type="range"[^>]*aria-label="Fade of the photo"/)
    expect(markup).toContain('value="0.5"')
  })

  it('says Show when the photo is hidden', () => {
    expect(plainText(html({}, photo({ hidden: true })))).toContain('Show')
    expect(html({}, photo({ hidden: true }))).toContain('data-hidden=""')
  })

  it('says the photo is not on this computer and still tells the line-up', () => {
    const markup = html({ here: false, thumb: null })
    const text = plainText(markup)
    expect(text).toContain('photo not on this computer')
    expect(text).toContain('4.731 px/mm')
    expect(text).toContain('not exact')
    expect(markup).not.toContain('<img')
    // Line up again needs the photo.
    expect(markup).toMatch(/<button[^>]*disabled=""[^>]*>Line up again/)
  })

  it('shows the thumbnail when there is one', () => {
    expect(html()).toContain('src="blob:thumb"')
  })
})

describe('adding a photo', () => {
  const add = (props: Partial<Parameters<typeof AddPhoto>[0]> = {}): string => renderToStaticMarkup(createElement(AddPhoto, { references: [], ...props }))

  it('offers to choose a file and says a picture can be dropped on the view', () => {
    const text = plainText(add())
    expect(text).toContain('Add photo')
    expect(text).toContain('drop a picture')
  })

  it('lists the photos of the project\'s references to take one from', () => {
    const markup = add({ references: ['reference/photo-1.jpg', 'reference/photo-2.png'] })
    expect(markup).toContain('data-reference="reference/photo-1.jpg"')
    expect(plainText(markup)).toContain('photo-2.png')
  })

  it('says what went wrong with the last picture', () => {
    expect(plainText(add({ problem: 'IMG_1.heic: HEIC is not read' }))).toContain('HEIC is not read')
  })
})
