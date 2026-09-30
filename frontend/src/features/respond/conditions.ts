import type { Condition, Question } from '../../api/types'

type Value = number | number[] | string

const OPERATORS: Record<Condition['operator'], (score: number, threshold: number) => boolean> = {
  '>': (a, b) => a > b,
  '>=': (a, b) => a >= b,
  '<': (a, b) => a < b,
  '<=': (a, b) => a <= b,
  '=': (a, b) => a === b,
}

/**
 * Ids of the questions a respondent should not see, given their answers so
 * far. Mirrors backend/feedback/conditions.py so the form hides exactly what
 * the API would reject: an unanswered source fails, a hidden source counts as
 * unanswered, and a condition whose source was archived does not apply.
 */
export function hiddenQuestions(questions: Question[], answers: Record<string, Value>): Set<number> {
  const hidden = new Set<number>()
  for (const question of questions) {
    const condition = question.condition
    if (!condition?.active) continue
    const source = hidden.has(condition.question_id) ? undefined : answers[String(condition.question_id)]
    const met = typeof source === 'number' && OPERATORS[condition.operator](source, condition.value)
    if (!met) hidden.add(question.id)
  }
  return hidden
}

/** "Shown when Q1 > 2", naming the source by its current position. */
export function describeCondition(condition: Condition, questions: Question[]): string {
  const source = questions.find((q) => q.id === condition.question_id)
  if (!condition.active || !source) return 'Condition off: the question it depended on was archived'
  return `Shown when Q${source.order} ${condition.operator} ${condition.value}`
}
