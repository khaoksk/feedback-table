import type { Survey } from '../../api/types'
import { ratingScores } from './scales'

export type StatusFilter = 'completed' | 'draft' | 'all'
export type Ordering = 'newest' | 'oldest'

export const PAGE_SIZES = [25, 50, 100] as const
export type PageSize = (typeof PAGE_SIZES)[number]

/**
 * Everything that decides which rows the table shows. It lives in the URL so
 * a filtered view can be shared, bookmarked and navigated with Back.
 */
export interface Filters {
  survey: number | null
  status: StatusFilter
  ticketless: boolean
  search: string
  rating: number | null
  /** A question id when `survey` is set, otherwise a column position (1 = Q1). */
  ratingQuestion: number | null
  ordering: Ordering
  page: number
  pageSize: PageSize
}

export const DEFAULT_FILTERS: Filters = {
  survey: null,
  status: 'completed',
  ticketless: false,
  search: '',
  rating: null,
  ratingQuestion: null,
  ordering: 'newest',
  page: 1,
  pageSize: 50,
}

function positiveInt(raw: string | null): number | null {
  if (raw === null || !/^\d+$/.test(raw)) return null
  const value = Number(raw)
  return value >= 1 ? value : null
}

function oneOf<T extends string | number>(raw: T | null, allowed: readonly T[], fallback: T): T {
  return raw !== null && allowed.includes(raw) ? raw : fallback
}

/** Read filters from a query string, ignoring anything malformed. */
export function parseFilters(search: string): Filters {
  const params = new URLSearchParams(search)
  const ratingQuestion = positiveInt(params.get('rq'))
  // A rating means nothing without the question it applies to. The question
  // alone is kept: the user may pick it before choosing a score.
  const rating = ratingQuestion === null ? null : positiveInt(params.get('rating'))

  return {
    survey: positiveInt(params.get('survey')),
    status: oneOf(params.get('status') as StatusFilter | null, ['completed', 'draft', 'all'], DEFAULT_FILTERS.status),
    ticketless: params.get('ticketless') === '1',
    search: params.get('q') ?? '',
    rating,
    ratingQuestion,
    ordering: oneOf(params.get('order') as Ordering | null, ['newest', 'oldest'], DEFAULT_FILTERS.ordering),
    page: positiveInt(params.get('page')) ?? 1,
    pageSize: oneOf(positiveInt(params.get('size')) as PageSize | null, PAGE_SIZES, DEFAULT_FILTERS.pageSize),
  }
}

/** Write filters to a query string, leaving out defaults to keep URLs short. */
export function serializeFilters(filters: Filters): string {
  const params = new URLSearchParams()
  if (filters.survey !== null) params.set('survey', String(filters.survey))
  if (filters.status !== DEFAULT_FILTERS.status) params.set('status', filters.status)
  if (filters.ticketless) params.set('ticketless', '1')
  if (filters.search.trim()) params.set('q', filters.search.trim())
  if (filters.ratingQuestion !== null) {
    params.set('rq', String(filters.ratingQuestion))
    if (filters.rating !== null) params.set('rating', String(filters.rating))
  }
  if (filters.ordering !== DEFAULT_FILTERS.ordering) params.set('order', filters.ordering)
  if (filters.page !== 1) params.set('page', String(filters.page))
  if (filters.pageSize !== DEFAULT_FILTERS.pageSize) params.set('size', String(filters.pageSize))
  return params.toString()
}

/** Translate filters into /api/feedback-table/ query parameters. */
export function toApiParams(filters: Filters): URLSearchParams {
  const params = new URLSearchParams({
    status: filters.status,
    ordering: filters.ordering === 'newest' ? '-submitted_at' : 'submitted_at',
    page: String(filters.page),
    page_size: String(filters.pageSize),
  })
  if (filters.survey !== null) params.set('survey', String(filters.survey))
  if (filters.ticketless) params.set('ticketless', 'true')
  if (filters.search.trim()) params.set('search', filters.search.trim())
  if (filters.rating !== null && filters.ratingQuestion !== null) {
    params.set('rating', String(filters.rating))
    params.set('rating_question', String(filters.ratingQuestion))
  }
  return params
}

/**
 * Apply a change that narrows or widens the result set. Any such change sends
 * the user back to page 1, since their old page may no longer exist.
 */
export function refine(filters: Filters, change: Partial<Omit<Filters, 'page'>>): Filters {
  return { ...filters, ...change, page: 1 }
}

/** The questions the rating filter can target, as {value, label} options. */
export function ratingQuestionOptions(
  surveys: Survey[],
  surveyId: number | null,
  columnCount: number,
): { value: number; label: string }[] {
  if (surveyId === null) {
    return Array.from({ length: columnCount }, (_, i) => ({ value: i + 1, label: `Q${i + 1}` }))
  }
  const survey = surveys.find((s) => s.id === surveyId)
  return (survey?.questions ?? [])
    .filter((q) => q.type === 'rating')
    .map((q) => ({ value: q.id, label: `Q${q.order}: ${q.text}` }))
}

/**
 * Switch the survey filter. A rating question id only makes sense inside one
 * survey and a position only across all of them, so the rating target is
 * reset to that scope's first question while the chosen score is kept.
 */
export function withSurvey(filters: Filters, surveyId: number | null, surveys: Survey[], columnCount: number): Filters {
  const options = ratingQuestionOptions(surveys, surveyId, columnCount)
  const inScope = surveyId === null ? surveys : surveys.filter((s) => s.id === surveyId)
  const keepRating = options.length > 0 && filters.rating !== null && ratingScores(inScope).includes(filters.rating)
  return refine(filters, {
    survey: surveyId,
    rating: keepRating ? filters.rating : null,
    ratingQuestion: filters.ratingQuestion === null || options.length === 0 ? null : options[0].value,
  })
}
