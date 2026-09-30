import type { FeedbackTablePage, Survey } from './types'

export class ApiError extends Error {
  readonly status: number

  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

async function getJson<T>(path: string, params: URLSearchParams | undefined, signal?: AbortSignal): Promise<T> {
  // Absolute URL: the app is served from the same origin as /api (Vite proxy),
  // and fetch outside a browser (tests) cannot resolve a relative path.
  const url = new URL(path, window.location.origin)
  if (params) url.search = params.toString()

  const response = await fetch(url, { signal, headers: { Accept: 'application/json' } })
  if (!response.ok) {
    throw new ApiError(response.status, `${path} returned ${response.status}`)
  }
  return (await response.json()) as T
}

export function fetchSurveys(signal?: AbortSignal): Promise<Survey[]> {
  return getJson<Survey[]>('/api/surveys/', undefined, signal)
}

export function fetchFeedbackTable(params: URLSearchParams, signal?: AbortSignal): Promise<FeedbackTablePage> {
  return getJson<FeedbackTablePage>('/api/feedback-table/', params, signal)
}
