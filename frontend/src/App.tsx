import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useState } from 'react'

import { FeedbackTablePage } from './features/feedback-table/FeedbackTablePage'

export default function App() {
  const [queryClient] = useState(
    () => new QueryClient({ defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } } }),
  )
  return (
    <QueryClientProvider client={queryClient}>
      <FeedbackTablePage />
    </QueryClientProvider>
  )
}
