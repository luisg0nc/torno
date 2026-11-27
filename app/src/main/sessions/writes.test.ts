// Which saves are Claude's: told by its tool calls, never by the clock of its turn.
import { spawnSync } from 'node:child_process'
import { mkdtempSync, realpathSync, rmSync, statSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ClaudeWrites, surelyWritesNothing, type ToolCall } from './writes'

let dir: string
let board: string
/** The ledger's clock, in ms: a file's mtime is set against it. */
let time: number
let writes: ClaudeWrites
const turn = { prompt: 'u7', conversation: 'c1' }

beforeEach(() => {
  dir = realpathSync(mkdtempSync(join(tmpdir(), 'torno-writes-')))
  board = join(dir, 'board.py')
  time = 1_800_000_000_000
  changed.clear()
  writes = new ClaudeWrites(() => time, statAsTold)
  save('first', time - 60_000)
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

/** When each file was last put there or changed (its ctime), by the ledger's clock: a real one cannot be set. */
const changed = new Map<string, number>()
const statAsTold = (path: string) => {
  try {
    const { mtimeMs, size } = statSync(path)
    return { mtimeMs, size, ctimeMs: changed.get(path) ?? mtimeMs }
  } catch {
    return undefined
  }
}

/** The file as saved by somebody at `at`; `put` is when it came to be there, for one that keeps an older mtime. */
function save(content: string, at = time, file = board, put = at): void {
  writeFileSync(file, content)
  utimesSync(file, at / 1000, at / 1000)
  changed.set(file, put)
}

const call = (tool: string, input: unknown, id = 't1'): ToolCall => ({ session: 's1', project: 'p1', dir, id, tool, input, turn })
const edit = (id = 't1', file = board) => call('Edit', { file_path: file }, id)
const bash = (command: string, id = 't1') => call('Bash', { command }, id)
const by = (file = board) => writes.by('p1', file)

describe("a save is Claude's when a tool of its wrote the file", () => {
  it('is nobody but the person\'s with no tool call, whatever the turn does', () => {
    expect(by()).toBeUndefined()
  })

  it.each(['Write', 'Edit', 'MultiEdit'])('is its while its %s of that file runs, with the turn', (tool) => {
    writes.began(call(tool, { file_path: board }))
    save('claude')
    expect(by()).toEqual({ turn })
  })

  it('says it was Claude even where no prompt can be named', () => {
    writes.began({ ...edit(), turn: undefined })
    expect(by()).toEqual({})
  })

  it('is not another file, nor another project', () => {
    writes.began(edit())
    expect(by(join(dir, 'extra.py'))).toBeUndefined()
    expect(writes.by('p2', board)).toBeUndefined()
  })

  it('takes a path from the project folder, and through a link', () => {
    symlinkSync(board, join(dir, 'linked.py'))
    writes.began(call('Write', { file_path: 'linked.py' }))
    expect(by()).toEqual({ turn })
  })

  it('is still its after the tool ended, while the file is as the tool left it, however late the save is heard', () => {
    writes.began(edit())
    save('claude')
    writes.ended('s1', 't1', true)
    writes.over('s1')
    time += 10_000
    expect(by()).toEqual({ turn })
  })

  it("is the person's once they save over what the tool left", () => {
    writes.began(edit())
    save('claude')
    writes.ended('s1', 't1', true)
    time += 5
    save('mine now', time)
    expect(by()).toBeUndefined()
  })

  it('keeps what the tool left when the same call is told ended twice (its hook, then its result)', () => {
    writes.began(edit())
    save('claude')
    writes.ended('s1', 't1', true)
    time += 50
    save('mine now', time)
    writes.ended('s1', 't1', true)
    expect(by()).toBeUndefined()
  })

  it('wrote nothing when the tool failed', () => {
    writes.began(edit())
    writes.ended('s1', 't1', false)
    expect(by()).toBeUndefined()
  })

  it("is the person's while the tool waits for their answer, and Claude's once they allow it", () => {
    writes.began(edit())
    writes.waits('s1', 't1')
    save('mine, while the card waits')
    expect(by()).toBeUndefined()
    writes.allowed('s1', 't1')
    save('claude')
    expect(by()).toEqual({ turn })
  })

  it('writes nothing when they refuse it', () => {
    writes.began(edit())
    writes.waits('s1', 't1')
    writes.refused('s1', 't1')
    save('mine')
    expect(by()).toBeUndefined()
  })

  it('drops a call still waiting when the turn is over, and ends one still running as it stands', () => {
    writes.began(edit('t1'))
    writes.waits('s1', 't1')
    writes.over('s1')
    expect(by()).toBeUndefined()
    writes.began(edit('t2'))
    save('claude')
    writes.over('s1')
    expect(by()).toEqual({ turn })
    time += 5
    save('mine', time)
    expect(by()).toBeUndefined()
  })

  it("ends only the calls of the session that is over", () => {
    writes.began(edit())
    writes.over('s2')
    save('claude')
    expect(by()).toEqual({ turn })
  })

  it('takes no notice of a tool that writes no file', () => {
    writes.began(call('Read', { file_path: board }))
    expect(by()).toBeUndefined()
  })
})

describe("a tool of an MCP server of the person's own", () => {
  const other = (input: unknown, tool = 'mcp__files__edit_file') => call(tool, input)

  it('is taken to write the .py files its input names, and no other', () => {
    writes.began(other({ path: board, edits: [{ oldText: 'a', newText: 'b' }] }))
    save('claude')
    expect(by()).toEqual({ turn })
    expect(by(join(dir, 'extra.py'))).toBeUndefined()
    writes.ended('s1', 't1', true)
    expect(by()).toEqual({ turn })
  })

  it('finds a file named in a list or a nested input, from the project folder', () => {
    writes.began(other({ files: [{ file: 'board.py' }] }))
    save('claude')
    expect(by()).toEqual({ turn })
  })

  it('claims nothing when it names no .py file', () => {
    writes.began(other({ query: 'how to save board.py safely', url: 'http://x' }, 'mcp__docs__search'))
    save('mine')
    expect(by()).toBeUndefined()
  })

  it("claims nothing for a tool of torno's own, which writes no .py file", () => {
    writes.began(other({ path: board }, 'mcp__torno__look'))
    save('mine')
    expect(by()).toBeUndefined()
  })
})

describe('a Bash, whose files cannot be read from its command', () => {
  it('is taken to have written a file saved while it runs', () => {
    writes.began(bash('python gen.py'))
    time += 2000
    save('generated')
    expect(by()).toEqual({ turn })
  })

  it('did not write a file that was last saved before it began', () => {
    save('mine', time - 500)
    writes.began(bash('python gen.py'))
    expect(by()).toBeUndefined()
  })

  it('keeps what was saved while it ran once it has ended, failed or not, and nothing saved after', () => {
    writes.began(bash('python gen.py'))
    time += 100
    save('generated')
    time += 100
    writes.ended('s1', 't1', false)
    time += 10_000
    expect(by()).toEqual({ turn })
    save('mine', time)
    expect(by()).toBeUndefined()
  })

  it('wrote a file it put there with an older mtime (cp -p, tar x, mv), while it runs and after', () => {
    writes.began(bash('cp -p old.py board.py'))
    time += 100
    save('copied', time - 86_400_000, board, time)
    expect(by()).toEqual({ turn })
    time += 100
    writes.ended('s1', 't1', true)
    time += 10_000
    expect(by()).toEqual({ turn })
  })

  it('did so with the real clock and a real cp -p', async () => {
    const real = new ClaudeWrites()
    const old = join(dir, 'old.py')
    writeFileSync(old, 'old')
    utimesSync(old, 1_000_000, 1_000_000)
    await new Promise((done) => setTimeout(done, 40))
    real.began(bash('cp -p old.py board.py'))
    expect(spawnSync('cp', ['-p', old, board]).status).toBe(0)
    expect(real.by('p1', board)).toEqual({ turn })
    real.ended('s1', 't1', true)
    expect(real.by('p1', board)).toEqual({ turn })
  })

  it('may have removed a file that goes while it runs or just after, not one that goes later', () => {
    const gone = join(dir, 'gone.py')
    writes.began(bash('rm gone.py'))
    expect(by(gone)).toEqual({ turn })
    writes.ended('s1', 't1', true)
    time += 100
    expect(by(gone)).toEqual({ turn })
    time += 5000
    expect(by(gone)).toBeUndefined()
  })

  it('wrote nothing while it waited for the person, and counts from when they allowed it', () => {
    writes.began(bash('python gen.py'))
    writes.waits('s1', 't1')
    time += 100
    save('mine')
    expect(by()).toBeUndefined()
    time += 1000
    writes.allowed('s1', 't1')
    expect(by()).toBeUndefined()
    time += 100
    save('generated')
    expect(by()).toEqual({ turn })
  })

  it('claims nothing when the command surely writes nothing', () => {
    writes.began(bash('sleep 5'))
    save('mine')
    expect(by()).toBeUndefined()
  })
})

describe('surelyWritesNothing', () => {
  it.each(['sleep 5', 'ls -la', 'cat board.py', 'grep -n U1 board.py | head -5', 'cd sub && ls', 'wc -l *.py; pwd', 'echo done'])('is sure of %s', (command) => {
    expect(surelyWritesNothing(command)).toBe(true)
  })

  it.each([
    'python gen.py', 'echo a > board.py', 'cat a.py >> board.py', "sed -i 's/a/b/' board.py", 'cp a.py board.py', 'rm board.py', 'git checkout board.py',
    'ls $(python gen.py)', 'echo `python gen.py`', 'cat <(python gen.py)', 'cat <<EOF\nx\nEOF', 'ls | xargs rm', 'ls && python gen.py', 'sleep 1 & python gen.py', 'ls\npython gen.py',
    'FOO=1 ls', '/tmp/ls', '', 42
  ])('is not sure of %s', (command) => {
    expect(surelyWritesNothing(command)).toBe(false)
  })
})
