import { http, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'

import type { FeedbackRow, FeedbackTablePage, Survey } from '../api/types'

export const SURVEYS: Survey[] = [
  {
    id: 1,
    name: 'Post-Support CSAT',
    questions: [
      { id: 11, order: 1, text: 'How satisfied were you?', type: 'rating' },
      { id: 12, order: 2, text: 'How fast was our reply?', type: 'rating' },
    ],
  },
  {
    id: 2,
    name: 'Quarterly Check-in',
    questions: [
      { id: 21, order: 1, text: 'How likely are you to recommend us?', type: 'rating' },
      { id: 22, order: 2, text: 'How well does it fit?', type: 'rating' },
      { id: 23, order: 3, text: 'Value for money?', type: 'rating' },
    ],
  },
]

export function row(overrides: Partial<FeedbackRow> = {}): FeedbackRow {
  return {
    id: 1,
    submitted_at: '2026-09-29T23:38:12Z',
    status: 'completed',
    customer: { name: 'Ada Lovelace', email: 'ada@example.com', company: 'Acme' },
    ticket: { id: 298, subject: 'Login broken' },
    survey_id: 1,
    answers: {
      '11': { value: '5', display: 'Great', state: 'ok' },
      '12': { value: '3', display: 'Okay', state: 'ok' },
    },
    ...overrides,
  }
}

export function page(results: FeedbackRow[], count = results.length): FeedbackTablePage {
  return { count, next: null, previous: null, results }
}

/** Every /api/feedback-table/ request URL seen during a test, newest last. */
export const tableRequests: URL[] = []

export const handlers = {
  surveys: (surveys: Survey[] = SURVEYS) => http.get('*/api/surveys/', () => HttpResponse.json(surveys)),
  table: (respond: (url: URL) => FeedbackTablePage | Response = () => page([row()])) =>
    http.get('*/api/feedback-table/', ({ request }) => {
      const url = new URL(request.url)
      tableRequests.push(url)
      const body = respond(url)
      return body instanceof Response ? body : HttpResponse.json(body)
    }),
}

export const server = setupServer(handlers.surveys(), handlers.table())

export function lastTableParams(): URLSearchParams {
  const last = tableRequests.at(-1)
  if (!last) throw new Error('No /api/feedback-table/ request was made')
  return last.searchParams
}

export function resetTableRequests() {
  tableRequests.length = 0
}
