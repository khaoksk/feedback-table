import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import type { AnswerCell as AnswerCellData, Question } from '../../api/types'
import { AnswerCell } from './AnswerCell'

const question: Question = { id: 11, order: 1, text: 'How satisfied were you?', type: 'rating' }

function renderCell(answer: AnswerCellData | undefined, options: { question?: Question; showQuestionText?: boolean } = {}) {
  const { container } = render(
    <table>
      <tbody>
        <tr>
          <AnswerCell
            question={'question' in options ? options.question : question}
            answer={answer}
            showQuestionText={options.showQuestionText ?? false}
          />
        </tr>
      </tbody>
    </table>,
  )
  return container.querySelector('td')!
}

describe('AnswerCell', () => {
  it.each([
    ['5', 'Great', 'green'],
    ['4', 'Good', 'green'],
    ['3', 'Okay', 'amber'],
    ['2', 'Bad', 'red'],
    ['1', 'Terrible', 'red'],
  ])('shows rating %s as "%s" in %s', (value, display, tone) => {
    renderCell({ value, display, state: 'ok' })

    expect(screen.getByText(`${value} · ${display}`)).toHaveClass('badge', tone)
  })

  it('shows a legacy score in grey with its fallback label', () => {
    renderCell({ value: '0', display: 'Unrated', state: 'legacy' })

    expect(screen.getByText('0 · Unrated')).toHaveClass('badge', 'gray')
  })

  it('flags an invalid value and keeps the raw value in the tooltip', () => {
    renderCell({ value: 'abc', display: null, state: 'invalid' })

    const badge = screen.getByText('Invalid').closest('.badge')
    expect(badge).toHaveClass('gray')
    expect(badge).toHaveAttribute('title', 'Stored value: "abc"')
  })

  it('says when a question was not answered', () => {
    renderCell({ value: null, display: null, state: 'unanswered' })

    expect(screen.getByText('blank — not answered')).toBeInTheDocument()
  })

  it('is empty when the survey has no question in this column', () => {
    const cell = renderCell(undefined, { question: undefined })

    expect(cell).toBeEmptyDOMElement()
    expect(cell).toHaveAttribute('data-state', 'not_applicable')
  })

  it('repeats the question text only when asked to', () => {
    renderCell({ value: '5', display: 'Great', state: 'ok' }, { showQuestionText: true })
    expect(screen.getByText('How satisfied were you?')).toBeInTheDocument()
  })

  it('leaves the question text out otherwise', () => {
    renderCell({ value: '5', display: 'Great', state: 'ok' })
    expect(screen.queryByText('How satisfied were you?')).not.toBeInTheDocument()
  })
})
