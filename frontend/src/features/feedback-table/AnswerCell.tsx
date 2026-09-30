import type { AnswerCell as AnswerCellData, Question } from '../../api/types'
import { toneFor } from './scales'

interface Props {
  /** The survey's question at this column, or undefined when it has none. */
  question: Question | undefined
  answer: AnswerCellData | undefined
  /** The scores of the row's survey, for colouring the badge. */
  scale: number[]
  /** Repeat the question text in the cell when the header cannot show it. */
  showQuestionText: boolean
}

/**
 * One answer, styled from the backend's resolved `state` (docs/PRD.md §6).
 * The frontend never re-interprets the raw value.
 */
export function AnswerCell({ question, answer, scale, showQuestionText }: Props) {
  // The survey has no question at this position: nothing to answer.
  if (!question || !answer) return <td className="qcell" data-state="not_applicable" />

  return (
    <td className="qcell" data-state={answer.state}>
      {showQuestionText && answer.state !== 'unanswered' && (
        <span className="qtext">
          {question.text}
          <span className="qtype">{question.type}</span>
        </span>
      )}
      <AnswerValue answer={answer} scale={scale} />
    </td>
  )
}

function AnswerValue({ answer, scale }: { answer: AnswerCellData; scale: number[] }) {
  switch (answer.state) {
    case 'ok':
      return (
        <span className={`badge ${toneFor(answer.value, scale)}`}>
          {answer.value} · {answer.display}
        </span>
      )
    case 'legacy':
      return (
        <span className="badge gray" title="Score from an earlier scale">
          {answer.value} · {answer.display}
        </span>
      )
    case 'invalid':
      return (
        <span className="badge gray" title={`Stored value: "${answer.value ?? ''}"`}>
          <span aria-hidden="true">⚠</span> Invalid
        </span>
      )
    case 'unanswered':
      return <span className="qcell-blank">blank — not answered</span>
  }
}
