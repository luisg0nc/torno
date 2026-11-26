#!/usr/bin/env node
// `pnpm -C app eval`: prompts to parts with the real Claude Code, scored by checks on the B-rep (issue #121).
//
// It spends the person's subscription, so it is no test: no suite picks it up, and it refuses to start without
// TORNO_EVAL=1, under CI, and until the phrase is typed (`guard.mjs`). The person runs it by hand, after `pnpm build`:
//
//   TORNO_EVAL=1 pnpm -C app eval [--case <id>]… [--repeats 5] [--label <name>] [--model sonnet] [--budget 2]
//                                 [--ablate skills,reviewer,stop,look,digest] [--look-size 768] [--holds 1]
//                                 (what main takes away or sets: `src/main/ablations.ts`)
//   pnpm -C app eval --compare <a.jsonl> <b.jsonl>        (two reports side by side; runs nothing)
//
// A run, for each case and repeat: the case is copied to a new temporary folder (never a person's workspace), the
// built app is started on it hidden (TORNO_TEST=1), a chat session is started on the case's project, its prompts are
// sent through the chat box (a case with `onboard`, a draft of the page of a new project, is first sent the prompt
// torno would make of it, as `objects.previewPrompt` writes it), permission cards and AskUserQuestion cards are answered from the case, a plain question
// is answered from `answers` while turns are left, and then the project is scored: `score.py` on the last state of
// the model folder, and each `mcp` check through the project's MCP address. One JSON line per run goes to
// `evals/out/<date>-<sha>-<label>.jsonl` (ignored by git) and a Markdown summary beside it.
//
// The agent is `claude --model <model> --max-budget-usd <budget> --permission-mode acceptEdits`, wrapped by `tee.mjs`,
// which keeps the CLI's `result` messages (cost, tokens, turns, time). TORNO_EVAL_AGENT replaces the command: the
// runner's smoke test uses the stand-in, `TORNO_EVAL_AGENT="node app/test/fake-agent.mjs"`, which spends nothing.
import { execFileSync, spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { createInterface } from 'node:readline/promises'
import { fileURLToPath } from 'node:url'
import { guard } from './guard.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const appDir = resolve(here, '..')
const repo = resolve(appDir, '..')
const casesDir = join(here, 'cases')
const DEFAULT_ANSWER = "I don't know: choose, and say what you chose."

function parseArgs(argv) {
  const o = { cases: [], repeats: 5, label: 'baseline', model: 'sonnet', budget: 2, compare: null, keep: false, ablate: '', lookSize: '', holds: '' }
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i]
    const next = () => argv[(i += 1)]
    if (a === '--case') o.cases.push(next())
    else if (a === '--repeats') o.repeats = Number(next())
    else if (a === '--label') o.label = next()
    else if (a === '--model') o.model = next()
    else if (a === '--budget') o.budget = Number(next())
    else if (a === '--keep') o.keep = true
    else if (a === '--ablate') o.ablate = next()
    else if (a === '--look-size') o.lookSize = next()
    else if (a === '--holds') o.holds = next()
    else if (a === '--compare') o.compare = [next(), next()]
    else throw new Error(`unknown argument: ${a}`)
  }
  if (!(o.repeats >= 1)) throw new Error('--repeats is a whole number, 1 or more')
  if (!(o.budget > 0)) throw new Error('--budget is in dollars, more than 0')
  if (!/^[a-z,]*$/.test(o.ablate)) throw new Error('--ablate is a comma list: skills, reviewer, stop, look, digest')
  if (!/^\d*$/.test(o.lookSize) || !/^[12]?$/.test(o.holds)) throw new Error('--look-size is pixels (256 to 2000), --holds 1 or 2')
  if (!/^[A-Za-z0-9_-]{1,40}$/.test(o.label)) throw new Error('--label is letters, digits, - and _')
  return o
}

