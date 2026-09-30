# Feedback Table

A Feedback Table page for Simplesat's survey responses: one row per response with the customer, ticket, survey and
every answer. Built on the provided Django REST Framework backend (extended, not replaced) and a new React +
TypeScript frontend, through the six backlog requirements in order.

| | |
|---|---|
| Spec | [docs/PRD.md](docs/PRD.md) |
| Backlog | Issues [#1](https://github.com/khaoksk/feedback-table/issues/1)–[#7](https://github.com/khaoksk/feedback-table/issues/7), one per item, all closed |
| How I worked with the AI agent | [docs/AI-COLLABORATION.md](docs/AI-COLLABORATION.md) |
| Judgment calls where the brief was open | [docs/JUDGMENT-CALLS.md](docs/JUDGMENT-CALLS.md) |
| Demo video (6.5 min, 10K responses) | [Release v1.0](https://github.com/khaoksk/feedback-table/releases/tag/v1.0): [MP4](https://github.com/khaoksk/feedback-table/releases/download/v1.0/feedback-table-demo.mp4) with subtitles and chapters |

## What was delivered

| # | Item | PR |
|---|---|---|
| — | PRD | [#8](https://github.com/khaoksk/feedback-table/pull/8) |
| 0 | Baseline table: new endpoint, filters, pagination, 10K data, CI | [#9](https://github.com/khaoksk/feedback-table/pull/9) |
| 1 | Custom choice labels per survey (and scales other than 1–5) | [#10](https://github.com/khaoksk/feedback-table/pull/10) |
| 2 | Multi-select questions, created in the UI, answered on an "Answer a survey" page | [#11](https://github.com/khaoksk/feedback-table/pull/11) |
| 3 | Comment questions in the shared `value` column | [#12](https://github.com/khaoksk/feedback-table/pull/12) |
| 4 | Re-answer through a private edit link; table shows the latest value, with history | [#13](https://github.com/khaoksk/feedback-table/pull/13) |
| 5 | Display from latest settings: rename/archive options, archive questions, change scales | [#14](https://github.com/khaoksk/feedback-table/pull/14) |
| 6 | Conditional display ("show Q2 only when Q1 > 2") | [#15](https://github.com/khaoksk/feedback-table/pull/15) |

Each PR description lists its decisions, tests, an end-to-end check against the real backend, and timings.

## Run it

Needs Docker Desktop and Node 22.

```bash
# 1. Backend: Django + Postgres on http://localhost:8000 (admin: admin / admin)
cd backend
docker compose up -d --build

# 2. 10,000 reproducible responses with every edge case the table handles
docker compose exec web python manage.py seed_bulk --responses 10000 --seed 42 --clear

# 3. Frontend on http://localhost:5173 (proxies /api to the backend; no CORS setup needed)
cd ../frontend
npm install
npm run dev
```

Pages: `/` is the Feedback Table, and `/respond` is "Answer a survey". After submitting, the respondent gets a
private edit link, `/respond/<id>?token=…`.

## Check it

```bash
cd backend
docker compose run --rm web pytest                    # 267 tests, separate test database
docker compose run --rm web flake8 feedback config
docker compose exec web python manage.py time_feedback_table --runs 20   # timing report on current data

cd ../frontend
npm run lint && npm run build && npm test            # 153 tests, API mocked with MSW
```

CI runs all of the above on every pull request, with a Postgres service.

## Demo

**Watch:** [feedback-table-demo.mp4](https://github.com/khaoksk/feedback-table/releases/download/v1.0/feedback-table-demo.mp4)
(6 min 34 s, no audio; captions on screen). The [v1.0 release](https://github.com/khaoksk/feedback-table/releases/tag/v1.0)
also has the subtitles (`.vtt`) and chapter times.

| Time | Chapter |
|---|---|
| 0:01 | The problem: the legacy API against the paged table |
| 0:31 | Table & filters |
| 1:38 | The six requirements |
| 4:58 | How it was built: PRs, commits, this AI collaboration note, CI |

**Re-record:** [demo/](demo/README.md) records the end-to-end demo with Playwright, with on-screen captions and highlights at each
step, plus subtitles and chapter marks: `cd demo && npm install && npm run record:app`.

## Performance

The "done" bar was: no N+1, and usable at 10K+ responses.

| | Before (legacy `/api/responses/`) | Feedback table API |
|---|---|---|
| Queries | 193 for 40 rows, one or more per row | **7 per page, whatever the page size** (asserted in CI) |
| 10K responses, first page | 77.7 s (all rows at once) | ~20–40 ms |
| 10K responses, last page | — | ~25–40 ms |
| 100K responses | — | all 8 scenarios under 300 ms (measured in #9) |

## Layout

```text
backend/feedback/
  views.py            API views (the legacy page and /api/responses/ are untouched)
  display.py          turns a stored answer into value / display / state for the table
  scales.py           per-survey rating labels and scale
  submissions.py      validating, creating and editing responses (Req 2-4, 6)
  questions.py        archiving questions, replacing options (Req 5)
  conditions.py       conditional display rule (Req 6)
  management/commands/seed_bulk.py            reproducible large dataset
  management/commands/time_feedback_table.py  timing report
  tests/              pytest-django + factory_boy
frontend/src/
  features/feedback-table/   the table, filters, settings panels
  features/respond/          answering and editing a response
docs/                        PRD, AI collaboration note, judgment calls
frontend-web-ui-reference/   the provided design reference (unchanged)
```

## Not done

These are listed with reasons in the PRD and the notes:

- **Out of scope:** auth, CSV export, and un-archiving questions or options.
- **Only partly done:** setting a condition from the "Add question" form. Conditions are set from "Edit questions" instead.
