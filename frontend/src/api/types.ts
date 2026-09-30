// Shapes returned by the Django API (backend/feedback/views.py).

/** How the backend resolved a stored answer (docs/PRD.md §6). */
export type AnswerState = 'ok' | 'legacy' | 'invalid' | 'unanswered'

export interface AnswerCell {
  value: string | null
  display: string | null
  state: AnswerState
}

export interface Question {
  id: number
  order: number
  text: string
  type: string
}

export interface RatingPoint {
  score: number
  label: string
}

export interface Survey {
  id: number
  name: string
  /** The survey's scale in score order, with its current labels. */
  rating_scale: RatingPoint[]
  /** False when the survey uses the default Terrible…Great labels. */
  custom_labels: boolean
  questions: Question[]
}

export type ResponseStatus = 'completed' | 'draft'

export interface FeedbackRow {
  id: number
  submitted_at: string
  status: ResponseStatus
  customer: { name: string; email: string; company: string }
  ticket: { id: number; subject: string } | null
  survey_id: number
  /** Keyed by question id; every question of the response's survey is present. */
  answers: Record<string, AnswerCell>
}

export interface FeedbackTablePage {
  count: number
  next: string | null
  previous: string | null
  results: FeedbackRow[]
}
