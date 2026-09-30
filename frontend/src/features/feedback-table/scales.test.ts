import { describe, expect, it } from 'vitest'

import { SURVEYS } from '../../test/server'
import { ratingScores, toneFor } from './scales'

describe('ratingScores', () => {
  it("offers one survey's scale, highest first", () => {
    expect(ratingScores([SURVEYS[0]])).toEqual([5, 4, 3, 2, 1])
  })

  it('offers every score seen across surveys once', () => {
    expect(ratingScores(SURVEYS)).toEqual([10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 0])
  })

  it('is empty with no surveys', () => {
    expect(ratingScores([])).toEqual([])
  })
})

describe('toneFor', () => {
  it.each([
    ['5', 'green'],
    ['4', 'green'],
    ['3', 'amber'],
    ['2', 'red'],
    ['1', 'red'],
  ])('matches the design on 1-5: %s is %s', (value, tone) => {
    expect(toneFor(value, [1, 2, 3, 4, 5])).toBe(tone)
  })

  it('does not fail on a one-point scale', () => {
    expect(toneFor('1', [1])).toBe('amber')
  })
})
