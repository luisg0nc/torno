import { describe, expect, it } from 'vitest'
import { objectNameProblem } from '../../../shared/objectName'
import { folderFromWords } from './folderFromWords'

describe('the folder name offered from the words', () => {
  it('names a part by what it is and what it holds', () => {
    expect(folderFromWords('A clip that holds a 6 mm cable to the edge of a desk, printed in PETG', [])).toBe('cable-clip')
    expect(folderFromWords('a lid for a box', [])).toBe('box-lid')
  })

  it('is a name the rule of a new project accepts', () => {
    for (const words of ['A clip that holds a 6 mm cable to the edge of a desk', 'Ø6 hole, 12 mm deep!', '  ¿¿ ??  ', 'test bracket', 'tools', 'a'.repeat(200), 'string', '12 34']) {
      const name = folderFromWords(words, [])
      expect(objectNameProblem(name, []), `${words} -> ${name}`).toBeNull()
    }
  })

  it('is `project` when the words give nothing to name it by', () => {
    expect(folderFromWords('', [])).toBe('project')
    expect(folderFromWords('   ', [])).toBe('project')
    expect(folderFromWords('a 6 mm one for the', [])).toBe('project')
  })

  it('leaves out the adjectives that lead and the verbs between', () => {
    expect(folderFromWords('A small bracket', [])).toBe('bracket')
    expect(folderFromWords('Make me a hook that holds a mug', [])).toBe('mug-hook')
  })

  it('numbers a name that is taken, in any case, and one that names the same model', () => {
    expect(folderFromWords('a clip for a cable', ['cable-clip'])).toBe('cable-clip-2')
    expect(folderFromWords('a clip for a cable', ['Cable-Clip', 'cable-clip-2'])).toBe('cable-clip-3')
    expect(folderFromWords('a clip for a cable', ['cable_clip'])).toBe('cable-clip-2')
    expect(folderFromWords('', ['project'])).toBe('project-2')
  })

  it('stays within the length of a name', () => {
    const name = folderFromWords(`${'extraordinarily'.repeat(5)} bracket`, [])
    expect(name.length).toBeLessThanOrEqual(64)
    expect(objectNameProblem(name, [])).toBeNull()
  })
})
