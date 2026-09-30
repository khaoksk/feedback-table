import { ApiError } from '../../api/client'

/** The respondent's private link for changing their answers later (Req 4). */
export function editLink(responseId: number, token: string): string {
  return `${window.location.origin}/respond/${responseId}?token=${encodeURIComponent(token)}`
}

export function apiErrors(error: unknown, fallback: string): string[] {
  if (error instanceof ApiError && error.messages.length > 0) return error.messages
  return error ? [fallback] : []
}
