import random
from datetime import timedelta

from django.core.management.base import BaseCommand
from django.utils import timezone

from feedback.models import Answer, Customer, Question, Response, Survey, Ticket

CUSTOMERS = [
    ("Alice Nguyen", "alice@brightmail.example", "Brightmail"),
    ("Ben Carter", "ben@harborlogistics.example", "Harbor Logistics"),
    ("Carla Mendes", "carla@example.com", ""),
    ("David Osei", "david@meadowcare.example", "Meadow Care"),
    ("Emi Tanaka", "emi@example.com", ""),
]

TICKETS = [
    "Cannot log in to the dashboard",
    "Billing charged me twice",
    "Feature request: CSV export",
]

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
]


class Command(BaseCommand):
    help = "Populate the database with realistic sample data."

    def add_arguments(self, parser):
        parser.add_argument(
            "--clear",
            action="store_true",
            help="Delete existing data before seeding.",
        )

    def handle(self, *args, **options):
        rng = random.Random(1337)

        if options["clear"]:
            Answer.objects.all().delete()
            Response.objects.all().delete()
            Question.objects.all().delete()
            Survey.objects.all().delete()
            Ticket.objects.all().delete()
            Customer.objects.all().delete()
            self.stdout.write("Cleared existing data.")

        if Customer.objects.exists():
            self.stdout.write("Data already present; skipping. Use --clear to reseed.")
            return

        now = timezone.now()

        customers = [
            Customer.objects.create(name=name, email=email, company=company)
            for name, email, company in CUSTOMERS
        ]

        # Only the first three customers get a ticket.
        tickets = [
            Ticket.objects.create(
                customer=customers[index],
                subject=subject,
                created_at=now - timedelta(days=rng.randint(10, 60)),
            )
            for index, subject in enumerate(TICKETS)
        ]

        surveys = []
        for name, question_texts in SURVEYS:
            survey = Survey.objects.create(name=name)
            for order, text in enumerate(question_texts, start=1):
                Question.objects.create(
                    survey=survey, text=text, type=Question.RATING, order=order
                )
            surveys.append(survey)

        scores = ["3", "4", "4", "5", "5", "2", "4", "5"]
        statuses = [
            Response.STATUS_COMPLETED,
            Response.STATUS_COMPLETED,
            Response.STATUS_DRAFT,
        ]

        created_answers = []
        for _ in range(40):
            survey = rng.choice(surveys)
            if rng.random() < 0.20:
                customer = rng.choice(customers)
                ticket = None
            else:
                ticket = rng.choice(tickets)
                customer = ticket.customer
            response = Response.objects.create(
                survey=survey,
                customer=customer,
                ticket=ticket,
                submitted_at=now
                - timedelta(days=rng.randint(0, 30), hours=rng.randint(0, 23)),
                status=rng.choice(statuses),
            )
            for question in survey.questions.all():
                created_answers.append(
                    Answer.objects.create(
                        response=response,
                        question=question,
                        value=rng.choice(scores),
                    )
                )

        # Some rows still carry a value from the survey's earlier scale.
        for answer in rng.sample(created_answers, 3):
            answer.value = "0"
            answer.save(update_fields=["value"])

        self.stdout.write(
            self.style.SUCCESS(
                f"Seeded {len(customers)} customers, {len(tickets)} tickets, "
                f"{len(surveys)} surveys, {Response.objects.count()} responses, "
                f"{Answer.objects.count()} answers."
            )
        )
