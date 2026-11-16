import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { expect, it } from 'vitest'
import { PROMPTS } from './main/mcp/prompts'
import { TOOLS } from './main/mcp/schemas'
import { cheatSheet, TOOL_KEYS } from './shared/keys'
import { POINTER } from './shared/pointer'

// The manual (`docs/manual.md`) is held to the code where it names what the code names: its table of keys is the
// sheet of keys (`cheatSheet()`), the tools it names are the tools there are, and its headings are in the order a
// first-time reader needs. `TORNO_README=write pnpm -C app exec vitest run src/readme.test.ts` writes the table of
// keys anew. The README is the short introduction; it is held only to the headings the window and the launcher name.
const path = resolve(__dirname, '../../docs/manual.md')
const readme = readFileSync(path, 'utf8')
const intro = readFileSync(resolve(__dirname, '../../README.md'), 'utf8')
const headings = readme.split('\n').filter((line) => /^#{1,3} /.test(line))

const BEGIN = '<!-- keys: generated from cheatSheet() in app/src/shared/keys.ts; `TORNO_README=write pnpm -C app exec vitest run src/readme.test.ts` writes it -->'
const END = '<!-- keys: end -->'
const POINTER_BEGIN = '<!-- pointer: generated from POINTER in app/src/shared/pointer.ts; `TORNO_README=write pnpm -C app exec vitest run src/readme.test.ts` writes it -->'
const POINTER_END = '<!-- pointer: end -->'

/** The pointer's gestures as the manual has them: one table, a row for each row of the sheet's first group. */
function pointerTable(): string {
  return ['| Pointer | What it does |', '|---|---|', ...POINTER.map((row) => `| ${row.gesture} | ${row.does} |`)].join('\n')
}

/** A key as Markdown code: one that holds a backtick needs two around it. */
const cap = (key: string): string => (key.includes('`') ? `\`\` ${key} \`\`` : `\`${key}\``)

/** The sheet of keys as the manual has it: one table, a row for each row of the sheet, by where it is listened to. */
function keysTable(): string {
  const lines = ['| Where | Keys | What it does |', '|---|---|---|']
  for (const group of cheatSheet()) {
    for (const row of group.rows) lines.push(`| ${group.context} | ${row.keys.map(cap).join(' ')} | ${row.does.replaceAll('|', '\\|')} |`)
  }
  return lines.join('\n')
}

/** Writes one generated region anew, from the file as it is now: the other test's write, made first, is kept. */
function writeRegion(begin: string, end: string, table: string): void {
  const now = readFileSync(path, 'utf8')
  const [from, to] = [now.indexOf(begin), now.indexOf(end)]
  writeFileSync(path, `${now.slice(0, from + begin.length)}\n${table}\n${now.slice(to)}`)
}

it('has its table of keys from the one table of keys', () => {
  const [from, to] = [readme.indexOf(BEGIN), readme.indexOf(END)]
  expect([from >= 0, to > from]).toEqual([true, true])
  const table = keysTable()
  if (process.env.TORNO_README === 'write') writeRegion(BEGIN, END, table)
  else expect(readme.slice(from + BEGIN.length, to).trim()).toBe(table)
  // Every key the sheet shows is in it, and the tools' keys with their tools.
  for (const { key, label } of TOOL_KEYS) expect([label, table.includes(`\`${key}\``)]).toEqual([label, true])
})

it('has its table of the pointer from the one table of it', () => {
  const [from, to] = [readme.indexOf(POINTER_BEGIN), readme.indexOf(POINTER_END)]
  expect([from >= 0, to > from]).toEqual([true, true])
  const table = pointerTable()
  if (process.env.TORNO_README === 'write') writeRegion(POINTER_BEGIN, POINTER_END, table)
  else expect(readme.slice(from + POINTER_BEGIN.length, to).trim()).toBe(table)
  // The walk-through says where the window shows it.
  expect(readme.slice(readme.indexOf('## Five minutes with torno'), readme.indexOf('## Projects and builds'))).toContain('the sheet of keys (`?`), where the pointer is the first group')
})

it('names every tool the agent has, and no tool there is not', () => {
  const named = [...new Set([...readme.matchAll(/(?<!\/)mcp__torno__([a-z_]+)/g)].map((match) => match[1]))].sort()
  expect(named).toEqual(Object.keys(TOOLS).sort())
})

it('names every prompt the server offers, as a slash command, and no prompt there is not', () => {
  const named = [...new Set([...readme.matchAll(/\/mcp__torno__([a-z_]+)/g)].map((match) => match[1]))].sort()
  expect(named).toEqual(Object.keys(PROMPTS).sort())
})

it('is laid out for a first-time reader: what it is, how to start it, a walk-through, then the reference', () => {
  expect(headings.filter((line) => /^#{1,2} /.test(line))).toEqual([
    '# The torno manual',
    '## Requirements',
    '## Install',
    '## Run',
    '## Five minutes with torno',
    '## Projects and builds',
    '## The agent',
    '## Marks',
    '## Measuring and dimensions',
    '## Section',
    '## Scans',
    '## Explode and saved views',
    '## The board',
    '## The page of projects',
    '## Export',
    '## Keys',
    '## Files torno writes',
    '## Limits and exactness',
    '## Troubleshooting',
    '## Tests',
    '## Environment variables',
    '## Not yet verified on a visible screen'
  ])
  for (const heading of ['### What Claude Code is given', '### What the agent is told', '### Tools', '### Prompts']) expect(headings).toContain(heading)
})

it('names the files torno writes and the variables it reads', () => {
  for (const name of ['scene.json', 'marks.json', 'scans.json', 'session.json', 'agent.json', 'state.md', 'thumb.png', 'thumb.json', 'builds.jsonl', 'exports/', 'views/', 'config.json', 'TORNO_OZONE', 'TORNO_WORKSPACE', 'TORNO_AGENT_CMD', 'TORNO_BUILD_TIMEOUT', 'TORNO_CONFIG', 'TORNO_DEBUG', 'TORNO_TEST']) {
    expect([name, readme.includes(name)]).toEqual([name, true])
  }
})

it('lists in one section what nobody has seen on a visible screen or with a real agent', () => {
  expect(headings.filter((line) => line.includes('Not yet verified'))).toHaveLength(1)
  const section = readme.slice(readme.indexOf('## Not yet verified on a visible screen'))
  // What a run on a real compositor output saw is said first, in one paragraph; what remains to try follows it.
  const seen = section.indexOf('**Verified on a real compositor output (Hyprland, NVIDIA; the session was\nlocked, so not by eye).**')
  const remains = section.indexOf('What remains is yours to try once.')
  expect([seen > 0, remains > seen]).toEqual([true, true])
  const verified = section.slice(seen, remains)
  for (const item of ['Only one torno', 'no menu', 'Alt-drag', 'hyprctl clients', 'thumbnail', 'Ctrl+Shift+E', 'Claude Code', 'Firefox']) {
    expect([item, verified.includes(item)]).toEqual([item, true])
  }
  const toTry = section.slice(remains)
  for (const item of ['Hyprland', 'flicker', 'comes to the front', 'Closing', 'clipboard', 'dark', 'dropped on the view', 'folder dialog', 'save dialog', 'replace', 'Claude Code', 'Firefox', 'Safari', 'phone', 'file://', '--install-desktop', 'another workspace with a session working']) {
    expect([item, toTry.includes(item)]).toEqual([item, true])
  }
})

it('keeps in the README the sections the window and the launcher send a reader to, and leads to the manual', () => {
  // "See Requirements in the README." (`ui/readyLines.ts`, `scripts/torno`) and "(README, Run)" (`scripts/torno`).
  const headings = intro.split('\n').filter((line) => /^#{1,3} /.test(line))
  for (const heading of ['### Requirements', '### Run']) expect(headings).toContain(heading)
  expect(intro).toContain('(docs/manual.md)')
  // Every link into the manual names a heading it has.
  const anchors = new Set(readme.split('\n').filter((line) => /^#{1,3} /.test(line)).map((line) => line.replace(/^#+ /, '').toLowerCase().replace(/[^a-z0-9 -]/g, '').replaceAll(' ', '-')))
  for (const [, anchor] of intro.matchAll(/docs\/manual\.md#([a-z0-9-]+)/g)) expect([anchor, anchors.has(anchor)]).toEqual([anchor, true])
})
