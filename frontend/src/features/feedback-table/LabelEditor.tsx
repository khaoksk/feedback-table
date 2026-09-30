import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'

import { ApiError, updateRatingLabels } from '../../api/client'
import type { Survey } from '../../api/types'

interface Props {
  survey: Survey
  onClose: () => void
}

/**
 * Rename the labels of a survey's rating scale. The table resolves every
 * existing answer against the new labels, so nothing else needs updating.
 */
export function LabelEditor({ survey, onClose }: Props) {
  const queryClient = useQueryClient()
  const [labels, setLabels] = useState(() =>
    Object.fromEntries(survey.rating_scale.map((point) => [String(point.score), point.label])),
  )

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
    save.mutate(labels)
  }

  return (
    <form className="label-editor" aria-labelledby="label-editor-title" onSubmit={submit}>
      <h2 id="label-editor-title">Rating labels: {survey.name}</h2>
      <p className="hint">
        Renaming a label changes how every existing answer with that score is shown.
        {survey.custom_labels ? '' : ' This survey currently uses the default labels.'}
      </p>

      <div className="label-fields">
        {survey.rating_scale.map((point) => (
          <label key={point.score} className="label-field">
            <span className="score">{point.score}</span>
            <input
              value={labels[String(point.score)] ?? ''}
              maxLength={40}
              aria-label={`Label for score ${point.score}`}
              onChange={(event) => setLabels({ ...labels, [String(point.score)]: event.target.value })}
            />
          </label>
        ))}
      </div>

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
