# Simplesat Feedback System

A small Django + Django REST Framework service backing a customer-satisfaction
(CSAT) feedback product. It models customers, their support tickets, surveys made
of rating questions, and the responses customers submit. It ships with sample
data, the Django admin, one server-rendered page, and a small JSON API.

## Stack

- Python 3.12 · Django 5 · Django REST Framework
- PostgreSQL 16
- Docker + Docker Compose

## Prerequisites

- Docker Desktop (or Docker Engine) with Docker Compose v2.

## Quick start

```bash
docker compose up --build
```

This builds the app image, starts Postgres, applies migrations, loads the sample
data, creates an admin user, and serves the app. Then open:

- **App (responses page):** http://localhost:8000/
- **Admin:** http://localhost:8000/admin/  — username `admin`, password `admin`
- **JSON API:** http://localhost:8000/api/responses/

Stop with `Ctrl-C`, then `docker compose down` (add `-v` to also drop the
database volume and start fresh).

> Optional: copy `.env.example` to `.env` to change the credentials or database
> name. The stack runs on sensible defaults without it.

## What's inside

All models are registered in the Django admin:

| Model | Purpose |
| --- | --- |
| **Customer** | A person who can receive surveys |
| **Ticket** | A support ticket belonging to a customer |
| **Survey** | A named survey containing questions |
| **Question** | A question within a survey |
| **Response** | One customer's submission to a survey |
| **Answer** | A customer's answer to a single question |

Two surfaces beyond the admin:

- `/` — a read-only table of survey responses (server-rendered).
- `GET /api/responses/` — the same responses as JSON, including the customer's
  name and the related ticket's subject.

## Project layout

```
config/            Django project — settings, urls, wsgi
feedback/          the app
  models.py        the six models above
  admin.py         admin registrations
  views.py         the responses page + the JSON API
  urls.py          routes
  templates/       the responses page template
  management/commands/seed.py   sample-data loader
Dockerfile
docker-compose.yml
entrypoint.sh      wait-for-db → migrate → seed → run
```

## Common commands

Run these against the running stack from another terminal:

```bash
docker compose exec web python manage.py seed --clear   # reset & reload sample data
docker compose exec web python manage.py migrate
docker compose exec web python manage.py shell
docker compose exec web python manage.py createsuperuser
```

## Notes

- Runs on Django's development server with `DEBUG=True` — a local dev environment,
  not production.
- The sample data is deterministic, so every run produces the same rows.
- The whole app is small on purpose; you can read it end to end in a few minutes.

## The assignment

Your take-home brief is provided separately, alongside this repository. A good
first step is to run the app, click through the admin, hit `/api/responses/`, and
read the `feedback/` app.
