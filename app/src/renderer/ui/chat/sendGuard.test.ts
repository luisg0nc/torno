import { describe, expect, it } from 'vitest'
import { sendGuard } from './sendGuard'

describe('sendGuard', () => {
  it('lets go of a second send while the first runs, and runs the next one after it', async () => {
    const guard = sendGuard()
    let release!: () => void
    const ran: string[] = []
    const first = guard.run(async () => {
      ran.push('first')
      await new Promise<void>((resolve) => (release = resolve))
    })
    expect(guard.busy()).toBe(true)
    expect(await guard.run(async () => void ran.push('second'))).toBe(false)
    release()
    expect(await first).toBe(true)
    expect(guard.busy()).toBe(false)
    expect(await guard.run(async () => void ran.push('third'))).toBe(true)
    expect(ran).toEqual(['first', 'third'])
  })

  it('opens again when the job throws', async () => {
    const guard = sendGuard()
    await expect(guard.run(async () => Promise.reject(new Error('no')))).rejects.toThrow('no')
    expect(guard.busy()).toBe(false)
  })
})
