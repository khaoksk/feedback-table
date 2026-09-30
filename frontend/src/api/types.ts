// Shapes returned by the Django API (backend/feedback/views.py).

/** How the backend resolved a stored answer (docs/PRD.md §6). */
export type AnswerState = 'ok' | 'legacy' | 'invalid' | 'unanswered' | 'removed_option' | 'condition_not_met'

/** One chosen option of a multi-select answer, with its current label. */
export interface Selection {
  id: number
  label: string
  /** The option was archived or deleted after the answer was given. */
  removed: boolean
}

/** How a re-answered value started out (Req 4). */
export interface EditedInfo {
  original_value: string
  /** The original, resolved with the survey's current labels and options. */
  original_display: string | null
  original_at: string
  edit_count: number
}

export interface AnswerCell {
  value: string | null
  display: string | null
  state: AnswerState
  /** Present for multi-select answers only. */
  selections?: Selection[]
  /** Present when the respondent changed this answer after submitting. */
  edited?: EditedInfo
}

export type QuestionType = 'rating' | 'multiselect' | 'comment'

export interface Option {
  id: number
  label: string
  order: number
}

/** Show a question only when an earlier rating meets this (Req 6). */
export interface Condition {
  question_id: number
  operator: '>' | '>=' | '<' | '<=' | '='
  value: number
  /** False when the source question was archived: the question then always shows. */
  active: boolean
}

export interface Question {
  id: number
  order: number
  text: string
  type: QuestionType
  condition: Condition | null
  /** Options a respondent can pick (multi-select); empty for ratings. */
  options: Option[]
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

/** A question removed from its survey; its answers are kept (Req 5). */
export interface ArchivedQuestion {
  id: number
  text: string
  type: QuestionType
  archived_at: string
  answer_count: number
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
