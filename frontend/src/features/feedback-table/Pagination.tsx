import { PAGE_SIZES, type PageSize } from './filters'

interface Props {
  page: number
  pageSize: PageSize
  count: number
  onPage: (page: number) => void
  onPageSize: (size: PageSize) => void
}

export function Pagination({ page, pageSize, count, onPage, onPageSize }: Props) {
  const pages = Math.max(1, Math.ceil(count / pageSize))

  return (
    <nav className="pagination" aria-label="Pagination">
      <button type="button" disabled={page <= 1} onClick={() => onPage(page - 1)}>
        ← Previous
      </button>
      <span className="page-status" aria-live="polite">
        Page {page.toLocaleString()} of {pages.toLocaleString()}
      </span>
      <button type="button" disabled={page >= pages} onClick={() => onPage(page + 1)}>
        Next →
      </button>
      <label className="page-size">
        Rows per page
        <select value={pageSize} onChange={(event) => onPageSize(Number(event.target.value) as PageSize)}>
          {PAGE_SIZES.map((size) => (
            <option key={size} value={size}>
              {size}
            </option>
          ))}
        </select>
      </label>
    </nav>
  )
}
