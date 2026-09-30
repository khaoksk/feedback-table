export const RESPOND_PATH = '/respond'
const EDIT_PATH = /^\/respond\/(\d+)\/?$/

/** Which page a path shows: the table, a new response, or an edit link. */
export function route(path: string, search: string): { page: 'table' } | { page: 'respond' } | { page: 'edit'; responseId: number; token: string } {
  const edit = EDIT_PATH.exec(path)
  if (edit) return { page: 'edit', responseId: Number(edit[1]), token: new URLSearchParams(search).get('token') ?? '' }
  if (path.startsWith(RESPOND_PATH)) return { page: 'respond' }
  return { page: 'table' }
}
