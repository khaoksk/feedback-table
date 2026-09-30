import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'

import { archiveQuestion, updateOptions } from '../../api/client'
import type { Question, Survey } from '../../api/types'
import { apiErrors } from '../respond/links'

interface Props {
  survey: Survey
  onClose: () => void
}

const TYPE_LABEL: Record<Question['type'], string> = {
  rating: 'Rating',
  multiselect: 'Multi-select',
  comment: 'Comment',
}

/**
 * The survey's current questions, with ways to archive one or change a
 * multi-select question's options (Req 5). Nothing here deletes answers:
 * archived questions and options stay behind every response that used them.
 */
export function QuestionsPanel({ survey, onClose }: Props) {
  const [editing, setEditing] = useState<number | null>(null)

  return (
    <section className="panel-form" aria-labelledby="questions-panel-title">
      <h2 id="questions-panel-title">Questions of {survey.name}</h2>
      <p className="hint">
        Archiving a question removes its column and moves later questions up; its answers are kept. Removing an
        option keeps it on old answers, marked as removed.
      </p>
      <ol className="question-list">
        {survey.questions.map((question) => (
          <li key={question.id}>
            <QuestionRow
              question={question}
              canArchive={survey.questions.length > 1}
              editingOptions={editing === question.id}
              onEditOptions={() => setEditing(editing === question.id ? null : question.id)}
            />
            {editing === question.id && (
              <OptionsEditor key={question.id} question={question} onDone={() => setEditing(null)} />
            )}
          </li>
        ))}
      </ol>
      <div className="editor-actions">
        <button type="button" onClick={onClose}>
          Close
        </button>
      </div>
    </section>
  )
}

function useRefresh() {
  const queryClient = useQueryClient()
  return () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ['surveys'] }),
      queryClient.invalidateQueries({ queryKey: ['feedback-table'] }),
    ])
}

function QuestionRow({
  question,
  canArchive,
  editingOptions,
  onEditOptions,
}: {
  question: Question
  canArchive: boolean
  editingOptions: boolean
  onEditOptions: () => void
}) {
  const refresh = useRefresh()
  const [confirming, setConfirming] = useState(false)
  const archive = useMutation({ mutationFn: () => archiveQuestion(question.id), onSuccess: refresh })
  const errors = apiErrors(archive.error, "Couldn't archive the question. Try again.")

  return (
    <div className="question-row">
      <span className="question-text">
        Q{question.order}. {question.text} <span className="qtype">{TYPE_LABEL[question.type]}</span>
      </span>
      {question.type === 'multiselect' && (
        <button type="button" className="link-button" aria-expanded={editingOptions} onClick={onEditOptions}>
          {editingOptions ? 'Close options' : 'Edit options'}
        </button>
      )}
      {canArchive &&
        (confirming ? (
          <>
            <button
              type="button"
              className="link-button danger"
              disabled={archive.isPending}
              onClick={() => archive.mutate()}
            >
              Confirm archive of Q{question.order}
            </button>
            <button type="button" className="link-button" onClick={() => setConfirming(false)}>
              Keep it
            </button>
          </>
        ) : (
          <button type="button" className="link-button" onClick={() => setConfirming(true)}>
            Archive
          </button>
        ))}
      {errors.length > 0 && (
        <span className="error inline" role="alert">
          {errors.join(' ')}
        </span>
      )}
    </div>
  )
}

interface DraftOption {
  /** Existing option id, or undefined for one added here. */
  id?: number
  label: string
  /** A stable key for React while the list is edited. */
  key: string
}

function OptionsEditor({ question, onDone }: { question: Question; onDone: () => void }) {
  const refresh = useRefresh()
  const [options, setOptions] = useState<DraftOption[]>(() =>
    question.options.map((o) => ({ id: o.id, label: o.label, key: `o${o.id}` })),
  )
  const [added, setAdded] = useState(0)
  const removed = question.options.filter((o) => !options.some((d) => d.id === o.id))

  const save = useMutation({
    mutationFn: () =>
      updateOptions(
        question.id,
        options.map((o) => (o.id === undefined ? { label: o.label.trim() } : { id: o.id, label: o.label.trim() })),
      ),
    onSuccess: async () => {
      await refresh()
      onDone()
    },
  })

  function move(index: number, by: number) {
    const next = [...options]
    const [item] = next.splice(index, 1)
    next.splice(index + by, 0, item)
    setOptions(next)
  }

  function submit(event: FormEvent) {
    event.preventDefault()
    save.mutate()
  }

  const errors = apiErrors(save.error, "Couldn't save the options. Try again.")

  return (
    <form className="options-editor" aria-label={`Options of Q${question.order}`} onSubmit={submit}>
      {options.map((option, index) => (
        <div key={option.key} className="option-row">
          <input
            value={option.label}
            maxLength={100}
            aria-label={`Option ${index + 1}`}
            onChange={(e) => setOptions(options.map((o) => (o.key === option.key ? { ...o, label: e.target.value } : o)))}
          />
          <button
            type="button"
            className="link-button"
            aria-label={`Move option ${index + 1} up`}
            disabled={index === 0}
            onClick={() => move(index, -1)}
          >
            ↑
          </button>
          <button
            type="button"
            className="link-button"
            aria-label={`Move option ${index + 1} down`}
            disabled={index === options.length - 1}
            onClick={() => move(index, 1)}
          >
            ↓
          </button>
          {options.length > 2 && (
            <button
              type="button"
              className="link-button"
              aria-label={`Remove option ${index + 1}`}
              onClick={() => setOptions(options.filter((o) => o.key !== option.key))}
            >
              Remove
            </button>
          )}
        </div>
      ))}
      <button
        type="button"
        className="link-button"
        onClick={() => {
          setOptions([...options, { label: '', key: `new${added}` }])
          setAdded(added + 1)
        }}
      >
        + Add option
      </button>
      {removed.length > 0 && (
        <p className="hint">
          Will be removed (kept on old answers): {removed.map((o) => o.label).join(', ')}
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
          {save.isPending ? 'Saving…' : 'Save options'}
        </button>
      </div>
    </form>
  )
}
