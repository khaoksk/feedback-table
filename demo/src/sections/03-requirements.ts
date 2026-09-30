import type { Page } from 'playwright'

import type { Demo } from '../annotate'
import { API_URL, APP_URL } from '../env'

const PAGE_SIZE = 50

interface Row {
  id: number
  answers: Record<string, { value: string | null; state: string; selections?: { removed: boolean }[] }>
}

/**
 * The table page (default size and order) holding the first row that matches,
 * so the demo can go straight to an example instead of hoping page 1 has one.
 */
async function pageWith(survey: number, match: (row: Row) => boolean): Promise<number> {
  for (let page = 1; page <= 60; page++) {
    const params = new URLSearchParams({
      survey: String(survey),
      status: 'completed',
      ordering: '-submitted_at',
      page: String(page),
      page_size: String(PAGE_SIZE),
    })
    const data = (await (await fetch(`${API_URL}/api/feedback-table/?${params}`)).json()) as { results: Row[] }
    if (data.results.some(match)) return page
    if (data.results.length < PAGE_SIZE) break
  }
  return 1
}

interface SurveyInfo {
  id: number
  /** Question ids by position: questions[0] is Q1. */
  questions: number[]
}

async function surveysByName(): Promise<(name: string) => SurveyInfo> {
  const surveys = (await (await fetch(`${API_URL}/api/surveys/`)).json()) as {
    id: number
    name: string
    questions: { id: number; order: number }[]
  }[]
  return (name) => {
    const survey = surveys.find((s) => s.name === name)
    if (!survey) throw new Error(`No survey named ${name}; reseed the database.`)
    return { id: survey.id, questions: [...survey.questions].sort((a, b) => a.order - b.order).map((q) => q.id) }
  }
}

function questionGroup(page: Page, order: number) {
  // Each question is a <fieldset> whose legend starts "Q<order>.".
  return page.getByRole('group', { name: new RegExp(`^Q${order}\\.`) })
}

function ratingChoice(page: Page, order: number, score: number) {
  return questionGroup(page, order).locator('label.rating-choice', { has: page.locator('.score', { hasText: new RegExp(`^${score}$`) }) })
}

