import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { useEffect, useMemo, useState } from 'react'

import { ApiError, fetchFeedbackTable, fetchSurveys } from '../../api/client'
import { columnCount } from './columns'
import { FeedbackTable } from './FeedbackTable'
import { ratingQuestionOptions, refine, toApiParams, withSurvey } from './filters'
import { LabelEditor } from './LabelEditor'
import { Pagination } from './Pagination'
import { QuestionForm } from './QuestionForm'
import { ratingScores } from './scales'
import { Toolbar } from './Toolbar'
import { useUrlFilters } from './useUrlFilters'

export const SEARCH_DEBOUNCE_MS = 300

export function FeedbackTablePage() {
  const [filters, setFilters] = useUrlFilters()

  const surveysQuery = useQuery({
    queryKey: ['surveys'],
    queryFn: ({ signal }) => fetchSurveys(signal),
    staleTime: 5 * 60_000,
  })
  const surveys = useMemo(() => surveysQuery.data ?? [], [surveysQuery.data])
  const surveysById = useMemo(() => new Map(surveys.map((s) => [s.id, s])), [surveys])
  const selectedSurvey = filters.survey === null ? undefined : surveysById.get(filters.survey)

  const allColumns = columnCount(surveys)
  const columns = selectedSurvey ? columnCount([selectedSurvey]) : allColumns
  const ratingOptions = ratingQuestionOptions(surveys, filters.survey, allColumns)
  const scores = ratingScores(selectedSurvey ? [selectedSurvey] : surveys)
  // At most one settings panel is open at a time.
  const [panel, setPanel] = useState<'labels' | 'question' | null>(null)

  const apiParams = toApiParams(filters)
  const tableQuery = useQuery({
    queryKey: ['feedback-table', apiParams.toString()],
    queryFn: ({ signal }) => fetchFeedbackTable(apiParams, signal),
    // Keep showing the current page while the next one loads, instead of
    // flashing an empty table on every filter change.
    placeholderData: keepPreviousData,
  })

  // Typing updates a draft immediately; the URL (and the request) follows
  // once the user pauses, and without adding a history entry per keystroke.
  const [searchDraft, setSearchDraft] = useState<string | null>(null)
  useEffect(() => {
    if (searchDraft === null) return
    const timer = window.setTimeout(() => {
      setFilters(refine(filters, { search: searchDraft }), { replace: true })
      setSearchDraft(null)
    }, SEARCH_DEBOUNCE_MS)
    return () => window.clearTimeout(timer)
  }, [searchDraft, filters, setFilters])

  const data = tableQuery.data
  const firstRow = (filters.page - 1) * filters.pageSize + 1
  const lastRow = firstRow + (data?.results.length ?? 0) - 1

  return (
    <main className="page">
      <header>
        <h1>Feedback responses</h1>
        <p className="subtitle">One row per survey response, with the customer, ticket and every answer.</p>
      </header>

      <Toolbar
        filters={filters}
        surveys={surveys}
        searchText={searchDraft ?? filters.search}
        ratingOptions={ratingOptions}
        ratingScores={scores}
        onEditLabels={() => setPanel('labels')}
        onAddQuestion={() => setPanel('question')}
        onSearchText={setSearchDraft}
        onSurvey={(surveyId) => setFilters(withSurvey(filters, surveyId, surveys, allColumns))}
        onRating={(rating) =>
          setFilters(
            refine(filters, { rating, ratingQuestion: filters.ratingQuestion ?? ratingOptions[0]?.value ?? null }),
          )
        }
        onRatingQuestion={(ratingQuestion) => setFilters(refine(filters, { ratingQuestion }))}
        onStatus={(status) => setFilters(refine(filters, { status }))}
        onTicketless={(ticketless) => setFilters(refine(filters, { ticketless }))}
      />

      {panel === 'labels' && selectedSurvey && (
        <LabelEditor key={selectedSurvey.id} survey={selectedSurvey} onClose={() => setPanel(null)} />
      )}
      {panel === 'question' && selectedSurvey && (
        <QuestionForm key={selectedSurvey.id} survey={selectedSurvey} onClose={() => setPanel(null)} />
      )}

      <p className="count" aria-live="polite">
        {!data
          ? 'Loading responses…'
          : data.count === 0
            ? 'No responses match these filters.'
            : `Showing ${firstRow.toLocaleString()}–${lastRow.toLocaleString()} of ${data.count.toLocaleString()} responses`}
      </p>

      {tableQuery.isError && (
        <div className="error" role="alert">
          {tableQuery.error instanceof ApiError && tableQuery.error.status === 404 && filters.page > 1 ? (
            <>
              This page no longer exists.{' '}
              <button type="button" onClick={() => setFilters({ ...filters, page: 1 })}>
                Go to the first page
              </button>
            </>
          ) : (
            <>
              Couldn't load responses.{' '}
              <button type="button" onClick={() => tableQuery.refetch()}>
                Try again
              </button>
            </>
          )}
        </div>
      )}

      {data && data.count > 0 && (
        <>
          <FeedbackTable
            rows={data.results}
            surveysById={surveysById}
            columns={columns}
            survey={selectedSurvey}
            ordering={filters.ordering}
            onToggleOrdering={() =>
              setFilters(refine(filters, { ordering: filters.ordering === 'newest' ? 'oldest' : 'newest' }))
            }
            busy={tableQuery.isPlaceholderData}
          />
          <Pagination
            page={filters.page}
            pageSize={filters.pageSize}
            count={data.count}
            onPage={(page) => setFilters({ ...filters, page })}
            onPageSize={(pageSize) => setFilters(refine(filters, { pageSize }))}
          />
        </>
      )}
    </main>
  )
}
