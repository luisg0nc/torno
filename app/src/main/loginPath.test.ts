import { chmodSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { applyLoginPath, mergedPath, pathBetweenMarkers, shellPath } from './loginPath'

const home = '/Users/me'

describe('mergedPath', () => {
  it('puts the shell first, then the rest of the current PATH, then the fallbacks that exist', () => {
    const exists = (dir: string): boolean => dir === '/opt/homebrew/bin' || dir === `${home}/.local/bin`
    expect(mergedPath('/a:/b', '/b:/usr/bin', home, exists)).toBe(`/a:/b:/usr/bin:${home}/.local/bin:/opt/homebrew/bin`)
  })
  it('has no entry twice and none empty or relative', () => {
    expect(mergedPath('/a::rel:/a', ':/c:bin', home, () => false)).toBe('/a:/c')
  })
  it('without a shell takes the current PATH and the fallbacks', () => {
    expect(mergedPath(null, '/usr/bin:/bin', home, () => true)).toBe(`/usr/bin:/bin:${home}/.local/bin:/opt/homebrew/bin:/usr/local/bin:${home}/.claude/local`)
  })
})

describe('pathBetweenMarkers', () => {
  it('ignores what the rc files print', () => {
    expect(pathBetweenMarkers('hello\n__TORNO_PATH__/x:/y__TORNO_PATH__\n')).toBe('/x:/y')
    expect(pathBetweenMarkers('noise')).toBeNull()
    expect(pathBetweenMarkers('__TORNO_PATH__/x')).toBeNull()
  })
})

function shellScript(body: string): string {
  const file = join(mkdtempSync(join(tmpdir(), 'torno-shell-')), 'sh')
  writeFileSync(file, `#!/bin/sh\n${body}\n`)
  chmodSync(file, 0o755)
  return file
}

describe('shellPath', () => {
  it('reads the PATH after the noise', async () => {
    const shell = shellScript('echo "welcome from rc"; printf "\\n__TORNO_PATH__/q:/r__TORNO_PATH__\\n"')
    expect(await shellPath(shell)).toBe('/q:/r')
  })
  it('kills a shell that hangs', async () => {
    const shell = shellScript('exec sleep 30')
    const t = Date.now()
    expect(await shellPath(shell, 300)).toBeNull()
    expect(Date.now() - t).toBeLessThan(5000)
  })
  it('gives null for a shell that does not exist', async () => {
    expect(await shellPath('/no/such/shell')).toBeNull()
  })
})

describe('applyLoginPath', () => {
  it('does nothing off macOS or under test', async () => {
    const env = { PATH: '/usr/bin', SHELL: shellScript('printf "__TORNO_PATH__/z__TORNO_PATH__"') }
    await applyLoginPath('linux', env)
    expect(env.PATH).toBe('/usr/bin')
    await applyLoginPath('darwin', { ...env, TORNO_TEST: '1' })
    expect(env.PATH).toBe('/usr/bin')
  })
  it('sets the PATH on macOS', async () => {
    const env: NodeJS.ProcessEnv = { PATH: '/usr/bin', SHELL: shellScript('printf "__TORNO_PATH__/z__TORNO_PATH__"') }
    await applyLoginPath('darwin', env)
    expect(env.PATH!.startsWith('/z:/usr/bin')).toBe(true)
  })
  it('on failure keeps the current PATH, says so without the shell output, and still adds fallbacks', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    const shell = shellScript('echo secret-output; exit 1')
    const env: NodeJS.ProcessEnv = { PATH: '/usr/bin', SHELL: shell }
    await applyLoginPath('darwin', env)
    expect(env.PATH!.startsWith('/usr/bin')).toBe(true)
    expect(err).toHaveBeenCalledOnce()
    expect(String(err.mock.calls[0][0])).toContain(shell)
    expect(String(err.mock.calls[0][0])).not.toContain('secret-output')
    err.mockRestore()
  })
})
