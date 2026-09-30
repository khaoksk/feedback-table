import pytest
from rest_framework.test import APIClient

from feedback.models import Answer, Survey

from .factories import DEFAULT_SCALE, QuestionFactory, ResponseFactory, SurveyFactory

pytestmark = pytest.mark.django_db

CUSTOM = {"1": "Meh", "2": "Rough", "3": "Fine", "4": "Nice", "5": "Awesome"}


def url(survey_id):
    return f"/api/surveys/{survey_id}/rating-labels/"


@pytest.fixture
def client():
    return APIClient()


def test_sets_labels_and_returns_the_survey(client):
    survey = SurveyFactory()
    QuestionFactory(survey=survey, order=1)

    result = client.put(url(survey.id), {"labels": {"2": " Rough ", "1": "Meh", "3": "Fine"}}, format="json")

    assert result.status_code == 200
    body = result.json()
    assert body["custom_labels"] is True
    assert body["rating_scale"] == [
        {"score": 1, "label": "Meh"},
        {"score": 2, "label": "Rough"},
        {"score": 3, "label": "Fine"},
    ]
    assert len(body["questions"]) == 1
    survey.refresh_from_db()
    assert survey.rating_labels == {"1": "Meh", "2": "Rough", "3": "Fine"}


def test_null_resets_to_the_defaults(client):
    survey = SurveyFactory(rating_labels=CUSTOM)

    body = client.put(url(survey.id), {"labels": None}, format="json").json()

    assert body["custom_labels"] is False
    assert body["rating_scale"] == DEFAULT_SCALE
    survey.refresh_from_db()
    assert survey.rating_labels is None


@pytest.mark.parametrize(
    "payload",
    [
        {},
        {"labels": {"1": "Meh"}},
        {"labels": {"1": "Meh", "3": "Fine"}},
        {"labels": {"1": "", "2": "Rough"}},
        {"labels": ["Meh", "Rough"]},
    ],
)
def test_rejects_invalid_labels_and_changes_nothing(client, payload):
    survey = SurveyFactory(rating_labels=CUSTOM)

    result = client.put(url(survey.id), payload, format="json")

    assert result.status_code == 400
    survey.refresh_from_db()
    assert survey.rating_labels == CUSTOM


def test_unknown_survey_is_404(client):
    assert client.put(url(999), {"labels": None}, format="json").status_code == 404


def test_works_for_a_browser_logged_into_the_admin(client, django_user_model):
    # A session cookie from /admin must not make DRF demand a CSRF token.
    user = django_user_model.objects.create_superuser("admin", "a@example.com", "pw")
    client = APIClient(enforce_csrf_checks=True)
    client.force_login(user)
    survey = SurveyFactory()

    assert client.put(url(survey.id), {"labels": CUSTOM}, format="json").status_code == 200


def test_table_shows_new_labels_for_existing_answers_immediately(client):
    survey = SurveyFactory()
    question = QuestionFactory(survey=survey, order=1)
    response = ResponseFactory(survey=survey)
    Answer.objects.create(response=response, question=question, value="4")

    def cell():
        return client.get("/api/feedback-table/").json()["results"][0]["answers"][str(question.id)]

    assert cell()["display"] == "Good"

    client.put(url(survey.id), {"labels": CUSTOM}, format="json")
    assert cell()["display"] == "Nice"

    client.put(url(survey.id), {"labels": {"1": "Low", "2": "Mid", "3": "High"}}, format="json")
    assert cell() == {"value": "4", "display": "Unrated", "state": "legacy"}


def test_each_survey_on_a_page_uses_its_own_labels(client, django_assert_num_queries):
    default = SurveyFactory()
    custom = SurveyFactory(rating_labels=CUSTOM)
    rows = {}
    for survey in (default, custom):
        question = QuestionFactory(survey=survey, order=1)
        response = ResponseFactory(survey=survey)
        Answer.objects.create(response=response, question=question, value="5")
        rows[response.id] = question.id

    with django_assert_num_queries(7):
        results = client.get("/api/feedback-table/").json()["results"]

    displays = {row["survey_id"]: row["answers"][str(rows[row["id"]])]["display"] for row in results}
    assert displays == {default.id: "Great", custom.id: "Awesome"}
    assert Survey.objects.get(pk=custom.pk).rating_labels == CUSTOM
