"""Req 6: a later question shows only when an earlier rating meets a numeric condition."""
import pytest
from rest_framework.test import APIClient

from feedback.conditions import condition_met, hidden_questions
from feedback.models import Answer, Question

from .factories import QuestionFactory, ResponseFactory, SurveyFactory


def question_with(op, threshold, source_id=1):
    return Question(id=99, condition_question_id=source_id, condition_operator=op, condition_value=threshold)


# --- The rule itself ----------------------------------------------------------------


@pytest.mark.parametrize(
    "op, value, met",
    [
        (">", "3", True), (">", "2", False),  # the design's boundary: Q1 > 2
        (">=", "2", True), (">=", "1", False),
        ("<", "1", True), ("<", "2", False),
        ("<=", "2", True), ("<=", "3", False),
        ("=", "2", True), ("=", "3", False),
    ],
)
def test_each_operator(op, value, met):
    assert condition_met(question_with(op, 2), value) is met


def test_unanswered_source_fails():
    assert condition_met(question_with(">", 2), None) is False


def test_legacy_score_is_still_compared():
    assert condition_met(question_with("<", 1), "0") is True


def test_invalid_source_value_fails():
    assert condition_met(question_with(">", 2), "abc") is False


def test_hidden_source_counts_as_unanswered_for_chained_conditions():
    q1 = Question(id=1, type=Question.RATING)
    q2 = Question(id=2, type=Question.RATING, condition_question_id=1, condition_operator=">", condition_value=2)
    q3 = Question(id=3, condition_question_id=2, condition_operator=">", condition_value=0)

    # Q2 has a kept answer of 5, but is hidden because Q1 = 1; so Q3 hides too.
    assert hidden_questions([q1, q2, q3], {1: "1", 2: "5"}) == {2, 3}
    assert hidden_questions([q1, q2, q3], {1: "4", 2: "5"}) == set()


def test_condition_on_an_archived_source_is_switched_off():
    # Q1 is not among the active questions, so Q2's condition does not apply.
    q2 = Question(id=2, condition_question_id=1, condition_operator=">", condition_value=2)

    assert hidden_questions([q2], {}) == set()


# --- API ------------------------------------------------------------------------------

@pytest.fixture
def client():
    return APIClient()


@pytest.fixture
def survey(db):
    survey = SurveyFactory()
    q1 = QuestionFactory(survey=survey, order=1, type=Question.RATING, text="How did we do?")
    q2 = QuestionFactory(survey=survey, order=2, type=Question.COMMENT, text="Anything you would add?")
    return survey, q1, q2


def set_condition(client, question, condition):
    return client.put(f"/api/questions/{question.id}/condition/", {"condition": condition}, format="json")


def show_when_q1_above_2(client, survey):
    _, q1, q2 = survey
    return set_condition(client, q2, {"question_id": q1.id, "operator": ">", "value": 2})


@pytest.mark.django_db
def test_sets_a_condition_and_describes_it(client, survey):
    _, q1, q2 = survey

    body = show_when_q1_above_2(client, survey).json()

    assert body["condition"] == {"question_id": q1.id, "operator": ">", "value": 2, "active": True}
    listed = client.get("/api/surveys/").json()[0]["questions"]
    assert listed[1]["condition"]["active"] is True
    assert listed[0]["condition"] is None


@pytest.mark.django_db
def test_clears_a_condition(client, survey):
    _, _, q2 = survey
    show_when_q1_above_2(client, survey)

    body = set_condition(client, q2, None).json()

    assert body["condition"] is None
    q2.refresh_from_db()
    assert (q2.condition_question_id, q2.condition_operator, q2.condition_value) == (None, "", None)


@pytest.mark.django_db
@pytest.mark.parametrize(
    "make, message",
    [
        # A later rating question as the source (the order rule, not the type rule).
        (lambda q1, q2, later: (q2, {"question_id": later.id, "operator": ">", "value": 2}), "earlier question"),
        # A question cannot depend on itself.
        (lambda q1, q2, later: (q1, {"question_id": q1.id, "operator": ">", "value": 2}), "earlier question"),
        # A comment cannot be a source, even an earlier one.
        (lambda q1, q2, later: (later, {"question_id": q2.id, "operator": ">", "value": 2}), "rating question"),
        (lambda q1, q2, later: (q2, {"question_id": QuestionFactory().id, "operator": ">", "value": 2}),
         "same survey"),
        (lambda q1, q2, later: (q2, {"question_id": q1.id, "operator": "!=", "value": 2}), "Operator"),
        (lambda q1, q2, later: (q2, {"question_id": q1.id, "operator": ">", "value": 11}), "0 to 10"),
    ],
)
def test_rejects_invalid_conditions(client, survey, make, message):
    s, q1, q2 = survey
    later = QuestionFactory(survey=s, order=3, type=Question.RATING)

    target, condition = make(q1, q2, later)
    result = set_condition(client, target, condition)

    assert result.status_code == 400
    assert message in str(result.json())
    target.refresh_from_db()
    assert target.condition_question_id is None


