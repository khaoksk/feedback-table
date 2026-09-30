import type { EditedInfo, Question } from '../../api/types'

const editedDate = new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit' })

/** The design's "Originally X on DATE", plus how many times it was changed since. */
export function editedNote(question: Question, edited: EditedInfo): string {
  const original =
    question.type === 'rating'
      ? `${edited.original_value} · ${edited.original_display ?? 'Unrated'}`
      : `"${edited.original_display ?? edited.original_value}"`
  const times = edited.edit_count === 1 ? 'once' : `${edited.edit_count} times`
  return `Originally ${original} on ${editedDate.format(new Date(edited.original_at))} · edited ${times}`
}
