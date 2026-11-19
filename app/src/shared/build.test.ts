import { describe, expect, it } from 'vitest'
import { ERROR_LINE, buildingText, clockText, errorLine, failedAfter, kindWords, fixPrompt, picksWait, rebuildHelps } from './build'

describe('the line of a failed build the chat shows', () => {
  it('is the last line of the traceback, which names the kind of error', () => {
    expect(errorLine({ message: "name 'WAL' is not defined", traceback: 'Traceback (most recent call last):\n  File "part.py", line 3, in assembly\nNameError: name \'WAL\' is not defined\n\n' })).toBe("NameError: name 'WAL' is not defined")
  })

  it('is the last line of the message where there is no traceback, and is nothing where there is neither', () => {
    expect(errorLine({ message: 'the model has no scene\nsay assembly(p)' })).toBe('say assembly(p)')
    expect(errorLine({ message: 'timed out after 600 s', traceback: '' })).toBe('timed out after 600 s')
    expect(errorLine({ message: '' })).toBe('')
  })

  it('is cut to what a line holds', () => {
    const line = errorLine({ message: 'x'.repeat(ERROR_LINE * 2) })
    expect(line).toHaveLength(ERROR_LINE)
    expect(line.endsWith('…')).toBe(true)
  })
})

describe('how a failed build is named', () => {
  it('is the build after the last one that worked, since a revision names a build that worked; the first build when none has', () => {
    expect(failedAfter(2)).toBe('build after r2')
    expect(failedAfter(0)).toBe('first build')
  })
})

describe('a failed build said in words', () => {
  it('names each kind of failure as what happened, not as the kernel names it', () => {
    expect(kindWords('exception')).toBe('Python error in the model')
    expect(kindWords('timeout')).toBe('The build took too long (timeout)')
    expect(kindWords('crash')).toBe('The build process stopped (crash)')
    expect(kindWords('cancelled')).toBe('The build was cancelled')
    expect(kindWords('no_model')).toBe('The folder has no model file')
    // A kind that is none of these is still said, with its own word as the kernel has it.
    expect(kindWords('odd')).toBe('The build failed (odd)')
    expect(kindWords(undefined)).toBe('The build failed')
  })

  it('has Rebuild primary only after a failure outside the model: a crash, a timeout, a cancel, or a build let go for memory with nothing failed since', () => {
    const failed = (kind: string, letGo?: 'memory') => ({ status: 'failed' as const, error: { kind, message: 'x' }, ...(letGo ? { letGo } : {}) })
    expect(rebuildHelps(failed('crash'))).toBe(true)
    expect(rebuildHelps(failed('timeout'))).toBe(true)
    expect(rebuildHelps(failed('cancelled'))).toBe(true)
    // The last build was let go, but this one failed in the model: building it again gives the same error.
    expect(rebuildHelps(failed('exception', 'memory'))).toBe(false)
    expect(rebuildHelps(failed('crash', 'memory'))).toBe(true)
    // The same sources give the same error again.
    expect(rebuildHelps(failed('exception'))).toBe(false)
    expect(rebuildHelps(failed('no_model'))).toBe(false)
    // A build that worked, and one let go with none of its own failed, are built again by the button.
    expect(rebuildHelps({ status: 'ok' })).toBe(false)
    expect(rebuildHelps({ status: 'ok', letGo: 'memory' })).toBe(true)
    expect(rebuildHelps({ status: 'failed' })).toBe(false)
  })

  it('writes the prompt the sheet hands over, which asks for the fix and holds no error: Claude Code has it already', () => {
    expect(fixPrompt('bracket')).toBe('Fix the build of bracket: see the error.')
  })
})

describe('the parts of the last good build while the next one builds', () => {
  it('stay usable: a build under way or a failed one waits for nothing', () => {
    expect(picksWait({ status: 'building' })).toBeNull()
    expect(picksWait({ status: 'failed' })).toBeNull()
    expect(picksWait({ status: 'ok' })).toBeNull()
    expect(picksWait(null)).toBeNull()
  })
  it('wait only when the kernel let the build go, since nothing can then be asked of it', () => {
    expect(picksWait({ status: 'building', letGo: 'memory' })).toMatch(/let this build go/)
    expect(picksWait({ status: 'failed', letGo: 'memory' })).toMatch(/let this build go/)
  })
})

describe('the clock of a build', () => {
  it('counts minutes and seconds', () => {
    expect(clockText(0)).toBe('0:00')
    expect(clockText(5)).toBe('0:05')
    expect(clockText(100)).toBe('1:40')
    expect(clockText(3725)).toBe('62:05')
  })
})

describe('the status line while a build runs', () => {
  it('names the build running, its clock and the build shown', () => {
    expect(buildingText(12, 100)).toEqual({ running: 'r13', clock: '1:40', shown: 'r12' })
  })
  it('names no build shown before the first one has landed', () => {
    expect(buildingText(0, 5)).toEqual({ running: null, clock: '0:05', shown: null })
  })
})
