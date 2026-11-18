import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { ChatItem } from '../../../shared/chat'
import { ToolCard, labelParts } from './ToolCard'

type Tool = Extract<ChatItem, { kind: 'tool' }>
const word = (state: Tool['state']): string => {
  const item: Tool = { kind: 'tool', id: 'i1', toolUseId: 't1', name: 'ExitPlanMode', torno: false, input: {}, state, images: [] }
  const out = renderToStaticMarkup(createElement(ToolCard, { item, beat: false }))
  return /<span class="chat-tool-state">(?:<[^>]*>)*([^<]*)<\/span>/.exec(out)?.[1] ?? ''
}

describe('the word on a tool card', () => {
  it('says denied and cancelled as they are, and failed only for an error; a tool that went well says nothing', () => {
    expect([word('denied'), word('cancelled'), word('error'), word('stopped'), word('running'), word('done')]).toEqual(['denied', 'cancelled', 'failed', 'stopped', 'running', ''])
  })
})

describe('the bold word of a tool chip', () => {
  it('is the file of a Read, the name of the others, and torno\'s own name before its hint', () => {
    expect(labelParts('Read', 'Read airbox.py', false)).toEqual(['Read ', 'airbox.py', ''])
    expect(labelParts('Edit', 'Edit airbox.py', false)).toEqual(['', 'Edit', ' airbox.py'])
    expect(labelParts('Bash', 'Bash: ls -la', false)).toEqual(['', 'Bash', ': ls -la'])
    expect(labelParts('mcp__torno__look', 'torno · look (front)', true)).toEqual(['', 'torno · look', ' (front)'])
    expect(labelParts('ExitPlanMode', 'ExitPlanMode', false)).toEqual(['', 'ExitPlanMode', ''])
  })
})
