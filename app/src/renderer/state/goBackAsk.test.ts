import { afterEach, describe, expect, it } from 'vitest'
import { goBackAskStore, strike, unstrike } from './goBackAsk'

afterEach(() => unstrike('a'))

describe('what a Go back that asks would undo', () => {
  it('holds the builds and prompts until the one that asked lets them go', () => {
    strike('a', ['h41', 'h42'], ['u2'])
    expect([...goBackAskStore.getState().nodes]).toEqual(['h41', 'h42'])
    expect([...goBackAskStore.getState().prompts]).toEqual(['u2'])
    unstrike('a')
    expect(goBackAskStore.getState().nodes.size).toBe(0)
  })

  it('is not let go by another that never asked', () => {
    strike('a', ['h41'], [])
    unstrike('b')
    expect(goBackAskStore.getState().nodes.has('h41')).toBe(true)
  })
})
