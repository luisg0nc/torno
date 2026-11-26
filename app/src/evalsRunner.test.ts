import { describe, expect, it } from 'vitest'
// @ts-expect-error: a plain module of the evals, outside the typed sources
import * as run from '../evals/run.mjs'
import { checkSize } from './shared/size'

// The pure parts of the evals' runner (`app/evals/run.mjs`): nothing here starts an agent, a window or a kernel.

describe('the runner of the evals, without running anything', () => {
  it('answers a question from the case by the first topic it names, or the default', () => {
    const answers = { leg: 'Both legs 120 mm.', hole: '4.5 mm.', default: 'choose' }
    expect(run.answerFor('How long should each LEG be?', answers)).toBe('Both legs 120 mm.')
    expect(run.answerFor('What colour?', answers)).toBe('choose')
    expect(run.answerFor('What colour?', {})).toMatch(/choose, and say what you chose/)
  })

  it('judges a tool check by its number within tol, or a range, and keeps what the tool said of exactness', () => {
    expect(run.judge({ path: 'value', expect: 52, tol: 0.1 }, { value: 52.05, exact: true })).toEqual({ pass: true, value: 52.05, expect: 52, exact: true })
    expect(run.judge({ path: 'value', expect: 52, tol: 0.01 }, { value: 52.05, exact: false }).pass).toBe(false)
    expect(run.judge({ path: 'a.b', min: 1, max: 2 }, { a: { b: 1.5 } }).pass).toBe(true)
    expect(run.judge({ path: 'value', expect: 1 }, { value: 'x' }).pass).toBe(false)
  })

  it('every case is whole: an object, prompts, and checks of known kinds; the smoke case only by name', () => {
    const kinds = ['valid', 'parts', 'solids', 'size', 'ratio', 'volume', 'clearance', 'overlap', 'hole', 'mcp', 'diff', 'asked']
    const cases = run.loadCases([])
    expect(cases.length).toBeGreaterThanOrEqual(12)
    expect(cases.map((c: { id: string }) => c.id)).not.toContain('_smoke')
    for (const c of [...cases, ...run.loadCases(['_smoke'])]) {
      expect(c.object, c.id).toMatch(/^[a-z][a-z0-9-]*$/)
      // A case that starts from the first prompt of a new project (`onboard`) may have no prompt of its own.
      expect(c.prompts.length + (c.onboard ? 1 : 0), c.id).toBeGreaterThan(0)
      expect(c.checks.length, c.id).toBeGreaterThan(1)
      for (const k of c.checks) expect(kinds, `${c.id} ${k.id}`).toContain(k.kind)
    }
  })

  it('starts a case from a draft of a new project whose sizes torno takes as the person\'s, so none is left out of the prompt (#324)', () => {
    const onboarded = run.loadCases([]).filter((c: { onboard?: unknown }) => c.onboard)
    expect(onboarded.map((c: { id: string }) => c.id).sort()).toEqual(['m-nothing-to-ask', 'm-open-mount'])
    for (const c of onboarded) {
      const draft = run.onboardDraft(c.onboard)
      expect(draft.description, c.id).not.toBe('')
      for (const size of draft.sizes) expect(typeof checkSize(size, 'person'), `${c.id} ${JSON.stringify(size)}`).toBe('object')
      expect(c.checks.some((k: { kind: string }) => k.kind === 'asked'), c.id).toBe(true)
    }
  })

  it('judges whether the agent asked before its first write, and about what, or asked nothing', () => {
    const chat = (questions: string[], askedBeforeWrite: boolean | null, cards = 0) => ({ questions, askedBeforeWrite, tools: cards > 0 ? { AskUserQuestion: cards } : {} })
    expect(run.judgeAsked({ expect: true, about: 'mount|wall' }, chat(['Mounting: How is it fixed to the WALL?'], true)).pass).toBe(true)
    expect(run.judgeAsked({ expect: true, about: 'mount|wall' }, chat(['Board: Which board?'], true)).pass).toBe(false)
    // Asked only after the model was written: too late.
    expect(run.judgeAsked({ expect: true }, chat(['Mounting: how?'], false)).pass).toBe(false)
    expect(run.judgeAsked({ expect: false }, chat([], null))).toEqual({ pass: true, value: [], expect: false })
    // An offer after the build is no question about it; a question before it, or a card at all, is.
    expect(run.judgeAsked({ expect: false }, chat(['Want a chamfer on the bore?'], false)).pass).toBe(true)
    expect(run.judgeAsked({ expect: false }, chat(['Which bolt?'], true)).pass).toBe(false)
    expect(run.judgeAsked({ expect: false }, chat(['Bore: which?'], false, 1)).pass).toBe(false)
  })

  it('puts the check pass rate first, the build apart, then cost and time', () => {
    const runs = [
      { case: 'a', passed: 3, total: 4, buildOk: true, costUsd: 0.5, wallMs: 60_000, saidDoneWhileFailing: true },
      { case: 'a', passed: 4, total: 4, buildOk: true, costUsd: 1.5, wallMs: 120_000 }
    ]
    expect(run.summarize(runs)).toEqual([{ case: 'a', runs: 2, checks: '88 %', allPassed: '50 %', build: '100 %', doneWhileFailing: 1, cost: '$1.00', minutes: '1.5', errors: 0 }])
    expect(run.markdown('t', runs)).toMatch(/\| a \| 2 \| 88 % \| 50 % \| 100 % \| 1 \| \$1\.00 \| 1\.5 \| 0 \|/)
  })

  it('counts a dimension of the person\'s only with its verdict on the build the answer is of', () => {
    const answer = (mark: object) => ({ revision: 4, marks: [{ id: 'M2', expected: 3, ...mark }] })
    expect(run.judgeDimension('M2', answer({ value: 3, verdict: 'pass', measuredRevision: 4 }))).toEqual({ pass: true, value: 3, expect: 3, exact: true })
    expect(run.judgeDimension('M2', answer({ value: 2, verdict: 'fail', measuredRevision: 4 })).pass).toBe(false)
    expect(run.judgeDimension('M2', answer({ wasValue: 3, wasRevision: 3 }))).toMatchObject({ pass: false, error: 'not measured on r4' })
    expect(run.judgeDimension('M2', answer({ refused: 'the edge is gone' }))).toMatchObject({ pass: false, error: 'not measured on r4: the edge is gone' })
    expect(run.judgeDimension('M2', answer({ resolvedValue: 3, resolvedVerdict: 'pass', resolvedOnRevision: 4 })).pass).toBe(true)
    expect(run.judgeDimension('M9', answer({})).error).toMatch(/not among/)
    const withDims = run.loadCases(['c-tub-wall'])[0]
    expect(run.caseDimensions(withDims)).toEqual(['M1', 'M2'])
    expect(run.caseDimensions(run.loadCases(['t1-box'])[0])).toEqual([])
  })

  it('holds the last edit to the parts a case lets it change, by diff: counts and place too, and nothing come or gone', () => {
    const answer = (parts: object[], extra = {}) => ({ from: 1, to: 2, layouts: [{ layout: 'assembly', added: [], removed: [], parts, ...extra }] })
    expect(run.judgeDiff({ only: ['tub'] }, answer([{ name: 'tub', changed: true }, { name: 'lid', changed: false }]))).toEqual({ pass: true, value: [], expect: ['tub'], exact: true })
    expect(run.judgeDiff({ only: ['tub'] }, answer([{ name: 'lid', changed: true }])).value).toEqual(['assembly:lid'])
    expect(run.judgeDiff({ only: ['tub'] }, answer([], { added: ['screw'] })).value).toEqual(['assembly:screw'])
    expect(run.judgeDiff({ only: [] }, { layouts: [], notes: ['approximate'] }).exact).toBe(false)
  })
})