/** The cases: every folder of `cases/` with a `case.json`; those whose id starts `_` (the smoke test) only by name. */
export function loadCases(ids) {
  const all = readdirSync(casesDir).filter((id) => existsSync(join(casesDir, id, 'case.json')))
  const chosen = ids.length > 0 ? ids : all.filter((id) => !id.startsWith('_'))
  return chosen.map((id) => {
    if (!all.includes(id)) throw new Error(`no case ${id} (has ${all.join(', ')})`)
    return { id, dir: join(casesDir, id), ...JSON.parse(readFileSync(join(casesDir, id, 'case.json'), 'utf8')) }
  })
}

/** A temporary workspace holding the case's project, `<ws>/<object>/`: its `start/` folder, or torno's template model. */
function makeWorkspace(c, runDir) {
  const ws = join(runDir, 'ws')
  const obj = join(ws, c.object)
  mkdirSync(obj, { recursive: true })
  const start = join(c.dir, 'start')
  if (existsSync(start)) cpSync(start, obj, { recursive: true })
  else writeFileSync(join(obj, `${c.object.replace(/-/g, '_')}.py`), readFileSync(join(appDir, 'src/main/objects/template.py.txt'), 'utf8'))
  if (existsSync(join(c.dir, 'brief.md'))) cpSync(join(c.dir, 'brief.md'), join(obj, 'brief.md'))
  if (existsSync(join(c.dir, 'reference'))) cpSync(join(c.dir, 'reference'), join(obj, 'reference'), { recursive: true })
  return { ws, obj }
}

