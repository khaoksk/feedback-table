import { useState, type FormEvent } from 'react'

import type { Question, Survey } from '../../api/types'
import { hiddenQuestions } from './conditions'

/** Question id to a score (rating), option ids (multi-select) or text (comment). */
export type Answers = Record<string, number | number[] | string>

export interface Contact {
  name: string
  email: string
  company: string
}

export const MAX_COMMENT_LENGTH = 2000

interface Props {
  survey: Survey
  /** Answers already saved (editing); empty for a new response. */
  initialAnswers?: Answers
  /** Who is answering, when already known (editing); asked for otherwise. */
  knownContact?: Contact
  submitLabel: string
  pending: boolean
  errors: string[]
  onSubmit: (answers: Answers, contact: Contact) => void
}

/**
 * The questions of one survey as form fields: ratings on the survey's own
 * scale, checkboxes for multi-select, a text box for comments. Any question
 * may be left blank, but at least one must be answered.
 */
export function ResponseForm({
  survey,
  initialAnswers = {},
  knownContact,
  submitLabel,
  pending,
  errors,
  onSubmit,
}: Props) {
  const [contact, setContact] = useState<Contact>(knownContact ?? { name: '', email: '', company: '' })
  const [answers, setAnswers] = useState<Answers>(initialAnswers)

  // Recomputed on every change, so later questions appear and disappear as
  // earlier ratings are picked (Req 6).
  const hidden = hiddenQuestions(survey.questions, answers)
  const visibleAnswers = Object.fromEntries(
    Object.entries(answers).filter(([questionId]) => !hidden.has(Number(questionId))),
  )
  const answered = Object.keys(visibleAnswers).length
  // Saved answers cannot be removed by an edit (docs/PRD.md §11); say so
  // rather than silently keeping them.
  const kept = survey.questions.filter((q) => String(q.id) in initialAnswers && !(String(q.id) in answers))

  function setAnswer(question: Question, value: number | number[] | string | null) {
    const next = { ...answers }
    // An emptied answer counts as skipped: no ticks, or only whitespace typed.
    const empty =
      value === null ||
      (Array.isArray(value) && value.length === 0) ||
      (typeof value === 'string' && value.trim() === '')
    if (empty) delete next[String(question.id)]
    else next[String(question.id)] = value
    setAnswers(next)
  }

  function submit(event: FormEvent) {
    event.preventDefault()
    // Answers to questions hidden now are not sent: the API would reject them.
    onSubmit(visibleAnswers, contact)
  }

  return (
    <form className="panel-form respond-form" aria-label={`Answer ${survey.name}`} onSubmit={submit}>
      {knownContact ? (
        <p className="hint">
          Answering as {knownContact.name || 'Anonymous'} ({knownContact.email})
        </p>
      ) : (
        <>
          <div className="form-row">
            <label htmlFor="respond-email">Email</label>
            <input
              id="respond-email"
              type="email"
              required
              value={contact.email}
              onChange={(e) => setContact({ ...contact, email: e.target.value })}
            />
          </div>
          <div className="form-row">
            <label htmlFor="respond-name">Name (optional)</label>
            <input
              id="respond-name"
              type="text"
              value={contact.name}
              onChange={(e) => setContact({ ...contact, name: e.target.value })}
            />
          </div>
          <div className="form-row">
            <label htmlFor="respond-company">Company (optional)</label>
            <input
              id="respond-company"
              type="text"
              value={contact.company}
              onChange={(e) => setContact({ ...contact, company: e.target.value })}
            />
          </div>
        </>
      )}

      {survey.questions.map((question) =>
        hidden.has(question.id) ? (
          String(question.id) in initialAnswers && (
            <p key={question.id} className="hint kept-note">
              Q{question.order} is hidden by its condition; your earlier answer to it is kept.
            </p>
          )
        ) : (
        <fieldset key={question.id} className="form-row question">
          <legend>
            Q{question.order}. {question.text}
          </legend>
          {question.type === 'rating' ? (
            <RatingInput
              question={question}
              survey={survey}
              value={answers[String(question.id)] as number | undefined}
              onChange={(value) => setAnswer(question, value)}
            />
          ) : question.type === 'comment' ? (
            <CommentInput
              question={question}
              value={(answers[String(question.id)] as string | undefined) ?? ''}
              onChange={(value) => setAnswer(question, value)}
            />
          ) : (
            <OptionsInput
              question={question}
              value={(answers[String(question.id)] as number[] | undefined) ?? []}
              onChange={(value) => setAnswer(question, value)}
            />
          )}
          {kept.includes(question) && (
            <p className="hint kept-note">Your saved answer is kept: answers can be changed but not removed.</p>
          )}
        </fieldset>
        ),
      )}

      {errors.length > 0 && (
        <ul className="error" role="alert">
          {errors.map((message) => (
            <li key={message}>{message}</li>
          ))}
        </ul>
      )}

      <div className="editor-actions">
        <button type="submit" className="primary" disabled={pending || answered === 0}>
          {pending ? 'Sending…' : submitLabel}
        </button>
        {answered === 0 && <span className="hint">Answer at least one question.</span>}
      </div>
    </form>
  )
}

function RatingInput({
  question,
  survey,
  value,
  onChange,
}: {
  question: Question
  survey: Survey
  value: number | undefined
  onChange: (value: number | null) => void
}) {
  return (
    <div className="rating-input">
      {survey.rating_scale.map((point) => (
        <label key={point.score} className="rating-choice">
          <input
            type="radio"
            name={`q${question.id}`}
            checked={value === point.score}
            onChange={() => onChange(point.score)}
          />
          <span className="score">{point.score}</span>
          <span className="label">{point.label}</span>
        </label>
      ))}
      {value !== undefined && (
        <button type="button" className="link-button" onClick={() => onChange(null)}>
          Clear
        </button>
      )}
    </div>
  )
}

function CommentInput({
  question,
  value,
  onChange,
}: {
  question: Question
  value: string
  onChange: (value: string) => void
}) {
  const counterId = `q${question.id}-count`
  return (
    <div className="comment-input">
      <textarea
        aria-label={question.text}
        aria-describedby={counterId}
        rows={4}
        maxLength={MAX_COMMENT_LENGTH}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
      <span id={counterId} className="hint">
        {value.length.toLocaleString()} / {MAX_COMMENT_LENGTH.toLocaleString()}
      </span>
    </div>
  )
}

function OptionsInput({
  question,
  value,
  onChange,
}: {
  question: Question
  value: number[]
  onChange: (value: number[]) => void
}) {
  return (
    <div className="options-input">
      {question.options.map((option) => (
        <label key={option.id} className="inline-choice">
          <input
            type="checkbox"
            checked={value.includes(option.id)}
            onChange={(event) =>
              onChange(event.target.checked ? [...value, option.id] : value.filter((id) => id !== option.id))
            }
          />
          {option.label}
        </label>
      ))}
    </div>
  )
}
