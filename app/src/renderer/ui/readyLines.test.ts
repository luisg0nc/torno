import { describe, expect, it } from 'vitest'
import type { Ready } from '../../shared/ready'
import { allReady, flat, foldedLine, glyphOf, lacking, makesEnvironment, readinessLines, text, type Line } from './readyLines'

const found: Ready = {
  searched: '/usr/local/bin:/usr/bin',
  claude: { command: 'claude', path: '/usr/local/bin/claude', version: '2.1.307', account: 'signed-in' },
  uv: { path: '/usr/bin/uv', version: '0.9.1' },
  environment: { kind: 'torno', dir: '/repo/kernel/.venv', made: true },
  making: { state: 'idle' },
  kernel: { state: 'ready', versions: { build123d: '0.13.0', python: '3.12.4' } }
}
const with_ = (over: Partial<Ready>): Ready => ({ ...found, ...over })
const line = (lines: Line[], id: Line['id']): Line => lines.find((l) => l.id === id)!

describe('Claude Code', () => {
  it('found: where it is, its version and that it is signed in, with the ok sign', () => {
    const l = line(readinessLines(found), 'claude')
    expect(l.tone).toBe('ok')
    expect(text(l)).toBe('Claude Code found at /usr/local/bin/claude, version 2.1.307, signed in')
  })

  it('found, and not asked (under test): only where it is', () => {
    const l = line(readinessLines(with_({ claude: { command: 'claude', path: '/usr/local/bin/claude' } })), 'claude')
    expect(l.tone).toBe('ok')
    expect(text(l)).toBe('Claude Code found at /usr/local/bin/claude')
  })

  it('missing: says it, what to do, and what torno looked on', () => {
    const l = line(readinessLines(with_({ claude: { command: 'claude', path: null } })), 'claude')
    expect(l.tone).toBe('fail')
    expect(text(l)).toBe('Claude Code Not found on PATH. Install Claude Code and log in, then reopen torno. See Requirements in the README.')
    expect(flat(l.note ?? [])).toBe('Looked in /usr/local/bin:/usr/bin')
  })

  it('signed out: fails, and says what to do', () => {
    const l = line(readinessLines(with_({ claude: { command: 'claude', path: '/usr/bin/claude', version: '2.1.307', account: 'signed-out' } })), 'claude')
    expect(l.tone).toBe('fail')
    expect(text(l)).toBe('Claude Code found at /usr/bin/claude, version 2.1.307, but not signed in. Run claude in a terminal and log in, then check again.')
  })

  it('silent when asked: warns that it may start and leave at once', () => {
    const l = line(readinessLines(with_({ claude: { command: 'claude', path: '/usr/bin/claude', silent: true } })), 'claude')
    expect(l.tone).toBe('warn')
    expect(text(l)).toContain('did not answer')
  })

  it('a version outside what torno was checked with is a quiet note, not a failure', () => {
    const l = line(readinessLines(with_({ claude: { ...found.claude, version: '2.2.0', range: 'newer', tested: { min: '2.1.300', max: '2.1.301' } } })), 'claude')
    expect(l.tone).toBe('ok')
    expect(flat(l.note ?? [])).toBe('Claude Code 2.2.0 is newer than the versions torno was checked with (2.1.300 to 2.1.301): if something in the chat looks wrong, this may be why.')
  })
})

describe('uv', () => {
  it('has a line only when it is missing', () => {
    expect(readinessLines(found).some((l) => l.id === 'uv')).toBe(false)
    const l = line(readinessLines(with_({ uv: { path: null } })), 'uv')
    expect(l.tone).toBe('fail')
    expect(text(l)).toBe('uv Not found on PATH. Install it from docs.astral.sh/uv, then reopen torno.')
  })
})

