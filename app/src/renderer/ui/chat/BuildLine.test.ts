import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ChatItem } from '../../../shared/chat'
import type { Mark as Marks } from '../../../shared/marks'
import type { BuildDigest } from '../../../shared/sanity'
import { reviewStore } from '../../state/review'
import { store } from '../../state/store'
import type { HistoryList } from '../../../shared/history'
import { BuildLine, stillLatest, verdictWord } from './BuildLine'
import { plainText } from '../../../test/plainText'

type Context = Extract<ChatItem, { kind: 'context' }>
const context = (more: Partial<Context> = {}): Context => ({ kind: 'context', id: 'i3', forUser: 'i2', forTool: true, text: 'THE WHOLE TEXT THE AGENT WAS GIVEN', marks: [], ...more })
const digest = (more: Partial<BuildDigest> = {}): BuildDigest => ({ revision: 2, since: 1, changed: true, parts: [], unchanged: 0, flags: [], dimensions: [], ...more })
const part = (name: string, before: number, after: number, exact = true) =>
  ({ name, layout: 'assembly', text: `${name}: volume ${before} → ${after} mm³`, volume: { before, after, exact, change: after - before, percent: ((after - before) / before) * 100 }, size: { before: [1, 1, 1], after: [1, 1, 1], exact }, faces: { before: 14, after: 14 }, edges: { before: 30, after: 30 } }) as BuildDigest['parts'][number]
/** The history of the project: r1 is h40 and r2 is h41, of this run. */
const history = { run: 'run', base: '/p/.torno/history', ghosts: [], entries: [1, 2].map((revision) => ({ id: `h${39 + revision}`, run: 'run', revision })) } as unknown as HistoryList

// A static render reads the store's first state (zustand's server snapshot): it is made the state there is now.
function drawn(item: Context, history?: HistoryList): string {
  const now = vi.spyOn(store, 'getInitialState').mockReturnValue(store.getState())
  try {
    return renderToStaticMarkup(createElement(BuildLine, { item, history }))
  } finally {
    now.mockRestore()
  }
}
const text = (html: string): string => plainText(html).replaceAll('&#x27;', "'")

afterEach(() => store.setState({ build: null, errorOpen: false, marks: [] }))

describe('the build line under an edit', () => {
  it('says a build that worked as a build, with its id and how long it took, and not as what torno added', () => {
    const out = drawn(context({ revision: 2, buildState: 'ok', seconds: 1.234 }))
    expect(text(out)).toContain('Built r2 ok 1.2 s')
    expect(text(out)).not.toContain('torno added')
    expect(out).toContain('Show text')
    // The text the agent was given is behind "Show text", not drawn.
    expect(out).not.toContain('THE WHOLE TEXT')
    // With the history, the build is told as the person knows it.
    const named = drawn(context({ revision: 2, buildState: 'ok', seconds: 51 }), history)
    expect(text(named)).toContain('Built h41 ok 51 s')
    expect(named).toContain('data-ref="r2"')
  })

  it('names a failed build as the build after the last one that worked, with the last line of its error apart; it has no revision of its own', () => {
    const out = drawn(context({ revision: 2, buildState: 'failed', error: "NameError: name 'WAL' is not defined" }), history)
    expect(text(out)).toContain('The build after h41 failed')
    expect(out).toContain('data-verdict="failed"')
    expect(out).toContain('data-ref="r2"')
    expect(out).toMatch(/<p class="chat-build-error[^"]*"[^>]*>NameError: name &#x27;WAL&#x27; is not defined<\/p>/)
    expect(text(out)).not.toContain('r3')
    // None has worked: there is no build to name.
    const first = text(drawn(context({ buildState: 'failed', error: 'SyntaxError: x' })))
    expect(first).toContain('The first build failed')
    expect(first).toContain('SyntaxError: x')
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

  it('shows the dimension the build flipped on a row of its own, with its chip, its values and the word', () => {
    const dimension = { id: 'M3', kind: 'dimension', measure: 'thickness', note: 'tub wall', history: [{ revision: 1, value: 2.8 }, { revision: 2, value: 3 }] } as unknown as Marks
    store.setState({ marks: [dimension] })
    const out = drawn(context({ revision: 2, buildState: 'ok', digest: digest({ since: 1, dimensions: [{ id: 'M3', was: 'fail', now: 'pass' }, { id: 'M2', was: 'pass', now: 'fail' }, { id: 'M5', was: 'pass', now: 'none' }] }) }))
    expect(text(out)).toContain('M3 tub wall 2.8 → 3 mm now passes')
    expect(text(out)).toContain('M2 now fails')
    expect(text(out)).toContain('M5 is no longer measured')
    expect(out).toContain('data-ref="M3"')
    expect(out).toContain('data-verdict="ok"')
    expect([verdictWord('pass'), verdictWord('fail'), verdictWord('none')]).toEqual(['now passes', 'now fails', 'is no longer measured'])
  })

  it('shows the parts the build changed as a table: a head row of the build before and this one, the cells in the face of numbers', () => {
    const parts = [part('tub', 28400, 30190), part('lid', 12000, 12480)]
    const out = drawn(context({ revision: 2, buildState: 'ok', digest: digest({ since: 1, parts, unchanged: 5 }) }), history)
    const head = /<thead>(.*?)<\/thead>/.exec(out)?.[1] ?? ''
    expect(text(head)).toBe('Volume, mm³h40h41change')
    const body = /<tbody>(.*?)<\/tbody>/.exec(out)?.[1] ?? ''
    expect(body.match(/<tr/g)).toHaveLength(2)
    const first = /<tr[^>]*>(.*?)<\/tr>/.exec(body)?.[1] ?? ''
    expect(text(first)).toBe('tub2840030190+6.3 %')
    expect([...first.matchAll(/<td[^>]*class="[^"]*\bnum\b/g)]).toHaveLength(3)
    expect(text(out)).toContain('5 parts did not change')
    expect(out).not.toContain('more changed')
  })

  it('keeps the ≈ of a volume that is not exact', () => {
    const out = text(drawn(context({ revision: 2, buildState: 'ok', digest: digest({ parts: [part('tub', 28400, 25560, false)] }) })))
    expect(out).toContain('≈ 28400')
    expect(out).toContain('≈ 25560')
    expect(out).toContain('≈ -10 %')
  })

  it('shows six parts at most, and counts the rest in a button that unfolds them', () => {
    const parts = Array.from({ length: 8 }, (_, n) => part(`p${n}`, 1000, 1000 + (n + 1) * 10))
    const out = drawn(context({ revision: 2, buildState: 'ok', digest: digest({ parts }) }))
    expect((/<tbody>(.*?)<\/tbody>/.exec(out)?.[1] ?? '').match(/<tr/g)).toHaveLength(6)
    expect(text(out)).toContain('2 more changed')
    expect(out).toContain('<button')
  })

  it('has nothing to add for a build that changed nothing', () => {
    const out = drawn(context({ revision: 2, buildState: 'ok', digest: digest({ changed: false, unchanged: 2 }) }))
    expect(out).not.toContain('<table')
    expect(out).not.toContain('chat-build-dimensions')
  })
})
