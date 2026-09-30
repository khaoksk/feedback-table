import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'

import { handlers, server, submittedResponses } from '../../test/server'
import { RespondPage } from './RespondPage'

async function renderRespond() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <RespondPage />
    </QueryClientProvider>,
  )
  const user = userEvent.setup()
  await screen.findByRole('form')
  return { user }
}

async function pickSurvey(user: ReturnType<typeof userEvent.setup>, name: string) {
  await user.selectOptions(screen.getByLabelText('Survey'), name)
  return screen.getByRole('form', { name: `Answer ${name}` })
}

describe('RespondPage', () => {
  it("offers each rating question on the survey's own scale", async () => {
    const { user } = await renderRespond()
    const form = await pickSurvey(user, 'Quarterly Check-in')

    const q1 = within(form).getByRole('group', { name: 'Q1. How likely are you to recommend us?' })
    expect(within(q1).getAllByRole('radio')).toHaveLength(11)
    expect(within(q1).getByText('10 of 10')).toBeInTheDocument()
  })

  it('offers a checkbox per option for a multi-select question', async () => {
    const { user } = await renderRespond()
    const form = await pickSurvey(user, 'Onboarding CSAT')

    const q2 = within(form).getByRole('group', { name: 'Q2. What made the biggest difference?' })
    expect(within(q2).getAllByRole('checkbox').map((box) => box.parentElement?.textContent)).toEqual([
      'Docs',
      'Support team',
      'Kickoff call',
    ])
  })

  it('needs at least one answer before it can be sent', async () => {
    const { user } = await renderRespond()
    const form = await pickSurvey(user, 'Onboarding CSAT')
    const submit = within(form).getByRole('button', { name: 'Submit response' })
    expect(submit).toBeDisabled()

    await user.click(within(form).getByLabelText('Docs'))

    expect(submit).toBeEnabled()
  })

  it('submits a rating and several options, then confirms', async () => {
    const { user } = await renderRespond()
    const form = await pickSurvey(user, 'Onboarding CSAT')

    await user.type(within(form).getByLabelText('Email'), 'ada@example.com')
    await user.type(within(form).getByLabelText('Name (optional)'), 'Ada')
    const q1 = within(form).getByRole('group', { name: /^Q1\./ })
    await user.click(within(q1).getByRole('radio', { name: /4\s*Good/ }))
    await user.click(within(form).getByLabelText('Kickoff call'))
    await user.click(within(form).getByLabelText('Docs'))
    await user.click(within(form).getByRole('button', { name: 'Submit response' }))

    const status = await screen.findByRole('status')
    expect(status).toHaveTextContent('Response #501')
    // The private edit link carries the token the API returned (Req 4).
    expect(within(status).getByLabelText(/private link to change your answers/)).toHaveValue(
      `${window.location.origin}/respond/501?token=tok-123`,
    )
    expect(within(status).getByRole('link', { name: 'Change my answers' })).toHaveAttribute(
      'href',
      `${window.location.origin}/respond/501?token=tok-123`,
    )
    expect(within(status).getByRole('link', { name: 'See it in the feedback table' })).toHaveAttribute(
      'href',
      '/?survey=3',
    )
    expect(submittedResponses).toEqual([
      {
        surveyId: 3,
        body: { name: 'Ada', email: 'ada@example.com', company: '', answers: { '31': 4, '32': [303, 301] } },
      },
    ])
  })

  it('unticking every option drops that answer', async () => {
    const { user } = await renderRespond()
    const form = await pickSurvey(user, 'Onboarding CSAT')

    await user.click(within(form).getByLabelText('Docs'))
    await user.click(within(form).getByLabelText('Docs'))

    expect(within(form).getByRole('button', { name: 'Submit response' })).toBeDisabled()
  })

  it('shows per-question errors from the API and keeps the answers', async () => {
    server.use(
      handlers.submitResponse(() =>
        HttpResponse.json({ answers: { '32': ['Not an option of this question: [999].'] } }, { status: 400 }),
      ),
    )
    const { user } = await renderRespond()
    const form = await pickSurvey(user, 'Onboarding CSAT')

    await user.type(within(form).getByLabelText('Email'), 'ada@example.com')
    await user.click(within(form).getByLabelText('Docs'))
    await user.click(within(form).getByRole('button', { name: 'Submit response' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Not an option of this question: [999].')
    expect(within(form).getByLabelText('Docs')).toBeChecked()
  })

  it('starts fresh when switching survey', async () => {
    const { user } = await renderRespond()
    let form = await pickSurvey(user, 'Onboarding CSAT')
    await user.click(within(form).getByLabelText('Docs'))

    form = await pickSurvey(user, 'Post-Support CSAT')

    await waitFor(() => expect(within(form).getByRole('button', { name: 'Submit response' })).toBeDisabled())
  })
})

describe('RespondPage comments (Req 3)', () => {
  it('offers a text box with a 2,000 character counter', async () => {
    const { user } = await renderRespond()
    const form = await pickSurvey(user, 'Onboarding CSAT')

    const box = within(form).getByRole('textbox', { name: 'Anything you would add?' })
    expect(box).toHaveAttribute('maxlength', '2000')
    expect(within(form).getByText('0 / 2,000')).toBeInTheDocument()

    await user.type(box, 'Great')
    expect(within(form).getByText('5 / 2,000')).toBeInTheDocument()
  })

  it('sends the comment as text alongside other answers', async () => {
    const { user } = await renderRespond()
    const form = await pickSurvey(user, 'Onboarding CSAT')

    await user.type(within(form).getByLabelText('Email'), 'ada@example.com')
    await user.click(within(form).getByLabelText('Docs'))
    await user.type(within(form).getByRole('textbox', { name: 'Anything you would add?' }), '5')
    await user.click(within(form).getByRole('button', { name: 'Submit response' }))

    await screen.findByRole('status')
    expect(submittedResponses[0].body).toMatchObject({ answers: { '32': [301], '33': '5' } })
  })

  it('treats a whitespace-only comment as skipped', async () => {
    const { user } = await renderRespond()
    const form = await pickSurvey(user, 'Onboarding CSAT')

    await user.type(within(form).getByRole('textbox', { name: 'Anything you would add?' }), '   ')

    expect(within(form).getByRole('button', { name: 'Submit response' })).toBeDisabled()
  })
})
