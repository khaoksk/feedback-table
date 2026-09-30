# Feedback table frontend

React + TypeScript (strict) app for the Feedback Table page, built with Vite.
It talks to the Django API in `../backend` through Vite's dev proxy, so the
browser stays on one origin and the backend needs no CORS setup.

## Run

Start the backend first (`cd ../backend && docker compose up`), then:

```bash
npm install
npm run dev        # http://localhost:5173, proxies /api to http://localhost:8000
```

Set `API_TARGET` to proxy elsewhere, e.g. `API_TARGET=http://localhost:8001 npm run dev`.

## Check

```bash
npm run lint       # ESLint, zero warnings allowed
npm run build      # typecheck (tsc -b) + production build
npm test           # Vitest + React Testing Library, API mocked with MSW
```

## Layout

```text
src/
  api/                     types and fetch client for /api/surveys/ and /api/feedback-table/
  features/feedback-table/
    filters.ts             filter state: URL <-> state <-> API parameters
    useUrlFilters.ts       filters stored in the query string (shareable, Back works)
    columns.ts             Q1..Qn column positions
    scales.ts              rating chips and badge colours from each survey's scale
    FeedbackTablePage.tsx  data loading, debounced search, wiring
    LabelEditor.tsx        rename a survey's rating labels (PUT /api/surveys/<id>/rating-labels/)
    QuestionForm.tsx       add a rating or multi-select question (POST /api/surveys/<id>/questions/)
    QuestionsPanel.tsx     archive questions and edit multi-select options (Req 5)
    Toolbar.tsx, FeedbackTable.tsx, AnswerCell.tsx, Pagination.tsx
  features/respond/        "Answer a survey" at /respond, and the private edit link /respond/<id>?token=...
    ResponseForm.tsx       the questions as fields, shared by answering and editing
  routes.ts                which page a path shows
  test/                    Vitest setup and the MSW mock API
```

Answer cells style the backend's resolved `state` and never reinterpret raw
values; the display rules are in `docs/PRD.md` §6.
