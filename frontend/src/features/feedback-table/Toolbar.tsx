import type { Survey } from '../../api/types'
import { RATING_VALUES, type Filters, type StatusFilter } from './filters'

interface Props {
  filters: Filters
  surveys: Survey[]
  searchText: string
  ratingOptions: { value: number; label: string }[]
  onSearchText: (text: string) => void
  onSurvey: (surveyId: number | null) => void
  onRating: (rating: number | null) => void
  onRatingQuestion: (question: number) => void
  onStatus: (status: StatusFilter) => void
  onTicketless: (ticketless: boolean) => void
}

export function Toolbar(props: Props) {
  const { filters, surveys, ratingOptions } = props
  const ratingQuestion = filters.ratingQuestion ?? ratingOptions[0]?.value

  return (
    <div className="toolbar" role="search">
      <label className="visually-hidden" htmlFor="search">
        Search customer or company
      </label>
      <input
        id="search"
        type="search"
        placeholder="Search customer or company"
        value={props.searchText}
        onChange={(event) => props.onSearchText(event.target.value)}
      />

      <label className="visually-hidden" htmlFor="survey">
        Survey
      </label>
      <select
        id="survey"
        value={filters.survey ?? ''}
        onChange={(event) => props.onSurvey(event.target.value ? Number(event.target.value) : null)}
      >
        <option value="">All surveys</option>
        {surveys.map((survey) => (
          <option key={survey.id} value={survey.id}>
            {survey.name}
          </option>
        ))}
      </select>

      <label className="visually-hidden" htmlFor="status">
        Status
      </label>
      <select id="status" value={filters.status} onChange={(event) => props.onStatus(event.target.value as StatusFilter)}>
        <option value="completed">Completed</option>
        <option value="draft">Drafts</option>
        <option value="all">All statuses</option>
      </select>

      <div className="rating-filter" role="group" aria-label="Rating filter">
        <div className="rating-chips">
          <button
            type="button"
            className={`rchip${filters.rating === null ? ' active' : ''}`}
            aria-pressed={filters.rating === null}
            onClick={() => props.onRating(null)}
          >
            All ratings
          </button>
          {RATING_VALUES.map((value) => (
            <button
              key={value}
              type="button"
              className={`rchip${filters.rating === value ? ' active' : ''}`}
              aria-pressed={filters.rating === value}
              disabled={ratingOptions.length === 0}
              onClick={() => props.onRating(value)}
            >
              {value}
            </button>
          ))}
        </div>
        <label htmlFor="rating-question" className="rating-on">
          on
        </label>
        <select
          id="rating-question"
          value={ratingQuestion ?? ''}
          disabled={ratingOptions.length === 0}
          onChange={(event) => props.onRatingQuestion(Number(event.target.value))}
        >
          {ratingOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>

      <label className="checkbox-label">
        <input
          type="checkbox"
          checked={filters.ticketless}
          onChange={(event) => props.onTicketless(event.target.checked)}
        />
        Ticket-less only
      </label>
    </div>
  )
}
