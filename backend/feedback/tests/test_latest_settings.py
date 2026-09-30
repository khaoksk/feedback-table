"""Req 5: the table always renders from the current questions, options and labels."""
import pytest
from rest_framework.test import APIClient

from feedback.models import Answer, Option, Question, Response

from .factories import OptionFactory, QuestionFactory, ResponseFactory, SurveyFactory

pytestmark = pytest.mark.django_db


@pytest.fixture
def client():
    return APIClient()


def answer(response, question, value):
    return Answer.objects.create(response=response, question=question, value=value)


def row(client, survey):
    return client.get("/api/feedback-table/", {"survey": survey.id}).json()["results"][0]


def archive(client, question):
    return client.delete(f"/api/questions/{question.id}/")


# --- Archiving questions ---------------------------------------------------------


@pytest.fixture
def three_questions():
    survey = SurveyFactory()
    q1 = QuestionFactory(survey=survey, order=1, text="Satisfaction")
    q2 = QuestionFactory(survey=survey, order=2, text="Friendliness")
    q3 = QuestionFactory(survey=survey, order=3, text="Speed")
    response = ResponseFactory(survey=survey)
    for question, value in ((q1, "4"), (q2, "2"), (q3, "5")):
        answer(response, question, value)
    return survey, q1, q2, q3


def test_archiving_moves_later_questions_up(client, three_questions):
    survey, q1, q2, q3 = three_questions

    assert archive(client, q2).status_code == 204

    q2.refresh_from_db()
    q3.refresh_from_db()
    assert q2.archived_at is not None
    assert q2.order == 2  # the archived question keeps its old place
    assert q3.order == 2  # Speed is now Q2
    surveys = client.get("/api/surveys/").json()
    assert [(q["order"], q["text"]) for q in surveys[0]["questions"]] == [(1, "Satisfaction"), (2, "Speed")]


def test_archived_question_leaves_the_table_but_its_answers_stay(client, three_questions):
    survey, q1, q2, q3 = three_questions

    archive(client, q2)

    assert set(row(client, survey)["answers"]) == {str(q1.id), str(q3.id)}
    assert Answer.objects.filter(question=q2).count() == 1


def test_archived_question_cannot_be_answered(client, three_questions):
    survey, _, q2, _ = three_questions
    archive(client, q2)

    result = client.post(
        f"/api/surveys/{survey.id}/responses/", {"email": "a@example.com", "answers": {str(q2.id): 3}}, format="json"
    )

    assert result.status_code == 400
    assert "Not a question of this survey" in str(result.json())


def test_position_filters_follow_the_renumbering(client, three_questions):
    survey, _, q2, _ = three_questions
    archive(client, q2)

    # Q2 is now Speed (answered 5); Friendliness (answered 2) no longer counts.
    assert client.get("/api/feedback-table/", {"rating": 5, "rating_question": 2}).json()["count"] == 1
    assert client.get("/api/feedback-table/", {"rating": 2, "rating_question": 2}).json()["count"] == 0


def test_a_new_question_goes_after_the_active_ones(client, three_questions):
    survey, _, q2, _ = three_questions
    archive(client, q2)

    body = client.post(
        f"/api/surveys/{survey.id}/questions/", {"text": "New", "type": "rating"}, format="json"
    ).json()

    assert body["order"] == 3


def test_the_last_question_cannot_be_archived(client):
    only = QuestionFactory()

    result = archive(client, only)

    assert result.status_code == 400
    assert "at least one question" in str(result.json())
    only.refresh_from_db()
    assert only.archived_at is None


def test_archiving_twice_or_an_unknown_question_is_404(client, three_questions):
    _, _, q2, _ = three_questions
    archive(client, q2)

    assert archive(client, q2).status_code == 404
    assert client.delete("/api/questions/999999/").status_code == 404


def test_edit_link_no_longer_offers_an_archived_question(client, three_questions):
    survey, _, _, _ = three_questions
    ask = QuestionFactory(survey=survey, order=4, text="Temporary")
    created = client.post(
        f"/api/surveys/{survey.id}/responses/", {"email": "a@example.com", "answers": {str(ask.id): 3}}, format="json"
    ).json()
    archive(client, ask)

    loaded = client.get(f"/api/responses/{created['id']}/edit/?token={created['edit_token']}").json()

    assert loaded["answers"] == {}


# --- Editing options ------------------------------------------------------------


@pytest.fixture
def multiselect():
    survey = SurveyFactory()
    QuestionFactory(survey=survey, order=1)
    question = QuestionFactory(survey=survey, order=2, type=Question.MULTISELECT)
    docs = OptionFactory(question=question, label="Docs", order=1)
    slack = OptionFactory(question=question, label="Slack channel", order=2)
    pricing = OptionFactory(question=question, label="Pricing", order=3)
    answer(ResponseFactory(survey=survey), question, f"[{docs.id}, {slack.id}]")
    return survey, question, docs, slack, pricing


