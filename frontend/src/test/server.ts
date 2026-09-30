import { http, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'

import type { FeedbackRow, FeedbackTablePage, RatingPoint, Survey } from '../api/types'

export const DEFAULT_SCALE: RatingPoint[] = [
  { score: 1, label: 'Terrible' },
  { score: 2, label: 'Bad' },
  { score: 3, label: 'Okay' },
  { score: 4, label: 'Good' },
  { score: 5, label: 'Great' },
]

/** A 0-10 scale with custom labels, to exercise non-default scales. */
export const TEN_POINT_SCALE: RatingPoint[] = Array.from({ length: 11 }, (_, score) => ({
  score,
  label: `${score} of 10`,
}))

export const SURVEYS: Survey[] = [
  {
    id: 1,
    name: 'Post-Support CSAT',
    rating_scale: DEFAULT_SCALE,
    custom_labels: false,
    questions: [
      { id: 11, order: 1, text: 'How satisfied were you?', type: 'rating', options: [] },
      { id: 12, order: 2, text: 'How fast was our reply?', type: 'rating', options: [] },
    ],
  },
  {
    id: 2,
    name: 'Quarterly Check-in',
    rating_scale: TEN_POINT_SCALE,
    custom_labels: true,
    questions: [
      { id: 21, order: 1, text: 'How likely are you to recommend us?', type: 'rating', options: [] },
      { id: 22, order: 2, text: 'How well does it fit?', type: 'rating', options: [] },
      { id: 23, order: 3, text: 'Value for money?', type: 'rating', options: [] },
    ],
  },
  {
    id: 3,
    name: 'Onboarding CSAT',
    rating_scale: DEFAULT_SCALE,
    custom_labels: false,
    questions: [
      { id: 31, order: 1, text: 'How easy was it to get started?', type: 'rating', options: [] },
      {
        id: 32,
        order: 2,
        text: 'What made the biggest difference?',
        type: 'multiselect',
        options: [
          { id: 301, label: 'Docs', order: 1 },
          { id: 302, label: 'Support team', order: 2 },
          { id: 303, label: 'Kickoff call', order: 3 },
        ],
      },
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

/** Bodies of PUT /api/surveys/<id>/rating-labels/ requests seen during a test. */
export const labelUpdates: { surveyId: number; labels: Record<string, string> | null }[] = []

/** Bodies of POST .../questions/ and .../responses/ requests seen during a test. */
export const createdQuestions: { surveyId: number; body: unknown }[] = []
export const submittedResponses: { surveyId: number; body: unknown }[] = []

export const handlers = {
  surveys: (surveys: Survey[] = SURVEYS) => http.get('*/api/surveys/', () => HttpResponse.json(surveys)),
  table: (respond: (url: URL) => FeedbackTablePage | Response = () => page([row()])) =>
    http.get('*/api/feedback-table/', ({ request }) => {
      const url = new URL(request.url)
      tableRequests.push(url)
      const body = respond(url)
      return body instanceof Response ? body : HttpResponse.json(body)
    }),
  createQuestion: (respond?: () => Response) =>
    http.post('*/api/surveys/:id/questions/', async ({ params, request }) => {
      createdQuestions.push({ surveyId: Number(params.id), body: await request.json() })
      if (respond) return respond()
      return HttpResponse.json({ id: 99, order: 3, text: 'New', type: 'rating', options: [] }, { status: 201 })
    }),
  submitResponse: (respond?: () => Response) =>
    http.post('*/api/surveys/:id/responses/', async ({ params, request }) => {
      submittedResponses.push({ surveyId: Number(params.id), body: await request.json() })
      return respond ? respond() : HttpResponse.json({ id: 501 }, { status: 201 })
    }),
  updateLabels: (respond?: (surveyId: number) => Response) =>
    http.put('*/api/surveys/:id/rating-labels/', async ({ params, request }) => {
      const surveyId = Number(params.id)
      const { labels } = (await request.json()) as { labels: Record<string, string> | null }
      labelUpdates.push({ surveyId, labels })
      if (respond) return respond(surveyId)
      const survey = SURVEYS.find((s) => s.id === surveyId)!
      return HttpResponse.json({
        ...survey,
        custom_labels: labels !== null,
        rating_scale: labels
          ? Object.entries(labels).map(([score, label]) => ({ score: Number(score), label }))
          : DEFAULT_SCALE,
      })
    }),
}

export const server = setupServer(
  handlers.surveys(),
  handlers.table(),
  handlers.updateLabels(),
  handlers.createQuestion(),
  handlers.submitResponse(),
)

export function lastTableParams(): URLSearchParams {
  const last = tableRequests.at(-1)
  if (!last) throw new Error('No /api/feedback-table/ request was made')
  return last.searchParams
}

export function resetTableRequests() {
  tableRequests.length = 0
  labelUpdates.length = 0
  createdQuestions.length = 0
  submittedResponses.length = 0
}
