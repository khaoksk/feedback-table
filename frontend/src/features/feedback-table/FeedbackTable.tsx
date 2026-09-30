import type { FeedbackRow, Survey } from '../../api/types'
import { AnswerCell } from './AnswerCell'
import { questionAt } from './columns'
import type { Ordering } from './filters'

const dateFormat = new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit' })
const dateTimeFormat = new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short' })

interface Props {
  rows: FeedbackRow[]
  surveysById: Map<number, Survey>
  columns: number
  /** The selected survey, if the table is filtered to one. */
  survey: Survey | undefined
  ordering: Ordering
  onToggleOrdering: () => void
  busy: boolean
}

export function FeedbackTable({ rows, surveysById, columns, survey, ordering, onToggleOrdering, busy }: Props) {
  const positions = Array.from({ length: columns }, (_, i) => i + 1)

  return (
    <div className="table-wrap">
      <table aria-busy={busy}>
        <thead>
          <tr>
            <th aria-sort={ordering === 'newest' ? 'descending' : 'ascending'}>
              <button type="button" className="sort-button" onClick={onToggleOrdering}>
                Created
                <span className="arrow" aria-hidden="true">
                  {ordering === 'newest' ? '▼' : '▲'}
                </span>
              </button>
            </th>
            <th>Customer</th>
            <th>Company</th>
            <th>Ticket</th>
            <th>Survey</th>
            {positions.map((position) => (
              <QuestionHeader key={position} position={position} survey={survey} />
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const rowSurvey = surveysById.get(row.survey_id)
            const scale = rowSurvey?.rating_scale.map((point) => point.score) ?? []
            return (
              <tr key={row.id}>
                <td>
                  <span title={dateTimeFormat.format(new Date(row.submitted_at))}>
                    {dateFormat.format(new Date(row.submitted_at))}
                  </span>
                  {row.status === 'draft' && <span className="tag">Draft</span>}
                </td>
                <td>{row.customer.name || <span className="muted-italic">Anonymous</span>}</td>
                <td className="company">{row.customer.company || '—'}</td>
                <td>
                  {row.ticket ? (
                    <>
                      <span className="ticket">#{row.ticket.id}</span> {row.ticket.subject}
                    </>
                  ) : (
                    <span className="muted-italic">No ticket</span>
                  )}
                </td>
                <td>{rowSurvey?.name ?? `Survey #${row.survey_id}`}</td>
                {positions.map((position) => {
                  const question = questionAt(rowSurvey, position)
                  return (
                    <AnswerCell
                      key={position}
                      question={question}
                      answer={question ? row.answers[String(question.id)] : undefined}
                      scale={scale}
                      showQuestionText={!survey}
                    />
                  )
                })}
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function QuestionHeader({ position, survey }: { position: number; survey: Survey | undefined }) {
  // With one survey selected the column has a single meaning, so show its
  // wording; across surveys Q1 means a different question per survey.
  const question = questionAt(survey, position)
  if (question) {
    return (
      <th className="qhead" title={`Q${position}`}>
        {question.text}
      </th>
    )
  }
  return <th title={`Question ${position}: wording differs per survey; blank if not asked`}>Q{position}</th>
}