/** The six requirements, in order, against the reseeded 10K dataset. */
export async function requirements(demo: Demo): Promise<void> {
  const { page } = demo
  const survey = await surveysByName()
  const postSupport = survey('Post-Support CSAT').id
  const onboarding = survey('Onboarding CSAT')
  const quarterly = survey('Quarterly Check-in')
  const multiselectQ3 = String(onboarding.questions[2])
  const commentQ4 = String(quarterly.questions[3])
  const toolbar = page.getByRole('search')

  await demo.goto(`${APP_URL}/?survey=${onboarding.id}`)
  await demo.card(2, 'The six requirements', [
    '1 · Custom rating labels per survey',
    '2 · Multi-select questions',
    '3 · Comment questions',
    '4 · Re-answering, with history',
    '5 · Show the latest survey settings',
    '6 · Conditional questions',
  ])

  // Req 1 ────────────────────────────────────────────────────────────────
  await demo.say('Req 1 · Custom labels', 'Onboarding CSAT names its scale differently: the same 5 reads **Awesome**, not Great.')
  const badge = page.locator('tbody td.qcell[data-state="ok"] .badge', { hasText: /^5 · / }).first()
  await demo.spotlight(badge, 'this survey’s own label for 5', 2500)
  await demo.clear()
  await demo.click(toolbar.getByRole('button', { name: 'Edit labels' }))
  await demo.type(page.getByLabel('Label for score 5', { exact: true }), 'Loved it')
  await demo.click(page.getByRole('button', { name: 'Save labels' }), 'saved per survey; answers are not rewritten')
  await demo.spotlight(page.locator('tbody .badge', { hasText: '5 · Loved it' }).first(), 'every existing 5 now reads **Loved it**', 2800)
  await demo.clear()

  // Req 2 ────────────────────────────────────────────────────────────────
  await demo.say('Req 2 · Multi-select', 'Q3 of Onboarding is a multi-select question: answers show as chips.')
  await demo.spotlight(page.locator('tbody .chips').first(), 'one answer, several options', 2200)
  await demo.clear()
  await demo.say('Add a question from the UI', 'A new multi-select question becomes the next column; old responses show it as not answered.', 3000)
  await demo.click(toolbar.getByRole('button', { name: 'Add question' }))
  const form = page.locator('form[aria-labelledby="question-form-title"]')
  await demo.type(form.getByLabel('Question', { exact: true }), 'Which channels do you use?')
  await demo.type(form.getByRole('textbox', { name: 'Option 1', exact: true }), 'Email')
  await demo.type(form.getByRole('textbox', { name: 'Option 2', exact: true }), 'Chat')
  await demo.click(form.getByRole('button', { name: '+ Add option' }))
  await demo.type(form.getByRole('textbox', { name: 'Option 3', exact: true }), 'Phone')
  await demo.click(form.getByRole('button', { name: 'Add question' }))
  await demo.spotlight(page.locator('thead th').last(), 'new column', 2200)
  await demo.clear()

  await demo.say('Answer it as a customer', 'The “Answer a survey” page saves through the same API and validation.', 2800)
  await demo.click(page.getByRole('link', { name: 'Answer a survey' }))
  await demo.select(page.locator('#respond-survey'), 'Onboarding CSAT')
  await demo.type(page.locator('#respond-email'), 'demo.viewer@example.com')
  await demo.type(page.locator('#respond-name'), 'Demo Viewer')
  await demo.click(ratingChoice(page, 1, 4))
  await demo.click(questionGroup(page, 3).getByLabel('Docs', { exact: true }))
  await demo.click(questionGroup(page, 3).getByLabel('Kickoff call', { exact: true }))
  await demo.click(questionGroup(page, 4).getByLabel('Chat', { exact: true }))
  await demo.click(questionGroup(page, 4).getByLabel('Phone', { exact: true }))
  await demo.click(page.getByRole('button', { name: 'Submit response' }))
  const editLink = await page.locator('#edit-link').inputValue()
  await demo.spotlight(page.locator('#edit-link'), 'a private edit link, with a random token', 2500)
  await demo.clear()
  await demo.click(page.getByRole('link', { name: 'See it in the feedback table' }))
  await demo.spotlight(page.locator('tbody tr').first(), 'the new response, newest first', 2800)
  await demo.clear()

  // Req 3 ────────────────────────────────────────────────────────────────
  const fivePage = await pageWith(quarterly.id, (row) => row.answers[commentQ4]?.state === 'ok' && row.answers[commentQ4]?.value === '5')
  await demo.goto(`${APP_URL}/?survey=${quarterly.id}&page=${fivePage}`)
  await demo.say('Req 3 · Comments', 'Q4 of Quarterly Check-in is free text, stored in the same value column as ratings.')
  const fiveComment = page.locator('tbody .comment', { hasText: /^“5”$/ }).first()
  await demo.spotlightIfPresent(fiveComment, 'a comment of “5” stays text: it never counts as a rating', 3200)
  await demo.clear()
  const more = page.getByRole('button', { name: 'Show more' }).first()
  if (await more.isVisible()) {
    await demo.click(more, 'long comments start collapsed')
    await demo.pause(1500)
  }

  // Req 4 ────────────────────────────────────────────────────────────────
  await demo.say('Req 4 · Re-answer', 'The customer opens their private link and changes Q1 from 4 to 2.')
  await demo.goto(editLink)
  await demo.click(ratingChoice(page, 1, 2))
  await demo.click(page.getByRole('button', { name: 'Save changes' }))
  await demo.click(page.getByRole('link', { name: 'See it in the feedback table' }))
  const edited = page.locator('tbody tr').first().locator('.edited-tag').first()
  const note = (await edited.getAttribute('title')) ?? ''
  await demo.say('Latest value, with history', 'The table shows the latest answer. Hovering **edited** shows the original and how many edits.')
  await demo.hover(edited, `tooltip: **${note}**`, 4000)

  // Req 5 ────────────────────────────────────────────────────────────────
  const removedPage = await pageWith(onboarding.id, (row) => Boolean(row.answers[multiselectQ3]?.selections?.some((s) => s.removed)))
  await demo.goto(`${APP_URL}/?survey=${onboarding.id}&page=${removedPage}`)
  await demo.say('Req 5 · Latest settings', 'Options removed since an answer was given stay on that answer, marked as removed.')
  await demo.spotlightIfPresent(page.locator('tbody .chip.removed'), 'dashed: an option removed since (hover: “Option removed…”)', 3200)
  await demo.clear()

  await demo.say('Rename an option', 'Renaming changes every old answer too, because answers store option ids, not labels.')
  await demo.click(toolbar.getByRole('button', { name: 'Edit questions' }))
  await demo.click(page.locator('.question-row', { hasText: 'Q3.' }).getByRole('button', { name: 'Edit options' }))
  await demo.type(page.getByRole('form', { name: 'Options of Q3' }).getByRole('textbox', { name: 'Option 1', exact: true }), 'Help docs')
  await demo.click(page.getByRole('button', { name: 'Save options' }))
  await demo.click(page.getByRole('button', { name: 'Close' }))
  await demo.spotlightIfPresent(page.locator('tbody .chip', { hasText: 'Help docs' }), 'old answers show the new name', 2500)
  await demo.clear()

  await demo.say('Change the scale', 'Narrowing the scale to 1–3 warns that stored 4s and 5s will show as legacy. Nothing is rewritten.')
  await demo.click(toolbar.getByRole('button', { name: 'Edit labels' }))
  await demo.select(page.getByLabel('Highest score', { exact: true }), '3', 'scale **1 → 3**')
  await demo.spotlight(page.getByRole('note'), 'the warning before saving', 3000)
  await demo.clear()
  await demo.click(page.getByRole('button', { name: 'Cancel' }), 'cancelled: the demo keeps 1–5')

  await demo.goto(`${APP_URL}/?survey=${postSupport}`)
  await demo.say('Archived questions', 'Archiving removes the column, but the answers are kept and listed here.')
  await demo.click(toolbar.getByRole('button', { name: 'Edit questions' }))
  const archived = page.locator('section.archived-questions')
  await demo.spotlight(archived, `${(await archived.locator('li').first().textContent())?.trim()}`, 3500)
  await demo.clear()
  await demo.click(page.getByRole('button', { name: 'Close' }))

  // Req 6 ────────────────────────────────────────────────────────────────
  await demo.goto(`${APP_URL}/?survey=${quarterly.id}`)
  await demo.say('Req 6 · Conditional questions', 'Q4 is shown only when Q1 > 2. Otherwise the table says why it is blank.')
  const hiddenRow = page.locator('tbody tr', { has: page.locator('td[data-state="condition_not_met"]') }).first()
  await demo.spotlight(hiddenRow.locator('td.qcell').first(), 'Q1 is 2 or lower…', 2000)
  await demo.spotlight(hiddenRow.locator('td[data-state="condition_not_met"]'), '…so Q4 was never shown', 2500)
  await demo.clear()

  await demo.click(page.getByRole('link', { name: 'Answer a survey' }))
  await demo.select(page.locator('#respond-survey'), 'Quarterly Check-in')
  await demo.click(ratingChoice(page, 1, 2), 'Q1 = 2')
  await demo.say('Live in the form', 'At Q1 = 2 there is no Q4. Picking 3 shows it.', 2800)
  await demo.click(ratingChoice(page, 1, 3), 'Q1 = 3')
  await demo.spotlight(questionGroup(page, 4), 'Q4 appears', 2500)
  await demo.clear()

  await demo.goto(`${APP_URL}/?survey=${quarterly.id}`)
  await demo.click(toolbar.getByRole('button', { name: 'Edit questions' }))
  await demo.spotlight(page.locator('.condition-note').first(), 'set per question, from Edit questions', 3000)
  await demo.clear()
  await demo.hideCaption()
}
