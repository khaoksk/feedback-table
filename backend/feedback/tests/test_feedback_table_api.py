from datetime import datetime, timedelta, timezone

import pytest
from rest_framework.test import APIClient

from feedback.models import Answer, Response

from .factories import (
    CustomerFactory,
    QuestionFactory,
    ResponseFactory,
    SurveyFactory,
    TicketFactory,
)

pytestmark = pytest.mark.django_db

URL = "/api/feedback-table/"
BASE_TIME = datetime(2026, 9, 1, 12, 0, tzinfo=timezone.utc)


@pytest.fixture
def client():
    return APIClient()


@pytest.fixture
def csat():
    survey = SurveyFactory(name="CSAT")
    q1 = QuestionFactory(survey=survey, order=1, text="How satisfied?")
    q2 = QuestionFactory(survey=survey, order=2, text="How fast?")
    return survey, q1, q2


def respond(survey, answers, minutes=0, **fields):
    """Create a response to `survey` with {question: value} answers."""
    response = ResponseFactory(
        survey=survey, submitted_at=BASE_TIME + timedelta(minutes=minutes), **fields
    )
    for question, value in answers.items():
        Answer.objects.create(response=response, question=question, value=value)
    return response


def get(client, **params):
    result = client.get(URL, params)
    assert result.status_code == 200, result.json()
    return result.json()


def ids(data):
    return [row["id"] for row in data["results"]]


# --- Row shape -------------------------------------------------------------


def test_row_carries_customer_ticket_survey_and_answers(client, csat):
    survey, q1, q2 = csat
    customer = CustomerFactory(name="Ada", email="ada@example.com", company="Acme")
    ticket = TicketFactory(customer=customer, subject="Login broken")
    response = respond(survey, {q1: "4", q2: "5"}, customer=customer, ticket=ticket)

    row = get(client)["results"][0]

    assert row == {
        "id": response.id,
        "submitted_at": "2026-09-01T12:00:00Z",
        "status": "completed",
        "customer": {"name": "Ada", "email": "ada@example.com", "company": "Acme"},
        "ticket": {"id": ticket.id, "subject": "Login broken"},
        "survey_id": survey.id,
        "answers": {
            str(q1.id): {"value": "4", "display": "Good", "state": "ok"},
            str(q2.id): {"value": "5", "display": "Great", "state": "ok"},
        },
    }


def test_response_without_ticket_has_null_ticket(client, csat):
    survey, q1, _ = csat
    respond(survey, {q1: "3"}, ticket=None)

    assert get(client)["results"][0]["ticket"] is None


def test_every_survey_question_appears_even_when_unanswered(client, csat):
    survey, q1, q2 = csat
    respond(survey, {q1: "3"})

    answers = get(client)["results"][0]["answers"]

    assert answers[str(q2.id)] == {"value": None, "display": None, "state": "unanswered"}


def test_legacy_and_invalid_values_are_resolved_not_dropped(client, csat):
    survey, q1, q2 = csat
    respond(survey, {q1: "0", q2: "abc"})

    answers = get(client)["results"][0]["answers"]

    assert answers[str(q1.id)]["state"] == "legacy"
    assert answers[str(q2.id)] == {"value": "abc", "display": None, "state": "invalid"}


def test_surveys_on_the_page_are_described_with_ordered_questions(client, csat):
    survey, q1, q2 = csat
    other = SurveyFactory(name="Not on this page")
    QuestionFactory(survey=other)
    respond(survey, {q1: "3"})

    surveys = get(client)["surveys"]

    assert surveys == {
        str(survey.id): {
            "name": "CSAT",
            "questions": [
                {"id": q1.id, "order": 1, "text": "How satisfied?", "type": "rating"},
                {"id": q2.id, "order": 2, "text": "How fast?", "type": "rating"},
            ],
        }
    }


# --- Filters ---------------------------------------------------------------


def test_only_completed_responses_by_default(client, csat):
    survey, q1, _ = csat
    completed = respond(survey, {q1: "3"}, status=Response.STATUS_COMPLETED)
    draft = respond(survey, {q1: "3"}, status=Response.STATUS_DRAFT)

    assert ids(get(client)) == [completed.id]
    assert ids(get(client, status="draft")) == [draft.id]
    assert set(ids(get(client, status="all"))) == {completed.id, draft.id}


