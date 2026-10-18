// node-pty 1.1.0's macOS prebuilds ship `spawn-helper` without its execute bit, and every terminal session then
// fails with `posix_spawnp failed`. Run by `postinstall`: gives the bit back. Silent, idempotent, and it does
// nothing where the files are not there.
import { chmodSync, statSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'

try {
  const root = dirname(createRequire(import.meta.url).resolve('node-pty/package.json'))
  for (const arch of ['darwin-arm64', 'darwin-x64']) {
    const helper = join(root, 'prebuilds', arch, 'spawn-helper')
    try {
      const mode = statSync(helper).mode
      if ((mode & 0o111) !== 0o111) chmodSync(helper, 0o755)
    } catch {
      // not there
    }
  }
} catch {
  // node-pty is not installed
}
