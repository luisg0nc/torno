import { describe, expect, it } from 'vitest'
import { profileSaid } from './profile'

const printer = { name: 'Bambu X1C', bed: [256, 256, 256] as [number, number, number], nozzle: 0.4 }
const material = { name: 'PETG', density: 1.27, fits: { press: [0, 0.1], sliding: [0.2, 0.3], loose: [0.4, 0.5] } as Record<'press' | 'sliding' | 'loose', [number, number]> }

describe('what the head of the Print profile says', () => {
  it('is the printer and the material', () => {
    expect(profileSaid({ printer, material })).toBe('Bambu X1C, PETG')
  })
  it('is the one of them there is', () => {
    expect(profileSaid({ printer })).toBe('Bambu X1C')
    expect(profileSaid({ material })).toBe('PETG')
  })
  it('is none for a project made for neither, or one not read yet', () => {
    expect(profileSaid({})).toBe('none')
    expect(profileSaid(null)).toBe('none')
  })
})
