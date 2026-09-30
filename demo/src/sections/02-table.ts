import type { Demo } from '../annotate'
import { APP_URL } from '../env'

/** Columns, the edge cases the table shows, and filters that live in the URL. */
export async function table(demo: Demo): Promise<void> {
  const { page } = demo
  await demo.goto(`${APP_URL}/?status=all`)
  await demo.card(1, 'The table and its filters', [
    'One row per response, with customer, ticket, survey and every answer.',
  ])

  const head = page.locator('thead tr')
  await demo.say('Columns', 'Created, Customer, Company, Ticket, Survey, then one column per question position.')
  await demo.spotlight(head, 'Q1–Q4: the question at that position in each row’s survey', 3000)
  await demo.clear()

  await demo.say('Edge cases are visible', 'Anonymous customers, responses without a ticket, and drafts (Status → All statuses).')
  for (const [text, label] of [
    ['Anonymous', 'no name on file'],
    ['No ticket', 'feedback not tied to a ticket'],
  ] as const) {
    await demo.spotlightIfPresent(page.locator('tbody').getByText(text, { exact: true }), label, 2000)
  }
  await demo.spotlightIfPresent(page.locator('tbody .tag', { hasText: 'Draft' }), 'a partial submission, tagged', 2000)
  await demo.clear()

  await demo.say('Filters', 'Search, a rating on a chosen question, ticket-less only, and sort by date.')
  await demo.select(page.locator('#status'), 'Completed')
  await demo.type(page.getByRole('searchbox'), 'acme')
  await demo.click(page.getByRole('group', { name: 'Rating filter' }).getByRole('button', { name: '5', exact: true }))
  await demo.select(page.locator('#rating-question'), 'Q2', 'rating filter **on Q2**, not always Q1')
  await demo.click(page.getByLabel('Ticket-less only', { exact: true }))
  await demo.click(page.getByRole('button', { name: /^Created/ }), 'oldest first')

  const url = page.url()
  await demo.say('Shareable views', `Every filter is in the URL: **${new URL(url).search}**. Opening it again gives the same view.`)
  await page.goto('about:blank')
  await demo.goto(url)
  await demo.spotlight(page.getByRole('search'), 'restored from the URL', 2500)
  await demo.clear()

  await demo.goto(APP_URL)
  await demo.say('One survey, real headers', 'With a single survey selected, the headers show its real questions instead of Q1–Q4.')
  await demo.select(page.locator('#survey'), 'Post-Support CSAT')
  await demo.spotlight(page.locator('thead tr'), 'headers are the survey’s questions', 2500)
  await demo.clear()
  await demo.hideCaption()
}