/** The answer to a question from the case's `answers`: the first topic its text names, or the default. */
export function answerFor(question, answers = {}) {
  const text = question.toLowerCase()
  for (const [topic, answer] of Object.entries(answers)) if (topic !== 'default' && text.includes(topic.toLowerCase())) return answer
  return answers.default ?? DEFAULT_ANSWER
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** A case's `onboard` as `objects.previewPrompt` takes it: what it leaves out is empty. */
export function onboardDraft(onboard) {
  return { description: onboard.description ?? '', items: [], steps: [], scans: [], objects: [], sizes: onboard.sizes ?? [], rules: onboard.rules ?? '', links: [], pdfs: [] }
}

/** Drive one run in the window: the prompts, the cards, the questions, up to the turn limit. */
async function drive(page, c, log) {
  const dock = page.locator('[data-region="session"]')
  const chat = dock.locator('.chat')
  const turns = chat.locator('.chat-turn')
  const status = () => dock.getByRole('status').first().innerText().catch(() => '')
  const say = async (text) => {
    const box = dock.locator('[data-chat-composer]')
    await box.focus()
    await box.fill(text)
    await page.keyboard.press('Enter')
  }
  const allowed = c.allow ?? ['Write', 'Edit', 'MultiEdit', 'mcp__torno__*']
  const allows = (tool) => allowed.some((a) => (a.endsWith('*') ? tool.startsWith(a.slice(0, -1)) : tool === a))
  const metrics = { turnsUsed: 0, cards: 0, questions: 0, denied: [], timedOut: false }

  /** Answer what is open, and wait until the turn has ended. */
  async function untilTurnEnds(before) {
    const deadline = Date.now() + (c.turnSeconds ?? 900) * 1000
    while (Date.now() < deadline) {
      const card = chat.locator('.chat-ask[data-state="open"]').first()
      if ((await card.count()) > 0) {
        const tool = (await card.getAttribute('data-tool')) ?? ''
        metrics.cards += 1
        if (tool === 'AskUserQuestion') {
          const others = card.getByLabel(/^Other answer to /)
          for (let i = 0; i < (await others.count()); i += 1) {
            const field = others.nth(i)
            const question = ((await field.getAttribute('aria-label')) ?? '').replace(/^Other answer to /, '')
            await field.fill(answerFor(question, c.answers))
            metrics.questions += 1
          }
          await card.getByRole('button', { name: 'Submit', exact: true }).click()
        } else if (allows(tool)) await card.getByRole('button', { name: 'Allow', exact: true }).click()
        else {
          metrics.denied.push(tool)
          log(`  denied ${tool}`)
          await card.getByRole('button', { name: 'Deny', exact: true }).click()
        }
        continue
      }
      if ((await turns.count()) > before && (await status()) === 'Idle') return true
      await sleep(500)
    }
    metrics.timedOut = true
    return false
  }

  await dock.getByRole('button', { name: 'New session' }).click()
  await chat.waitFor()
  // The first prompt of a new project, as torno writes it from the draft, for the session's skills: not a copy that could drift.
  const onboarding = c.onboard ? (await page.evaluate(([name, draft]) => window.torno.objects.previewPrompt(name, draft), [c.object, onboardDraft(c.onboard)])).text : undefined
  const prompts = [...(onboarding ? [onboarding] : []), ...c.prompts]
  const limit = c.turns ?? prompts.length + 3
  while (metrics.turnsUsed < limit) {
    let prompt = prompts.shift()
    if (prompt === undefined) {
      // The prompts are said: a question at the end of the last turn is answered while turns are left.
      const last = (await chat.locator('.chat-text').last().innerText().catch(() => '')).trim()
      if (!/\?\s*$/.test(last)) break
      metrics.questions += 1
      prompt = answerFor(last, c.answers)
    }
    const before = await turns.count()
    log(`  turn ${metrics.turnsUsed + 1}: ${prompt.slice(0, 70).replace(/\n/g, ' ')}`)
    await say(prompt)
    metrics.turnsUsed += 1
    if (!(await untilTurnEnds(before))) break
  }
  return metrics
}

/** What the chat log of the run says: tools by name, pictures, the last claim, whether a question came before a write. */
export function readChat(obj) {
  const folder = join(obj, '.torno', 'chat')
  const items = existsSync(folder)
    ? readdirSync(folder).filter((f) => f.endsWith('.jsonl')).flatMap((f) => readFileSync(join(folder, f), 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l) } catch { return null } }).filter(Boolean))
    : []
  const tools = {}
  let pictures = 0
  let askedBeforeWrite = null
  let asked = false
  const questions = []
  for (const item of items) {
    if (item.kind === 'tool') {
      tools[item.name] = (tools[item.name] ?? 0) + 1
      pictures += item.images?.length ?? 0
      if (item.name === 'AskUserQuestion') {
        asked = true
        for (const q of Array.isArray(item.input?.questions) ? item.input.questions : []) questions.push([q?.header, q?.question].filter((t) => typeof t === 'string').join(': '))
      }
      const path = item.input?.file_path ?? ''
      if (askedBeforeWrite === null && ['Write', 'Edit', 'MultiEdit'].includes(item.name) && path.endsWith('.py')) askedBeforeWrite = asked
    }
    if (item.kind === 'text' && /\?\s*$/.test(item.text)) {
      asked = true
      questions.push(item.text.trim().split('\n').at(-1))
    }
  }
  const lastText = [...items].reverse().find((i) => i.kind === 'text')?.text ?? ''
  const claim = /\?\s*$/.test(lastText.trim()) ? 'asked' : 'done'
  return { tools, pictures, askedBeforeWrite, questions, claim, lastText: lastText.slice(-400) }
}

/**
 * An `asked` check, of what the chat says (`readChat`): `expect: true` passes when a question came before the first
 * write of the model and one of them matches `about` (a regular expression, any case) when it is given; `expect: false`
 * when nothing was asked before it and no AskUserQuestion card came at all (an offer at the end, after the build, is none).
 */
export function judgeAsked(check, chat) {
  const about = check.about ? new RegExp(check.about, 'i') : null
  const value = chat.questions.slice(0, 8)
  if (check.expect === false) return { pass: chat.askedBeforeWrite !== true && !(chat.tools?.AskUserQuestion > 0), value, expect: false }
  return { pass: chat.askedBeforeWrite === true && (!about || chat.questions.some((q) => about.test(q))), value, expect: check.about ?? true }
}