@pytest.mark.django_db
def test_archiving_the_source_switches_the_condition_off(client, survey):
    s, q1, q2 = survey
    show_when_q1_above_2(client, survey)
    response = ResponseFactory(survey=s)  # q1 unanswered: would be hidden

    client.delete(f"/api/questions/{q1.id}/")

    listed = client.get("/api/surveys/").json()[0]["questions"]
    assert listed[0]["condition"] == {"question_id": q1.id, "operator": ">", "value": 2, "active": False}
    row = client.get("/api/feedback-table/").json()["results"][0]
    assert row["id"] == response.id
    assert row["answers"][str(q2.id)]["state"] == "unanswered"


# --- The table ----------------------------------------------------------------------


def table_cell(client, question):
    return client.get("/api/feedback-table/").json()["results"][0]["answers"][str(question.id)]


@pytest.mark.django_db
@pytest.mark.parametrize(
    "q1_value, q2_state",
    [("3", "ok"), ("2", "condition_not_met"), (None, "condition_not_met")],
)
def test_table_shows_both_the_answered_and_the_hidden_shape(client, survey, q1_value, q2_state):
    s, q1, q2 = survey
    show_when_q1_above_2(client, survey)
    response = ResponseFactory(survey=s)
    if q1_value is not None:
        Answer.objects.create(response=response, question=q1, value=q1_value)
    if q2_state == "ok":
        Answer.objects.create(response=response, question=q2, value="Great support")

    assert table_cell(client, q2)["state"] == q2_state


@pytest.mark.django_db
def test_unanswered_is_distinct_from_condition_not_met(client, survey):
    s, q1, q2 = survey
    show_when_q1_above_2(client, survey)
    response = ResponseFactory(survey=s)
    Answer.objects.create(response=response, question=q1, value="4")

    assert table_cell(client, q2)["state"] == "unanswered"


@pytest.mark.django_db
def test_query_count_stays_fixed_with_conditions(client, survey, django_assert_num_queries):
    s, q1, q2 = survey
    show_when_q1_above_2(client, survey)
    for score in ("1", "4", "2", "5"):
        Answer.objects.create(response=ResponseFactory(survey=s), question=q1, value=score)

    with django_assert_num_queries(7):
        body = client.get("/api/feedback-table/").json()

    states = sorted(row["answers"][str(q2.id)]["state"] for row in body["results"])
    assert states == ["condition_not_met", "condition_not_met", "unanswered", "unanswered"]


# --- Submitting and editing ------------------------------------------------------------


def submit(client, survey, answers):
    return client.post(
        f"/api/surveys/{survey.id}/responses/", {"email": "a@example.com", "answers": answers}, format="json"
    )


@pytest.mark.django_db
def test_answering_a_hidden_question_is_rejected(client, survey):
    s, q1, q2 = survey
    show_when_q1_above_2(client, survey)

    result = submit(client, s, {str(q1.id): 2, str(q2.id): "Should not be here"})

    assert result.status_code == 400
    assert "hidden by its condition" in str(result.json()["answers"][str(q2.id)])
    assert not Answer.objects.exists()


@pytest.mark.django_db
def test_answering_a_shown_question_is_accepted(client, survey):
    s, q1, q2 = survey
    show_when_q1_above_2(client, survey)

    assert submit(client, s, {str(q1.id): 3, str(q2.id): "Thanks"}).status_code == 201


@pytest.mark.django_db
def test_re_answering_the_source_keeps_the_hidden_answer_and_can_show_it_again(client, survey):
    s, q1, q2 = survey
    show_when_q1_above_2(client, survey)
    created = submit(client, s, {str(q1.id): 4, str(q2.id): "Quick fix, thanks"}).json()
    edit_url = f"/api/responses/{created['id']}/edit/?token={created['edit_token']}"

    client.put(edit_url, {"answers": {str(q1.id): 1}}, format="json")

    assert Answer.objects.get(question=q2).value == "Quick fix, thanks"  # kept
    assert table_cell(client, q2) == {"value": "Quick fix, thanks", "display": None, "state": "condition_not_met"}

    client.put(edit_url, {"answers": {str(q1.id): 5}}, format="json")

    assert table_cell(client, q2)["display"] == "Quick fix, thanks"


@pytest.mark.django_db
def test_an_edit_cannot_answer_a_question_its_own_change_hides(client, survey):
    s, q1, q2 = survey
    show_when_q1_above_2(client, survey)
    created = submit(client, s, {str(q1.id): 4}).json()

    result = client.put(
        f"/api/responses/{created['id']}/edit/?token={created['edit_token']}",
        {"answers": {str(q1.id): 1, str(q2.id): "Late comment"}},
        format="json",
    )

    assert result.status_code == 400
    assert Answer.objects.get(question=q1).value == "4"
