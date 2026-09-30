import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useState } from 'react'

import { FeedbackTablePage } from './features/feedback-table/FeedbackTablePage'
import { EditResponsePage } from './features/respond/EditResponsePage'
import { RespondPage } from './features/respond/RespondPage'
import { RESPOND_PATH, route } from './routes'


/** Two pages, chosen by path; plain links reload the page, which is fine here. */
export function Nav({ path }: { path: string }) {
  const onRespond = path.startsWith(RESPOND_PATH)
  return (
    <nav className="app-nav" aria-label="Main">
      <a href="/" aria-current={onRespond ? undefined : 'page'}>
        Feedback table
      </a>
      <a href={RESPOND_PATH} aria-current={onRespond ? 'page' : undefined}>
        Answer a survey
      </a>
    </nav>
  )
}

export default function App() {
  const [queryClient] = useState(
    () => new QueryClient({ defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } } }),
  )
  const path = window.location.pathname
  const current = route(path, window.location.search)
  return (
    <QueryClientProvider client={queryClient}>
      <Nav path={path} />
      {current.page === 'edit' ? (
        <EditResponsePage responseId={current.responseId} token={current.token} />
      ) : current.page === 'respond' ? (
        <RespondPage />
      ) : (
        <FeedbackTablePage />
      )}
    </QueryClientProvider>
  )
}
