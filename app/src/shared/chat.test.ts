import { describe, expect, it } from 'vitest'
import { agentChoiceOf, EFFORTS, effortsOf, pulledFromTorno, refsIn, shownPath, toolLabel, type Effort } from './chat'

const refs = (text: string, sets?: readonly string[]): string[] => refsIn(text, sets).flatMap((piece) => (piece.ref ? [piece.ref] : []))

describe('refsIn: tracings', () => {
  it('takes T<n> as a ref, with the marks and the cards', () => {
    expect(refs('see T1 and M3')).toEqual(['T1', 'M3'])
    expect(refs('T12, then T3.')).toEqual(['T12', 'T3'])
    expect(refsIn('see T1 and M3').map((p) => p.text)).toEqual(['see ', 'T1', ' and ', 'M3'])
  })
  it('takes T0, T01, ST1 and T1a for none', () => {
    expect(refs('T0 and ST1 and T01 and T1a and aT1')).toEqual([])
  })
})

describe('refsIn', () => {
  it('finds marks, builds, and faces and edges of a part, and leaves the text between them whole', () => {
    expect(refs('M4 and lid/F12, r3; tub_2/E10.')).toEqual(['M4', 'lid/F12', 'r3', 'tub_2/E10'])
    expect(refsIn('see M4 now').map((p) => p.text)).toEqual(['see ', 'M4', ' now'])
    expect(refsIn('M4 and lid/F12, r3; tub_2/E10.').map((p) => p.text).join('')).toBe('M4 and lid/F12, r3; tub_2/E10.')
  })

  it('finds a vertex of a part, which a sketch snaps to', () => {
    expect(refs('p0 is block/V88, on block/E3.')).toEqual(['block/V88', 'block/E3'])
    expect(refs('V88 alone, block/V, block/V8x')).toEqual([])
  })

  it('finds a card of the board, and nothing that only ends in one', () => {
    expect(refs('see C7 and M3')).toEqual(['C7', 'M3'])
    expect(refs('C alone, ABC7, C7x, C.')).toEqual([])
  })

  it('finds a face or an edge the model names, without the full stop or comma that ends the sentence', () => {
    expect(refs('the lid/@top and tub/@screw_holes, then lid/@a.b-c. Not lid/@ or @top.')).toEqual(['lid/@top', 'tub/@screw_holes', 'lid/@a.b-c'])
  })

  it('finds a named set, #deck and block/#deck, and never #171, a heading or a colour of one letter', () => {
    expect(refs('see #deck and #171, then block/#deck-face. Not ## Plan or # Plan or C#deck.')).toEqual(['#deck', 'block/#deck-face'])
  })

  it('with names given, finds only those, whatever the case, the longest first', () => {
    expect(refs('see #deck and #171 and #other', ['deck'])).toEqual(['#deck'])
    expect(refs('#deck face and block/#Deck.', ['deck', 'deck face'])).toEqual(['#deck face', 'block/#Deck'])
    expect(refs('## Plan', ['deck'])).toEqual([])
    expect(refs('#decks and #deck-x', ['deck'])).toEqual([])
    expect(refsIn('a #deck.').map((p) => p.text)).toEqual(['a ', '#deck', '.'])
  })

  it('never takes a letter, a bare face number or a decimal for one', () => {
    expect(refs('M alone, F12 alone, 3.5 mm, M4x, version 12, r')).toEqual([])
    expect(refs('a part named lid is not one')).toEqual([])
  })

  it('has no pieces for no text and one for text with no ref', () => {
    expect(refsIn('')).toEqual([])
    expect(refsIn('nothing here')).toEqual([{ text: 'nothing here' }])
  })

  it('finds the same refs however many times it is asked', () => {
    expect(refs('M1 M2')).toEqual(['M1', 'M2'])
    expect(refs('M1 M2')).toEqual(['M1', 'M2'])
  })
})

describe('toolLabel', () => {
  it('names the file of Read, Edit and Write', () => {
    expect(toolLabel('Read', { file_path: 'app.py' })).toBe('Read app.py')
    expect(toolLabel('Edit', { file_path: '/work/obj/lid.py' })).toBe('Edit /work/obj/lid.py')
    expect(toolLabel('Write', { file_path: 'probe.txt', content: 'x' })).toBe('Write probe.txt')
  })

  it('gives the first line of a Bash command, cut when it is long', () => {
    expect(toolLabel('Bash', { command: 'uv run pytest' })).toBe('Bash: uv run pytest')
    expect(toolLabel('Bash', { command: 'a\nb' })).toBe('Bash: a')
    expect(toolLabel('Bash', { command: 'x'.repeat(200) })).toHaveLength('Bash: '.length + 80)
  })

  it('gives the pattern of Grep and Glob and the description of Task', () => {
    expect(toolLabel('Grep', { pattern: 'TODO' })).toBe('Grep: TODO')
    expect(toolLabel('Glob', { pattern: '**/*.py' })).toBe('Glob: **/*.py')
    expect(toolLabel('Task', { description: 'find the lid', prompt: 'long' })).toBe('Task: find the lid')
  })

  it('shows a tool of torno as torno\'s, with the view it was asked for', () => {
    expect(toolLabel('mcp__torno__look', { view: 'iso' })).toBe('torno · look (iso)')
    expect(toolLabel('mcp__torno__scene', {})).toBe('torno · scene')
    expect(toolLabel('mcp__torno__describe', { ref: 'lid/F12' })).toBe('torno · describe (lid/F12)')
  })

  it('is the name for anything else, and for input that is not an object', () => {
    expect(toolLabel('CronList', {})).toBe('CronList')
    expect(toolLabel('Read', null)).toBe('Read')
    expect(toolLabel('Bash', 'ls')).toBe('Bash')
    expect(toolLabel('mcp__other__thing', {})).toBe('mcp__other__thing')
  })
})

