"""Time GET /api/feedback-table/ against whatever data is in the database.

    python manage.py time_feedback_table --runs 20

Calls the view in-process (no HTTP server), so the numbers cover the view,
serialisation and Postgres, not network or dev-server overhead. The output is
a Markdown table for pasting into a PR. It reports, it does not gate: timings
depend on the machine, so CI asserts query counts instead (see docs/PRD.md §9).
"""
import math
import statistics
import time

from django.core.management.base import BaseCommand, CommandError
from django.db import connection
from django.test import Client

from feedback.models import Answer, Question, Response

URL = "/api/feedback-table/"


class Command(BaseCommand):
    help = "Time the feedback table endpoint on the current data and print a Markdown report."

    def add_arguments(self, parser):
        parser.add_argument("--runs", type=int, default=20, help="Timed requests per scenario.")
        parser.add_argument("--target-ms", type=float, default=300.0)

    def handle(self, *args, **options):
        if not Response.objects.exists():
            raise CommandError("No responses to time. Run `seed_bulk` first.")

        client = Client()
        rows = []
        for name, params in self._scenarios(client):
            rows.append((name, params, *self._measure(client, params, options["runs"])))

        target = options["target_ms"]
        self.stdout.write(
            f"Feedback table timings: {Response.objects.count():,} responses, "
            f"{Answer.objects.count():,} answers, {options['runs']} runs each, "
            f"target < {target:g} ms (median)\n"
        )
        self.stdout.write("| Scenario | Params | Rows | Queries | Median ms | p95 ms | Target |")
        self.stdout.write("|---|---|---|---|---|---|---|")
        for name, params, count, queries, median, p95 in rows:
            query = "&".join(f"{k}={v}" for k, v in params.items()) or "(defaults)"
            verdict = "pass" if median < target else "OVER"
            self.stdout.write(
                f"| {name} | `{query}` | {count} | {queries} | {median:.1f} | {p95:.1f} | {verdict} |"
            )

    def _scenarios(self, client):
        yield "First page", {}
        yield "Last page", {"page": self._last_page(client, {})}
        yield "Last page, all statuses", {
            "status": "all",
            "page": self._last_page(client, {"status": "all"}),
        }
        yield "Largest page", {"page_size": 100}

        question = Question.objects.order_by("survey_id", "order").first()
        yield "Survey + rating", {
            "survey": question.survey_id,
            "rating": 5,
            "rating_question": question.id,
        }
        yield "Rating on Q1, all surveys", {"rating": 5, "rating_question": 1}
        yield "Search", {"search": "an"}
        yield "Ticketless, oldest first", {"ticketless": "true", "ordering": "submitted_at"}

    def _last_page(self, client, params):
        count = self._get(client, params).json()["count"]
        return max(1, math.ceil(count / 50))

    def _measure(self, client, params, runs):
        # One untimed request to warm caches and count queries. Counting via an
        # execute wrapper, not connection.queries: Django clears that log at the
        # start of every request, which made before/after diffs meaningless.
        queries = []
        with connection.execute_wrapper(lambda execute, sql, *args: queries.append(sql) or execute(sql, *args)):
            body = self._get(client, params).json()
        timings = []
        for _ in range(runs):
            started = time.perf_counter()
            self._get(client, params)
            timings.append((time.perf_counter() - started) * 1000)
        timings.sort()
        p95 = timings[min(len(timings) - 1, math.ceil(len(timings) * 0.95) - 1)]
        return len(body["results"]), len(queries), statistics.median(timings), p95

    def _get(self, client, params):
        response = client.get(URL, params)
        if response.status_code != 200:
            raise CommandError(f"{URL} {params} returned {response.status_code}: {response.content[:200]!r}")
        return response
