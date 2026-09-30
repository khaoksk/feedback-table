# Judgment calls

Where the brief or the design reference left a choice open, this is what I decided and why. Each decision was
committed to [PRD.md](PRD.md) before the code for it; the PR that implemented it is in brackets.

## The table

| Decision | Why | Not chosen |
|---|---|---|
| **All surveys in one table, with columns by question position (Q1, Q2, …) and one survey filter** (#9) | Follows the design reference. A support lead sees everything in one place, and columns don't multiply with each new survey. | One table per survey; one column per question across all surveys. |
| **With one survey selected, headers show the real question text** (#9) | "Q1" means a different question in each survey. Once the survey is known, the wording is more useful, and it's already in the payload. | Keep "Q1" everywhere, exactly as the design does. |
| **The rating filter names the question it applies to** (#9) | The design filters silently on Q1. That's easy to misread once surveys differ. | Always Q1; any question. |
| **A status filter, defaulting to Completed, with a Draft tag** (#9) | The seed has drafts with full answers, and the brief counts partial submissions as responses. The default keeps the view clean. | Hide drafts entirely; mix them in unmarked. |
| **"blank — not answered" shown on every page** (#9) | The design leaves it blank on its Baseline tab and shows the text on later tabs. One behaviour is easier to read. | Blank on some pages only. |
| **Filters, page and sort live in the URL** (#9) | Views can be shared and bookmarked, and Back works. It cost little. | Component state only. |

## API and data

| Decision | Why | Not chosen |
|---|---|---|
| **A new endpoint, `/api/feedback-table/`; the legacy `/api/responses/` and HTML page untouched** (#9) | The brief says extend, don't replace, and the new shape (pagination, answers keyed by question) would break any existing caller. | Rewrite the legacy endpoint. |
| **Page-number pagination, 50 per page** (#9) | At 10K rows `OFFSET` costs milliseconds (measured: page 1 and the last page within ~10 ms of each other). It gives "Showing X of Y", as in the design. The cursor upgrade path is in the PRD with 100K numbers. | Cursor pagination: faster at millions of rows, but no total count and no jumping to a page. |
| **The backend resolves every answer to `value` / `display` / `state`** (#9) | One place decides how a value reads, which fixed the legacy code's three different fallbacks. The Python tests cover every state, and the frontend never guesses from raw strings. | Resolve in the frontend. |
| **Out-of-range numbers are `legacy`, non-numbers are `invalid`, and input is validated on write** (#9) | Matches the design ("0 · Unrated") and the seed's own comment about an earlier scale. Bad input is stopped at the door instead of normalised. | Treat both as legacy (the agent's first suggestion, which I overruled). |
| **Rating labels as a JSON map on `Survey`, where the keys define the scale** (#10) | An answer stores the score, and the score is the key, so a rename needs no migration. About 5 labels are always edited together, so the constraints of a separate table buy little. | A `RatingLabel` table. |
| **Multi-select options in their own table; answers store option ids as a JSON list** (#11) | Decided before Req 1 so it wasn't boxed in. Storing labels, as the design does, would orphan answers when an option is renamed. The list keeps one answer per question, which the unique constraint requires. | Labels as strings; one answer row per selected option. |
| **Comments: trimmed, at most 2,000 characters, blank rejected** (#12) | Room for real feedback, with a bounded table payload. | No limit. |
| **Re-answers keep history in `AnswerRevision`; `Answer` holds the latest** (#13) | The table still reads one row per question, the full history is kept, and duplicates stay impossible. | Overwrite with one previous value (loses history); a new answer row per edit (slower query, duplicates). |
| **Edits never delete: questions left out keep their answer, and unchanged values create no revision** (#13) | History is the point of Req 4; a form that silently removes answers is a trap. | Treat a missing answer as "remove". |
| **Archiving instead of deleting, for both questions and options** (#14) | Answers are never lost. Archived options still show on old answers as the design's dashed "removed" chip. | Delete, which cascades to the answers. |
| **Archiving a question renumbers the later ones** (#14) | No empty column for a question that no longer exists, and position filters keep pointing at real questions. | Keep gaps. |
| **Conditions: an unanswered source hides the question; an archived source switches the condition off; a kept answer stays hidden while the condition fails** (#15) | "Show when Q1 > 2" can't be true without a Q1. Archiving shouldn't strand a question. And edits never delete, as above. | Show when the source is unanswered; block archiving the source; delete the dependent answer. |

## Respondents

| Decision | Why | Not chosen |
|---|---|---|
| **An "Answer a survey" page in the same app; the customer is matched by email** (#11) | The brief requires saving multi-selections end to end through a UI, and one app is the simplest thing to demo and test. | An API only. |
| **Re-answering through a private edit link with a random token** (#13) | There is no login. The token stops anyone who guesses an id; a wrong token returns the same 404 as a missing response. | The id alone. |
| **The "edited" tooltip shows the first value and the edit count** (#13) | The design says "Originally", and a support lead wants the feeling before any follow-up. The count shows there were edits in between. | Only the previous value. |

## Engineering

| Decision | Why | Not chosen |
|---|---|---|
| **A query budget asserted in CI (5, then 6, then 7 per page as features added prefetches); timings reported, not gated** (#9) | Query counts are deterministic, while timings depend on the machine and would make CI flaky. | Time-based CI gates. |
| **A reproducible 10K generator (`seed_bulk`), separate from the original seed, grown with each requirement** (#9–#15) | The same seed gives the same rows, ids included, so demos and timings can be repeated. Each PR's data shows its feature. | Extend `seed`; random data. |
| **An `(status, submitted_at, id)` index; no extra `Answer` index** (#9) | A status-only index would go unused (two values). The `Answer` index was measured at about 20% faster with a worse p95, so it wasn't worth the write cost. | Index `status`; keep the `Answer` index. |
| **`ANALYZE` after bulk loads** (#9) | A slowdown first blamed on a missing index was really stale planner statistics. | — |
| **The Vite dev proxy instead of CORS** (#9) | The browser stays on one origin, so Django needs no CORS setup. | `django-cors-headers`. |
| **Auth out of scope; the write endpoints opt out of session auth** (#10) | The existing API is `AllowAny`. Without the opt-out, a browser logged into `/admin` would be asked for a CSRF token it cannot get. | Add auth. |
| **ESLint instead of the Vite template's oxlint** (#9) | The PRD named ESLint, and I kept the plan rather than the template default. | oxlint. |

## Deviations from the design reference

- **The comment question is Q4 of "Quarterly Check-in",** not on the post-support survey. Putting it there would
  have made every survey equally long, and the demo would lose the empty column a shorter survey leaves. A seed
  test caught this.
- **Additions the design doesn't have:** a status filter, real question headers, the rating filter's question
  picker, settings panels, and an "Archived questions" list. Each has a row above.
