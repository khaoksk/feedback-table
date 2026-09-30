import type { FeedbackTablePage, Question, QuestionType, Survey } from './types'

export class ApiError extends Error {
  readonly status: number
  /** Validation messages from a 400 response, flattened, if any. */
  readonly messages: string[]

  constructor(status: number, message: string, messages: string[] = []) {
    super(message)
    this.status = status
    this.messages = messages
  }
}

// Absolute URL: the app is served from the same origin as /api (Vite proxy),
// and fetch outside a browser (tests) cannot resolve a relative path.
function apiUrl(path: string, params?: URLSearchParams): URL {
  const url = new URL(path, window.location.origin)
  if (params) url.search = params.toString()
  return url
}

/** DRF error bodies nest messages in objects and lists; collect the strings. */
function collectMessages(body: unknown): string[] {
  if (typeof body === 'string') return [body]
  if (Array.isArray(body)) return body.flatMap(collectMessages)
  if (body && typeof body === 'object') return Object.values(body).flatMap(collectMessages)
  return []
}

async function request<T>(url: URL, init: RequestInit): Promise<T> {
  const response = await fetch(url, { ...init, headers: { Accept: 'application/json', ...init.headers } })
  if (!response.ok) {
    const body: unknown = await response.json().catch(() => null)
    throw new ApiError(response.status, `${url.pathname} returned ${response.status}`, collectMessages(body))
  }
  // 204 No Content (e.g. archiving) has no body to parse.
  if (response.status === 204) return undefined as T
  return (await response.json()) as T
}

export function fetchSurveys(signal?: AbortSignal): Promise<Survey[]> {
  return request<Survey[]>(apiUrl('/api/surveys/'), { signal })
}

export function fetchFeedbackTable(params: URLSearchParams, signal?: AbortSignal): Promise<FeedbackTablePage> {
  return request<FeedbackTablePage>(apiUrl('/api/feedback-table/', params), { signal })
}

/** Set a survey's labels ({score: label}); null resets to the defaults. */
export function updateRatingLabels(surveyId: number, labels: Record<string, string> | null): Promise<Survey> {
  return sendJson<Survey>('PUT', `/api/surveys/${surveyId}/rating-labels/`, { labels })
}

function sendJson<T>(method: 'POST' | 'PUT' | 'DELETE', path: string, body?: unknown): Promise<T> {
  return request<T>(apiUrl(path), {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

/** Archive a question: it leaves the survey, later questions move up, answers stay (Req 5). */
export function archiveQuestion(questionId: number): Promise<void> {
  return sendJson<void>('DELETE', `/api/questions/${questionId}/`)
}

/** Replace a multi-select question's options; ones left out are archived, not deleted. */
export function updateOptions(
  questionId: number,
  options: ({ id: number; label: string } | { label: string })[],
): Promise<Question> {
  return sendJson<Question>('PUT', `/api/questions/${questionId}/options/`, { options })
}

export function createQuestion(
  surveyId: number,
  question: { text: string; type: QuestionType; options: string[] },
): Promise<Question> {
  return sendJson<Question>('POST', `/api/surveys/${surveyId}/questions/`, question)
}

/** Answers map question id to a score (rating), option ids (multi-select) or text (comment). */
export interface ResponseSubmission {
  name: string
  email: string
  company: string
  answers: Record<string, number | number[] | string>
}

/** The new response's id, and the secret for the respondent's private edit link. */
export function submitResponse(
  surveyId: number,
  submission: ResponseSubmission,
): Promise<{ id: number; edit_token: string }> {
  return sendJson<{ id: number; edit_token: string }>('POST', `/api/surveys/${surveyId}/responses/`, submission)
}

export interface EditableResponse {
  id: number
  survey_id: number
  customer: { name: string; email: string; company: string }
  answers: ResponseSubmission['answers']
}

function editPath(responseId: number, token: string): string {
  return `/api/responses/${responseId}/edit/?token=${encodeURIComponent(token)}`
}

export function fetchResponseForEdit(responseId: number, token: string, signal?: AbortSignal): Promise<EditableResponse> {
  return request<EditableResponse>(new URL(editPath(responseId, token), window.location.origin), { signal })
}

/** Change answers; returns how many changed. Questions left out keep their answer. */
export function updateResponse(
  responseId: number,
  token: string,
  answers: ResponseSubmission['answers'],
): Promise<{ id: number; changed: number }> {
  return sendJson<{ id: number; changed: number }>('PUT', editPath(responseId, token), { answers })
}
