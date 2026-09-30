import pytest
from rest_framework.test import APIClient

from .factories import QuestionFactory, SurveyFactory

pytestmark = pytest.mark.django_db


def test_lists_every_survey_with_ordered_questions(django_assert_num_queries):
    first = SurveyFactory(name="CSAT")
    q2 = QuestionFactory(survey=first, order=2, text="How fast?")
    q1 = QuestionFactory(survey=first, order=1, text="How satisfied?")
    second = SurveyFactory(name="Onboarding")
    for order in range(1, 4):
        QuestionFactory(survey=second, order=order)

    with django_assert_num_queries(2):  # surveys, questions
        data = APIClient().get("/api/surveys/").json()

    assert [survey["name"] for survey in data] == ["CSAT", "Onboarding"]
    assert data[0] == {
        "id": first.id,
        "name": "CSAT",
        "questions": [
            {"id": q1.id, "order": 1, "text": "How satisfied?", "type": "rating"},
            {"id": q2.id, "order": 2, "text": "How fast?", "type": "rating"},
        ],
    }
    assert [q["order"] for q in data[1]["questions"]] == [1, 2, 3]


def test_empty_when_there_are_no_surveys():
    assert APIClient().get("/api/surveys/").json() == []
