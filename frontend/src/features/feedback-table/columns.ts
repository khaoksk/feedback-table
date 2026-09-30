import type { Question, Survey } from '../../api/types'

/**
 * Number of question columns: the highest question order across the given
 * surveys (the design's "Q1, Q2, … up to the highest order"). Pass every
 * survey for the all-surveys view, or just the selected one.
 */
export function columnCount(surveys: Survey[]): number {
  return surveys.reduce((max, survey) => Math.max(max, ...survey.questions.map((q) => q.order)), 0)
}

/** The survey's question at a column position, if it has one. */
export function questionAt(survey: Survey | undefined, position: number): Question | undefined {
  return survey?.questions.find((q) => q.order === position)
}