def put_options(client, question, options):
    return client.put(f"/api/questions/{question.id}/options/", {"options": options}, format="json")


def test_renaming_an_option_relabels_old_answers(client, multiselect):
    survey, question, docs, slack, pricing = multiselect

    put_options(client, question, [
        {"id": docs.id, "label": "Documentation"},
        {"id": slack.id, "label": "Slack channel"},
        {"id": pricing.id, "label": "Pricing"},
    ])

    cell = row(client, survey)["answers"][str(question.id)]
    assert [s["label"] for s in cell["selections"]] == ["Documentation", "Slack channel"]
    assert cell["state"] == "ok"


def test_removing_an_option_archives_it_and_old_answers_show_it_removed(client, multiselect):
    survey, question, docs, slack, pricing = multiselect

    body = put_options(client, question, [
        {"id": docs.id, "label": "Docs"},
        {"id": pricing.id, "label": "Pricing"},
        {"label": "Kickoff call"},
    ]).json()

    assert [o["label"] for o in body["options"]] == ["Docs", "Pricing", "Kickoff call"]
    slack.refresh_from_db()
    assert slack.archived_at is not None
    cell = row(client, survey)["answers"][str(question.id)]
    assert cell["state"] == "removed_option"
    assert cell["selections"] == [
        {"id": docs.id, "label": "Docs", "removed": False},
        {"id": slack.id, "label": "Slack channel", "removed": True},
    ]


def test_options_follow_the_new_order(client, multiselect):
    _, question, docs, slack, pricing = multiselect

    body = put_options(client, question, [
        {"id": pricing.id, "label": "Pricing"},
        {"id": docs.id, "label": "Docs"},
        {"id": slack.id, "label": "Slack channel"},
    ]).json()

    assert [(o["label"], o["order"]) for o in body["options"]] == [("Pricing", 1), ("Docs", 2), ("Slack channel", 3)]


def test_a_removed_option_can_no_longer_be_chosen(client, multiselect):
    survey, question, docs, slack, pricing = multiselect
    put_options(client, question, [{"id": docs.id, "label": "Docs"}, {"id": pricing.id, "label": "Pricing"}])

    result = client.post(
        f"/api/surveys/{survey.id}/responses/",
        {"email": "a@example.com", "answers": {str(question.id): [slack.id]}},
        format="json",
    )

    assert result.status_code == 400


@pytest.mark.parametrize(
    "make_options, message",
    [
        (lambda d, s, p: [{"id": d.id, "label": "Docs"}], "at least 2"),
        (lambda d, s, p: [{"id": d.id, "label": "Docs"}, {"label": "docs"}], "different label"),
        (lambda d, s, p: [{"id": d.id, "label": "Docs"}, {"id": d.id, "label": "Again"}], "listed once"),
        (lambda d, s, p: [{"id": d.id, "label": "Docs"}, {"id": 999999, "label": "X"}], "Not an active option"),
        (lambda d, s, p: [{"id": d.id, "label": ""}, {"label": "X"}], "blank"),
    ],
)
def test_rejects_bad_option_lists_and_changes_nothing(client, multiselect, make_options, message):
    _, question, docs, slack, pricing = multiselect

    result = put_options(client, question, make_options(docs, slack, pricing))

    assert result.status_code == 400
    assert message in str(result.json())
    assert list(question.options.values_list("label", "archived_at")) == [
        ("Docs", None), ("Slack channel", None), ("Pricing", None),
    ]


def test_options_of_a_rating_question_cannot_be_set(client):
    rating = QuestionFactory(type=Question.RATING)

    result = put_options(client, rating, [{"label": "A"}, {"label": "B"}])

    assert result.status_code == 400
    assert not Option.objects.exists()


# --- Changing the scale ---------------------------------------------------------------


def test_shrinking_the_scale_turns_out_of_range_scores_legacy(client):
    survey = SurveyFactory()
    question = QuestionFactory(survey=survey, order=1)
    answer(ResponseFactory(survey=survey), question, "5")

    client.put(
        f"/api/surveys/{survey.id}/rating-labels/", {"labels": {"1": "Low", "2": "Mid", "3": "High"}}, format="json"
    )

    assert row(client, survey)["answers"][str(question.id)] == {"value": "5", "display": "Unrated", "state": "legacy"}
    assert Answer.objects.get().value == "5"  # nothing rewritten


def test_widening_the_scale_to_zero_to_ten_keeps_old_scores_valid(client):
    survey = SurveyFactory()
    question = QuestionFactory(survey=survey, order=1)
    answer(ResponseFactory(survey=survey), question, "5")

    client.put(
        f"/api/surveys/{survey.id}/rating-labels/",
        {"labels": {str(s): f"{s}/10" for s in range(0, 11)}},
        format="json",
    )

    assert row(client, survey)["answers"][str(question.id)]["display"] == "5/10"
    assert Response.objects.count() == 1