describe('the kernel', () => {
  it('ready: build123d, Python and uv versions', () => {
    const l = line(readinessLines(found), 'kernel')
    expect(l.tone).toBe('ok')
    expect(text(l)).toBe('Kernel build123d 0.13.0, Python 3.12.4, uv 0.9.1')
  })

  it("without a workspace and made: torno's environment is made", () => {
    const l = line(readinessLines(with_({ kernel: { state: 'none' } })), 'kernel')
    expect(l.tone).toBe('ok')
    expect(text(l)).toBe("Kernel torno's Python environment is made, uv 0.9.1")
  })

  it('without a workspace and not made: says what the first time costs and offers to make it', () => {
    const l = line(readinessLines(with_({ kernel: { state: 'none' }, environment: { kind: 'torno', dir: '/x', made: false } })), 'kernel')
    expect(l.tone).toBe('warn')
    expect(text(l)).toBe('Kernel Not made yet: about 900 MB is fetched the first time, so the first run needs the network.')
    expect(l.action).toBe('make')
  })

  it('does not offer to make it without uv', () => {
    const lines = readinessLines(with_({ uv: { path: null }, kernel: { state: 'none' }, environment: { kind: 'torno', dir: '/x', made: false } }))
    expect(lines.find((l) => l.id === 'kernel')?.action).toBeUndefined()
  })

  it('while it is being made by the person asking: preparing, with the lines uv prints', () => {
    const l = line(readinessLines(with_({ kernel: { state: 'none' }, environment: { kind: 'torno', dir: '/x', made: false }, making: { state: 'making', lines: ['Resolved 12 packages', 'Downloading build123d'] } })), 'kernel')
    expect(l.tone).toBe('wait')
    expect(text(l)).toBe("Kernel Preparing torno's Python environment (the first time takes a minute or two).")
    expect(l.progress).toEqual(['Resolved 12 packages', 'Downloading build123d'])
    expect(l.action).toBeUndefined()
  })

  it('while a workspace opened with none is starting and the environment is not made: the same words', () => {
    const l = line(readinessLines(with_({ kernel: { state: 'starting' }, environment: { kind: 'torno', dir: '/x', made: false } })), 'kernel')
    expect(l.tone).toBe('wait')
    expect(text(l)).toContain("Preparing torno's Python environment")
  })

  it('starting with the environment there is only starting', () => {
    const l = line(readinessLines(with_({ kernel: { state: 'starting' } })), 'kernel')
    expect(text(l)).toBe('Kernel Starting.')
  })

  it('failed: the reason from main, as it came', () => {
    const l = line(readinessLines(with_({ kernel: { state: 'failed', reason: 'kernel stopped\ncould not run uv: spawn uv ENOENT' } })), 'kernel')
    expect(l.tone).toBe('fail')
    expect(text(l)).toBe('Kernel Did not start: kernel stopped\ncould not run uv: spawn uv ENOENT')
  })

  it('failed over an environment that is not made: also offers to make it; made, it does not', () => {
    const failed: Ready['kernel'] = { state: 'failed', reason: 'kernel stopped' }
    expect(line(readinessLines(with_({ kernel: failed, environment: { kind: 'torno', dir: '/x', made: false } })), 'kernel').action).toBe('make')
    expect(line(readinessLines(with_({ kernel: failed })), 'kernel').action).toBeUndefined()
    expect(line(readinessLines(with_({ kernel: failed, uv: { path: null }, environment: { kind: 'torno', dir: '/x', made: false } })), 'kernel').action).toBeUndefined()
  })

  it('failed while the person has it made: preparing, not the old failure', () => {
    const l = line(readinessLines(with_({ kernel: { state: 'failed', reason: 'kernel stopped' }, environment: { kind: 'torno', dir: '/x', made: false }, making: { state: 'making', lines: ['Resolved 3 packages'] } })), 'kernel')
    expect(l.tone).toBe('wait')
    expect(l.progress).toEqual(['Resolved 3 packages'])
  })

  it('making failed: the reason, and a way to try again', () => {
    const l = line(readinessLines(with_({ kernel: { state: 'none' }, environment: { kind: 'torno', dir: '/x', made: false }, making: { state: 'failed', reason: 'network unreachable', lines: [] } })), 'kernel')
    expect(l.tone).toBe('fail')
    expect(text(l)).toBe("Kernel Could not make torno's Python environment: network unreachable")
    expect(l.action).toBe('make')
  })

  it('has no line of its own when uv is missing and it has said nothing', () => {
    expect(readinessLines(with_({ uv: { path: null }, kernel: { state: 'none' } })).some((l) => l.id === 'kernel')).toBe(false)
  })
})

