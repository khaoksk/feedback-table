from datetime import datetime, timezone
from io import StringIO

import pytest
from django.core.management import call_command
from django.core.management.base import CommandError
from django.db.models import Count, F

from feedback.management.commands import seed_bulk
from feedback.models import Answer, Customer, Option, Question, Response, Survey
from feedback.validators import validate_comment, validate_selection

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
    # Answers never edited were last touched when submitted (edited ones: see below).
    assert not Answer.objects.filter(revisions=None).exclude(updated_at=F("response__submitted_at")).exists()
    ratings = Answer.objects.filter(question__type=Question.RATING)
    assert set(ratings.values_list("value", flat=True)) <= {"0", "1", "2", "3", "4", "5"}


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


def test_onboarding_has_a_multiselect_question_with_valid_selections():
    run(responses=200, clear=True)

    question = Question.objects.get(type=Question.MULTISELECT)
    assert question.survey.name == "Onboarding CSAT"
    active = question.options.filter(archived_at=None)
    assert [o.label for o in active] == ["Docs", "Support team", "Pricing", "Kickoff call", "Product itself"]
    # Answers chose 1-3 active options, some plus one option removed since (Req 5).
    every_option = set(question.options.values_list("id", flat=True))
    active_ids = set(active.values_list("id", flat=True))
    answers = Answer.objects.filter(question=question)
    assert answers.exists()
    for answer in answers:
        ids = validate_selection(answer.value, every_option)
        assert 1 <= len([i for i in ids if i in active_ids]) <= 3
        assert len(ids) - len([i for i in ids if i in active_ids]) <= 1


def test_legacy_scores_only_land_on_rating_answers():
    run(responses=400, seed=7, clear=True)

    legacy = Answer.objects.filter(value=seed_bulk.LEGACY_VALUE)
    assert legacy.exists()
    assert not legacy.exclude(question__type=Question.RATING).exists()


def test_quarterly_check_in_has_an_optional_comment_question():
    run(responses=300, clear=True)

    question = Question.objects.get(type=Question.COMMENT)
    assert (question.survey.name, question.order) == ("Quarterly Check-in", 4)
    answers = Answer.objects.filter(question=question)
    asked = Response.objects.filter(survey=question.survey).count()
    assert 0 < answers.count() < asked  # optional: most respondents skip it
    for answer in answers:
        assert validate_comment(answer.value) == answer.value


def test_some_rating_answers_have_a_believable_edit_history():
    run(responses=400, seed=7, clear=True)

    edited = Answer.objects.exclude(revisions=None).distinct()
    assert edited.exists()
    assert not edited.exclude(question__type=Question.RATING).exists()
    for answer in edited.select_related("response").prefetch_related("revisions"):
        revisions = list(answer.revisions.all())
        assert 1 <= len(revisions) <= 2
        # The first value was given at submission; values change at each step.
        assert revisions[0].answered_at == answer.response.submitted_at
        chain = [r.value for r in revisions] + [answer.value]
        assert all(a != b for a, b in zip(chain, chain[1:]))
        assert answer.updated_at > answer.response.submitted_at
        assert answer.updated_at == revisions[-1].replaced_at


def test_post_support_has_an_archived_question_with_answers_and_no_column():
    run(responses=300, clear=True)

    survey = Survey.objects.get(name="Post-Support CSAT")
    archived = Question.objects.get(survey=survey, archived_at__isnull=False)
    assert archived.text == "How friendly was the agent?"
    assert Answer.objects.filter(question=archived).exists()
    # The active questions were renumbered: no gap where it was.
    active = Question.objects.filter(survey=survey, archived_at=None).order_by("order")
    assert [q.order for q in active] == [1, 2]
    assert active[1].text == "How would you rate the speed of our response?"


def test_some_selections_include_an_option_removed_since():
    run(responses=400, seed=7, clear=True)

    slack = Option.objects.get(label="Slack channel")
    assert slack.archived_at is not None
    assert Answer.objects.filter(value__contains=str(slack.id), question=slack.question).exists()