/** The CLI's own `result` messages, kept by `tee.mjs`: cost, tokens, turns and time, summed. */
export function readResults(file) {
  const lines = existsSync(file) ? readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []
  const sum = { results: lines.length, costUsd: 0, durationMs: 0, apiMs: 0, cliTurns: 0, tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }
  for (const r of lines) {
    // total_cost_usd is the session's so far: the last is the whole.
    if (typeof r.total_cost_usd === 'number') sum.costUsd = r.total_cost_usd
    sum.durationMs += r.duration_ms ?? 0
    sum.apiMs += r.duration_api_ms ?? 0
    sum.cliTurns += r.num_turns ?? 0
    sum.tokens.input += r.usage?.input_tokens ?? 0
    sum.tokens.output += r.usage?.output_tokens ?? 0
    sum.tokens.cacheRead += r.usage?.cache_read_input_tokens ?? 0
    sum.tokens.cacheWrite += r.usage?.cache_creation_input_tokens ?? 0
  }
  return sum
}

/** A torno tool called through the project's MCP address, as the agent calls it; its text answer parsed as JSON. */
async function callTool(mcp, name, args) {
  const rpc = async (method, params, id) => {
    const reply = await fetch(mcp.url, { method: 'POST', headers: { 'X-Torno-Session': mcp.token, 'content-type': 'application/json', accept: 'application/json, text/event-stream' }, body: JSON.stringify({ jsonrpc: '2.0', method, params, ...(id ? { id } : {}) }) })
    const text = await reply.text()
    const data = /^(event|data):/.test(text) ? text.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trim()).at(-1) : text
    return data ? JSON.parse(data) : undefined
  }
  await rpc('initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'torno-eval', version: '1' } }, 1)
  const answer = await rpc('tools/call', { name, arguments: args }, 2)
  const text = answer?.result?.content?.find((p) => p.type === 'text')?.text
  if (answer?.result?.isError || text === undefined) throw new Error(text ?? JSON.stringify(answer?.error ?? answer))
  return JSON.parse(text)
}

const at = (value, path) => (path ? path.split('.').reduce((v, k) => (v == null ? undefined : v[k]), value) : value)

/** An `mcp` check: `{tool, args, path, expect, tol}` or `{…, min, max}`; the number's `exact` as the tool told it. */
export function judge(check, answer) {
  const value = at(answer, check.path)
  const parent = check.path?.includes('.') ? at(answer, check.path.split('.').slice(0, -1).join('.')) : answer
  const exact = typeof parent?.exact === 'boolean' ? parent.exact : undefined
  let pass
  if (typeof check.expect === 'number') pass = typeof value === 'number' && Math.abs(value - check.expect) <= (check.tol ?? 0.01)
  else if (check.expect !== undefined) pass = JSON.stringify(value) === JSON.stringify(check.expect)
  else pass = typeof value === 'number' && value >= (check.min ?? -Infinity) && value <= (check.max ?? Infinity)
  return { pass, value, expect: check.expect ?? [check.min, check.max], ...(exact !== undefined ? { exact } : {}) }
}

/** The person's dimensions in the case's start (`start/.torno/marks.json`) that hold an expected value: each is a check. */
export function caseDimensions(c) {
  const file = join(c.dir, 'start', '.torno', 'marks.json')
  if (!existsSync(file)) return []
  return (JSON.parse(readFileSync(file, 'utf8')).marks ?? []).filter((m) => m.kind === 'dimension' && m.author === 'user' && typeof m.expected === 'number').map((m) => m.id)
}

/**
 * A dimension of the person's, as the `marks` tool tells it: it passes only with the verdict `pass` measured on the
 * build the answer is of (`measuredRevision`, or `resolvedOnRevision` of one resolved); a value of an older build, or
 * none, fails, saying why.
 */
export function judgeDimension(id, answer) {
  const mark = answer?.marks?.find((m) => m.id === id)
  if (!mark) return { pass: false, error: `${id} is not among the marks` }
  const revision = answer.revision
  const on = mark.measuredRevision ?? mark.resolvedOnRevision
  const verdict = mark.verdict ?? mark.resolvedVerdict
  const value = mark.value ?? mark.resolvedValue ?? mark.wasValue
  if (on !== revision || verdict === undefined) return { pass: false, value, expect: mark.expected, error: `not measured on r${revision}${mark.refused ? `: ${mark.refused}` : ''}` }
  return { pass: verdict === 'pass', value, expect: mark.expected, exact: true }
}