describe('pulledFromTorno', () => {
  it('says nothing for nothing', () => {
    expect(pulledFromTorno({})).toBeNull()
  })

  it('lists tools in the order they were pulled, counted past one, and the pictures', () => {
    expect(pulledFromTorno({ look: 1, pictures: 1 })).toBe('Pulled from torno: look, 1 picture')
    expect(pulledFromTorno({ scene: 1, pictures: 2, measure: 3 })).toBe('Pulled from torno: scene, 2 pictures, measure ×3')
  })
})

describe('a path in the chat', () => {
  const where = { dir: '/work/intake', home: '/home/luis' }
  it('is relative to the object folder inside it, with ~ for the home folder elsewhere, as given otherwise', () => {
    expect(shownPath('/work/intake/probe-note.txt', where)).toBe('probe-note.txt')
    expect(shownPath('/work/intake/parts/lid.py', where)).toBe('parts/lid.py')
    expect(shownPath('/work/intake', where)).toBe('.')
    expect(shownPath('/work/intake-2/a.py', where)).toBe('/work/intake-2/a.py')
    expect(shownPath('/home/luis/notes/a.md', where)).toBe('~/notes/a.md')
    expect(shownPath('/home/luis', where)).toBe('~')
    expect(shownPath('/home/luisa/a.md', where)).toBe('/home/luisa/a.md')
    expect(shownPath('/tmp/x', where)).toBe('/tmp/x')
    expect(shownPath('lid.py', where)).toBe('lid.py')
    expect(shownPath('/tmp/x')).toBe('/tmp/x')
  })
  it('is shortened in the label of a file tool and of Grep and Glob, not when nothing is known', () => {
    expect(toolLabel('Write', { file_path: '/work/intake/probe-note.txt' }, where)).toBe('Write probe-note.txt')
    expect(toolLabel('NotebookEdit', { notebook_path: '/home/luis/n.ipynb' }, where)).toBe('NotebookEdit ~/n.ipynb')
    expect(toolLabel('Grep', { pattern: 'TODO', path: '/work/intake/parts' }, where)).toBe('Grep: TODO in parts')
    expect(toolLabel('Glob', { pattern: '*.py', path: '/work/intake' }, where)).toBe('Glob: *.py in .')
    expect(toolLabel('Write', { file_path: '/work/intake/a.txt' })).toBe('Write /work/intake/a.txt')
  })
})

describe('agentChoiceOf', () => {
  it('keeps a model the CLI could be given and an effort it knows', () => {
    expect(agentChoiceOf({ model: 'opus', effort: 'high' })).toEqual({ model: 'opus', effort: 'high' })
    expect(agentChoiceOf({ model: 'claude-opus-5-5[1m]', effort: 'max' })).toEqual({ model: 'claude-opus-5-5[1m]', effort: 'max' })
  })

  it('drops what is not one, and leaves the person\'s default for it', () => {
    expect(agentChoiceOf({ model: '--dangerously-skip-permissions', effort: 'huge' })).toEqual({})
    expect(agentChoiceOf({ model: 'a b', effort: 3 })).toEqual({})
    expect(agentChoiceOf({ model: '' })).toEqual({})
    expect(agentChoiceOf(null)).toEqual({})
    expect(agentChoiceOf('opus')).toEqual({})
  })
})

describe('effortsOf', () => {
  it('is what the model offers, or every level when the CLI did not say', () => {
    const models = [
      { value: 'opus', displayName: 'Opus', efforts: ['low', 'high'] as Effort[] },
      { value: 'haiku', displayName: 'Haiku', efforts: [] }
    ]
    expect(effortsOf(models, 'opus')).toEqual(['low', 'high'])
    expect(effortsOf(models, 'haiku')).toEqual([])
    expect(effortsOf(models, 'claude-fable-5-1')).toEqual(EFFORTS)
    expect(effortsOf(models, undefined)).toEqual(EFFORTS)
  })
})
