import { describe, expect, it } from 'vitest'
import { nameOf, openProblem } from './openFolder'

describe('the first screen', () => {
  it('names a folder by its last part, trailing separators and all', () => {
    expect(nameOf('/home/a/objects/')).toBe('objects')
    expect(nameOf('C:\\parts')).toBe('parts')
    expect(nameOf('/')).toBe('/')
  })
  it('says why a folder could not be opened without the IPC wrapping', () => {
    expect(openProblem('The example', new Error("Error invoking remote method 'workspace:open': Error: gone"))).toBe('The example could not be opened: gone')
    expect(openProblem('parts', 'no')).toBe('parts could not be opened: no')
  })
})
