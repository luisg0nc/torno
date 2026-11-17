import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ChatItem } from '../../../shared/chat'
import type { BuildDigest } from '../../../shared/sanity'
import { reviewStore } from '../../state/review'
import { store } from '../../state/store'
import { BuildLine, MOST_PARTS, stillLatest, verdictWord } from './BuildLine'
import { plainText } from '../../../test/plainText'

type Context = Extract<ChatItem, { kind: 'context' }>
const context = (more: Partial<Context> = {}): Context => ({ kind: 'context', id: 'i3', forUser: 'i2', forTool: true, text: 'THE WHOLE TEXT THE AGENT WAS GIVEN', marks: [], ...more })
const digest = (more: Partial<BuildDigest> = {}): BuildDigest => ({ revision: 2, since: 1, changed: true, parts: [], unchanged: 0, flags: [], dimensions: [], ...more })
const part = (name: string, text: string) => ({ name, layout: 'assembly', text }) as BuildDigest['parts'][number]

// A static render reads the store's first state (zustand's server snapshot): it is made the state there is now.
function drawn(item: Context): string {
  const now = vi.spyOn(store, 'getInitialState').mockReturnValue(store.getState())
  try {
    return renderToStaticMarkup(createElement(BuildLine, { item }))
  } finally {
    now.mockRestore()
  }
}
const text = (html: string): string => plainText(html).replaceAll('&#x27;', "'")

afterEach(() => store.setState({ build: null, errorOpen: false, marks: [] }))

describe('the build line under an edit', () => {
  it('says a build that worked as a build, with its revision and how long it took, and not as what torno added', () => {
    const out = drawn(context({ revision: 2, buildState: 'ok', seconds: 1.234 }))
    expect(text(out)).toContain('Built r2 · ok · 1.2 s')
    expect(text(out)).not.toContain('torno added')
    expect(out).toContain('Show text')
    // The text the agent was given is behind "Show text", not drawn.
    expect(out).not.toContain('THE WHOLE TEXT')
  })

  it('names the failure of a build as the build after the last one that worked, which has the revision; a failure has none of its own', () => {
    const out = drawn(context({ revision: 2, buildState: 'failed', error: "NameError: name 'WAL' is not defined" }))
    expect(text(out)).toContain("Build after r2 failed: NameError: name 'WAL' is not defined")
    expect(text(out)).not.toContain('r3')
    expect(out).toContain('data-verdict="failed"')
    expect(out).toContain('data-ref="r2"')
    // None has worked: there is no revision to name.
    const first = text(drawn(context({ buildState: 'failed', error: 'SyntaxError: x' })))
    expect(first).toContain('First build failed: SyntaxError: x')
    expect(first).not.toMatch(/r\d/)
  })

  it('offers "Review this build" on the build that is still the latest, and on no other, nor while a round is open', () => {
    const item = context({ revision: 2, buildState: 'ok', seconds: 1 })
    expect(drawn(item)).not.toContain('Review this build')
    store.setState({ build: { objectId: 'a', status: 'ok', revision: 2, stale: false } })
    expect(drawn(item)).toContain('Review this build')
    store.setState({ build: { objectId: 'a', status: 'ok', revision: 3, stale: false } })
    expect(drawn(item)).not.toContain('Review this build')
    store.setState({ build: { objectId: 'a', status: 'ok', revision: 2, stale: false } })
    const open = vi.spyOn(reviewStore, 'getInitialState').mockReturnValue({ ...reviewStore.getState(), rounds: [{ id: 'R1', build: 'h41', sources: 'abc', line: '', layout: 'default', startedAt: 't' }] })
    try {
      expect(drawn(item)).not.toContain('Review this build')
    } finally {
      open.mockRestore()
    }
    expect(drawn(context({ revision: 2, buildState: 'failed', error: 'x' }))).not.toContain('Review this build')
  })

  it('offers "Show error" only while that failure is the latest build', () => {
    const item = context({ revision: 2, buildState: 'failed', error: 'NameError: x' })
    expect(drawn(item)).not.toContain('Show error')
    store.setState({ build: { objectId: 'a', status: 'failed', revision: 2, stale: true, error: { kind: 'exception', message: 'x', traceback: 'File "a.py"\nNameError: x\n' } } })
    expect(drawn(item)).toContain('Show error')
    // Another failure since, or a build that worked after it: the sheet would show another build.
    store.setState({ build: { objectId: 'a', status: 'failed', revision: 2, stale: true, error: { kind: 'exception', message: 'y', traceback: 'TypeError: y' } } })
    expect(drawn(item)).not.toContain('Show error')
    store.setState({ build: { objectId: 'a', status: 'ok', revision: 3, stale: false } })
    expect(drawn(item)).not.toContain('Show error')
    expect(stillLatest(null, item)).toBe(false)
  })

  it('says a build still running when the edit was answered as that, in the past, with no revision', () => {
    expect(text(drawn(context({ buildState: 'building' })))).toContain('Still building when Claude Code was answered')
  })

  it('shows the dimensions whose verdict the build changed, each as a chip with the word', () => {
    const out = drawn(context({ revision: 2, buildState: 'ok', digest: digest({ dimensions: [{ id: 'M3', was: 'fail', now: 'pass' }, { id: 'M2', was: 'pass', now: 'fail' }, { id: 'M5', was: 'pass', now: 'none' }] }) }))
    expect(text(out)).toContain('M3 now passes')
    expect(text(out)).toContain('M2 now fails')
    expect(text(out)).toContain('M5 is no longer measured')
    expect(out).toContain('data-ref="M3"')
    expect([verdictWord('pass'), verdictWord('fail'), verdictWord('none')]).toEqual(['now passes', 'now fails', 'is no longer measured'])
  })

  it('shows the parts the build changed as the kernel said them, a few, then how many more', () => {
    const parts = ['tub', 'lid', 'cap', 'clip', 'pin', 'peg'].map((name) => part(name, `${name}: volume ≈ 100 → 90 mm³ (-10, -10 %)`))
    const out = text(drawn(context({ revision: 2, buildState: 'ok', digest: digest({ parts }) })))
    for (const name of parts.slice(0, MOST_PARTS)) expect(out).toContain(name.text)
    expect(out).not.toContain('pin:')
    expect(out).toContain(`${parts.length - MOST_PARTS} more changed`)
    expect(out).toContain('≈ 100')
  })

  it('has nothing to add for a build that changed nothing', () => {
    const out = drawn(context({ revision: 2, buildState: 'ok', digest: digest({ changed: false, unchanged: 2 }) }))
    expect(out).not.toContain('chat-build-parts')
    expect(out).not.toContain('chat-build-dimensions')
  })
})
