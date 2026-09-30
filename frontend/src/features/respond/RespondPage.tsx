import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'

import { fetchSurveys, submitResponse } from '../../api/client'
import type { Survey } from '../../api/types'
import { apiErrors, editLink } from './links'
import { ResponseForm } from './ResponseForm'

/** A respondent picks a survey and answers it. */
export function RespondPage() {
  const surveysQuery = useQuery({ queryKey: ['surveys'], queryFn: ({ signal }) => fetchSurveys(signal) })
  const surveys = surveysQuery.data ?? []
  const [surveyId, setSurveyId] = useState<number | null>(null)
  const survey = surveys.find((s) => s.id === surveyId) ?? surveys[0]
  const [submitted, setSubmitted] = useState<{ id: number; surveyId: number; token: string } | null>(null)

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
        <Submitted {...submitted} onAnotherOne={() => setSubmitted(null)} />
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
            <NewResponse
              key={survey.id}
              survey={survey}
              onSubmitted={(id, token) => setSubmitted({ id, surveyId: survey.id, token })}
            />
          </>
        )
      )}
    </main>
  )
}

function NewResponse({ survey, onSubmitted }: { survey: Survey; onSubmitted: (id: number, token: string) => void }) {
  const queryClient = useQueryClient()
  const send = useMutation({
    mutationFn: (args: Parameters<typeof submitResponse>[1]) => submitResponse(survey.id, args),
    onSuccess: async ({ id, edit_token }) => {
      await queryClient.invalidateQueries({ queryKey: ['feedback-table'] })
      onSubmitted(id, edit_token)
    },
  })

  return (
    <ResponseForm
      survey={survey}
      submitLabel="Submit response"
      pending={send.isPending}
      errors={apiErrors(send.error, "Couldn't send your response. Try again.")}
      onSubmit={(answers, contact) => send.mutate({ ...contact, answers })}
    />
  )
}

function Submitted({
  id,
  surveyId,
  token,
  onAnotherOne,
}: {
  id: number
  surveyId: number
  token: string
  onAnotherOne: () => void
}) {
  const link = editLink(id, token)
  const [copied, setCopied] = useState(false)

  async function copy() {
    try {
      await navigator.clipboard.writeText(link)
      setCopied(true)
    } catch {
      setCopied(false)
    }
  }

  return (
    <div className="panel-form" role="status">
      <h2>Thanks, your response was recorded</h2>
      <p className="hint">Response #{id}.</p>
      <div className="form-row">
        <label htmlFor="edit-link">Keep this private link to change your answers later</label>
        <div className="option-row">
          <input id="edit-link" type="text" readOnly value={link} onFocus={(e) => e.target.select()} />
          <button type="button" className="link-button" onClick={copy}>
            {copied ? 'Copied' : 'Copy link'}
          </button>
        </div>
      </div>
      <div className="editor-actions">
        <a className="button-link primary" href={`/?survey=${surveyId}`}>
          See it in the feedback table
        </a>
        <a className="link-button" href={link}>
          Change my answers
        </a>
        <button type="button" onClick={onAnotherOne}>
          Answer another
        </button>
      </div>
    </div>
  )
}
