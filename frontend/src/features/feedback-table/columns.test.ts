import { describe, expect, it } from 'vitest'

import { SURVEYS } from '../../test/server'
import { columnCount, questionAt } from './columns'

describe('columnCount', () => {
  it('is the highest question order across the surveys', () => {
    expect(columnCount(SURVEYS)).toBe(3)
    expect(columnCount([SURVEYS[0]])).toBe(2)
  })

  it('is zero with no surveys', () => {
    expect(columnCount([])).toBe(0)
  })

  it('follows order values, not question counts', () => {
    const gappy = {
      ...SURVEYS[0],
      id: 9,
      name: 'Gappy',
      questions: [{ id: 1, order: 4, text: 'x', type: 'rating' }],
    }
    expect(columnCount([gappy])).toBe(4)
  })
})

describe('questionAt', () => {
  it('finds the question at a position', () => {
    expect(questionAt(SURVEYS[1], 3)?.id).toBe(23)
  })

  it('is undefined past the end of a shorter survey', () => {
    expect(questionAt(SURVEYS[0], 3)).toBeUndefined()
    expect(questionAt(undefined, 1)).toBeUndefined()
  })
})
