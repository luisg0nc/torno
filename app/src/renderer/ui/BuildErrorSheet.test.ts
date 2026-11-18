import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { BuildError, BuildState } from '../../shared/build'
import { probe } from '../../test/diagnosisFixtures'
import { plainText } from '../../test/plainText'
import { chatStore } from '../state/chat'
import { store } from '../state/store'
import { BuildErrorSheet, askLabel, errorTail, errorText, failedTitle, toldLine } from './BuildErrorSheet'

describe('errorTail', () => {
  it('is the last lines of the traceback, with the message before them when they do not hold it', () => {
    const traceback = ['Traceback (most recent call last):', '  File "a.py", line 1', '    x', '  File "b.py", line 2', '    y', '  File "c.py", line 3', '    z', 'NameError: WAL'].join('\n')
    expect(errorTail({ kind: 'exception', message: 'NameError: WAL', traceback }).split('\n')).toEqual(['  File "a.py", line 1', '    x', '  File "b.py", line 2', '    y', '  File "c.py", line 3', '    z', 'NameError: WAL'].slice(-6))
  })

  it('is the message when there is no traceback', () => {
    expect(errorTail({ kind: 'no_model', message: 'no model file in /ws/empty' })).toBe('no model file in /ws/empty')
  })

  it('puts the message first when the tail does not say it', () => {
    expect(errorTail({ kind: 'exception', message: 'fillet failed', traceback: 'a\nb\nc' }, 2)).toBe('fillet failed\nb\nc')
  })
})

describe('errorText', () => {
  it('is the message, the traceback and the output, a blank line apart', () => {
    const text = errorText({ kind: 'exception', message: 'boom', traceback: 'Traceback\n  File "a.py"\n', output: 'printed\n' })
    expect(text).toBe('boom\n\nTraceback\n  File "a.py"\n\nprinted')
  })

  it('leaves out what the kernel did not send', () => {
    expect(errorText({ kind: 'no_model', message: 'no model file in /ws/empty' })).toBe('no model file in /ws/empty')
    expect(errorText({ kind: 'crash', message: 'kernel stopped', traceback: '', output: '  \n' })).toBe('kernel stopped')
  })

  it('holds why a fillet failed after the message', () => {
    const text = errorText({ kind: 'exception', message: 'ValueError: fillet', traceback: 'Traceback', diagnosis: probe() })
    expect(text.startsWith('ValueError: fillet\n\nWhy: fillet R6 of 8 edges: each works alone;')).toBe(true)
    expect(text.endsWith('(6, 6, -2.5) to (6, 6, 2.5)\n\nTraceback')).toBe(true)
  })
})

