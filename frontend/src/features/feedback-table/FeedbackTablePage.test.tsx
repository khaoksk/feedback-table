import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'

import {
  archivedQuestions,
  conditionUpdates,
  createdQuestions,
  handlers,
  labelUpdates,
  lastTableParams,
  optionUpdates,
  page,
  row,
  server,
  SURVEYS,
  surveysWithCondition,
  tableRequests,
} from '../../test/server'
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

  describe('custom rating labels (Req 1)', () => {
    function chips() {
      const group = screen.getByRole('group', { name: 'Rating filter' })
      return within(group)
        .getAllByRole('button')
        .map((button) => button.textContent)
    }

    it("offers the selected survey's scale as rating chips", async () => {
      const { user } = renderPage()
      await waitForRows()
      expect(chips()).toEqual(['All ratings', '10', '9', '8', '7', '6', '5', '4', '3', '2', '1', '0'])

      await user.selectOptions(screen.getByLabelText('Survey'), 'Post-Support CSAT')

      expect(chips()).toEqual(['All ratings', '5', '4', '3', '2', '1'])
    })

    it('only offers label editing once a survey is selected', async () => {
      const { user } = renderPage()
      await waitForRows()
      expect(screen.queryByRole('button', { name: 'Edit labels' })).not.toBeInTheDocument()

      await user.selectOptions(screen.getByLabelText('Survey'), 'Post-Support CSAT')

      expect(screen.getByRole('button', { name: 'Edit labels' })).toBeInTheDocument()
    })

    it('saves renamed labels and reloads the table with them', async () => {
      const { user } = renderPage('/?survey=1')
      await waitForRows()
      const requestsBefore = tableRequests.length

      await user.click(screen.getByRole('button', { name: 'Edit labels' }))
      const form = screen.getByRole('form', { name: 'Rating labels: Post-Support CSAT' })
      expect(within(form).getByLabelText('Label for score 5')).toHaveValue('Great')

      const five = within(form).getByLabelText('Label for score 5')
      await user.clear(five)
      await user.type(five, 'Awesome')
      await user.click(within(form).getByRole('button', { name: 'Save labels' }))

      await waitFor(() => expect(screen.queryByRole('form')).not.toBeInTheDocument())
      expect(labelUpdates).toEqual([
        { surveyId: 1, labels: { '1': 'Terrible', '2': 'Bad', '3': 'Okay', '4': 'Good', '5': 'Awesome' } },
      ])
      // The table is fetched again so every answer shows the new wording.
      await waitFor(() => expect(tableRequests.length).toBeGreaterThan(requestsBefore))
    })

    it('shows validation errors from the API and keeps the form open', async () => {
      server.use(
        handlers.updateLabels(() =>
          HttpResponse.json({ labels: ['Each score needs a different label.'] }, { status: 400 }),
        ),
      )
      const { user } = renderPage('/?survey=1')
      await waitForRows()

      await user.click(screen.getByRole('button', { name: 'Edit labels' }))
      await user.click(screen.getByRole('button', { name: 'Save labels' }))

      expect(await screen.findByRole('alert')).toHaveTextContent('Each score needs a different label.')
      expect(screen.getByRole('form')).toBeInTheDocument()
    })

    it('resets custom labels to the defaults', async () => {
      const { user } = renderPage('/?survey=2')
      await waitForRows()

      await user.click(screen.getByRole('button', { name: 'Edit labels' }))
      await user.click(screen.getByRole('button', { name: 'Reset to default labels' }))

      await waitFor(() => expect(labelUpdates).toEqual([{ surveyId: 2, labels: null }]))
    })

    it('does not offer a reset for a survey on the defaults', async () => {
      const { user } = renderPage('/?survey=1')
      await waitForRows()

      await user.click(screen.getByRole('button', { name: 'Edit labels' }))

      expect(screen.queryByRole('button', { name: 'Reset to default labels' })).not.toBeInTheDocument()
      expect(SURVEYS[0].custom_labels).toBe(false)
    })

    it('cancel closes the editor without saving', async () => {
      const { user } = renderPage('/?survey=1')
      await waitForRows()

      await user.click(screen.getByRole('button', { name: 'Edit labels' }))
      await user.click(screen.getByRole('button', { name: 'Cancel' }))

      expect(screen.queryByRole('form')).not.toBeInTheDocument()
      expect(labelUpdates).toEqual([])
    })
  })

  describe('multi-select questions (Req 2)', () => {
    it('shows a multi-select answer as chips in its column', async () => {
      server.use(
        handlers.table(() =>
          page([
            row({
              survey_id: 3,
              answers: {
                '31': { value: '4', display: 'Good', state: 'ok' },
                '32': {
                  value: '[301, 303]',
                  display: 'Docs, Kickoff call',
                  state: 'ok',
                  selections: [
                    { id: 301, label: 'Docs', removed: false },
                    { id: 303, label: 'Kickoff call', removed: false },
                  ],
                },
              },
            }),
          ]),
        ),
      )
      renderPage()
      const [first] = await waitForRows()

      const q2 = within(first).getAllByRole('cell')[6]
      expect(within(q2).getByText('Docs')).toHaveClass('chip')
      expect(within(q2).getByText('Kickoff call')).toHaveClass('chip')
    })

    async function openQuestionForm() {
      const result = renderPage('/?survey=1')
      await waitForRows()
      await result.user.click(screen.getByRole('button', { name: 'Add question' }))
      return { ...result, form: screen.getByRole('form', { name: 'Add a question to Post-Support CSAT' }) }
    }

    it('creates a multi-select question with the options entered', async () => {
      const { user, form } = await openQuestionForm()

      await user.type(within(form).getByLabelText('Question'), 'What made the biggest difference?')
      await user.type(within(form).getByLabelText('Option 1'), 'Docs')
      await user.type(within(form).getByLabelText('Option 2'), 'Pricing')
      await user.click(within(form).getByRole('button', { name: '+ Add option' }))
      await user.type(within(form).getByLabelText('Option 3'), 'Kickoff call')
      await user.click(within(form).getByRole('button', { name: 'Add question' }))

      await waitFor(() => expect(screen.queryByRole('form')).not.toBeInTheDocument())
      expect(createdQuestions).toEqual([
        {
          surveyId: 1,
          body: {
            text: 'What made the biggest difference?',
            type: 'multiselect',
            options: ['Docs', 'Pricing', 'Kickoff call'],
          },
        },
      ])
    })

    it('can remove an option but keeps at least two', async () => {
      const { user, form } = await openQuestionForm()
      expect(within(form).queryByRole('button', { name: /Remove option/ })).not.toBeInTheDocument()

      await user.click(within(form).getByRole('button', { name: '+ Add option' }))
      await user.click(within(form).getByRole('button', { name: 'Remove option 1' }))

      expect(within(form).getAllByLabelText(/^Option \d$/)).toHaveLength(2)
      expect(within(form).queryByRole('button', { name: /Remove option/ })).not.toBeInTheDocument()
    })

    it('creates a rating question without options', async () => {
      const { user, form } = await openQuestionForm()

      await user.type(within(form).getByLabelText('Question'), 'How did we do?')
      await user.click(within(form).getByLabelText(/^Rating/))
      expect(within(form).queryByLabelText('Option 1')).not.toBeInTheDocument()
      await user.click(within(form).getByRole('button', { name: 'Add question' }))

      await waitFor(() =>
        expect(createdQuestions).toEqual([
          { surveyId: 1, body: { text: 'How did we do?', type: 'rating', options: [] } },
        ]),
      )
    })

    it('shows validation errors from the API', async () => {
      server.use(
        handlers.createQuestion(() =>
          HttpResponse.json({ options: ['Each option needs a different label.'] }, { status: 400 }),
        ),
      )
      const { user, form } = await openQuestionForm()

      await user.type(within(form).getByLabelText('Question'), 'Q')
      await user.click(within(form).getByRole('button', { name: 'Add question' }))

      expect(await screen.findByRole('alert')).toHaveTextContent('Each option needs a different label.')
    })
  })

  describe('comment questions (Req 3)', () => {
    it('creates a comment question without options', async () => {
      const result = renderPage('/?survey=1')
      await waitForRows()
      await result.user.click(screen.getByRole('button', { name: 'Add question' }))
      const form = screen.getByRole('form', { name: 'Add a question to Post-Support CSAT' })

      await result.user.type(within(form).getByLabelText('Question'), 'Anything you would add?')
      await result.user.click(within(form).getByLabelText(/^Comment/))
      expect(within(form).queryByLabelText('Option 1')).not.toBeInTheDocument()
      await result.user.click(within(form).getByRole('button', { name: 'Add question' }))

      await waitFor(() =>
        expect(createdQuestions).toEqual([
          { surveyId: 1, body: { text: 'Anything you would add?', type: 'comment', options: [] } },
        ]),
      )
    })
  })

  describe('edited answers (Req 4)', () => {
    it('marks a re-answered value in the table', async () => {
      server.use(
        handlers.table(() =>
          page([
            row({
              answers: {
                '11': {
                  value: '5',
                  display: 'Great',
                  state: 'ok',
                  edited: {
                    original_value: '2',
                    original_display: 'Bad',
                    original_at: '2026-06-20T10:00:00Z',
                    edit_count: 1,
                  },
                },
                '12': { value: '3', display: 'Okay', state: 'ok' },
              },
            }),
          ]),
        ),
      )
      renderPage()
      const [first] = await waitForRows()

      const q1 = within(first).getAllByRole('cell')[5]
      expect(within(q1).getByText('edited')).toHaveAttribute('title', 'Originally 2 · Bad on 2026-06-20 · edited once')
      expect(within(within(first).getAllByRole('cell')[6]).queryByText('edited')).not.toBeInTheDocument()
    })
  })

  describe('current settings (Req 5)', () => {
    async function openQuestions(url = '/?survey=3') {
      const result = renderPage(url)
      await waitForRows()
      await result.user.click(screen.getByRole('button', { name: 'Edit questions' }))
      return { ...result, panel: screen.getByRole('region', { name: /^Questions of/ }) }
    }

    it('lists the survey questions with their types', async () => {
      const { panel } = await openQuestions()

      const items = within(panel).getAllByRole('listitem').map((li) => li.textContent)
      expect(items[0]).toMatch(/^Q1\. How easy was it to get started\? Rating/)
      expect(items[1]).toMatch(/^Q2\. What made the biggest difference\? Multi-select/)
    })

    it('archives a question only after confirming, then reloads', async () => {
      const { user, panel } = await openQuestions()
      const requestsBefore = tableRequests.length
      const q1 = within(panel).getAllByRole('listitem')[0]

      await user.click(within(q1).getByRole('button', { name: 'Archive' }))
      expect(archivedQuestions).toEqual([])
      await user.click(within(q1).getByRole('button', { name: 'Confirm archive of Q1' }))

      await waitFor(() => expect(archivedQuestions).toEqual([31]))
      await waitFor(() => expect(tableRequests.length).toBeGreaterThan(requestsBefore))
    })

    it('can back out of archiving', async () => {
      const { user, panel } = await openQuestions()
      const q1 = within(panel).getAllByRole('listitem')[0]

      await user.click(within(q1).getByRole('button', { name: 'Archive' }))
      await user.click(within(q1).getByRole('button', { name: 'Keep it' }))

      expect(within(q1).getByRole('button', { name: 'Archive' })).toBeInTheDocument()
      expect(archivedQuestions).toEqual([])
    })

    it('shows why a question could not be archived', async () => {
      server.use(
        handlers.archiveQuestion(() =>
          HttpResponse.json({ question: ['A survey needs at least one question.'] }, { status: 400 }),
        ),
      )
      const { user, panel } = await openQuestions()
      const q1 = within(panel).getAllByRole('listitem')[0]

      await user.click(within(q1).getByRole('button', { name: 'Archive' }))
      await user.click(within(q1).getByRole('button', { name: 'Confirm archive of Q1' }))

      expect(await within(q1).findByRole('alert')).toHaveTextContent('A survey needs at least one question.')
    })

    it('renames, reorders, removes and adds options in one save', async () => {
      const { user, panel } = await openQuestions()
      const q2 = within(panel).getAllByRole('listitem')[1]
      await user.click(within(q2).getByRole('button', { name: 'Edit options' }))
      const form = within(q2).getByRole('form', { name: 'Options of Q2' })

      const docs = within(form).getByLabelText('Option 1')
      await user.clear(docs)
      await user.type(docs, 'Documentation')
      // Kickoff call moves up to 2, so Support team is now option 3.
      await user.click(within(form).getByRole('button', { name: 'Move option 3 up' }))
      await user.click(within(form).getByRole('button', { name: 'Remove option 3' }))
      expect(within(form).getByText(/Will be removed \(kept on old answers\): Support team/)).toBeInTheDocument()
      await user.click(within(form).getByRole('button', { name: '+ Add option' }))
      await user.type(within(form).getByLabelText('Option 3'), 'Onboarding call')
      await user.click(within(form).getByRole('button', { name: 'Save options' }))

      await waitFor(() =>
        expect(optionUpdates).toEqual([
          {
            questionId: 32,
            body: {
              options: [
                { id: 301, label: 'Documentation' },
                { id: 303, label: 'Kickoff call' },
                { label: 'Onboarding call' },
              ],
            },
          },
        ]),
      )
    })

    it('keeps at least two options', async () => {
      const { user, panel } = await openQuestions()
      const q2 = within(panel).getAllByRole('listitem')[1]
      await user.click(within(q2).getByRole('button', { name: 'Edit options' }))
      const form = within(q2).getByRole('form', { name: 'Options of Q2' })

      await user.click(within(form).getByRole('button', { name: 'Remove option 1' }))

      expect(within(form).queryByRole('button', { name: /Remove option/ })).not.toBeInTheDocument()
    })

    it('narrows the scale and warns which scores become legacy', async () => {
      const { user } = renderPage('/?survey=1')
      await waitForRows()
      await user.click(screen.getByRole('button', { name: 'Edit labels' }))
      const form = screen.getByRole('form', { name: 'Rating labels: Post-Support CSAT' })

      await user.selectOptions(within(form).getByLabelText('Highest score'), '3')

      expect(within(form).queryByLabelText('Label for score 4')).not.toBeInTheDocument()
      expect(within(form).getByRole('note')).toHaveTextContent('score 4, 5 will show as legacy')
      await user.click(within(form).getByRole('button', { name: 'Save labels' }))
      await waitFor(() =>
        expect(labelUpdates).toEqual([{ surveyId: 1, labels: { '1': 'Terrible', '2': 'Bad', '3': 'Okay' } }]),
      )
    })

    it('widens the scale to 0-10, prefilling new scores', async () => {
      const { user } = renderPage('/?survey=1')
      await waitForRows()
      await user.click(screen.getByRole('button', { name: 'Edit labels' }))
      const form = screen.getByRole('form', { name: 'Rating labels: Post-Support CSAT' })

      await user.selectOptions(within(form).getByLabelText('Lowest score'), '0')
      await user.selectOptions(within(form).getByLabelText('Highest score'), '10')

      expect(within(form).getByLabelText('Label for score 0')).toHaveValue('0')
      expect(within(form).getByLabelText('Label for score 5')).toHaveValue('Great')
      expect(within(form).getByLabelText('Label for score 10')).toHaveValue('10')
    })
  })

  describe('archived questions (Req 5)', () => {
    it('lists archived questions with their date and kept answers', async () => {
      server.use(
        handlers.archivedQuestions([
          { id: 2, text: 'How friendly was the agent?', type: 'rating', archived_at: '2026-08-16T00:00:00Z', answer_count: 4742 },
        ]),
      )
      const { user } = renderPage('/?survey=1')
      await waitForRows()
      await user.click(screen.getByRole('button', { name: 'Edit questions' }))

      const section = await screen.findByRole('region', { name: 'Archived questions' })
      expect(await within(section).findByText('How friendly was the agent?')).toBeInTheDocument()
      expect(section).toHaveTextContent('archived 2026-08-16 · 4,742 answers kept')
    })

    it('says when nothing is archived', async () => {
      const { user } = renderPage('/?survey=1')
      await waitForRows()
      await user.click(screen.getByRole('button', { name: 'Edit questions' }))

      const section = await screen.findByRole('region', { name: 'Archived questions' })
      expect(await within(section).findByText(/None\. Every question/)).toBeInTheDocument()
    })

    it('shows a question in the archived list right after archiving it', async () => {
      let archivedList: unknown[] = []
      server.use(
        http.get('*/api/surveys/:id/archived-questions/', () => HttpResponse.json(archivedList)),
        handlers.archiveQuestion(() => {
          archivedList = [
            { id: 31, text: 'How easy was it to get started?', type: 'rating', archived_at: '2026-10-01T09:00:00Z', answer_count: 12 },
          ]
          return new HttpResponse(null, { status: 204 })
        }),
      )
      const { user } = renderPage('/?survey=3')
      await waitForRows()
      await user.click(screen.getByRole('button', { name: 'Edit questions' }))
      const panel = screen.getByRole('region', { name: /^Questions of/ })
      const q1 = within(panel).getAllByRole('listitem')[0]

      await user.click(within(q1).getByRole('button', { name: 'Archive' }))
      await user.click(within(q1).getByRole('button', { name: 'Confirm archive of Q1' }))

      const section = screen.getByRole('region', { name: 'Archived questions' })
      expect(await within(section).findByText('How easy was it to get started?')).toBeInTheDocument()
    })
  })

  describe('conditional display (Req 6)', () => {
    it('distinguishes a hidden question from a skipped one', async () => {
      server.use(
        handlers.table(() =>
          page([
            row({
              survey_id: 3,
              answers: {
                '31': { value: '2', display: 'Bad', state: 'ok' },
                '32': { value: null, display: null, state: 'unanswered' },
                '33': { value: null, display: null, state: 'condition_not_met' },
              },
            }),
          ]),
        ),
      )
      renderPage()
      const [first] = await waitForRows()
      const cells = within(first).getAllByRole('cell')

      expect(cells[6]).toHaveTextContent('blank — not answered')
      expect(cells[7]).toHaveTextContent('blank — condition not met')
    })

    it('describes and sets a condition from the questions panel', async () => {
      server.use(handlers.surveys(surveysWithCondition()))
      const { user } = renderPage('/?survey=3')
      await waitForRows()
      await user.click(screen.getByRole('button', { name: 'Edit questions' }))
      const panel = screen.getByRole('region', { name: /^Questions of/ })
      const q3 = within(panel).getAllByRole('listitem')[2]

      expect(q3).toHaveTextContent('Shown when Q1 > 2')
      await user.click(within(q3).getByRole('button', { name: 'Edit condition' }))
      const form = within(q3).getByRole('form', { name: 'Condition of Q3' })
      await user.selectOptions(within(form).getByLabelText('Operator'), '>=')
      await user.clear(within(form).getByLabelText('Threshold'))
      await user.type(within(form).getByLabelText('Threshold'), '4')
      await user.click(within(form).getByRole('button', { name: 'Save condition' }))

      await waitFor(() =>
        expect(conditionUpdates).toEqual([
          { questionId: 33, body: { condition: { question_id: 31, operator: '>=', value: 4 } } },
        ]),
      )
    })

    it('can switch a condition off', async () => {
      server.use(handlers.surveys(surveysWithCondition()))
      const { user } = renderPage('/?survey=3')
      await waitForRows()
      await user.click(screen.getByRole('button', { name: 'Edit questions' }))
      const q3 = within(screen.getByRole('region', { name: /^Questions of/ })).getAllByRole('listitem')[2]

      await user.click(within(q3).getByRole('button', { name: 'Edit condition' }))
      await user.click(within(q3).getByRole('button', { name: 'Always show' }))

      await waitFor(() => expect(conditionUpdates).toEqual([{ questionId: 33, body: { condition: null } }]))
    })

    it('only offers earlier rating questions as the source', async () => {
      const { user } = renderPage('/?survey=3')
      await waitForRows()
      await user.click(screen.getByRole('button', { name: 'Edit questions' }))
      const items = within(screen.getByRole('region', { name: /^Questions of/ })).getAllByRole('listitem')

      expect(within(items[0]).queryByRole('button', { name: /condition/ })).not.toBeInTheDocument()
      await user.click(within(items[2]).getByRole('button', { name: 'Set condition' }))
      const sources = within(items[2]).getByLabelText('Depends on')
      expect(within(sources).getAllByRole('option').map((o) => o.textContent)).toEqual(['Q1'])
    })

    it('says when a condition is off because its source was archived', async () => {
      server.use(handlers.surveys(surveysWithCondition(false)))
      const { user } = renderPage('/?survey=3')
      await waitForRows()
      await user.click(screen.getByRole('button', { name: 'Edit questions' }))
      const q3 = within(screen.getByRole('region', { name: /^Questions of/ })).getAllByRole('listitem')[2]

      expect(q3).toHaveTextContent('Condition off: the question it depended on was archived')
    })
  })
})