/**
 * A `diff` check: what the last edit (the build before the last against the last, all `diff` keeps) changed. It passes
 * when no part came or went and every part that changed is one of `only`: the face, edge and solid counts and the
 * place of each part count, not its volume and box alone.
 */
export function judgeDiff(check, answer) {
  const only = new Set(check.only ?? [])
  const changed = []
  const cameOrWent = []
  for (const layout of answer?.layouts ?? []) {
    if (check.layout && layout.layout !== check.layout) continue
    for (const p of layout.parts ?? []) if (p.changed && !only.has(p.name)) changed.push(`${layout.layout}:${p.name}`)
    for (const n of [...(layout.added ?? []), ...(layout.removed ?? [])]) cameOrWent.push(`${layout.layout}:${n}`)
  }
  const outside = [...new Set([...changed, ...cameOrWent])]
  return { pass: outside.length === 0, value: outside, expect: [...only], exact: !(answer?.notes ?? []).length }
}

async function scoreRun(c, obj, mcp) {
  const brep = c.checks.filter((k) => !['mcp', 'diff', 'asked'].includes(k.kind))
  const checksFile = join(dirname(obj), '..', 'checks.json')
  writeFileSync(checksFile, JSON.stringify(brep))
  const py = spawnSync('uv', ['run', '--no-sync', '--project', join(repo, 'kernel'), 'python', join(here, 'score.py'), obj, checksFile], { encoding: 'utf8', timeout: 300_000, env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' } })
  let scored
  try {
    scored = JSON.parse(py.stdout.trim().split('\n').at(-1))
  } catch {
    scored = { build: { ok: false, error: `score.py: ${(py.stderr || py.error?.message || '').slice(-500)}` }, checks: brep.map((k) => ({ id: k.id ?? k.kind, kind: k.kind, pass: false, error: 'not scored' })) }
  }
  for (const check of c.checks.filter((k) => k.kind === 'mcp')) {
    const head = { id: check.id ?? check.tool, kind: 'mcp' }
    try {
      scored.checks.push({ ...head, ...judge(check, await callTool(mcp, check.tool, check.args ?? {})) })
    } catch (e) {
      scored.checks.push({ ...head, pass: false, error: String(e.message ?? e).slice(0, 300) })
    }
  }
  for (const check of c.checks.filter((k) => k.kind === 'diff')) {
    const head = { id: check.id ?? 'diff', kind: 'diff' }
    try {
      scored.checks.push({ ...head, ...judgeDiff(check, await callTool(mcp, 'diff', {})) })
    } catch (e) {
      scored.checks.push({ ...head, pass: false, error: String(e.message ?? e).slice(0, 300) })
    }
  }
  for (const check of c.checks.filter((k) => k.kind === 'asked')) scored.checks.push({ id: check.id ?? 'asked', kind: 'asked', ...judgeAsked(check, readChat(obj)) })
  const dims = caseDimensions(c)
  if (dims.length > 0) {
    let answer
    try {
      answer = await callTool(mcp, 'marks', { ids: dims })
    } catch (e) {
      answer = { error: String(e.message ?? e).slice(0, 300) }
    }
    for (const id of dims) scored.checks.push({ id, kind: 'dimension', ...(answer.error ? { pass: false, error: answer.error } : judgeDimension(id, answer)) })
  }
  return scored
}

async function oneRun(c, repeat, o, agent, electron, log) {
  const runDir = mkdtempSync(join(realpathSync(tmpdir()), `torno-eval-${c.id}-`))
  const { ws, obj } = makeWorkspace(c, runDir)
  const resultsFile = join(runDir, 'results.jsonl')
  const started = Date.now()
  const env = { ...process.env, TORNO_TEST: '1', TORNO_WORKSPACE: ws, TORNO_CONFIG: join(runDir, 'config.json'), TORNO_AGENT_CMD: `node ${join(here, 'tee.mjs')} ${resultsFile} ${agent}`, TORNO_EVAL: '1', TORNO_EVAL_ABLATE: o.ablate, TORNO_EVAL_LOOK_SIZE: o.lookSize, TORNO_EVAL_HOLDS: o.holds }
  delete env.TORNO_KEEP_BUILDS
  const app = await electron.launch({ args: ['.'], cwd: appDir, env })
  let run = { case: c.id, repeat, label: o.label, ablate: o.ablate.split(',').filter(Boolean), ...(o.lookSize ? { lookSize: Number(o.lookSize) } : {}), ...(o.holds ? { holds: Number(o.holds) } : {}) }
  try {
    const page = await app.firstWindow()
    // The left column is there hidden while a project's route card is up: there, not seen.
    await page.waitForSelector('[data-region="left"]', { state: 'attached' })
    const { openListed } = await import('./window.mjs')
    await openListed(page, c.object)
    // The case's first build ends before the first prompt: the agent starts from it, and diff has it to compare with.
    const first = Date.now() + 120_000
    while (Date.now() < first && !['ok', 'failed'].includes(await page.evaluate(() => window.__tornoTest.state().build?.status))) await sleep(250)
    const driven = await drive(page, c, log)
    // The build the checks are of: the model as the agent left it, once the window's build has settled.
    // A save the turn ended on is seen by the watcher a moment later: give it that moment before asking.
    await sleep(3000)
    const deadline = Date.now() + 120_000
    while (Date.now() < deadline && (await page.evaluate(() => window.__tornoTest.state().build?.status)) === 'building') await sleep(500)
    const build = await page.evaluate(() => { const b = window.__tornoTest.state().build; return b ? { status: b.status, revision: b.revision } : null })
    const objectId = await page.evaluate(() => window.__tornoTest.state().objectId)
    const mcp = await app.evaluate((_e, id) => globalThis.__tornoMain.mcpFor(id), objectId)
    // The person's dimensions are measured once the marks are checked against that build: wait for every check begun.
    const settled = Date.now() + 60_000
    while (Date.now() < settled) {
      const { started, finished } = await app.evaluate((_e, id) => globalThis.__tornoMain.marksChecks(id), objectId)
      if (started === finished) break
      await sleep(500)
    }
    const scored = await scoreRun(c, obj, mcp)
    const passed = scored.checks.filter((k) => k.pass).length
    run = { ...run, passed, total: scored.checks.length, buildOk: scored.build.ok, windowBuild: build, checks: scored.checks, buildError: scored.build.error, ...driven, ...readChat(obj), ...readResults(resultsFile), wallMs: Date.now() - started }
    // Judge calibration: it said done while a check failed.
    run.saidDoneWhileFailing = run.claim === 'done' && passed < scored.checks.length
  } catch (e) {
    run = { ...run, error: String(e.stack ?? e).slice(0, 2000), wallMs: Date.now() - started, ...readResults(resultsFile) }
  } finally {
    await app.close().catch(() => {})
    if (!o.keep) rmSync(runDir, { recursive: true, force: true })
    else log(`  kept ${runDir}`)
  }
  return run
}

const pct = (n, d) => (d > 0 ? `${Math.round((100 * n) / d)} %` : '–')
const money = (x) => `$${x.toFixed(2)}`
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0)

/** Per case: check pass rate first, build success apart, cost and time. */
export function summarize(runs) {
  const byCase = new Map()
  for (const r of runs) byCase.set(r.case, [...(byCase.get(r.case) ?? []), r])
  return [...byCase].map(([id, rs]) => ({
    case: id,
    runs: rs.length,
    checks: pct(rs.reduce((a, r) => a + (r.passed ?? 0), 0), rs.reduce((a, r) => a + (r.total ?? 0), 0)),
    allPassed: pct(rs.filter((r) => r.total > 0 && r.passed === r.total).length, rs.length),
    build: pct(rs.filter((r) => r.buildOk).length, rs.length),
    doneWhileFailing: rs.filter((r) => r.saidDoneWhileFailing).length,
    cost: money(mean(rs.map((r) => r.costUsd ?? 0))),
    minutes: (mean(rs.map((r) => r.wallMs ?? 0)) / 60000).toFixed(1),
    errors: rs.filter((r) => r.error).length
  }))
}

export function markdown(title, runs, other) {
  const rows = summarize(runs)
  const theirs = other ? new Map(summarize(other.runs).map((r) => [r.case, r])) : null
  const head = theirs
    ? `| Case | Checks passed (${other.name}) | Checks passed | All passed | Build ok | Said done, failing | Cost / run | Minutes / run |\n|---|---|---|---|---|---|---|---|`
    : '| Case | Runs | Checks passed | All passed | Build ok | Said done, failing | Cost / run | Minutes / run | Errors |\n|---|---|---|---|---|---|---|---|---|'
  const lines = rows.map((r) =>
    theirs
      ? `| ${r.case} | ${theirs.get(r.case)?.checks ?? '–'} | ${r.checks} | ${r.allPassed} | ${r.build} | ${r.doneWhileFailing} | ${r.cost} | ${r.minutes} |`
      : `| ${r.case} | ${r.runs} | ${r.checks} | ${r.allPassed} | ${r.build} | ${r.doneWhileFailing} | ${r.cost} | ${r.minutes} | ${r.errors} |`
  )
  return `# ${title}\n\n${head}\n${lines.join('\n')}\n`
}

const readReport = (file) => readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l))

