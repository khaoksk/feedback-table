# Working with the AI agent

I built this with Claude Code (Claude Opus) as the agent. This note describes how I split the work, where I let it
run and where I stepped in, what it got wrong and how that surfaced. I kept a running log of mistakes while
working, so the examples below are the real ones, including the ones that don't flatter either of us.

## How the work was split

- **The agent wrote almost all of the code, tests and PR descriptions.** It also ran the tests, the timing
  reports and the end-to-end checks, and it made the commits, which carry a `Co-Authored-By` line.
- **I made every product and design decision.** Before any code for a requirement, the agent had to lay out the
  open questions with options and trade-offs, and I chose. The spec was built this way: I answered ten questions
  one at a time, and the agent compiled the answers into [PRD.md](PRD.md). I also questioned recommendations
  when I wasn't convinced, checked the running page against the design reference, and approved every merge. The
  agent ran the merge command only after I said so.

## The loop for each requirement

1. **Decide before code.** The agent listed the open questions for the requirement with a recommendation, I
   answered, and the decision was committed to the PRD as the first commit of the PR. Each PR starts with a
   `PRD:` commit.
2. **Build in small commits:** model and migration, then display, then API, then seed data, then frontend. Each
   step is committed separately with its tests.
3. **Prove the tests can fail.** Many tests passed on their first run, which on its own proves little. So after
   each step the agent temporarily broke the code on purpose (removed a `select_related`, skipped a token check,
   dropped a validation), confirmed the relevant tests failed, then restored the file. This is recorded in every
   PR.
4. **Check end to end against the real backend,** through the Vite proxy, not mocks. Test rows were deleted
   afterwards **by the ids the API returned** (a rule that came from a mistake, see below), and the dev data was
   confirmed back to its seeded counts.
5. **Time the endpoint** on 10K responses, then open the PR. CI runs; I review it with a browser checklist the
   agent writes, and approve the merge.

## Where I let it run, and where I stepped in

**Let it run end to end:** implementation once decisions were made, test writing, CI setup, the data generator,
timing tooling, PR descriptions, and repetitive fixes such as fixture updates when a payload gained a field.

**Stepped in:**

- **Every open-ended product question.** See [JUDGMENT-CALLS.md](JUDGMENT-CALLS.md). Several times I chose an
  option the design reference didn't have: a rating filter that names its question, real question text as headers,
  and a status filter.
- **Merges.** Nothing went to `master` without my go-ahead.
- **When its reasoning didn't convince me,** I asked why before accepting (see the tooltip example below).

## Where I rejected or substantially changed what it produced

1. **Invalid values (spec stage).** The agent recommended treating non-numeric ratings as `legacy`, the same as
   out-of-range numbers. I disagreed: garbage input should be stopped at the door, not normalised. So it became a
   separate `invalid` state plus validation on write, in the API and in `Answer.clean()` so the admin is covered too.
2. **The "edited" tooltip (Req 4).** It recommended showing the original value. Instead of just accepting, I asked
   why that was better than the previous value. Its reasoning was sound: the design says "Originally", and a
   support lead cares how the customer felt before any follow-up. But the alternatives made me pick a combination
   it hadn't offered first, "Originally 2 · Bad on … · edited 2 times", so intermediate edits aren't hidden.
3. **Archived questions were invisible (Req 5).** The feature passed all its tests. In the browser I went looking
   for the archived question and couldn't find it, which was technically correct, since archived questions are
   meant to disappear. But it showed that the app gave **no way at all** to see that a question and its thousands
   of answers still existed. I had it add an "Archived questions" section to the settings panel before merging.
4. **The "edited" tag was hard to find (Req 4).** Also from the browser check: only about 3 of roughly 150 cells
   per page are edited, and the tag is small by design. The agent confirmed the data was right and proposed an
   "Edited only" filter. I decided to ship as designed and note it, rather than widen the scope.

The browser checks found problems that none of the tests did. The tests checked that the code did what the spec
said; they couldn't tell that the spec left a user unable to find something.

## Where it was confidently wrong, and how that surfaced

To be precise about "how I caught it": most of these were caught by the agent itself, from test failures or from
reading command output carefully, not by me. What I controlled was the process that made them visible. Tests
must be shown to fail, commands must print their results, and nothing merges without my review.

1. **"The PRD says it, so it's done" (Req 3).** The PRD for Req 2 stated that the rating filter only targets rating
   questions. The code, written back in Issue #1, never enforced it: it matched any answer whose stored value was
   `"5"` at that position. A comment reading "5" would have shown up under "rating 5". A Req 2 test passed only
   by coincidence, because multi-select answers are stored as JSON lists and can't equal `"5"`. A new Req 3 test
   with a comment of `"5"` exposed it. The fix is its own commit
   ([9cd2a2b](https://github.com/khaoksk/v1-self/commit/9cd2a2b)) so it's visible in the history.
2. **A wrong diagnosis of slowness (Issue #1).** At 100K responses one filter took about 390 ms. From
   `EXPLAIN ANALYZE` the agent concluded an index was missing, proposed one, and I approved it. The re-measurement
   looked like a big win, but that run had also refreshed planner statistics, so two things had changed at once.
   The agent noticed, and ran a clean A/B on the same database: the real cause was **stale statistics after the
   bulk load**, and the index only gave about 20%. We dropped the index on the numbers and added `ANALYZE` to the
   data generator. The measurements are recorded in the PRD.
3. **It deleted real data while testing a migration (Issue #1).** To check that a migration refuses duplicate
   answers, it chained three commands: create a duplicate, migrate, then clean up by deleting "the answer with the
   highest id". The first command failed, but the chain kept going, and the clean-up deleted a real seeded answer.
   It noticed from the output, stopped, told me, and restored the row with its original id and value, derived from
   the seed's fixed random generator. From then on:
   - test data is only ever deleted by ids returned from its creation
   - chained commands stop at the first failure
   - migrations are tested in pytest against the test database, not tried out on the dev database
4. **It overwrote my edit on GitHub (Issue #1).** When merging, its script ticked a checkbox in the PR description
   that I had already ticked. The step failed to find its text, but a leftover file from an earlier edit was
   uploaded anyway, reverting my change. The same root cause as above. Since then it re-reads the current
   description before editing it.
5. **The same timestamp trap twice (Issues #1 and #5).** Django's `bulk_create` overwrites `auto_now_add` fields
   with the current time. The agent had documented this in the code in Issue #1, then gave a new field
   `auto_now_add` in Issue #5, and every seeded revision claimed it was replaced "today". A seed test caught it.
6. **Its measuring tool measured wrong (Issue #1).** The first timing report showed 0 queries for most scenarios,
   because Django resets its query log at the start of each request. The agent spotted the impossible number, and
   the tool now counts queries at the driver level. A test also checks the number itself, not just that a table
   was printed.

**Smaller slips, all caught by the agent:**
- a checklist told me to search for `int(value)`, which doesn't exist in the code
- options offered for a spec question were written before reading the design
- several of its own tests were wrong while the code was right: for example `2 < 2` listed as true, and an
  "earlier question" rule tested with a question that failed a different rule first

In each case it checked whether the test or the code was wrong before changing anything.

## What I'd keep doing

- **Make the agent state options before code,** and commit the decision. The PRD history then shows every decision
  and its reason, next to the code that implements it.
- **Treat a test that passed on its first run as unproven** until the code has been broken on purpose and the test
  failed.
- **Look at the product myself.** My two most useful interventions came from using the page, not from reading diffs.
- **Keep the mistake log during the work, not after.** This note was written from it.
