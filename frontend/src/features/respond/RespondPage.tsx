import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'

import { ApiError, fetchSurveys, submitResponse } from '../../api/client'
import type { Question, Survey } from '../../api/types'

type Answers = Record<string, number | number[] | string>

export const MAX_COMMENT_LENGTH = 2000

/**
 * A respondent answers one survey: ratings on the survey's own scale, and
 * one or more options for multi-select questions. Any question may be skipped,
 * but at least one must be answered.
 */
export function RespondPage() {
  const surveysQuery = useQuery({ queryKey: ['surveys'], queryFn: ({ signal }) => fetchSurveys(signal) })
  const surveys = surveysQuery.data ?? []
  const [surveyId, setSurveyId] = useState<number | null>(null)
  const survey = surveys.find((s) => s.id === surveyId) ?? surveys[0]
  const [submitted, setSubmitted] = useState<{ id: number; surveyId: number } | null>(null)

  return (
    <main className="page">
      <header>
        <h1>Answer a survey</h1>
        <p className="subtitle">Fill in a survey as a customer would. Your response appears in the feedback table.</p>
      </header>

      {surveysQuery.isError && (
        <p className="error" role="alert">
          Couldn't load surveys.
        </p>
      )}

      {submitted ? (
        <div className="panel-form" role="status">
          <h2>Thanks, your response was recorded</h2>
          <p className="hint">Response #{submitted.id}.</p>
          <div className="editor-actions">
            <a className="button-link primary" href={`/?survey=${submitted.surveyId}`}>
              See it in the feedback table
            </a>
            <button type="button" onClick={() => setSubmitted(null)}>
              Answer another
            </button>
          </div>
        </div>
      ) : (
        survey && (
          <>
            <div className="toolbar">
              <label htmlFor="respond-survey">Survey</label>
              <select
                id="respond-survey"
                value={survey.id}
                onChange={(event) => setSurveyId(Number(event.target.value))}
              >
                {surveys.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>
            <ResponseForm
              key={survey.id}
              survey={survey}
              onSubmitted={(id) => setSubmitted({ id, surveyId: survey.id })}
            />
          </>
        )
      )}
    </main>
  )
}

function ResponseForm({ survey, onSubmitted }: { survey: Survey; onSubmitted: (id: number) => void }) {
  const queryClient = useQueryClient()
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [company, setCompany] = useState('')
  const [answers, setAnswers] = useState<Answers>({})

  const send = useMutation({
    mutationFn: () => submitResponse(survey.id, { name, email, company, answers }),
    onSuccess: async ({ id }) => {
      await queryClient.invalidateQueries({ queryKey: ['feedback-table'] })
      onSubmitted(id)
    },
  })

  const answered = Object.keys(answers).length
  const errors =
    send.error instanceof ApiError && send.error.messages.length > 0
      ? send.error.messages
      : send.error
        ? ["Couldn't send your response. Try again."]
        : []

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
    send.mutate()
  }

  return (
    <form className="panel-form respond-form" aria-label={`Answer ${survey.name}`} onSubmit={submit}>
      <div className="form-row">
        <label htmlFor="respond-email">Email</label>
        <input id="respond-email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
      </div>
      <div className="form-row">
        <label htmlFor="respond-name">Name (optional)</label>
        <input id="respond-name" type="text" value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      <div className="form-row">
        <label htmlFor="respond-company">Company (optional)</label>
        <input id="respond-company" type="text" value={company} onChange={(e) => setCompany(e.target.value)} />
      </div>

      {survey.questions.map((question) => (
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
        </fieldset>
      ))}

      {errors.length > 0 && (
        <ul className="error" role="alert">
          {errors.map((message) => (
            <li key={message}>{message}</li>
          ))}
        </ul>
      )}

      <div className="editor-actions">
        <button type="submit" className="primary" disabled={send.isPending || answered === 0}>
          {send.isPending ? 'Sending…' : 'Submit response'}
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