def test_filters_by_survey(client, csat):
    survey, q1, _ = csat
    other = SurveyFactory()
    mine = respond(survey, {q1: "3"})
    respond(other, {})

    assert ids(get(client, survey=survey.id)) == [mine.id]


def test_ticketless_only(client, csat):
    survey, q1, _ = csat
    without = respond(survey, {q1: "3"}, ticket=None)
    respond(survey, {q1: "3"}, ticket=TicketFactory())

    assert ids(get(client, ticketless="true")) == [without.id]


@pytest.mark.parametrize("term", ["ada", "ACME", "  Acme  "])
def test_search_matches_customer_name_or_company_case_insensitively(client, csat, term):
    survey, q1, _ = csat
    match = respond(survey, {q1: "3"}, customer=CustomerFactory(name="Ada Lovelace", company="Acme"))
    respond(survey, {q1: "3"}, customer=CustomerFactory(name="Bob", company="Globex"))

    assert ids(get(client, search=term)) == [match.id]


def test_rating_filter_uses_question_id_within_one_survey(client, csat):
    survey, q1, q2 = csat
    q1_five = respond(survey, {q1: "5", q2: "1"})
    respond(survey, {q1: "1", q2: "5"})

    assert ids(get(client, survey=survey.id, rating=5, rating_question=q1.id)) == [q1_five.id]


def test_rating_filter_uses_question_position_across_surveys(client, csat):
    survey, q1, _ = csat
    other = SurveyFactory()
    other_q1 = QuestionFactory(survey=other, order=1)
    a = respond(survey, {q1: "5"})
    b = respond(other, {other_q1: "5"})
    respond(other, {other_q1: "2"})

    assert set(ids(get(client, rating=5, rating_question=1))) == {a.id, b.id}


# --- Ordering and pagination ----------------------------------------------


def test_newest_first_with_id_breaking_ties(client, csat):
    survey, q1, _ = csat
    older = respond(survey, {q1: "3"}, minutes=0)
    tie_a = respond(survey, {q1: "3"}, minutes=5)
    tie_b = respond(survey, {q1: "3"}, minutes=5)

    assert ids(get(client)) == [tie_b.id, tie_a.id, older.id]
    assert ids(get(client, ordering="submitted_at")) == [older.id, tie_a.id, tie_b.id]


def test_paginates_with_count_and_links(client, csat):
    survey, q1, _ = csat
    for minute in range(7):
        respond(survey, {q1: "3"}, minutes=minute)

    first = get(client, page_size=3)
    last = get(client, page_size=3, page=3)

    assert first["count"] == 7
    assert len(first["results"]) == 3
    assert "page=2" in first["next"]
    assert first["previous"] is None
    assert len(last["results"]) == 1
    assert last["next"] is None


def test_page_size_is_capped(client, csat):
    survey, q1, _ = csat
    for minute in range(101):
        respond(survey, {}, minutes=minute)

    assert len(get(client, page_size=500)["results"]) == 100


# --- Validation ------------------------------------------------------------


@pytest.mark.parametrize(
    "params",
    [
        {"status": "archived"},
        {"survey": "abc"},
        {"ordering": "customer"},
        {"rating": 5},
        {"rating_question": 1},
    ],
)
def test_rejects_bad_parameters(client, params):
    assert client.get(URL, params).status_code == 400


# --- Performance -----------------------------------------------------------


def test_query_count_does_not_grow_with_rows(client, csat, django_assert_num_queries):
    survey, q1, q2 = csat
    other = SurveyFactory()
    other_q = QuestionFactory(survey=other)
    for minute in range(30):
        respond(survey, {q1: "4", q2: "5"}, minutes=minute, ticket=TicketFactory())
        respond(other, {other_q: "2"}, minutes=minute, ticket=None)

    # count, rows (+customer, ticket), answers, surveys, questions
    with django_assert_num_queries(5):
        small = get(client, page_size=5)
    with django_assert_num_queries(5):
        large = get(client, page_size=60)

    assert len(small["results"]) == 5
    assert len(large["results"]) == 60
