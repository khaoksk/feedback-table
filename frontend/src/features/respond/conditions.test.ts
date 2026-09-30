import { describe, expect, it } from 'vitest'

import type { Condition, Question } from '../../api/types'
import { describeCondition, hiddenQuestions } from './conditions'

function question(id: number, order: number, condition: Condition | null = null): Question {
  return { id, order, text: `Q${order}`, type: 'rating', options: [], condition }
}

const above2 = (source: number, active = true): Condition => ({ question_id: source, operator: '>', value: 2, active })

describe('hiddenQuestions (mirrors backend/feedback/conditions.py)', () => {
  const q1 = question(1, 1)
  const q2 = question(2, 2, above2(1))

  it.each([
    [3, false],
    [2, true], // the design's boundary: Q1 > 2 hides at exactly 2
    [0, true],
  ])('Q1 = %s hides Q2: %s', (score, hidden) => {
    expect(hiddenQuestions([q1, q2], { '1': score }).has(2)).toBe(hidden)
  })

  it('hides the question while the source is unanswered', () => {
    expect(hiddenQuestions([q1, q2], {})).toEqual(new Set([2]))
  })

  it('treats a hidden source as unanswered for a chained condition', () => {
    const q3 = question(3, 3, { question_id: 2, operator: '>', value: 0, active: true })

    expect(hiddenQuestions([q1, q2, q3], { '1': 1, '2': 5 })).toEqual(new Set([2, 3]))
    expect(hiddenQuestions([q1, q2, q3], { '1': 4, '2': 5 })).toEqual(new Set())
  })

  it('ignores a condition switched off because its source was archived', () => {
    expect(hiddenQuestions([question(2, 1, above2(1, false))], {})).toEqual(new Set())
  })

  it.each([
    ['>=', 2, true], ['<', 2, false], ['<=', 2, true], ['=', 2, true], ['=', 3, false],
  ] as const)('operator %s %s against a score of 2 shows: %s', (operator, value, shows) => {
    const dependent = question(2, 2, { question_id: 1, operator, value, active: true })
    expect(hiddenQuestions([q1, dependent], { '1': 2 }).has(2)).toBe(!shows)
  })
})

describe('describeCondition', () => {
  it('names the source by its current position', () => {
    expect(describeCondition(above2(7), [question(7, 1)])).toBe('Shown when Q1 > 2')
  })

  it('explains a condition that no longer applies', () => {
    expect(describeCondition(above2(7, false), [])).toBe('Condition off: the question it depended on was archived')
  })
})
