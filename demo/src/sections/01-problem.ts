import type { Demo } from '../annotate'
import { APP_URL, type Timing } from '../env'

/** The legacy API next to the new table, with live numbers. */
export async function problem(demo: Demo, timings: Timing[]): Promise<void> {
  const { page } = demo
  await demo.goto(APP_URL)

  await demo.card(0, 'Feedback Table on 10,000 responses', [
    'The legacy /api/responses/ took **77.7 s** on this dataset: queries grow with rows (**193 for the original 40**).',
    'The new table pages on the server: **7 queries per page**, asserted in CI.',
  ])

  const count = page.getByText(/^Showing .* responses$/)
  await count.waitFor()
  // Measured just before this run, so the caption states this dataset's numbers.
  const firstTiming = timings.find((t) => t.scenario === 'First page')
  const lastTiming = timings.find((t) => t.scenario === 'Last page')
  await demo.say(
    'One page at a time',
    firstTiming && lastTiming
      ? `Measured on the server just before this recording: first page **${firstTiming.medianMs} ms**, last page **${lastTiming.medianMs} ms**, **${firstTiming.queries} queries** each.`
      : 'Each page is one fixed set of queries, whatever the page number.',
  )
  await demo.spotlight(count, `**${await count.textContent()}**, completed only by default`, 3000)
  await demo.clear()

  const next = page.getByRole('navigation', { name: 'Pagination' }).getByRole('button', { name: 'Next →' })
  for (let i = 0; i < 3; i++) await demo.click(next)

  const status = page.getByRole('navigation', { name: 'Pagination' }).getByText(/^Page .* of .*$/)
  const last = Number((await status.textContent())!.match(/of ([\d,]+)/)![1].replace(/,/g, ''))
  await demo.say('Straight to the last page', 'Page numbers use OFFSET, which at 10K costs milliseconds, not seconds.')
  await demo.goto(`${APP_URL}/?page=${last}`)
  await demo.spotlight(status, 'last page: same query budget', 2500)
  await demo.clear()
  await demo.hideCaption()
}
