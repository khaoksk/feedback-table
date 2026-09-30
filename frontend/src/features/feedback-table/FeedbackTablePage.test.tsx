import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'

import { handlers, lastTableParams, page, row, server, tableRequests } from '../../test/server'
import { FeedbackTablePage } from './FeedbackTablePage'

function renderPage(url = '/') {
  window.history.replaceState(null, '', url)
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <FeedbackTablePage />
    </QueryClientProvider>,
  )
  return { user: userEvent.setup() }
}

async function waitForRows() {
  return screen.findAllByRole('row').then((rows) => rows.slice(1)) // drop the header row
}

function columnHeaders() {
  return screen.getAllByRole('columnheader').map((th) => th.textContent)
}

describe('FeedbackTablePage', () => {
  describe('rendering', () => {
    it('shows one row per response with its context and answers', async () => {
      renderPage()
      const [first] = await waitForRows()
      const cells = within(first).getAllByRole('cell')

      expect(cells[0]).toHaveTextContent('2026-09-29')
      expect(cells[1]).toHaveTextContent('Ada Lovelace')
      expect(cells[2]).toHaveTextContent('Acme')
      expect(cells[3]).toHaveTextContent('#298 Login broken')
      expect(cells[4]).toHaveTextContent('Post-Support CSAT')
      expect(cells[5]).toHaveTextContent('5 · Great')
      expect(cells[6]).toHaveTextContent('3 · Okay')
    })

    it('has a column per question position across all surveys', async () => {
      renderPage()
      await waitForRows()

      expect(columnHeaders()).toEqual(['Created▼', 'Customer', 'Company', 'Ticket', 'Survey', 'Q1', 'Q2', 'Q3'])
    })

    it("leaves a column empty when the row's survey has no question there", async () => {
      renderPage()
      const [first] = await waitForRows()

      const q3 = within(first).getAllByRole('cell')[7]
      expect(q3).toBeEmptyDOMElement()
    })

    it('marks anonymous customers, missing tickets and drafts', async () => {
      server.use(
        handlers.table(() =>
          page([row({ customer: { name: '', email: 'x@example.com', company: '' }, ticket: null, status: 'draft' })]),
        ),
      )
      renderPage()
      const [first] = await waitForRows()

      expect(within(first).getByText('Anonymous')).toBeInTheDocument()
      expect(within(first).getByText('No ticket')).toBeInTheDocument()
      expect(within(first).getByText('Draft')).toBeInTheDocument()
      expect(within(first).getAllByRole('cell')[2]).toHaveTextContent('—')
    })

    it('says so when nothing matches', async () => {
      server.use(handlers.table(() => page([], 0)))
      renderPage()

      expect(await screen.findByText('No responses match these filters.')).toBeInTheDocument()
      expect(screen.queryByRole('table')).not.toBeInTheDocument()
    })

    it('reports a failed load and retries on request', async () => {
      let calls = 0
      server.use(
        handlers.table(() => {
          calls += 1
          return calls === 1 ? new HttpResponse(null, { status: 500 }) : page([row()])
        }),
      )
      const { user } = renderPage()

      const alert = await screen.findByRole('alert')
      expect(alert).toHaveTextContent("Couldn't load responses.")

      await user.click(within(alert).getByRole('button', { name: 'Try again' }))
      await waitForRows()
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    })
  })

  describe('requests', () => {
    it('asks for completed responses, newest first, 50 per page by default', async () => {
      renderPage()
      await waitForRows()

      expect(Object.fromEntries(lastTableParams())).toEqual({
        status: 'completed',
        ordering: '-submitted_at',
        page: '1',
        page_size: '50',
      })
    })

    it('restores filters from the URL on load', async () => {
      renderPage('/?survey=1&status=all&page=2&size=25')
      await waitForRows()

      expect(Object.fromEntries(lastTableParams())).toMatchObject({
        survey: '1',
        status: 'all',
        page: '2',
        page_size: '25',
      })
    })
  })

  describe('filters', () => {
    it('filters by survey and shows its question wording as headers', async () => {
      const { user } = renderPage()
      await waitForRows()

      await user.selectOptions(screen.getByLabelText('Survey'), 'Post-Support CSAT')

      await waitFor(() => expect(lastTableParams().get('survey')).toBe('1'))
      expect(window.location.search).toBe('?survey=1')
      expect(columnHeaders().slice(5)).toEqual(['How satisfied were you?', 'How fast was our reply?'])
    })

    it('searches once the user stops typing', async () => {
      const { user } = renderPage()
      await waitForRows()

      await user.type(screen.getByLabelText('Search customer or company'), 'acme')

      await waitFor(() => expect(lastTableParams().get('search')).toBe('acme'))
      const searches = tableRequests.map((url) => url.searchParams.get('search')).filter(Boolean)
      expect(searches).toEqual(['acme'])
    })

    it('filters by rating on a chosen question', async () => {
      const { user } = renderPage()
      await waitForRows()

      await user.click(screen.getByRole('button', { name: '5' }))
      await waitFor(() => expect(lastTableParams().get('rating')).toBe('5'))
      expect(lastTableParams().get('rating_question')).toBe('1')
      expect(screen.getByRole('button', { name: '5' })).toHaveAttribute('aria-pressed', 'true')

      await user.selectOptions(screen.getByLabelText('on'), 'Q2')
      await waitFor(() => expect(lastTableParams().get('rating_question')).toBe('2'))

      await user.click(screen.getByRole('button', { name: 'All ratings' }))
      await waitFor(() => expect(lastTableParams().has('rating')).toBe(false))
    })

    it('rating questions come from the selected survey', async () => {
      const { user } = renderPage()
      await waitForRows()

      await user.selectOptions(screen.getByLabelText('Survey'), 'Quarterly Check-in')
      await user.click(screen.getByRole('button', { name: '4' }))

      await waitFor(() => expect(lastTableParams().get('rating_question')).toBe('21'))
      const options = within(screen.getByLabelText('on')).getAllByRole('option').map((o) => o.textContent)
      expect(options).toEqual([
        'Q1: How likely are you to recommend us?',
        'Q2: How well does it fit?',
        'Q3: Value for money?',
      ])
    })

    it('filters by status and ticket', async () => {
      const { user } = renderPage()
      await waitForRows()

      await user.selectOptions(screen.getByLabelText('Status'), 'All statuses')
      await user.click(screen.getByLabelText('Ticket-less only'))

      await waitFor(() => expect(lastTableParams().get('ticketless')).toBe('true'))
      expect(lastTableParams().get('status')).toBe('all')
    })

    it('toggles oldest first from the Created header', async () => {
      const { user } = renderPage()
      await waitForRows()

      await user.click(screen.getByRole('button', { name: /Created/ }))

      await waitFor(() => expect(lastTableParams().get('ordering')).toBe('submitted_at'))
      expect(screen.getByRole('columnheader', { name: /Created/ })).toHaveAttribute('aria-sort', 'ascending')
    })
  })

  describe('pagination', () => {
    it('pages through results and shows where the user is', async () => {
      server.use(
        handlers.table((url) => {
          const offset = (Number(url.searchParams.get('page')) - 1) * 50
          return page(Array.from({ length: 50 }, (_, i) => row({ id: offset + i + 1 })), 120)
        }),
      )
      const { user } = renderPage()
      await waitForRows()

      expect(screen.getByText('Showing 1–50 of 120 responses')).toBeInTheDocument()
      expect(screen.getByText('Page 1 of 3')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: '← Previous' })).toBeDisabled()

      await user.click(screen.getByRole('button', { name: 'Next →' }))

      await waitFor(() => expect(lastTableParams().get('page')).toBe('2'))
      expect(await screen.findByText('Page 2 of 3')).toBeInTheDocument()
      expect(window.location.search).toBe('?page=2')
    })

    it('goes back to page 1 when a filter changes', async () => {
      server.use(handlers.table(() => page([row()], 500)))
      const { user } = renderPage('/?page=4')
      await waitForRows()

      await user.click(screen.getByLabelText('Ticket-less only'))

      await waitFor(() => expect(lastTableParams().get('ticketless')).toBe('true'))
      expect(lastTableParams().get('page')).toBe('1')
    })

    it('offers a way back when the page no longer exists', async () => {
      server.use(
        handlers.table((url) =>
          url.searchParams.get('page') === '9' ? new HttpResponse(null, { status: 404 }) : page([row()]),
        ),
      )
      const { user } = renderPage('/?page=9')

      const alert = await screen.findByRole('alert')
      await user.click(within(alert).getByRole('button', { name: 'Go to the first page' }))

      await waitFor(() => expect(lastTableParams().get('page')).toBe('1'))
      await waitForRows()
    })
  })
})
