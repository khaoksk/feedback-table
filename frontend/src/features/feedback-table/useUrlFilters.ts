import { useCallback, useMemo, useSyncExternalStore } from 'react'

import { parseFilters, serializeFilters, type Filters } from './filters'

const listeners = new Set<() => void>()

function subscribe(listener: () => void) {
  listeners.add(listener)
  window.addEventListener('popstate', listener)
  return () => {
    listeners.delete(listener)
    window.removeEventListener('popstate', listener)
  }
}

function getSearch() {
  return window.location.search
}

/**
 * Filters backed by the URL query string. `replace` updates the URL without a
 * new history entry (used while typing a search), so Back skips keystrokes.
 */
export function useUrlFilters(): [Filters, (next: Filters, options?: { replace?: boolean }) => void] {
  const search = useSyncExternalStore(subscribe, getSearch)
  const filters = useMemo(() => parseFilters(search), [search])

  const setFilters = useCallback((next: Filters, options: { replace?: boolean } = {}) => {
    const query = serializeFilters(next)
    const url = `${window.location.pathname}${query ? `?${query}` : ''}`
    if (options.replace) window.history.replaceState(null, '', url)
    else window.history.pushState(null, '', url)
    listeners.forEach((listener) => listener())
  }, [])

  return [filters, setFilters]
}
