"""Generate a large, reproducible dataset for the feedback table.

    python manage.py seed_bulk --responses 10000 --seed 42 --clear

The same --seed on the same day produces the same rows (times are spread over
the days before today's midnight UTC; ids match too, because --clear restarts
the id sequences). Edge cases are mixed in at roughly the rates the
design reference describes, so the table can be demoed and timed on data that
looks like production rather than on uniform filler.
"""
import random
import time
from datetime import timedelta

from django.core.management.base import BaseCommand, CommandError
from django.db import connection, transaction
from django.db.models import OuterRef, Subquery
from django.utils import timezone

from feedback.models import Answer, Customer, Question, Response, Survey, Ticket
from feedback.validators import validate_rating

SURVEYS = [
    (
        "Post-Support CSAT",
        [
            "How satisfied were you with the support you received?",
            "How would you rate the speed of our response?",
        ],
    ),
    (
        "Onboarding CSAT",
        [
            "How easy was it to get started?",
            "How would you rate your first week with us?",
        ],
    ),
    # One longer survey, so the table has a Q3 column that the others leave empty.
    (
        "Quarterly Check-in",
        [
            "How likely are you to recommend us?",
            "How well does the product fit your needs?",
            "How would you rate the value for money?",
        ],
    ),
]
SURVEY_WEIGHTS = [5, 3, 2]

FIRST_NAMES = [
    "Alice", "Ben", "Carla", "David", "Emi", "Farah", "George", "Hana", "Ivan",
    "Julia", "Kofi", "Lena", "Mateo", "Nadia", "Omar", "Priya", "Quinn", "Rosa",
    "Sam", "Tomas", "Uma", "Victor", "Wen", "Yara", "Zane",
]
LAST_NAMES = [
    "Nguyen", "Carter", "Mendes", "Osei", "Tanaka", "Haddad", "Novak", "Kim",
    "Petrov", "Rossi", "Mensah", "Berg", "Silva", "Popescu", "Khan", "Nair",
    "Reyes", "Chen", "Okafor", "Larsen",
]
COMPANIES = [
    "Brightmail", "Harbor Logistics", "Meadow Care", "Acme", "Globex", "Initech",
    "Northwind", "Umbrella Health", "",  # some customers have no company
]
TICKET_SUBJECTS = [
    "Cannot log in to the dashboard", "Billing charged me twice",
    "Feature request: CSV export", "Password reset link expired",
    "API returns 500 on export", "Refund request", "Data import stuck",
    "Question about pricing tiers", "SSO setup help", "Report shows wrong totals",
]

# Weighted towards positive scores, as CSAT data usually is.
RATING_WEIGHTS = {1: 5, 2: 8, 3: 15, 4: 35, 5: 37}

NO_TICKET_RATE = 0.20
DRAFT_RATE = 0.20
SKIP_LATER_QUESTION_RATE = 0.05
ANONYMOUS_CUSTOMER_RATE = 0.03
LEGACY_ANSWER_RATE = 0.005
LEGACY_VALUE = "0"  # a score from the survey's earlier scale, as in `seed`
HISTORY_DAYS = 180


class Command(BaseCommand):
    help = "Generate a large, reproducible dataset for the feedback table."

    def add_arguments(self, parser):
        parser.add_argument("--responses", type=int, default=10_000)
        parser.add_argument("--seed", type=int, default=42)
        parser.add_argument("--batch-size", type=int, default=1_000)
        parser.add_argument(
            "--clear",
            action="store_true",
            help="Delete ALL feedback data (including `seed` data) before generating.",
        )

    def handle(self, *args, **options):
        if options["responses"] < 1:
            raise CommandError("--responses must be at least 1.")

        if options["clear"]:
            self._truncate()
        elif Response.objects.exists() or Customer.objects.exists():
            raise CommandError(
                "Feedback data already exists. Re-run with --clear to replace it "
                "(this deletes all customers, tickets, surveys and responses)."
            )

        started = time.monotonic()
        with transaction.atomic():
            stats = Generator(
                rng=random.Random(options["seed"]),
                anchor=timezone.now().replace(hour=0, minute=0, second=0, microsecond=0),
            ).run(options["responses"], options["batch_size"])

        self.stdout.write(
            self.style.SUCCESS(
                f"Generated {stats['responses']} responses and {stats['answers']} answers "
                f"in {time.monotonic() - started:.1f}s "
                f"({stats['customers']} customers, {stats['tickets']} tickets, "
                f"{stats['no_ticket']} without ticket, {stats['drafts']} drafts, "
                f"{stats['skipped']} skipped answers, {stats['legacy']} legacy scores)."
            )
        )

    def _truncate(self):
        tables = [
            model._meta.db_table
            for model in (Answer, Response, Question, Ticket, Survey, Customer)
        ]
        # Postgres-only, like the rest of the stack. RESTART IDENTITY makes ids
        # reproducible across runs with the same --seed.
        with connection.cursor() as cursor:
            # Django's foreign keys are DEFERRABLE INITIALLY DEFERRED; if this
            # runs inside a transaction that already inserted rows (tests, or a
            # caller's atomic block), Postgres refuses TRUNCATE until the pending
            # checks have fired.
            cursor.execute("SET CONSTRAINTS ALL IMMEDIATE")
            cursor.execute(f"TRUNCATE {', '.join(tables)} RESTART IDENTITY CASCADE")
        self.stdout.write("Cleared existing feedback data.")


