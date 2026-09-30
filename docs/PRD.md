# PRD: Feedback Table

| | |
|---|---|
| Status | Draft for review |
| Date | 2026-09-30 |
| Design reference | `frontend-web-ui-reference/index.html` |

## 1. Problem

Simplesat stores survey responses reliably but offers no way to read them back in bulk with context.
The only surfaces are a server-rendered page (`/`) and `GET /api/responses/`. Both:

- issue one query per row and per answer (**193 queries for 40 rows** on the API, 153 on the page)
- have no pagination
- miss fields a support lead needs (email, company, survey name)
- return answers as an ordered list, so they cannot be laid out as fixed question columns
- hardcode rating labels in three places, each with a different fallback for unknown values

A support lead cannot use either to understand feedback at the scale of the real dataset.

## 2. Goal

A **Feedback Table page** (React + TypeScript) backed by a new DRF endpoint, where a support lead can browse
every survey response with its customer, ticket and answers, and that stays fast at **10,000+ responses**.
Then extend it through the six backlog requirements, in order, one PR each, backend then frontend.

**User:** support lead reviewing customer feedback.

## 3. Scope

### Required by the brief or the design

- One row per response; columns: Created, Customer, Company, Ticket, Survey, Q1…Qn
- Search (customer / company), survey filter, rating filter, "Ticket-less only", sort by Created
- UI to create questions (Req 2) and a respondent UI to submit and re-submit answers (Req 2, 3, 4, 6)

### Added by this PRD

| Addition | Reason |
|---|---|
| Rating filter lets the user pick **which question** it applies to | The design silently filters on Q1 only, which is easy to misread |
| Column headers show the **real question text** when a single survey is selected | `Q1`/`Q2` is ambiguous once the survey is known; the data is already in the payload |
| **Status filter** (Completed by default / Draft / All) with a "Draft" badge | 9 of 40 seeded responses are drafts with full answers; the brief counts partial submissions as responses |

### Priority

1. **Should do:** CI running tests on every PR from the first PR; edit/remove question options in the UI (to demo Req 5); rating labels (Req 1) and display conditions (Req 6) editable in the question form
2. **If time allows:** responsive layout; baseline accessibility (semantic table, labelled filters, keyboard use); advanced search (ticket subject, date range)
3. **Out of scope:** auth (existing API is `AllowAny`), production deploy, editing answers from the table (conflicts with Req 4, where the respondent edits), real-time updates, full WCAG audit
4. **Future work:** CSV export (needs streaming at 10K+), advanced search if not reached, fixing N+1 in the legacy endpoint

## 4. Requirements and acceptance criteria

| # | Requirement | Done when |
|---|---|---|
| 0 | **Baseline table** | Table renders all seeded responses with the columns above; filters, sort and pagination work server-side; query count per page is constant; 10K responses load page 1 and the last page in < 300 ms |
| 1 | **Custom choice labels** | Each survey can define its own rating labels (default 1–5 set otherwise); the table shows that survey's labels |
| 2 | **Multi-select question type** | A question with options is created through the app UI; a respondent can save one or more options; the table renders them as chips |
| 3 | **Comment question type** | Free-text answers share the `value` column; no code path assumes `value` is a number; long text is truncated with full text available |
| 4 | **Re-answer** | A respondent can resubmit; the table shows the latest value with an "edited" tag ("Originally X on DATE") |
| 5 | **Display from latest settings** | Labels, options and questions always render from current settings; stale and legacy values degrade gracefully (see §6) |
| 6 | **Conditional display** | A question can depend on a numeric condition on an earlier answer (e.g. Q1 > 2); the respondent UI shows/hides it; the table distinguishes "condition not met" from "not answered" |

## 5. API

### New endpoint

`GET /api/feedback-table/` — a new endpoint rather than changing `/api/responses/`.
The brief says to extend the backend, not replace it; the legacy endpoint and page stay as they are.

**Query parameters:** `page`, `page_size` (25 / 50 / 100, max 100), `survey`, `status` (default `completed`),
`ticketless`, `search`, `rating` + `rating_question` (question id for one survey, question order for all surveys), `ordering`

