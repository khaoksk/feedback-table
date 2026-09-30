import type { Demo } from '../annotate'
import { REPO_URL } from '../env'

/**
 * How the agent was directed, shown on GitHub itself. GitHub's markup is not
 * ours, so every highlight here is skipped rather than failing if it moved.
 */
export async function howBuilt(demo: Demo): Promise<void> {
  const { page } = demo
  await demo.card(3, 'How the work was done', [
    'An AI agent wrote most of the code. I made every product decision and approved every merge.',
    'Each requirement: **decide → build in small commits → prove tests can fail → check end to end → merge**.',
  ])

  await demo.goto(`${REPO_URL}/pulls?q=is%3Apr+is%3Aclosed+sort%3Acreated-asc`)
  await demo.say('One PR per requirement', 'Eight pull requests, in order: the PRD, the baseline table, then Req 1–6.')
  await demo.spotlightIfPresent(page.getByRole('link', { name: 'Add PRD for the feedback table feature' }), 'PR #8: the PRD, before any code', 2500)
  await demo.clear()

  await demo.goto(`${REPO_URL}/pull/13/commits`)
  await demo.say('Decisions first, then small commits', 'Every PR starts with a **PRD:** commit recording the decisions, then one commit per layer.')
  await demo.spotlightIfPresent(page.getByRole('link', { name: /^PRD:/ }), 'the decision, committed before the code', 3000)
  await demo.clear()

  await demo.goto(`${REPO_URL}/pull/13`)
  await demo.say('What each PR reports', 'Decisions, tests, the check that tests can fail, the end-to-end result and timings.')
  for (const heading of [/tests can fail/i, /end to end/i, /timing/i]) {
    await demo.spotlightIfPresent(page.locator('.comment-body').getByRole('heading', { name: heading }), '', 1800)
  }
  await demo.clear()

  const doc = await page.goto(`${REPO_URL}/blob/master/docs/AI-COLLABORATION.md`, { waitUntil: 'load' })
  if (doc?.ok()) {
    await demo.say('Where I stepped in', 'Checking in the browser, I couldn’t find an archived question: that led to the **Archived questions** list.')
    await demo.spotlightIfPresent(page.getByRole('heading', { name: /rejected or substantially changed/i }), '', 2500)
    await demo.say('Where the agent was confidently wrong', 'The rating filter the PRD called rating-only matched comments of “5”. A Req 3 test caught it; fixed in its own commit.')
    await demo.spotlightIfPresent(page.getByRole('heading', { name: /confidently wrong/i }), '', 3000)
    await demo.clear()
  } else {
    await demo.card(3, 'Where I stepped in, and where it was wrong', [
      'Stepped in: an archived question was invisible in the browser → the **Archived questions** list.',
      'Confidently wrong: the “rating-only” filter matched comments of “5” → caught by a Req 3 test.',
      'Full account: docs/AI-COLLABORATION.md',
    ], 7000)
  }

  await demo.goto(`${REPO_URL}/actions`)
  await demo.say('CI on every PR', 'Backend tests, flake8, frontend lint, build and tests, with a real Postgres service.')
  await demo.pause(2000)
  await demo.hideCaption()
}
