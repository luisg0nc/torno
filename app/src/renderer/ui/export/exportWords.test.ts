import { describe, expect, it } from 'vitest'
import { weightSaid, actionWords, bandWords, fileNameOf, foldWords, marksToReview, tilesOf } from './exportWords'

describe('exportWords', () => {
  it('names the action by what is written', () => {
    expect(actionWords('html', null)).toBe('Export page')
    expect(actionWords('step', null)).toBe('Export STEP')
    expect(actionWords('3mf', null)).toBe('Export 3MF')
    expect(actionWords('stl', null)).toBe('Export STL')
    expect(actionWords('html', 'png')).toBe('Export picture')
    expect(actionWords('html', 'svg')).toBe('Export SVG')
    expect(actionWords('html', 'pdf')).toBe('Export PDF')
  })

  it('says what the band over the view is of', () => {
    expect(bandWords('html', null)).toBe('a page')
    expect(bandWords('step', null)).toBe('a STEP file')
    expect(bandWords('stl', null)).toBe('an STL file')
    expect(bandWords('html', 'png')).toBe('a picture')
    expect(bandWords('html', 'pdf')).toBe('a tracing')
  })

  it('reads the name of a file at the end of its path, whichever the separator', () => {
    expect(fileNameOf('/home/a/b/intake.html')).toBe('intake.html')
    expect(fileNameOf('C:\\a\\b\\intake.step')).toBe('intake.step')
  })

  it('folds the conversation into a line about the session', () => {
    expect(foldWords('idle', 1)).toEqual({ state: 'idle', marks: '1 mark to review' })
    expect(foldWords('working', 3)).toEqual({ state: 'working', marks: '3 marks to review' })
    expect(foldWords('needs_input', 0)).toEqual({ state: 'needs you', marks: null })
    expect(foldWords(undefined, 0)).toEqual({ state: 'no session', marks: null })
  })

  it('says what a line weighs in the unit that suits it', () => {
    expect(weightSaid(0)).toBe('0 B')
    expect(weightSaid(413 * 1024)).toBe('413 KB')
    expect(weightSaid(1.1 * 1024 * 1024)).toBe('1.1 MB')
  })

  it('counts the marks the agent resolved that wait to be seen', () => {
    expect(marksToReview([])).toBe(0)
  })

  it('lays the five tiles out in order, with the formats each one writes', () => {
    expect(tilesOf().map((t) => [t.name, t.formats])).toEqual([
      ['A page', ['HTML']],
      ['CAD', ['STEP']],
      ['Slicer', ['3MF', 'STL']],
      ['Picture', ['PNG']],
      ['Tracing', ['SVG', 'PDF']]
    ])
  })
})
