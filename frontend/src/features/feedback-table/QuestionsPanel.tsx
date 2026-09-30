import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'

import { archiveQuestion, fetchArchivedQuestions, setCondition, updateOptions } from '../../api/client'
import type { Condition, Question, Survey } from '../../api/types'
import { describeCondition } from '../respond/conditions'
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
  const [conditionFor, setConditionFor] = useState<number | null>(null)

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
              sources={survey.questions.filter((q) => q.type === 'rating' && q.order < question.order)}
              editingCondition={conditionFor === question.id}
              onEditCondition={() => setConditionFor(conditionFor === question.id ? null : question.id)}
            />
            {question.condition && (
              <p className="condition-note">{describeCondition(question.condition, survey.questions)}</p>
            )}
            {conditionFor === question.id && (
              <ConditionEditor
                key={question.id}
                question={question}
                sources={survey.questions.filter((q) => q.type === 'rating' && q.order < question.order)}
                onDone={() => setConditionFor(null)}
              />
            )}
            {editing === question.id && (
              <OptionsEditor key={question.id} question={question} onDone={() => setEditing(null)} />
            )}
          </li>
        ))}
      </ol>
      <ArchivedQuestions surveyId={survey.id} />
      <div className="editor-actions">
        <button type="button" onClick={onClose}>
          Close
        </button>
      </div>
    </section>
  )
}

const archivedDate = new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit' })

/** Questions archived from this survey: no column, no form field, answers kept. */
function ArchivedQuestions({ surveyId }: { surveyId: number }) {
  const archived = useQuery({
    queryKey: ['archived-questions', surveyId],
    queryFn: ({ signal }) => fetchArchivedQuestions(surveyId, signal),
  })

  return (
    <section className="archived-questions" aria-labelledby="archived-questions-title">
      <h3 id="archived-questions-title">Archived questions</h3>
      {archived.isError && <p className="hint">Couldn't load archived questions.</p>}
      {archived.data?.length === 0 && <p className="hint">None. Every question of this survey is in use.</p>}
      {archived.data && archived.data.length > 0 && (
        <ul>
          {archived.data.map((question) => (
            <li key={question.id}>
              <span className="question-text">{question.text}</span>{' '}
              <span className="qtype">{TYPE_LABEL[question.type]}</span>
              <span className="hint">
                {' '}
                · archived {archivedDate.format(new Date(question.archived_at))} ·{' '}
                {question.answer_count.toLocaleString()} {question.answer_count === 1 ? 'answer' : 'answers'} kept
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function useRefresh() {
  const queryClient = useQueryClient()
  return () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ['surveys'] }),
      queryClient.invalidateQueries({ queryKey: ['feedback-table'] }),
      queryClient.invalidateQueries({ queryKey: ['archived-questions'] }),
    ])
}

function QuestionRow({
  question,
  canArchive,
  editingOptions,
  onEditOptions,
  sources,
  editingCondition,
  onEditCondition,
}: {
  question: Question
  canArchive: boolean
  editingOptions: boolean
  onEditOptions: () => void
  /** Earlier rating questions this one could depend on. */
  sources: Question[]
  editingCondition: boolean
  onEditCondition: () => void
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
      {sources.length > 0 && (
        <button type="button" className="link-button" aria-expanded={editingCondition} onClick={onEditCondition}>
          {editingCondition ? 'Close condition' : question.condition ? 'Edit condition' : 'Set condition'}
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

const OPERATORS: Condition['operator'][] = ['>', '>=', '<', '<=', '=']

/** Show a question only when an earlier rating meets a condition (Req 6). */
function ConditionEditor({ question, sources, onDone }: { question: Question; sources: Question[]; onDone: () => void }) {
  const refresh = useRefresh()
  const current = question.condition?.active ? question.condition : null
  const [sourceId, setSourceId] = useState(current?.question_id ?? sources[sources.length - 1].id)
  const [operator, setOperator] = useState<Condition['operator']>(current?.operator ?? '>')
  const [value, setValue] = useState(current?.value ?? 2)

  const save = useMutation({
    mutationFn: (condition: Omit<Condition, 'active'> | null) => setCondition(question.id, condition),
    onSuccess: async () => {
      await refresh()
      onDone()
    },
  })

  function submit(event: FormEvent) {
    event.preventDefault()
    save.mutate({ question_id: sourceId, operator, value })
  }

  const errors = apiErrors(save.error, "Couldn't save the condition. Try again.")

  return (
    <form className="condition-form" aria-label={`Condition of Q${question.order}`} onSubmit={submit}>
      <span>Show Q{question.order} only when</span>
      <select aria-label="Depends on" value={sourceId} onChange={(e) => setSourceId(Number(e.target.value))}>
        {sources.map((source) => (
          <option key={source.id} value={source.id}>
            Q{source.order}
          </option>
        ))}
      </select>
      <select aria-label="Operator" value={operator} onChange={(e) => setOperator(e.target.value as Condition['operator'])}>
        {OPERATORS.map((op) => (
          <option key={op} value={op}>
            {op}
          </option>
        ))}
      </select>
      <input
        type="number"
        aria-label="Threshold"
        min={0}
        max={10}
        value={value}
        onChange={(e) => setValue(Number(e.target.value))}
      />
      <button type="submit" className="link-button" disabled={save.isPending}>
        Save condition
      </button>
      {question.condition && (
        <button type="button" className="link-button" disabled={save.isPending} onClick={() => save.mutate(null)}>
          Always show
        </button>
      )}
      {errors.length > 0 && (
        <span className="error inline" role="alert">
          {errors.join(' ')}
        </span>
      )}
    </form>
  )
}