describe('what the sheet says of who is told, and offers', () => {
  const NAME_ERROR: BuildError = { kind: 'exception', message: "name 'WAL' is not defined", traceback: 'Traceback\nNameError: name \'WAL\' is not defined\n' }
  const failed = (error: BuildError, revision = 2, more: Partial<BuildState> = {}): BuildState => ({ objectId: 'bracket', status: 'failed', revision, stale: true, error, ...more })
  const session = { sessionId: 's1', status: 'idle' as const, view: 'chat' as const }
  const edit = { kind: 'context' as const, id: 's1-i3', forUser: 's1-i2', forTool: true as const, text: '', marks: [], revision: 2, buildState: 'failed' as const, error: "NameError: name 'WAL' is not defined" }
  const chatWith = (...items: unknown[]) => chatStore.setState({ sessions: { s1: { items, earlier: [], meta: {}, commands: [], models: [], seq: 1, loading: false, told: [] } } as never })
  // A static render reads the first state of each store (zustand's server snapshot): they are made the state there is now.
  function sheet(error = NAME_ERROR, more: { after?: string; old?: boolean } = {}): string {
    const now = vi.spyOn(store, 'getInitialState').mockReturnValue(store.getState())
    const chat = vi.spyOn(chatStore, 'getInitialState').mockReturnValue(chatStore.getState())
    try {
      return renderToStaticMarkup(createElement(BuildErrorSheet, { objectName: 'bracket', error, ...more, onClose: () => {} }))
    } finally {
      now.mockRestore()
      chat.mockRestore()
    }
  }
  const text = (html: string): string => plainText(html).replaceAll('&#x27;', "'")
  const button = (html: string, name: string): string => new RegExp(`<button[^>]*>${name}</button>`).exec(html)?.[0] ?? ''

  afterEach(() => {
    store.setState({ build: null, objectId: null, sessions: {}, errorOpen: false })
    chatStore.setState({ sessions: {} })
  })

  it('says in words that Claude Code is told, so that the error need not be pasted into the chat', () => {
    expect(toldLine('prompt')).toBe('Claude Code is told this with your next prompt.')
    expect(toldLine('edit')).toBe('Claude Code was told after its edit, and your next prompt carries it too.')
    expect(toldLine('none')).toBe('No session is running. Start one, and it is told with your first prompt.')
    expect([askLabel('prompt'), askLabel('edit'), askLabel('none')]).toEqual(['Ask Claude Code to fix it', 'Ask Claude Code to fix it', 'Start a session to fix it'])
  })

  it('tells of a failure with a session running as told with the next prompt, and offers to ask for the fix as the one primary button', () => {
    store.setState({ objectId: 'bracket', build: failed(NAME_ERROR), sessions: { bracket: session } })
    chatWith()
    const out = sheet()
    expect(text(out)).toContain('Claude Code is told this with your next prompt.')
    expect(button(out, 'Ask Claude Code to fix it')).toContain('button-primary')
    expect(button(out, 'Copy')).toContain('button-quiet')
    // After an error in the model building it again gives the same error: no Rebuild is offered here.
    expect(out).not.toContain('Rebuild')
  })

  it('tells of a failure the session met in its own edit as told after it', () => {
    store.setState({ objectId: 'bracket', build: failed(NAME_ERROR), sessions: { bracket: session } })
    chatWith(edit)
    expect(text(sheet())).toContain('Claude Code was told after its edit')
    // An edit whose build is not this failure is not it.
    chatWith({ ...edit, error: 'TypeError: y' })
    expect(text(sheet())).toContain('Claude Code is told this with your next prompt.')
  })

  it('offers to start a session when none runs, or the one there was has ended', () => {
    store.setState({ objectId: 'bracket', build: failed(NAME_ERROR), sessions: {} })
    expect(text(sheet())).toContain('No session is running.')
    expect(button(sheet(), 'Start a session to fix it')).toContain('button-primary')
    store.setState({ sessions: { bracket: { ...session, status: 'exited' } } })
    expect(button(sheet(), 'Start a session to fix it')).not.toBe('')
  })

  it('names the build the failure came after, by its id in the history, and says the kind in words (not the kernel word)', () => {
    store.setState({ objectId: 'bracket', build: failed(NAME_ERROR, 2), sessions: {} })
    const out = sheet(NAME_ERROR, { after: 'h40' })
    expect(text(out)).toContain('The build after h40 failed')
    expect(text(out)).toContain('Python error in the model')
    expect(text(out)).not.toMatch(/\bexception\b/)
    expect(text(sheet(NAME_ERROR))).toContain('The first build failed')
    expect(failedTitle('h40')).toBe('The build after h40 failed')
  })

  it('shows the tail of the error with Copy, Whole error and the ask, and the whole of it only once asked for', () => {
    store.setState({ objectId: 'bracket', build: failed(NAME_ERROR), sessions: { bracket: session } })
    const out = sheet()
    expect(out).toContain('data-part="tail"')
    expect(out).toContain('aria-label="Build error"')
    expect(button(out, 'Whole error')).toContain('aria-expanded="false"')
    expect(button(out, 'Copy')).not.toBe('')
    expect(out).not.toContain('data-part="traceback"')
  })

  it('has for a failure that is not the build on show only its line and Copy: nobody is told, nothing to ask', () => {
    store.setState({ objectId: 'bracket', build: failed(NAME_ERROR), sessions: { bracket: session } })
    const out = sheet({ kind: 'exception', message: 'NameError: x' }, { after: 'h38', old: true })
    expect(text(out)).toContain('The build after h38 failed')
    expect(text(out)).toContain('NameError: x')
    expect(out).not.toContain('data-part="told"')
    expect(out).not.toContain('Ask Claude Code to fix it')
    expect(out).not.toContain('Whole error')
    expect(button(out, 'Copy')).not.toBe('')
  })

  it('makes Rebuild the primary button after a failure outside the model, and the ask quiet', () => {
    for (const [kind, words] of [['crash', 'The build process stopped (crash)'], ['timeout', 'The build took too long (timeout)'], ['cancelled', 'The build was cancelled']] as const) {
      const error = { kind, message: 'it ended' }
      store.setState({ objectId: 'bracket', build: failed(error), sessions: { bracket: session } })
      const out = sheet(error)
      expect(text(out)).toContain(words)
      expect(button(out, 'Rebuild')).toContain('button-primary')
      expect(button(out, 'Ask Claude Code to fix it')).not.toContain('button-primary')
    }
  })
})
