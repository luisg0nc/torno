import { describe, expect, it } from 'vitest'
import { groupOf, groupsIn, groupVisibility, partsNamed } from './groups'
import type { Part, Scene } from './scene'

const part = (layout: string, name: string) => ({ key: `${layout}:${name}`, layout, name }) as Part
const names = ['flat-a', 'flat-b', 'tall-a', 'key']
const scene: Pick<Scene, 'parts' | 'groups'> = {
  parts: [...names.map((n) => part('assembly', n)), part('print', 'flat-a'), part('print', 'key')],
  groups: [
    { name: 'flat', parts: ['flat-a', 'flat-b'] },
    { name: 'tall', parts: ['tall-a'] },
  ],
}

describe('groups', () => {
  it('groupsIn keeps the parts the layout has, and drops a group with none', () => {
    expect(groupsIn(scene, 'assembly')).toEqual(scene.groups)
    expect(groupsIn(scene, 'print')).toEqual([{ name: 'flat', parts: ['flat-a'] }])
    expect(groupsIn({ parts: scene.parts }, 'assembly')).toEqual([])
  })

  it('partsNamed turns group names into their parts, in order, without repeats', () => {
    expect(partsNamed(scene, 'assembly', ['flat', 'key'])).toEqual(['flat-a', 'flat-b', 'key'])
    expect(partsNamed(scene, 'assembly', ['flat-a', 'flat'])).toEqual(['flat-a', 'flat-b'])
    expect(partsNamed(scene, 'print', ['flat'])).toEqual(['flat-a'])
    expect(partsNamed(scene, 'assembly', [])).toEqual([])
  })

  it('partsNamed names the parts and the groups of the layout after an unknown name', () => {
    expect(partsNamed(scene, 'assembly', ['nope'])).toEqual({
      unknown: 'nope',
      text: "unknown part 'nope'; parts in layout assembly: flat-a, flat-b, tall-a, key; groups: flat, tall",
    })
    // A group none of whose parts the layout has is not a name there.
    expect(partsNamed(scene, 'print', ['tall'])).toMatchObject({ unknown: 'tall' })
    expect(partsNamed({ parts: scene.parts }, 'assembly', ['flat'])).toEqual({
      unknown: 'flat',
      text: "unknown part 'flat'; parts in layout assembly: flat-a, flat-b, tall-a, key",
    })
  })

  it('groupOf finds the group of a part', () => {
    expect(groupOf(scene, 'flat-b')?.name).toBe('flat')
    expect(groupOf(scene, 'key')).toBeUndefined()
    expect(groupOf({}, 'key')).toBeUndefined()
  })

  it('groupVisibility is all, some or none, a part with no settings visible', () => {
    expect(groupVisibility(['a', 'b'], {})).toBe('all')
    expect(groupVisibility(['a', 'b'], { a: { visible: false } })).toBe('some')
    expect(groupVisibility(['a', 'b'], { a: { visible: false }, b: { visible: false } })).toBe('none')
    expect(groupVisibility(['a'], { a: { visible: true, opacity: 0.5 } })).toBe('all')
  })
})