**Pagination:** page number (DRF `PageNumberPagination`), default 50 per page.

- At 10K rows `OFFSET` costs milliseconds; it gives the "Showing X of Y responses" count the design shows and allows jumping to any page
- Deterministic order: `submitted_at DESC, id DESC`; indexes on `(submitted_at, id)` and `(status, submitted_at, id)`
- `next` / `previous` are URLs, so a later move to cursor pagination needs minimal frontend change

**Response shape:**

```json
{
  "count": 8234,
  "next": "…?page=2",
  "previous": null,
  "surveys": {
    "1": { "name": "Post-Support CSAT",
           "questions": [ { "id": 12, "order": 1, "text": "…", "type": "rating" } ] }
  },
  "results": [ {
    "id": 501, "submitted_at": "…", "status": "completed",
    "customer": { "name": "…", "email": "…", "company": "…" },
    "ticket": { "id": 3, "subject": "…" },
    "survey_id": 1,
    "answers": {
      "12": { "value": "4", "display": "Good", "state": "ok" }
    }
  } ]
}
```

- **Answers are keyed by question id**, not position, so keys keep their meaning if questions are reordered. The frontend maps `order` to the Q1…Qn columns.
- **The backend resolves display.** Each answer carries the raw `value` plus `display` and `state`. Label, legacy, removed-option and condition logic lives in one place and is covered by Python tests; the raw value stays available for tooltips.
- `surveys` contains only the surveys on the current page and is fetched without N+1.

### Write endpoints

The repo has no endpoint for saving answers today (only the admin). New endpoints for creating questions and
submitting / resubmitting responses are added in the requirement PRs that need them (Req 2, 4).

## 6. Display rules

| Case | `state` | Rendered as |
|---|---|---|
| Rating within the survey's current scale | `ok` | Coloured badge (green 4–5, amber 3, red 1–2) + `4 · Good` |
| Numeric rating outside the current scale (e.g. seeded `0`), or answer no longer matching a changed question type | `legacy` | Grey badge + `0 · Unrated` |
| Non-numeric or empty rating | `invalid` | Grey badge + ⚠, raw value in tooltip |
| Multi-select option removed from the question | `removed_option` | Dashed, italic, muted chip; tooltip "Option removed from current survey settings" |
| Question shown but not answered | `unanswered` | Muted italic "blank — not answered" |
| Question hidden by its condition | `condition_not_met` | Muted italic "blank — condition not met" |
| Survey has no question at this column position | `not_applicable` | Empty cell |
| Answer was resubmitted | (extra field) | "edited" tag, tooltip "Originally X on DATE" |
| Customer has no name | — | "Anonymous" |

**Legacy vs invalid:** any out-of-range *number* is `legacy`; `invalid` is only for non-numbers and empty values.
This matches the design and the seed's own comment ("earlier scale"), and if a survey's scale shrinks (Req 1),
older answers become `legacy` automatically (Req 5). Accepted trade-off: a stray `7` also reads as legacy.

