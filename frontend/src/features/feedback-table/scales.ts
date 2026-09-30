import type { Survey } from '../../api/types'

/** Every score offered by the given surveys, highest first (for the rating chips). */
export function ratingScores(surveys: Survey[]): number[] {
  const scores = new Set(surveys.flatMap((survey) => survey.rating_scale.map((point) => point.score)))
  return [...scores].sort((a, b) => b - a)
}

/**
 * Badge colour for a score, by its position on the survey's own scale: the top
 * quarter is green, the middle amber, the rest red. On 1-5 that is the design's
 * 4-5 / 3 / 1-2; a 0-10 survey gets 8-10 / 5-7 / 0-4.
 */
export function toneFor(value: string | null, scale: number[]): 'green' | 'amber' | 'red' {
  const score = Number(value)
  if (scale.length < 2) return 'amber'
  const low = Math.min(...scale)
  const high = Math.max(...scale)
  const position = (score - low) / (high - low)
  if (position >= 0.75) return 'green'
  if (position >= 0.5) return 'amber'
  return 'red'
}
