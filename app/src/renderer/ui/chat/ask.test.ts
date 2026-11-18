import { expect, it } from 'vitest'
import { answerFor, describeInput, openRequest, questionsOf } from './ask'

it('shows a command as the command, and a file as its path and a few lines of what goes in it', () => {
  expect(describeInput('Bash', { command: 'ls -la\ncat x' })).toEqual({ lead: undefined, body: 'ls -la\ncat x', more: 0 })
  const content = Array.from({ length: 10 }, (_, n) => `line ${n + 1}`).join('\n')
  expect(describeInput('Write', { file_path: 'a/b.py', content })).toEqual({ lead: 'a/b.py', body: 'line 1\nline 2\nline 3\nline 4\nline 5\nline 6', more: 4 })
  // Every line, when asked for.
  expect(describeInput('Write', { file_path: 'a/b.py', content }, true)).toEqual({ lead: 'a/b.py', body: content, more: 0 })
  // An edit with nothing to compare is the new text, as a file is.
  expect(describeInput('Edit', { file_path: 'a.py', new_string: 'y\nz' })).toEqual({ lead: 'a.py', body: 'y\nz', more: 0 })
  expect(describeInput('Write', { file_path: 'empty.txt', content: '' })).toEqual({ lead: 'empty.txt', body: '', more: 0 })
})

it('shows any other input as compact JSON, cut when long, and survives what is not an object', () => {
  expect(describeInput('mcp__torno__look', { view: 'iso' })).toEqual({ lead: undefined, body: '{"view":"iso"}', more: 0 })
  expect(describeInput('Task', { description: 'x'.repeat(2000) }).body.length).toBeLessThan(700)
  expect(describeInput('Bash', null)).toEqual({ lead: undefined, body: '', more: 0 })
  expect(describeInput('Bash', 'ls')).toEqual({ lead: undefined, body: '"ls"', more: 0 })
  expect(describeInput('Write', { file_path: 3 }).lead).toBeUndefined()
})

it('reads the questions of AskUserQuestion, leaving out what is not one', () => {
  const input = {
    questions: [
      { question: 'Which wall?', header: 'Wall', multiSelect: false, options: [{ label: '2 mm', description: 'thin' }, { label: '3 mm' }, { nope: 1 }] },
      { question: 'Finish?', multiSelect: true, options: [{ label: 'Matte', description: '' }] },
      { header: 'no question text', options: [] },
      'junk'
    ]
  }
  expect(questionsOf(input)).toEqual([
    { question: 'Which wall?', header: 'Wall', multi: false, options: [{ label: '2 mm', description: 'thin' }, { label: '3 mm', description: '' }] },
    { question: 'Finish?', header: '', multi: true, options: [{ label: 'Matte', description: '' }] }
  ])
  expect(questionsOf(undefined)).toEqual([])
  expect(questionsOf({ questions: 'x' })).toEqual([])
})

it('answers a question with what was typed in its Other line, else the labels chosen, in the order of the options', () => {
  const q = { question: 'Finish?', header: '', multi: true, options: [{ label: 'Matte', description: '' }, { label: 'Gloss', description: '' }, { label: 'Brushed', description: '' }] }
  expect(answerFor(q, [], '')).toBeUndefined()
  expect(answerFor(q, ['Gloss', 'Matte'], '')).toBe('Matte, Gloss')
  expect(answerFor(q, ['Matte'], '  none of these ')).toBe('none of these')
  expect(answerFor(q, [], '   ')).toBeUndefined()
  expect(answerFor({ ...q, multi: false }, ['Gloss'], '')).toBe('Gloss')
})

it('shows a file path on a card relative to the object folder, with the full path kept', () => {
  const shown = describeInput('Write', { file_path: '/w/obj/parts/lid.py', content: 'x' }, false, { dir: '/w/obj' })
  expect(shown.lead).toBe('parts/lid.py')
  expect(shown.full).toBe('/w/obj/parts/lid.py')
})

it('shows an Edit as the lines removed and added, a MultiEdit as one block for each edit, and a Write as what it will hold', () => {
  const edit = describeInput('Edit', { file_path: '/w/obj/m.py', old_string: 'WALL = 2', new_string: 'WALL = 3' }, false, { dir: '/w/obj' })
  expect(edit).toEqual({ lead: 'm.py', full: '/w/obj/m.py', body: '', more: 0, hunks: [{ rows: [{ kind: 'removed', text: 'WALL = 2' }, { kind: 'added', text: 'WALL = 3' }] }] })

  const multi = describeInput('MultiEdit', { file_path: 'm.py', edits: [{ old_string: 'WALL = 2', new_string: 'WALL = 3' }, { old_string: 'LID = 1', new_string: 'LID = 2' }] })
  expect(multi.lead).toBe('m.py')
  expect(multi.body).toBe('')
  expect(multi.hunks?.map((h) => h.title)).toEqual(['Edit 1 of 2', 'Edit 2 of 2'])
  expect(multi.hunks?.[1].rows).toEqual([{ kind: 'removed', text: 'LID = 1' }, { kind: 'added', text: 'LID = 2' }])

  // Six lines removed and added at first; the rest with `all`.
  const edits = [{ old_string: '1\n2\n3\n4\n5', new_string: 'a\nb\nc\nd\ne' }]
  const cut = describeInput('MultiEdit', { file_path: 'm.py', edits })
  expect(cut.more).toBe(4)
  expect(cut.hunks?.[0].rows).toHaveLength(6)
  expect(describeInput('MultiEdit', { file_path: 'm.py', edits }, true)).toMatchObject({ more: 0, hunks: [{ rows: expect.arrayContaining([{ kind: 'added', text: 'e' }]) }] })

  // An edit with replace_all changes every match in the file: the card says so.
  expect(describeInput('Edit', { file_path: 'm.py', old_string: 'a', new_string: 'b', replace_all: true }).hunks?.[0].everywhere).toBe(true)
  expect(describeInput('Edit', { file_path: 'm.py', old_string: 'a', new_string: 'b' }).hunks?.[0].everywhere).toBeUndefined()

  // A Write has no old text to compare with: it stays the first lines of what it holds.
  expect(describeInput('Write', { file_path: 'm.py', content: 'WALL = 3' })).toEqual({ lead: 'm.py', body: 'WALL = 3', more: 0 })
  expect(describeInput('Write', { file_path: 'm.py', content: 'WALL = 3' }).hunks).toBeUndefined()
})

it('takes the last request still open for the foot, whatever it asks, and none once all are answered', () => {
  const ask = (requestId: string, state: 'open' | 'allowed') => ({ kind: 'ask', id: `a${requestId}`, requestId, toolName: 'Bash', input: {}, state }) as never
  expect(openRequest([ask('1', 'open'), ask('2', 'allowed'), ask('3', 'open')])).toMatchObject({ requestId: '3' })
  expect(openRequest([ask('1', 'allowed')])).toBeUndefined()
  expect(openRequest([])).toBeUndefined()
})
