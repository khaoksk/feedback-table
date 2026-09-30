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

from feedback.models import Answer, AnswerRevision, Customer, Option, Question, Response, Survey, Ticket
from feedback.scales import normalize_rating_labels
from feedback.validators import serialize_selection, validate_comment, validate_rating, validate_selection

COMMENT = "comment"

# (name, questions, rating labels or None for the defaults). A question is
# rating text, (text, [options]) for multi-select, or (text, COMMENT).
SURVEYS = [
    (
        "Post-Support CSAT",
        [
            "How satisfied were you with the support you received?",
            "How would you rate the speed of our response?",
        ],
        None,
    ),
    # Custom labels, as in the design reference's Req 1 example: the same
    # scores read differently from the other surveys.
    (
        "Onboarding CSAT",
        [
            "How easy was it to get started?",
            "How would you rate your first week with us?",
            # The design reference's Req 2 example.
            (
                "What made the biggest difference?",
                ["Docs", "Support team", "Pricing", "Kickoff call", "Product itself"],
            ),
        ],
        {1: "Meh", 2: "Rough", 3: "Fine", 4: "Nice", 5: "Awesome"},
    ),
    # The longest survey, so the table has columns that shorter surveys leave
    # empty (2, 3 and 4 questions across the three surveys).
    (
        "Quarterly Check-in",
        [
            "How likely are you to recommend us?",
            "How well does the product fit your needs?",
            "How would you rate the value for money?",
            # The design reference's Req 3 example.
            ("Anything you would add?", COMMENT),
        ],
        None,
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
# Free-text answers, including ones that look like scores, non-English text
# and a long one, so the table has to render them as text.
COMMENTS = [
    "Support was quick, thanks!",
    "Appreciate the quick turnaround.",
    "Nothing major, just a bit slow to respond.",
    "Took a couple of tries to get the export format right.",
    "5",
    "10/10 would recommend",
    "บริการดีมาก ขอบคุณครับ",
    "The agent was great.\nThe wait before reaching them was not.",
    (
        "Long story short: the first reply came fast, but the fix needed three follow-ups, and each time "
        "I had to explain the setup again because the context was not carried over between agents. Once "
        "it reached someone who knew the billing module it was solved in minutes. A shared case history "
        "would have saved everyone a lot of time."
    ),
]
COMMENT_ANSWER_RATE = 0.4  # comments are optional; most people skip them

# How many options a multi-select answer picks.
SELECTION_SIZE_WEIGHTS = {1: 45, 2: 35, 3: 20}

NO_TICKET_RATE = 0.20
DRAFT_RATE = 0.20
SKIP_LATER_QUESTION_RATE = 0.05
ANONYMOUS_CUSTOMER_RATE = 0.03
LEGACY_ANSWER_RATE = 0.005
# Rating answers the respondent later changed, once or twice (Req 4).
EDITED_ANSWER_RATE = 0.03
EDIT_COUNT_WEIGHTS = {1: 70, 2: 30}
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
        self._analyze()

        self.stdout.write(
            self.style.SUCCESS(
                f"Generated {stats['responses']} responses and {stats['answers']} answers "
                f"in {time.monotonic() - started:.1f}s "
                f"({stats['customers']} customers, {stats['tickets']} tickets, "
                f"{stats['no_ticket']} without ticket, {stats['drafts']} drafts, "
                f"{stats['skipped']} skipped answers, {stats['legacy']} legacy scores, "
                f"{stats['edited']} edited answers)."
            )
        )

    def _analyze(self):
        # A bulk load leaves planner statistics stale until autovacuum gets to
        # them; timing right after seeding then measures bad plans (a rating
        # filter at 100K took ~390 ms before ANALYZE and ~75 ms after).
        tables = [
            model._meta.db_table
            for model in (AnswerRevision, Answer, Response, Question, Ticket, Survey, Customer)
        ]
        with connection.cursor() as cursor:
            cursor.execute(f"ANALYZE {', '.join(tables)}")

    def _truncate(self):
        tables = [
            model._meta.db_table
            for model in (AnswerRevision, Answer, Response, Question, Ticket, Survey, Customer)
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
            "answers": 0, "no_ticket": 0, "drafts": 0, "skipped": 0, "legacy": 0, "edited": 0,
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
            # Legacy scores only make sense on rating answers.
            answer_ids.extend(answer.id for answer in answers if answer.question.type == Question.RATING)
            stats["responses"] += len(responses)
            stats["answers"] += len(answers)

        legacy_ids = self._mark_legacy_scores(answer_ids)
        stats["legacy"] = len(legacy_ids)
        self._align_answer_timestamps()
        # After the timestamps are aligned, so edits can move them forward.
        legacy = set(legacy_ids)
        stats["edited"] = self._add_edits([i for i in answer_ids if i not in legacy])
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
        for name, specs, labels in SURVEYS:
            survey = Survey.objects.create(
                name=name,
                rating_labels=None if labels is None else normalize_rating_labels(labels),
            )
            survey.question_list = []
            for order, spec in enumerate(specs, start=1):
                text, options = (spec, None) if isinstance(spec, str) else spec
                if options is None:
                    question_type = Question.RATING
                elif options == COMMENT:
                    question_type, options = Question.COMMENT, None
                else:
                    question_type = Question.MULTISELECT
                question = Question.objects.create(survey=survey, text=text, order=order, type=question_type)
                question.option_ids = [
                    option.id
                    for option in Option.objects.bulk_create(
                        Option(question=question, label=label, order=position)
                        for position, label in enumerate(options or [], start=1)
                    )
                ]
                survey.question_list.append(question)
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
            if question.type == Question.COMMENT:
                if self.rng.random() >= COMMENT_ANSWER_RATE:
                    continue
                value = validate_comment(self.rng.choice(COMMENTS))
            elif question.type == Question.MULTISELECT:
                size = self.rng.choices(list(SELECTION_SIZE_WEIGHTS), weights=SELECTION_SIZE_WEIGHTS.values())[0]
                ids = validate_selection(self.rng.sample(question.option_ids, size), question.option_ids)
                value = serialize_selection(ids)
            else:
                value = str(self.rng.choices(list(RATING_WEIGHTS), weights=RATING_WEIGHTS.values())[0])
                validate_rating(value)
            answers.append(Answer(response=response, question=question, value=value))
        return answers

    def _mark_legacy_scores(self, answer_ids):
        # Legacy values are written deliberately, after validation, like the
        # handful of pre-rescale scores in the original seed.
        count = max(1, round(len(answer_ids) * LEGACY_ANSWER_RATE))
        ids = self.rng.sample(answer_ids, count)
        Answer.objects.filter(id__in=ids).update(value=LEGACY_VALUE)
        return ids

    def _add_edits(self, rating_answer_ids):
        """Give some rating answers a history, as if re-answered through an edit link.

        Each keeps its current score; one or two earlier scores become
        revisions, the first given when the response was submitted, and the
        answer's updated_at moves to the last edit.
        """
        chosen = sorted(self.rng.sample(rating_answer_ids, round(len(rating_answer_ids) * EDITED_ANSWER_RATE)))
        answers = Answer.objects.filter(id__in=chosen).select_related("response").order_by("id")
        revisions, updated = [], []
        for answer in answers:
            edits = self.rng.choices(list(EDIT_COUNT_WEIGHTS), weights=EDIT_COUNT_WEIGHTS.values())[0]
            submitted = answer.response.submitted_at
            span = (self.anchor - submitted).total_seconds()
            edit_times = sorted(submitted + timedelta(seconds=self.rng.uniform(0, span)) for _ in range(edits))
            # Each earlier value differs from the one that replaced it.
            values, later = [], int(answer.value)
            for _ in range(edits):
                earlier = self.rng.choice([score for score in RATING_WEIGHTS if score != later])
                values.insert(0, str(earlier))
                later = earlier
            given_at = [submitted] + edit_times[:-1]
            revisions += [
                AnswerRevision(answer=answer, value=value, answered_at=at, replaced_at=replaced)
                for value, at, replaced in zip(values, given_at, edit_times)
            ]
            answer.updated_at = edit_times[-1]
            updated.append(answer)
        AnswerRevision.objects.bulk_create(revisions)
        # bulk_update does not apply auto_now, so the edit time is kept.
        Answer.objects.bulk_update(updated, ["updated_at"])
        return len(updated)

    def _align_answer_timestamps(self):
        # bulk_create applies auto_now_add/auto_now, stamping every answer with
        # the time this command ran. Answers belong to their response's time.
        submitted_at = Subquery(
            Response.objects.filter(pk=OuterRef("response_id")).values("submitted_at")[:1]
        )
        Answer.objects.update(created_at=submitted_at, updated_at=submitted_at)

    def _random_time(self):
        return self.anchor - timedelta(seconds=self.rng.randint(1, HISTORY_DAYS * 24 * 3600))
