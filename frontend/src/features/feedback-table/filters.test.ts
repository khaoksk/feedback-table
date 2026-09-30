import { describe, expect, it } from 'vitest'

import { SURVEYS } from '../../test/server'
import {
  DEFAULT_FILTERS,
  parseFilters,
  ratingQuestionOptions,
  refine,
  serializeFilters,
  toApiParams,
  withSurvey,
  type Filters,
} from './filters'

describe('parseFilters', () => {
  it('returns defaults for an empty query string', () => {
    expect(parseFilters('')).toEqual(DEFAULT_FILTERS)
  })

  it('reads every filter', () => {
    expect(
      parseFilters('?survey=2&status=all&ticketless=1&q=acme&rating=5&rq=21&order=oldest&page=3&size=100'),
    ).toEqual({
      survey: 2,
      status: 'all',
      ticketless: true,
      search: 'acme',
      rating: 5,
      ratingQuestion: 21,
      ordering: 'oldest',
      page: 3,
      pageSize: 100,
    })
  })

  it.each([
    ['survey=abc', { survey: null }],
    ['survey=0', { survey: null }],
    ['status=archived', { status: 'completed' }],
    ['order=sideways', { ordering: 'newest' }],
    ['page=-2', { page: 1 }],
    ['page=1.5', { page: 1 }],
    ['size=30', { pageSize: 50 }],
    ['ticketless=yes', { ticketless: false }],
  ])('ignores malformed %s', (query, expected) => {
    expect(parseFilters(query)).toMatchObject(expected)
  })

  it('drops a rating that has no question to apply to', () => {
    expect(parseFilters('rating=5')).toMatchObject({ rating: null, ratingQuestion: null })
  })

  it('keeps a chosen question before any score is picked', () => {
    expect(parseFilters('rq=2')).toMatchObject({ rating: null, ratingQuestion: 2 })
  })
})

describe('serializeFilters', () => {
  it('leaves defaults out of the URL', () => {
    expect(serializeFilters(DEFAULT_FILTERS)).toBe('')
  })

  it('round-trips through parseFilters', () => {
    const filters: Filters = {
      survey: 1,
      status: 'draft',
      ticketless: true,
      search: 'ada',
      rating: 4,
      ratingQuestion: 12,
      ordering: 'oldest',
      page: 7,
      pageSize: 25,
    }
    expect(parseFilters(serializeFilters(filters))).toEqual(filters)
  })

  it('trims the search text', () => {
    expect(serializeFilters({ ...DEFAULT_FILTERS, search: '  ada  ' })).toBe('q=ada')
  })
})

describe('toApiParams', () => {
  it('maps defaults to explicit API parameters', () => {
    expect(Object.fromEntries(toApiParams(DEFAULT_FILTERS))).toEqual({
      status: 'completed',
      ordering: '-submitted_at',
      page: '1',
      page_size: '50',
    })
  })

  it('maps every filter to its API name', () => {
    const params = toApiParams({
      ...DEFAULT_FILTERS,
      survey: 2,
      ticketless: true,
      search: ' acme ',
      rating: 5,
      ratingQuestion: 21,
      ordering: 'oldest',
    })
    expect(Object.fromEntries(params)).toMatchObject({
      survey: '2',
      ticketless: 'true',
      search: 'acme',
      rating: '5',
      rating_question: '21',
      ordering: 'submitted_at',
    })
  })

  it('sends no rating filter until both score and question are set', () => {
    const params = toApiParams({ ...DEFAULT_FILTERS, ratingQuestion: 1 })
    expect(params.has('rating')).toBe(false)
    expect(params.has('rating_question')).toBe(false)
  })
})

describe('refine', () => {
  it('returns to page 1 whenever the result set changes', () => {
    expect(refine({ ...DEFAULT_FILTERS, page: 9 }, { status: 'all' })).toMatchObject({ status: 'all', page: 1 })
  })
})

describe('rating question scope', () => {
  it('offers column positions across all surveys', () => {
    expect(ratingQuestionOptions(SURVEYS, null, 3)).toEqual([
      { value: 1, label: 'Q1' },
      { value: 2, label: 'Q2' },
      { value: 3, label: 'Q3' },
    ])
  })

  it("offers the selected survey's rating questions by id", () => {
    expect(ratingQuestionOptions(SURVEYS, 1, 3)).toEqual([
      { value: 11, label: 'Q1: How satisfied were you?' },
      { value: 12, label: 'Q2: How fast was our reply?' },
    ])
  })

  it('switching survey keeps the score but retargets it to the new scope', () => {
    const filtered = { ...DEFAULT_FILTERS, rating: 5, ratingQuestion: 2, page: 4 }

    expect(withSurvey(filtered, 2, SURVEYS, 3)).toMatchObject({ survey: 2, rating: 5, ratingQuestion: 21, page: 1 })
    expect(withSurvey({ ...filtered, survey: 2, ratingQuestion: 23 }, null, SURVEYS, 3)).toMatchObject({
      survey: null,
      rating: 5,
      ratingQuestion: 1,
    })
  })

  it('switching survey without a rating filter leaves it off', () => {
    expect(withSurvey(DEFAULT_FILTERS, 1, SURVEYS, 3)).toMatchObject({ rating: null, ratingQuestion: null })
  })
})

describe('rating chips follow the scale in view', () => {
  it('drops a score the newly selected survey does not have', () => {
    const onTen = { ...DEFAULT_FILTERS, survey: 2, rating: 9, ratingQuestion: 21 }

    expect(withSurvey(onTen, 1, SURVEYS, 3)).toMatchObject({ survey: 1, rating: null, ratingQuestion: 11 })
  })
})