async function main() {
  const o = parseArgs(process.argv.slice(2))
  if (o.compare) {
    // Reads two reports and writes nothing: no agent, no window, no cost.
    const [a, b] = o.compare
    process.stdout.write(markdown(`${b} against ${a}`, readReport(b), { name: a.split('/').at(-1), runs: readReport(a) }))
    return
  }
  const cases = loadCases(o.cases)
  const agent = process.env.TORNO_EVAL_AGENT ?? `claude --model ${o.model} --max-budget-usd ${o.budget} --permission-mode acceptEdits`
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  const no = await guard(process.env, { agent, model: o.model, budgetUsd: o.budget, cases: cases.map((c) => c.id), repeats: o.repeats }, (q) => rl.question(q).catch(() => null))
  rl.close()
  if (no) {
    console.error(no)
    process.exit(2)
  }
  if (!existsSync(join(appDir, 'out/main')) || !existsSync(join(appDir, 'out/viewer/viewer.js'))) {
    console.error('Build the app first: pnpm build')
    process.exit(2)
  }
  const { _electron: electron } = await import('@playwright/test')
  const sha = (() => { try { return execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim() } catch { return 'nosha' } })()
  const outDir = join(here, 'out')
  mkdirSync(outDir, { recursive: true })
  const base = join(outDir, `${new Date().toISOString().slice(0, 10)}-${sha}-${o.label}`)
  const runs = []
  for (const c of cases) {
    for (let repeat = 1; repeat <= o.repeats; repeat += 1) {
      console.log(`${c.id} ${repeat}/${o.repeats}`)
      const run = { ...(await oneRun(c, repeat, o, agent, electron, console.log)), sha, model: o.model, agent: agent.split(' ')[0] }
      runs.push(run)
      writeFileSync(`${base}.jsonl`, runs.map((r) => JSON.stringify(r)).join('\n') + '\n')
      console.log(run.error ? `  error: ${run.error.split('\n')[0]}` : `  ${run.passed}/${run.total} checks, build ${run.buildOk ? 'ok' : 'failed'}, ${money(run.costUsd ?? 0)}`)
    }
  }
  writeFileSync(`${base}.md`, markdown(`${o.label} at ${sha}, ${o.model}${o.ablate ? `, without ${o.ablate}` : ''}${o.lookSize ? `, look ${o.lookSize} px` : ''}${o.holds ? `, ${o.holds} holds` : ''}`, runs))
  console.log(`\n${readFileSync(`${base}.md`, 'utf8')}\nWrote ${base}.jsonl and ${base}.md`)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main()
