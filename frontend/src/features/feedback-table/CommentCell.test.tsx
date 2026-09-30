import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

import type { Question } from '../../api/types'
import { AnswerCell, COMMENT_PREVIEW_CHARS } from './AnswerCell'

const comment: Question = { id: 33, order: 3, text: 'Anything you would add?', type: 'comment', options: [] }

function renderComment(text: string) {
  render(
    <table>
      <tbody>
        <tr>
          <AnswerCell
            question={comment}
            answer={{ value: text, display: text, state: 'ok' }}
            scale={[1, 2, 3, 4, 5]}
            showQuestionText={false}
          />
        </tr>
      </tbody>
    </table>,
  )
}

describe('comment answers (Req 3)', () => {
  it('shows a comment that looks like a score as text, not a badge', () => {
    renderComment('5')

    const text = screen.getByText('“5”')
    expect(text).toHaveClass('comment')
    expect(text.closest('.badge')).toBeNull()
  })

  it('shows a short comment in full with no toggle', () => {
    renderComment('Support was quick, thanks!')

    expect(screen.getByText('“Support was quick, thanks!”')).not.toHaveClass('collapsed')
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('collapses a long comment and expands it on request', async () => {
    const long = 'Long feedback. '.repeat(20).trim()
    expect(long.length).toBeGreaterThan(COMMENT_PREVIEW_CHARS)
    renderComment(long)
    const user = userEvent.setup()

    const text = screen.getByText(`“${long}”`)
    expect(text).toHaveClass('collapsed')

    await user.click(screen.getByRole('button', { name: 'Show more' }))
    expect(text).not.toHaveClass('collapsed')
    expect(screen.getByRole('button', { name: 'Show less' })).toHaveAttribute('aria-expanded', 'true')
  })

  it('keeps line breaks and non-English text', () => {
    renderComment('บริการดีมาก\nขอบคุณครับ')

    expect(screen.getByText(/บริการดีมาก/)).toHaveTextContent('บริการดีมาก ขอบคุณครับ')
  })
})
