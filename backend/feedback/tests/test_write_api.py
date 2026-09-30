import json

import pytest
from rest_framework.test import APIClient

from feedback.models import Answer, Customer, Option, Question, Response

from .factories import CustomerFactory, OptionFactory, QuestionFactory, SurveyFactory

pytestmark = pytest.mark.django_db


@pytest.fixture
def client():
    return APIClient()


# --- POST /api/surveys/<id>/questions/ --------------------------------------


def add_question(client, survey, **body):
    return client.post(f"/api/surveys/{survey.id}/questions/", body, format="json")


def test_creates_a_multiselect_question_last_with_its_options_in_order(client):
    survey = SurveyFactory()
    QuestionFactory(survey=survey, order=1)
    QuestionFactory(survey=survey, order=2)

    result = add_question(
        client, survey, text="What made the biggest difference?", type="multiselect",
        options=["Docs", "Support team", "Kickoff call"],
    )

    assert result.status_code == 201
    body = result.json()
    question = Question.objects.get(pk=body["id"])
    assert (question.survey, question.order, question.type) == (survey, 3, "multiselect")
    assert [(o["label"], o["order"]) for o in body["options"]] == [
        ("Docs", 1), ("Support team", 2), ("Kickoff call", 3),
    ]


def test_creates_a_rating_question_without_options(client):
    survey = SurveyFactory()

    body = add_question(client, survey, text="How did we do?", type="rating").json()

    assert body["type"] == "rating"
    assert body["order"] == 1
    assert body["options"] == []


@pytest.mark.parametrize(
    "body, field",
    [
        ({"text": "", "type": "rating"}, "text"),
        ({"text": "Q", "type": "comment"}, "type"),
        ({"text": "Q", "type": "multiselect", "options": ["Only one"]}, "options"),
        ({"text": "Q", "type": "multiselect"}, "options"),
        ({"text": "Q", "type": "multiselect", "options": ["Docs", "docs"]}, "options"),
        ({"text": "Q", "type": "multiselect", "options": ["Docs", ""]}, "options"),
        ({"text": "Q", "type": "rating", "options": ["A", "B"]}, "options"),
    ],
)
def test_rejects_invalid_questions_and_creates_nothing(client, body, field):
    survey = SurveyFactory()

    result = add_question(client, survey, **body)

    assert result.status_code == 400
    assert field in result.json()
    assert not Question.objects.exists()
    assert not Option.objects.exists()


def test_adding_a_question_to_an_unknown_survey_is_404(client):
    assert client.post("/api/surveys/999/questions/", {"text": "Q", "type": "rating"}, format="json").status_code == 404


# --- POST /api/surveys/<id>/responses/ --------------------------------------


@pytest.fixture
def survey():
    survey = SurveyFactory()
    rating = QuestionFactory(survey=survey, order=1, type="rating")
    pick = QuestionFactory(survey=survey, order=2, type="multiselect")
    docs = OptionFactory(question=pick, label="Docs", order=1)
    pricing = OptionFactory(question=pick, label="Pricing", order=2)
    archived = OptionFactory(question=pick, label="Old", order=3, archived_at="2026-01-01T00:00:00Z")
    return {"survey": survey, "rating": rating, "pick": pick, "docs": docs, "pricing": pricing, "archived": archived}


def submit(client, survey, answers, email="ada@example.com", **fields):
    return client.post(
        f"/api/surveys/{survey.id}/responses/",
        {"email": email, "name": "Ada", "company": "Acme", "answers": answers, **fields},
        format="json",
    )


def test_saves_a_response_with_a_rating_and_several_options(client, survey):
    result = submit(
        client, survey["survey"],
        {str(survey["rating"].id): 4, str(survey["pick"].id): [survey["pricing"].id, survey["docs"].id]},
    )

    assert result.status_code == 201
    response = Response.objects.get(pk=result.json()["id"])
    assert response.status == "completed"
    assert response.ticket is None
    values = {a.question_id: a.value for a in response.answers.all()}
    assert values[survey["rating"].id] == "4"
    assert json.loads(values[survey["pick"].id]) == sorted([survey["docs"].id, survey["pricing"].id])


def test_saved_selection_shows_in_the_table(client, survey):
    submit(client, survey["survey"], {str(survey["pick"].id): [survey["docs"].id, survey["pricing"].id]})

    row = client.get("/api/feedback-table/").json()["results"][0]

    cell = row["answers"][str(survey["pick"].id)]
    assert [s["label"] for s in cell["selections"]] == ["Docs", "Pricing"]
    assert row["answers"][str(survey["rating"].id)]["state"] == "unanswered"


def test_reuses_the_customer_with_the_same_email(client, survey):
    existing = CustomerFactory(email="Ada@Example.com", name="Ada Lovelace")

    submit(client, survey["survey"], {str(survey["rating"].id): 5}, email="ada@example.com", name="Someone else")

    assert Customer.objects.count() == 1
    assert Response.objects.get().customer == existing
    existing.refresh_from_db()
    assert existing.name == "Ada Lovelace"


def test_creates_a_customer_for_a_new_email(client, survey):
    submit(client, survey["survey"], {str(survey["rating"].id): 5}, email="new@example.com", name=" Bo ")

    assert Customer.objects.get().name == "Bo"


@pytest.mark.parametrize(
    "make_answers, message",
    [
        (lambda s: {str(s["rating"].id): 6}, "between 1 and 5"),
        (lambda s: {str(s["rating"].id): "4"}, "whole number"),
        (lambda s: {str(s["rating"].id): True}, "whole number"),
        (lambda s: {str(s["pick"].id): []}, "at least one"),
        (lambda s: {str(s["pick"].id): [s["docs"].id, s["docs"].id]}, "only be chosen once"),
        (lambda s: {str(s["pick"].id): [s["archived"].id]}, "Not an option"),
        (lambda s: {str(s["pick"].id): ["Docs"]}, "by their ids"),
        (lambda s: {"99999": 4}, "Not a question of this survey"),
    ],
)
def test_rejects_bad_answers_per_question_and_saves_nothing(client, survey, make_answers, message):
    result = submit(client, survey["survey"], make_answers(survey))

    assert result.status_code == 400
    errors = result.json()["answers"]
    assert message in json.dumps(errors)
    assert not Response.objects.exists()
    assert not Answer.objects.exists()


def test_rating_is_checked_against_the_survey_scale(client, survey):
    survey["survey"].rating_labels = {str(s): f"S{s}" for s in range(0, 11)}
    survey["survey"].save()

    assert submit(client, survey["survey"], {str(survey["rating"].id): 0}).status_code == 201


@pytest.mark.parametrize(
    "body, field",
    [
        ({"email": "not-an-email", "answers": {"1": 3}}, "email"),
        ({"answers": {"1": 3}}, "email"),
        ({"email": "a@example.com", "answers": {}}, "answers"),
    ],
)
def test_requires_an_email_and_at_least_one_answer(client, survey, body, field):
    result = client.post(f"/api/surveys/{survey['survey'].id}/responses/", body, format="json")

    assert result.status_code == 400
    assert field in result.json()


def test_a_question_from_another_survey_is_rejected(client, survey):
    other = QuestionFactory()

    result = submit(client, survey["survey"], {str(other.id): 3})

    assert result.status_code == 400
    assert not Response.objects.exists()
