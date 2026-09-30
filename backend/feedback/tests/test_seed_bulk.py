from datetime import datetime, timezone
from io import StringIO

import pytest
from django.core.management import call_command
from django.core.management.base import CommandError
from django.db.models import Count, F

from feedback.management.commands import seed_bulk
from feedback.models import Answer, Customer, Response, Survey

from .factories import ResponseFactory

pytestmark = pytest.mark.django_db


@pytest.fixture(autouse=True)
def fixed_clock(monkeypatch):
    # Pin "today" so runs on either side of midnight stay comparable.
    monkeypatch.setattr(
        seed_bulk.timezone, "now", lambda: datetime(2026, 9, 30, 15, 30, tzinfo=timezone.utc)
    )


def run(**options):
    call_command("seed_bulk", stdout=StringIO(), **options)


def snapshot():
    return [
        (
            response.id,
            response.customer.name,
            response.customer.email,
            response.ticket_id,
            response.survey.name,
            response.status,
            response.submitted_at,
            tuple((a.question.order, a.value) for a in response.answers.order_by("question__order")),
        )
        for response in Response.objects.select_related("customer", "survey").order_by("id")
    ]


def test_generates_the_requested_number_of_responses():
    run(responses=25, batch_size=10, clear=True)

    assert Response.objects.count() == 25


def test_mixes_in_the_edge_cases_the_table_must_handle():
    run(responses=400, seed=7, clear=True)
    responses = Response.objects.count()

    no_ticket = Response.objects.filter(ticket__isnull=True).count()
    assert 0.10 < no_ticket / responses < 0.30
    assert Response.objects.filter(status=Response.STATUS_DRAFT).exists()
    assert Customer.objects.filter(name="").exists()
    assert Answer.objects.filter(value=seed_bulk.LEGACY_VALUE).exists()
    # Some responses skipped a later question.
    assert (
        Response.objects.annotate(
            answered=Count("answers", distinct=True),
            asked=Count("survey__questions", distinct=True),
        )
        .filter(answered__lt=F("asked"))
        .exists()
    )
    # A survey longer than the others, so the table gets a column some rows leave empty.
    question_counts = set(Survey.objects.annotate(n=Count("questions")).values_list("n", flat=True))
    assert len(question_counts) > 1


def test_generated_rows_are_consistent():
    run(responses=200, clear=True)

    assert not Answer.objects.exclude(question__survey=F("response__survey")).exists()
    assert not Response.objects.exclude(ticket=None).exclude(ticket__customer=F("customer")).exists()
    assert not Answer.objects.exclude(created_at=F("response__submitted_at")).exists()
    assert not Answer.objects.exclude(updated_at=F("response__submitted_at")).exists()
    assert set(Answer.objects.values_list("value", flat=True)) <= {"0", "1", "2", "3", "4", "5"}


def test_same_seed_gives_identical_data():
    run(responses=150, seed=3, clear=True)
    first = snapshot()

    run(responses=150, seed=3, clear=True)

    assert snapshot() == first


def test_different_seed_gives_different_data():
    run(responses=150, seed=3, clear=True)
    first = snapshot()

    run(responses=150, seed=4, clear=True)

    assert snapshot() != first


def test_refuses_to_mix_with_existing_data_without_clear():
    ResponseFactory()

    with pytest.raises(CommandError, match="--clear"):
        run(responses=10)

    assert Response.objects.count() == 1


def test_clear_replaces_existing_data():
    existing = ResponseFactory()

    run(responses=10, clear=True)

    assert not Response.objects.filter(customer__email=existing.customer.email).exists()
    assert Response.objects.count() == 10


def test_one_survey_uses_custom_labels():
    run(responses=50, clear=True)

    custom = Survey.objects.exclude(rating_labels=None)
    assert [survey.name for survey in custom] == ["Onboarding CSAT"]
    assert custom[0].rating_labels["5"] == "Awesome"
