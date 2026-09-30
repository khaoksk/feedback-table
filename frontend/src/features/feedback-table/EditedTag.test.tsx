import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import type { AnswerCell as AnswerCellData, Question } from '../../api/types'
import { route } from '../../routes'
import { AnswerCell } from './AnswerCell'
import { editedNote } from './editedNote'

const rating: Question = { id: 11, order: 1, text: 'How satisfied?', type: 'rating', options: [], condition: null }
const comment: Question = { id: 33, order: 3, text: 'Anything else?', type: 'comment', options: [], condition: null }

function renderCell(question: Question, answer: AnswerCellData) {
  render(
    <table>
      <tbody>
        <tr>
          <AnswerCell question={question} answer={answer} scale={[1, 2, 3, 4, 5]} showQuestionText={false} />
        </tr>
      </tbody>
    </table>,
  )
}

const editedRating: AnswerCellData = {
  value: '5',
  display: 'Great',
  state: 'ok',
  edited: { original_value: '2', original_display: 'Bad', original_at: '2026-06-20T10:00:00Z', edit_count: 2 },
}

describe('edited answers (Req 4)', () => {
  it('shows the latest value with an "edited" tag', () => {
    renderCell(rating, editedRating)

    expect(screen.getByText('5 · Great')).toBeInTheDocument()
    expect(screen.getByText('edited')).toHaveClass('edited-tag')
  })

  it('tooltip gives the original value, its date and the number of edits', () => {
    renderCell(rating, editedRating)

    expect(screen.getByText('edited')).toHaveAttribute(
      'title',
      'Originally 2 · Bad on 2026-06-20 · edited 2 times',
    )
  })

  it('says "once" for a single edit and quotes a comment', () => {
    expect(
      editedNote(comment, {
        original_value: 'Slow start',
        original_display: 'Slow start',
        original_at: '2026-06-20T10:00:00Z',
        edit_count: 1,
      }),
    ).toBe('Originally "Slow start" on 2026-06-20 · edited once')
  })

  it('has no tag when the answer was never changed', () => {
    renderCell(rating, { value: '5', display: 'Great', state: 'ok' })

    expect(screen.queryByText('edited')).not.toBeInTheDocument()
  })
})

describe('route', () => {
  it.each([
    ['/', '', { page: 'table' }],
    ['/respond', '', { page: 'respond' }],
    ['/respond/501', '?token=abc', { page: 'edit', responseId: 501, token: 'abc' }],
    ['/respond/501/', '', { page: 'edit', responseId: 501, token: '' }],
    ['/respond/abc', '', { page: 'respond' }],
  ])('%s%s', (path, search, expected) => {
    expect(route(path, search)).toEqual(expected)
  })
})