class Generator:
    def __init__(self, rng, anchor):
        self.rng = rng
        self.anchor = anchor

    def run(self, response_count, batch_size):
        customers = self._customers(max(20, response_count // 20))
        tickets = self._tickets(customers, count=int(len(customers) * 1.5))
        surveys = self._surveys()
        stats = {
            "customers": len(customers), "tickets": len(tickets), "responses": 0,
            "answers": 0, "no_ticket": 0, "drafts": 0, "skipped": 0, "legacy": 0,
        }
        answer_ids = []

        for start in range(0, response_count, batch_size):
            size = min(batch_size, response_count - start)
            responses = Response.objects.bulk_create(
                [self._response(customers, tickets, surveys, stats) for _ in range(size)]
            )
            answers = Answer.objects.bulk_create(
                [
                    answer
                    for response in responses
                    for answer in self._answers(response, surveys[response.survey_id], stats)
                ]
            )
            answer_ids.extend(answer.id for answer in answers)
            stats["responses"] += len(responses)
            stats["answers"] += len(answers)

        stats["legacy"] = self._mark_legacy_scores(answer_ids)
        self._align_answer_timestamps()
        return stats

    def _customers(self, count):
        anonymous = set(self.rng.sample(range(count), max(1, round(count * ANONYMOUS_CUSTOMER_RATE))))
        customers = []
        for index in range(count):
            first, last = self.rng.choice(FIRST_NAMES), self.rng.choice(LAST_NAMES)
            customers.append(
                Customer(
                    name="" if index in anonymous else f"{first} {last}",
                    email=f"{first}.{last}.{index}@example.com".lower(),
                    company=self.rng.choice(COMPANIES),
                )
            )
        return Customer.objects.bulk_create(customers)

    def _tickets(self, customers, count):
        return Ticket.objects.bulk_create(
            [
                Ticket(
                    customer=self.rng.choice(customers),
                    subject=self.rng.choice(TICKET_SUBJECTS),
                    created_at=self._random_time(),
                )
                for _ in range(count)
            ]
        )

    def _surveys(self):
        surveys = {}
        for name, texts in SURVEYS:
            survey = Survey.objects.create(name=name)
            survey.question_list = Question.objects.bulk_create(
                [
                    Question(survey=survey, text=text, type=Question.RATING, order=order)
                    for order, text in enumerate(texts, start=1)
                ]
            )
            surveys[survey.id] = survey
        return surveys

    def _response(self, customers, tickets, surveys, stats):
        survey = self.rng.choices(list(surveys.values()), weights=SURVEY_WEIGHTS)[0]
        if self.rng.random() < NO_TICKET_RATE:
            ticket, customer = None, self.rng.choice(customers)
            stats["no_ticket"] += 1
        else:
            ticket = self.rng.choice(tickets)
            customer = ticket.customer
        status = Response.STATUS_DRAFT if self.rng.random() < DRAFT_RATE else Response.STATUS_COMPLETED
        stats["drafts"] += status == Response.STATUS_DRAFT
        return Response(
            survey=survey, customer=customer, ticket=ticket,
            submitted_at=self._random_time(), status=status,
        )

    def _answers(self, response, survey, stats):
        answers = []
        for question in survey.question_list:
            # Only later questions are skipped, matching the design's "skipped Q2".
            if question.order > 1 and self.rng.random() < SKIP_LATER_QUESTION_RATE:
                stats["skipped"] += 1
                continue
            value = str(self.rng.choices(list(RATING_WEIGHTS), weights=RATING_WEIGHTS.values())[0])
            validate_rating(value)
            answers.append(Answer(response=response, question=question, value=value))
        return answers

    def _mark_legacy_scores(self, answer_ids):
        # Legacy values are written deliberately, after validation, like the
        # handful of pre-rescale scores in the original seed.
        count = max(1, round(len(answer_ids) * LEGACY_ANSWER_RATE))
        ids = self.rng.sample(answer_ids, count)
        return Answer.objects.filter(id__in=ids).update(value=LEGACY_VALUE)

    def _align_answer_timestamps(self):
        # bulk_create applies auto_now_add/auto_now, stamping every answer with
        # the time this command ran. Answers belong to their response's time.
        submitted_at = Subquery(
            Response.objects.filter(pk=OuterRef("response_id")).values("submitted_at")[:1]
        )
        Answer.objects.update(created_at=submitted_at, updated_at=submitted_at)

    def _random_time(self):
        return self.anchor - timedelta(seconds=self.rng.randint(1, HISTORY_DAYS * 24 * 3600))
