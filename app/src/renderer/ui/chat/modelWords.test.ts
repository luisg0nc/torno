import { expect, it } from 'vitest'
import { modelShown } from './modelWords'

it('drops the claude- of a model id and nothing else', () => {
  expect(modelShown('claude-opus-5-5')).toBe('opus-5-5')
  expect(modelShown('claude-sonnet-5-5[1m]')).toBe('sonnet-5-5[1m]')
  expect(modelShown('fake-model')).toBe('fake-model')
  expect(modelShown('opus')).toBe('opus')
})
