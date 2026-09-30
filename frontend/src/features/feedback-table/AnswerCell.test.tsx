import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import type { AnswerCell as AnswerCellData, Question } from '../../api/types'
import { AnswerCell } from './AnswerCell'

const question: Question = { id: 11, order: 1, text: 'How satisfied were you?', type: 'rating', options: [], condition: null }

const ONE_TO_FIVE = [1, 2, 3, 4, 5]

function renderCell(
  answer: AnswerCellData | undefined,
  options: { question?: Question; showQuestionText?: boolean; scale?: number[] } = {},
) {
  const { container } = render(
    <table>
      <tbody>
        <tr>
          <AnswerCell
            question={'question' in options ? options.question : question}
            answer={answer}
            scale={options.scale ?? ONE_TO_FIVE}
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

describe('AnswerCell on a custom scale', () => {
  const zeroToTen = Array.from({ length: 11 }, (_, i) => i)

  it.each([
    ['10', 'green'],
    ['8', 'green'],
    ['7', 'amber'],
    ['5', 'amber'],
    ['4', 'red'],
    ['0', 'red'],
  ])('colours %s out of 0-10 by its place on the scale (%s)', (value, tone) => {
    renderCell({ value, display: `${value} of 10`, state: 'ok' }, { scale: zeroToTen })

    expect(screen.getByText(`${value} · ${value} of 10`)).toHaveClass('badge', tone)
  })

  it('shows the label the backend resolved, custom or not', () => {
    renderCell({ value: '4', display: 'Nice', state: 'ok' })

    expect(screen.getByText('4 · Nice')).toHaveClass('green')
  })
})

describe('AnswerCell for multi-select answers', () => {
  const multiselect: Question = { id: 32, order: 2, text: 'What helped?', type: 'multiselect', options: [], condition: null }

  it('shows each chosen option as a chip', () => {
    renderCell(
      {
        value: '[301, 303]',
        display: 'Docs, Kickoff call',
        state: 'ok',
        selections: [
          { id: 301, label: 'Docs', removed: false },
          { id: 303, label: 'Kickoff call', removed: false },
        ],
      },
      { question: multiselect },
    )

    expect(screen.getByText('Docs')).toHaveClass('chip')
    expect(screen.getByText('Kickoff call')).toHaveClass('chip')
    expect(screen.getByText('Docs')).not.toHaveClass('removed')
  })

  it('marks an option removed since the answer was given', () => {
    renderCell(
      {
        value: '[301, 309]',
        display: 'Docs, Slack channel',
        state: 'removed_option',
        selections: [
          { id: 301, label: 'Docs', removed: false },
          { id: 309, label: 'Slack channel', removed: true },
        ],
      },
      { question: multiselect },
    )

    const removed = screen.getByText('Slack channel')
    expect(removed).toHaveClass('chip', 'removed')
    expect(removed).toHaveAttribute('title', 'Option removed from current survey settings')
  })

  it('treats a malformed multi-select value as invalid', () => {
    renderCell({ value: 'Docs', display: null, state: 'invalid' }, { question: multiselect })

    expect(screen.getByText('Invalid')).toBeInTheDocument()
  })
})
