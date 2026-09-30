import { useState } from 'react'

import type { AnswerCell as AnswerCellData, Question, Selection } from '../../api/types'
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
      {question.type === 'comment' && answer.state === 'ok' ? (
        <Comment text={answer.display ?? ''} />
      ) : (
        <AnswerValue answer={answer} scale={scale} />
      )}
    </td>
  )
}

function AnswerValue({ answer, scale }: { answer: AnswerCellData; scale: number[] }) {
  // Multi-select answers arrive as selections, whether or not one was removed.
  if (answer.selections) return <Chips selections={answer.selections} />

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
    case 'removed_option':
      // Only multi-select answers can reference a removed option (handled above).
      return <span className="qcell-blank">{answer.display}</span>
  }
}

/** Comments longer than this start collapsed to a few lines. */
export const COMMENT_PREVIEW_CHARS = 140

function Comment({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false)
  const long = text.length > COMMENT_PREVIEW_CHARS
  return (
    <span className="comment-cell">
      <span className={`comment${long && !expanded ? ' collapsed' : ''}`}>“{text}”</span>
      {long && (
        <button type="button" className="link-button" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>
          {expanded ? 'Show less' : 'Show more'}
        </button>
      )}
    </span>
  )
}

function Chips({ selections }: { selections: Selection[] }) {
  return (
    <span className="chips">
      {selections.map((selection) => (
        <span
          key={selection.id}
          className={`chip${selection.removed ? ' removed' : ''}`}
          title={selection.removed ? 'Option removed from current survey settings' : undefined}
        >
          {selection.label}
        </span>
      ))}
    </span>
  )
}
