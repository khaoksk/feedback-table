import type { FeedbackTablePage, Survey } from './types'

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
  return request<Survey>(apiUrl(`/api/surveys/${surveyId}/rating-labels/`), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ labels }),
  })
}
