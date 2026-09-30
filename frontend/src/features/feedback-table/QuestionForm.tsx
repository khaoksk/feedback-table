import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'

import { ApiError, createQuestion } from '../../api/client'
import type { QuestionType, Survey } from '../../api/types'

interface Props {
  survey: Survey
  onClose: () => void
}

const MIN_OPTIONS = 2

/** Add a rating or multi-select question to the end of a survey. */
export function QuestionForm({ survey, onClose }: Props) {
  const queryClient = useQueryClient()
  const [text, setText] = useState('')
  const [type, setType] = useState<QuestionType>('multiselect')
  const [options, setOptions] = useState(['', ''])

  const save = useMutation({
    mutationFn: () =>
      createQuestion(survey.id, {
        text: text.trim(),
        type,
        options: type === 'multiselect' ? options.map((option) => option.trim()).filter(Boolean) : [],
      }),
    onSuccess: async () => {
      // A new question can add a column; the survey list drives the columns.
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
        ? ["Couldn't add the question. Try again."]
        : []

  function submit(event: FormEvent) {
    event.preventDefault()
    save.mutate()
  }

  return (
    <form className="panel-form" aria-labelledby="question-form-title" onSubmit={submit}>
      <h2 id="question-form-title">Add a question to {survey.name}</h2>
      <p className="hint">It becomes Q{survey.questions.length + 1} of this survey. Existing responses show it as not answered.</p>

      <div className="form-row">
        <label htmlFor="question-text">Question</label>
        <input
          id="question-text"
          value={text}
          maxLength={255}
          required
          onChange={(event) => setText(event.target.value)}
        />
      </div>

      <fieldset className="form-row">
        <legend>Type</legend>
        <label className="inline-choice">
          <input
            type="radio"
            name="question-type"
            checked={type === 'multiselect'}
            onChange={() => setType('multiselect')}
          />
          Multi-select (pick one or more options)
        </label>
        <label className="inline-choice">
          <input type="radio" name="question-type" checked={type === 'rating'} onChange={() => setType('rating')} />
          Rating (uses the survey's scale)
        </label>
      </fieldset>

      {type === 'multiselect' && (
        <fieldset className="form-row">
          <legend>Options</legend>
          {options.map((option, index) => (
            <div key={index} className="option-row">
              <input
                value={option}
                maxLength={100}
                aria-label={`Option ${index + 1}`}
                onChange={(event) => setOptions(options.map((o, i) => (i === index ? event.target.value : o)))}
              />
              {options.length > MIN_OPTIONS && (
                <button
                  type="button"
                  className="link-button"
                  aria-label={`Remove option ${index + 1}`}
                  onClick={() => setOptions(options.filter((_, i) => i !== index))}
                >
                  Remove
                </button>
              )}
            </div>
          ))}
          <button type="button" className="link-button" onClick={() => setOptions([...options, ''])}>
            + Add option
          </button>
        </fieldset>
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
          {save.isPending ? 'Adding…' : 'Add question'}
        </button>
        <button type="button" onClick={onClose} disabled={save.isPending}>
          Cancel
        </button>
      </div>
    </form>
  )
}