describe('the environment of a folder with its own project', () => {
  const own = (made: boolean): Partial<Ready> => ({ environment: { kind: 'workspace', dir: '/w/.venv', made } })

  it('is there: said, and the kernel line goes on as ever', () => {
    const lines = readinessLines(with_(own(true)))
    expect(text(line(lines, 'project'))).toBe('This folder has a pyproject.toml, and its .venv is there')
    expect(line(lines, 'project').tone).toBe('ok')
  })

  it('is not there: the first build would fail, and torno does not run uv sync there', () => {
    const lines = readinessLines(with_({ ...own(false), kernel: { state: 'failed', reason: 'This workspace has a pyproject.toml but no .venv.' } }))
    const l = line(lines, 'project')
    expect(l.tone).toBe('fail')
    expect(text(l)).toBe('This folder has a pyproject.toml but no .venv. Run uv sync in it once and open it again: torno never does that.')
    expect(lines.some((x) => x.id === 'kernel')).toBe(false)
  })
})

describe('the summary', () => {
  it('folds to one line when everything is ready', () => {
    const lines = readinessLines(found)
    expect(allReady(lines)).toBe(true)
    expect(foldedLine(found, lines)).toBe('Claude Code 2.1.307 and build123d 0.13.0 are ready')
  })

  it('says Claude Code alone while its version is not asked for (under test), and names no version it does not have', () => {
    const ready = with_({ claude: { command: 'claude', path: '/usr/local/bin/claude' } })
    expect(foldedLine(ready, readinessLines(ready))).toBe('Claude Code and build123d 0.13.0 are ready')
  })

  it("names torno's environment while no kernel has spoken", () => {
    const ready = with_({ kernel: { state: 'none' } })
    expect(foldedLine(ready, readinessLines(ready))).toBe("Claude Code 2.1.307 and torno's Python environment are ready")
  })

  it('does not fold while anything is waiting, warned of or failed', () => {
    for (const ready of [with_({ claude: { command: 'claude', path: null } }), with_({ kernel: { state: 'starting' }, environment: { kind: 'torno', dir: '/x', made: false } }), with_({ kernel: { state: 'none' }, environment: { kind: 'torno', dir: '/x', made: false } })]) {
      expect(allReady(readinessLines(ready))).toBe(false)
    }
  })

  it('folds over a kernel that is only starting, its environment there: seconds, not a reason to keep the block open', () => {
    const ready = with_({ kernel: { state: 'starting' } })
    expect(allReady(readinessLines(ready))).toBe(true)
    expect(foldedLine(ready, readinessLines(ready))).toBe("Claude Code 2.1.307 and torno's Python environment are ready")
  })

  it('lacking is what is warned of or failed', () => {
    const lines = readinessLines(with_({ claude: { command: 'claude', path: null }, uv: { path: null } }))
    expect(lacking(lines).map((l) => l.id)).toEqual(['claude', 'uv'])
  })
})

describe('the build that makes the environment', () => {
  const unmade: Ready['environment'] = { kind: 'torno', dir: '/x', made: false }
  it('is the one while the kernel starts over an environment that is not made, and no other', () => {
    expect(makesEnvironment(with_({ kernel: { state: 'starting' }, environment: unmade }))).toBe(true)
    expect(makesEnvironment(with_({ kernel: { state: 'starting' } }))).toBe(false)
    expect(makesEnvironment(with_({ kernel: { state: 'ready', versions: {} }, environment: unmade }))).toBe(false)
    expect(makesEnvironment(with_({ kernel: { state: 'starting' }, environment: { kind: 'workspace', dir: '/w/.venv', made: false } }))).toBe(false)
    expect(makesEnvironment(null)).toBe(false)
  })
})

describe('the glyphs', () => {
  it('a tick for ready, ! for a warning, × for a failure, and an ellipsis while it waits', () => {
    expect(['ok', 'warn', 'fail', 'wait'].map((tone) => glyphOf(tone as Line['tone']))).toEqual(['✓', '!', '×', '…'])
  })
})
