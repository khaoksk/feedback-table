import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'

import { ApiError, updateRatingLabels } from '../../api/client'
import type { Survey } from '../../api/types'

interface Props {
  survey: Survey
  onClose: () => void
}

const LOWEST_SCORES = [0, 1]
const HIGHEST_SCORES = [3, 4, 5, 6, 7, 8, 9, 10]

function range(low: number, high: number): number[] {
  return Array.from({ length: high - low + 1 }, (_, i) => low + i)
}

/**
 * Rename the labels of a survey's rating scale, or change its range (Req 5).
 * The table resolves every existing answer against the new labels; scores
 * outside a new range show as legacy. Nothing stored is rewritten.
 */
export function LabelEditor({ survey, onClose }: Props) {
  const queryClient = useQueryClient()
  const current = survey.rating_scale.map((point) => point.score)
  const [low, setLow] = useState(Math.min(...current))
  const [high, setHigh] = useState(Math.max(...current))
  // Every label typed so far, including scores outside the range, so narrowing
  // and widening again does not lose them.
  const [labels, setLabels] = useState<Record<string, string>>(() =>
    Object.fromEntries(survey.rating_scale.map((point) => [String(point.score), point.label])),
  )
  const scores = range(low, high)
  const dropped = current.filter((score) => score < low || score > high)

  const save = useMutation({
    mutationFn: (next: Record<string, string> | null) => updateRatingLabels(survey.id, next),
    onSuccess: async () => {
      // Labels appear in the survey list and in every resolved answer.
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['surveys'] }),
        queryClient.invalidateQueries({ queryKey: ['feedback-table'] }),
      ])
      onClose()
    },
  })

  const errors =
    save.error instanceof ApiError && save.error.messages.length > 0
      ? save.error.messages
      : save.error
        ? ["Couldn't save the labels. Try again."]
        : []

  function submit(event: FormEvent) {
    event.preventDefault()
    save.mutate(Object.fromEntries(scores.map((score) => [String(score), labels[String(score)] ?? String(score)])))
  }

  return (
    <form className="label-editor" aria-labelledby="label-editor-title" onSubmit={submit}>
      <h2 id="label-editor-title">Rating labels: {survey.name}</h2>
      <p className="hint">
        Renaming a label changes how every existing answer with that score is shown.
        {survey.custom_labels ? '' : ' This survey currently uses the default labels.'}
      </p>

      <div className="scale-range">
        <label htmlFor="scale-low">Scale from</label>
        <select id="scale-low" aria-label="Lowest score" value={low} onChange={(e) => setLow(Number(e.target.value))}>
          {LOWEST_SCORES.map((score) => (
            <option key={score} value={score}>
              {score}
            </option>
          ))}
        </select>
        <label htmlFor="scale-high">to</label>
        <select id="scale-high" aria-label="Highest score" value={high} onChange={(e) => setHigh(Number(e.target.value))}>
          {HIGHEST_SCORES.map((score) => (
            <option key={score} value={score}>
              {score}
            </option>
          ))}
        </select>
      </div>

      <div className="label-fields">
        {scores.map((score) => (
          <label key={score} className="label-field">
            <span className="score">{score}</span>
            <input
              value={labels[String(score)] ?? String(score)}
              maxLength={40}
              aria-label={`Label for score ${score}`}
              onChange={(event) => setLabels({ ...labels, [String(score)]: event.target.value })}
            />
          </label>
        ))}
      </div>

      {dropped.length > 0 && (
        <p className="hint" role="note">
          Existing answers with score {dropped.join(', ')} will show as legacy (Unrated). They are not changed.
        </p>
      )}

      {errors.length > 0 && (
        <ul className="error" role="alert">
          {errors.map((message) => (
            <li key={message}>{message}</li>
          ))}
        </ul>
      )}

      <div className="editor-actions">
        <button type="submit" className="primary" disabled={save.isPending}>
          {save.isPending ? 'Saving…' : 'Save labels'}
        </button>
        <button type="button" onClick={onClose} disabled={save.isPending}>
          Cancel
        </button>
        {survey.custom_labels && (
          <button type="button" className="link-button" onClick={() => save.mutate(null)} disabled={save.isPending}>
            Reset to default labels
          </button>
        )}
      </div>
    </form>
  )
}
