import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'

import { EDIT_TOKEN, handlers, responseUpdates, server } from '../../test/server'
import { EditResponsePage } from './EditResponsePage'

function renderEdit(token = EDIT_TOKEN) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <EditResponsePage responseId={501} token={token} />
    </QueryClientProvider>,
  )
  return { user: userEvent.setup() }
}

async function editForm() {
  return screen.findByRole('form', { name: 'Answer Onboarding CSAT' })
}

describe('EditResponsePage (Req 4)', () => {
  it('opens with the saved answers filled in', async () => {
    renderEdit()
    const form = await editForm()

    const q1 = within(form).getByRole('group', { name: /^Q1\./ })
    expect(within(q1).getByRole('radio', { name: /2\s*Bad/ })).toBeChecked()
    expect(within(form).getByLabelText('Docs')).toBeChecked()
    expect(within(form).getByLabelText('Support team')).not.toBeChecked()
    expect(within(form).getByRole('textbox', { name: 'Anything you would add?' })).toHaveValue('Slow start')
  })

  it('shows who is answering instead of asking again', async () => {
    renderEdit()
    const form = await editForm()

    expect(within(form).getByText('Answering as Ada (ada@example.com)')).toBeInTheDocument()
    expect(within(form).queryByLabelText('Email')).not.toBeInTheDocument()
  })

  it('saves a changed answer through the edit link', async () => {
    const { user } = renderEdit()
    const form = await editForm()

    const q1 = within(form).getByRole('group', { name: /^Q1\./ })
    await user.click(within(q1).getByRole('radio', { name: /5\s*Great/ }))
    await user.click(within(form).getByRole('button', { name: 'Save changes' }))

    expect(await screen.findByRole('status')).toHaveTextContent('1 answer updated.')
    expect(responseUpdates).toEqual([
      {
        responseId: 501,
        token: EDIT_TOKEN,
        body: { answers: { '31': 5, '32': [301], '33': 'Slow start' } },
      },
    ])
  })

  it('explains that a cleared answer is kept, and does not send it', async () => {
    const { user } = renderEdit()
    const form = await editForm()

    await user.clear(within(form).getByRole('textbox', { name: 'Anything you would add?' }))

    expect(within(form).getByText(/Your saved answer is kept/)).toBeInTheDocument()
    await user.click(within(form).getByRole('button', { name: 'Save changes' }))
    await screen.findByRole('status')
    expect(responseUpdates[0].body).toEqual({ answers: { '31': 2, '32': [301] } })
  })

  it('says so when the link is not valid', async () => {
    renderEdit('not-the-token')

    expect(await screen.findByRole('alert')).toHaveTextContent('This edit link is not valid.')
    expect(screen.queryByRole('form')).not.toBeInTheDocument()
  })

  it('shows per-question errors from the API and keeps the form', async () => {
    server.use(
      handlers.updateResponse(() =>
        HttpResponse.json({ answers: { '33': ['A comment cannot be empty.'] } }, { status: 400 }),
      ),
    )
    const { user } = renderEdit()
    const form = await editForm()

    await user.click(within(form).getByRole('button', { name: 'Save changes' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('A comment cannot be empty.')
    expect(screen.getByRole('form')).toBeInTheDocument()
  })

  it('reports when nothing changed', async () => {
    server.use(handlers.updateResponse(() => HttpResponse.json({ id: 501, changed: 0 })))
    const { user } = renderEdit()
    const form = await editForm()

    await user.click(within(form).getByRole('button', { name: 'Save changes' }))

    expect(await screen.findByRole('status')).toHaveTextContent('Nothing changed.')
  })
})