**Input validation:** ratings are validated on write (numeric, within the survey's scale), both in the new
write endpoints and in `Answer.clean()` so the admin is covered too. `value` is shared across question types,
so this cannot be a database check constraint. `bulk_create` skips `clean()`, so the data generator calls
the same validator explicitly.

## 7. Data model changes

| PR | Change | Why |
|---|---|---|
| Baseline | `Answer`: unique `(response, question)`, `created_at`, `updated_at` | Blocks duplicate answers before bulk data is generated. The seed has 0 duplicates; the migration fails with a clear message if any exist. Existing rows are backfilled from `Response.submitted_at`. |
| Baseline | Indexes on `Response (submitted_at, id)` and `(status, submitted_at, id)` | Page through newest first without a sort step, with or without the status filter. A `status`-only index would go unused: two values, ~78% `completed`. |
| Req 1 | Per-survey rating labels | Storage (JSON field vs table) decided in the Req 1 PR |
| Req 2 | Question options | Storage of multi-select values decided in the Req 2 PR |
| Req 4 | `AnswerRevision` (previous value + timestamp); `Answer` keeps the current value | Table reads one row per question (fast); full history; the design needs the original value and date. Revision and update are written in one transaction. |
| Req 5 | `Question.archived_at` (soft delete) instead of cascading deletes | Answers are never lost. Archived questions are hidden from columns and forms. |
| Req 6 | Display condition on `Question` (source question, operator, threshold) | Validated: the source comes earlier, is a rating question, and there are no cycles |

**Alternatives rejected for re-answers:** overwrite with one previous value (loses history after the second edit);
a new `Answer` row per edit (needs a latest-per-group query and allows duplicates again).

## 8. Data for demo and performance

- New command, run manually: `python manage.py seed_bulk --responses 10000 --seed 42` (not in `entrypoint.sh`, so startup stays fast)
- `bulk_create` in batches of 1,000; `--clear` to reset
- Fixed random seed, so demos and PR measurements are reproducible
- Edge cases in proportions close to the design: ~20% without a ticket, drafts, skipped Q2, anonymous customers, legacy scores
- Grows with each requirement PR (multi-select, comments, edited answers, conditional questions)
- `--responses 100000` for performance reporting

## 9. Quality

| Area | Choice |
|---|---|
| Backend tests | pytest-django + factory_boy, run in Docker against Postgres (not SQLite, so query counts and plans match) |
| Frontend tests | Vitest + React Testing Library + MSW |
| E2E | One Playwright smoke test (open table → filter → change page), if time allows |
| CI | GitHub Actions with a Postgres service, on every PR |
| Performance gate (CI) | `assertNumQueries`: a page of 50 rows uses the same number of queries as a page of 5 |
| Performance report (per PR) | Script timing page 1 and the last page: target < 300 ms at 10K; 100K reported only |
| Lint | flake8 (existing `.flake8`); TypeScript `strict` + ESLint |

Response time is reported rather than gated, because it depends on the machine and would make CI flaky.

## 10. Risks found in the existing code

| Risk | Handling |
|---|---|
| N+1 in both existing surfaces | New endpoint uses `select_related` / `prefetch_related`; query count gated in CI |
| Hardcoded labels with three different fallbacks | Single backend resolver (§6) |
| Rating assumption hidden in label lookups keyed `"1"`–`"5"` (no literal `int(value)`) | Resolver branches on question type; tests for numeric-looking comments such as `"5"` |
| Seeded legacy `0` values (3 of 80) and no `1` values | `legacy` state; tests build their own data covering 1–5 |
| No uniqueness or timestamps on `Answer` | Baseline migration (§7) |
| Cascading deletes remove answers | Soft delete (Req 5) |
| `seed` skips when data exists and runs on every start | Separate `seed_bulk` command |
| CRLF line endings break `entrypoint.sh` on Windows | Fixed with `.gitattributes` |
| No CORS setup | Vite dev proxy or `django-cors-headers`, decided in the baseline PR |

## 11. Open questions (decided in the PR where they arise)

- `seed_bulk --clear` scope: everything, or only generated data (proposed: everything, with its own surveys)
- Column position after a question is archived: raw `order` or renumbered (Req 5)
- A conditional question whose source question is archived (Req 6)
- Which question types the rating filter offers once multi-select and comment exist (Req 2, 3)

## 12. Future work

| Trigger | Change |
|---|---|
| Late pages get slow (hundreds of thousands to millions of rows) or `COUNT(*)` dominates | Cursor pagination on the existing `(submitted_at, id)` index |
| Exact count too expensive | Approximate count (`pg_class.reltuples` / `EXPLAIN`) shown as "about N", or cache counts per filter set |
| Very long result sets | "Load more" / infinite scroll with virtualised rows |
| Legacy `/api/responses/` | Fix N+1 without changing its JSON, after adding tests that lock the current shape |
| — | CSV export, advanced search |

## 13. Delivery plan

One PR per item, in order, each with tests, backend then frontend:

0. PRD (this document)
1. Baseline table + CI + `seed_bulk`
2. Req 1: custom choice labels
3. Req 2: multi-select question type
4. Req 3: comment question type
5. Req 4: re-answer
6. Req 5: dynamic display from latest settings
7. Req 6: conditional display
