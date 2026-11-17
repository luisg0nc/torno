import { expect, it } from 'vitest'
import { BOARD_TOOLS } from './Palette'

it('calls the ink-pad tool of the board a Doodle', () => {
  expect(BOARD_TOOLS.find((t) => t.tool === 'sketch')).toMatchObject({ label: 'Doodle', id: 'board.sketch' })
})
