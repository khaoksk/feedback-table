import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'

import { ApiError, fetchResponseForEdit, fetchSurveys, updateResponse } from '../../api/client'
import { ResponseForm } from './ResponseForm'
import { apiErrors } from './links'

interface Props {
  responseId: number
  token: string
}

/**
 * A respondent's private edit link (/respond/<id>?token=...): their saved
 * answers, ready to change. Every change keeps the previous value as history,
 * and the table shows the latest one with an "edited" tag (Req 4).
 */
export function EditResponsePage({ responseId, token }: Props) {
  const queryClient = useQueryClient()
  const surveysQuery = useQuery({ queryKey: ['surveys'], queryFn: ({ signal }) => fetchSurveys(signal) })
  const responseQuery = useQuery({
    queryKey: ['response-edit', responseId, token],
    queryFn: ({ signal }) => fetchResponseForEdit(responseId, token, signal),
    retry: false,
  })
  const [saved, setSaved] = useState<number | null>(null)

  const save = useMutation({
    mutationFn: (answers: Parameters<typeof updateResponse>[2]) => updateResponse(responseId, token, answers),
    onSuccess: async ({ changed }) => {
      await queryClient.invalidateQueries({ queryKey: ['feedback-table'] })
      await queryClient.invalidateQueries({ queryKey: ['response-edit', responseId, token] })
      setSaved(changed)
    },
  })

  const response = responseQuery.data
  const survey = surveysQuery.data?.find((s) => s.id === response?.survey_id)
  const notFound = responseQuery.error instanceof ApiError && responseQuery.error.status === 404

  return (
    <main className="page">
      <header>
        <h1>Change your answers</h1>
        <p className="subtitle">Update any answer; the feedback table shows your latest one.</p>
      </header>

      {notFound && (
        <p className="error" role="alert">
          This edit link is not valid. Check that you copied the whole link.
        </p>
      )}
      {(surveysQuery.isError || (responseQuery.isError && !notFound)) && (
        <p className="error" role="alert">
          Couldn't load your response. Try again.
        </p>
      )}

      {saved !== null ? (
        <div className="panel-form" role="status">
          <h2>Your changes are saved</h2>
          <p className="hint">
            {saved === 0 ? 'Nothing changed.' : `${saved} ${saved === 1 ? 'answer' : 'answers'} updated.`}
          </p>
          <div className="editor-actions">
            <a className="button-link primary" href={`/?survey=${response?.survey_id ?? ''}`}>
              See it in the feedback table
            </a>
            <button type="button" onClick={() => setSaved(null)}>
              Change again
            </button>
          </div>
        </div>
      ) : (
        response &&
        survey && (
          <ResponseForm
            key={`${response.id}-${JSON.stringify(response.answers)}`}
            survey={survey}
            initialAnswers={response.answers}
            knownContact={response.customer}
            submitLabel="Save changes"
            pending={save.isPending}
            errors={apiErrors(save.error, "Couldn't save your changes. Try again.")}
            onSubmit={(answers) => save.mutate(answers)}
          />
        )
      )}
    </main>
  )
}
