"""Req 4: respondents re-answer through a private edit link; the table shows the latest value."""
import json

import pytest
from rest_framework.test import APIClient

from feedback.models import Answer, AnswerRevision, Question, Response

from .factories import OptionFactory, QuestionFactory, ResponseFactory, SurveyFactory

pytestmark = pytest.mark.django_db


@pytest.fixture
def client():
    return APIClient()


@pytest.fixture
def survey():
    survey = SurveyFactory(rating_labels={"1": "Meh", "2": "Rough", "3": "Fine", "4": "Nice", "5": "Awesome"})
    rating = QuestionFactory(survey=survey, order=1, type=Question.RATING)
    pick = QuestionFactory(survey=survey, order=2, type=Question.MULTISELECT)
    docs = OptionFactory(question=pick, label="Docs", order=1)
    pricing = OptionFactory(question=pick, label="Pricing", order=2)
    note = QuestionFactory(survey=survey, order=3, type=Question.COMMENT)
    return {"survey": survey, "rating": rating, "pick": pick, "docs": docs, "pricing": pricing, "note": note}


def submit(client, s, answers):
    result = client.post(
        f"/api/surveys/{s['survey'].id}/responses/", {"email": "ada@example.com", "answers": answers}, format="json"
    )
    assert result.status_code == 201, result.json()
    return result.json()


def edit_url(response_id, token):
    return f"/api/responses/{response_id}/edit/?token={token}"


def edit(client, created, answers):
    return client.put(edit_url(created["id"], created["edit_token"]), {"answers": answers}, format="json")


def cell(client, s, question):
    row = client.get("/api/feedback-table/", {"survey": s["survey"].id}).json()["results"][0]
    return row["answers"][str(question.id)]


# --- The edit link --------------------------------------------------------------


def test_new_responses_get_a_long_unique_edit_token(client, survey):
    first = submit(client, survey, {str(survey["rating"].id): 2})
    second = submit(client, survey, {str(survey["rating"].id): 2})

    assert len(first["edit_token"]) >= 40
    assert first["edit_token"] != second["edit_token"]


def test_edit_link_returns_answers_in_the_shape_the_form_sends(client, survey):
    created = submit(client, survey, {
        str(survey["rating"].id): 2,
        str(survey["pick"].id): [survey["pricing"].id, survey["docs"].id],
        str(survey["note"].id): " Slow start ",
    })

    body = client.get(edit_url(created["id"], created["edit_token"])).json()

    assert body["survey_id"] == survey["survey"].id
    assert body["customer"]["email"] == "ada@example.com"
    assert body["answers"] == {
        str(survey["rating"].id): 2,
        str(survey["pick"].id): sorted([survey["docs"].id, survey["pricing"].id]),
        str(survey["note"].id): "Slow start",
    }


@pytest.mark.parametrize("token", ["wrong", "", None])
def test_wrong_or_missing_token_looks_like_a_missing_response(client, survey, token):
    created = submit(client, survey, {str(survey["rating"].id): 2})
    url = f"/api/responses/{created['id']}/edit/" + ("" if token is None else f"?token={token}")

    assert client.get(url).status_code == 404
    assert client.put(url, {"answers": {str(survey["rating"].id): 5}}, format="json").status_code == 404
    assert Answer.objects.get().value == "2"


def test_responses_without_a_token_cannot_be_edited(client):
    seeded = ResponseFactory()  # like seed data: no edit_token

    assert client.get(f"/api/responses/{seeded.id}/edit/?token=").status_code == 404
    assert client.get(f"/api/responses/{seeded.id}/edit/?token=None").status_code == 404


def test_unknown_response_is_404(client):
    assert client.get("/api/responses/999999/edit/?token=abc").status_code == 404


# --- Editing ----------------------------------------------------------------------


def test_changing_an_answer_keeps_the_old_value_as_a_revision(client, survey):
    created = submit(client, survey, {str(survey["rating"].id): 2})
    before = Answer.objects.get()

    result = edit(client, created, {str(survey["rating"].id): 5})

    assert result.json() == {"id": created["id"], "changed": 1}
    answer = Answer.objects.get()
    assert answer.value == "5"
    assert answer.updated_at > before.updated_at
    revision = AnswerRevision.objects.get()
    assert (revision.answer, revision.value, revision.answered_at) == (answer, "2", before.updated_at)


def test_resubmitting_the_same_values_changes_nothing(client, survey):
    created = submit(client, survey, {
        str(survey["rating"].id): 2,
        str(survey["pick"].id): [survey["docs"].id, survey["pricing"].id],
    })

    # Same selection in another order is the same answer.
    result = edit(client, created, {
        str(survey["rating"].id): 2,
        str(survey["pick"].id): [survey["pricing"].id, survey["docs"].id],
    })

    assert result.json()["changed"] == 0
    assert not AnswerRevision.objects.exists()


def test_a_skipped_question_can_be_answered_later_without_a_revision(client, survey):
    created = submit(client, survey, {str(survey["rating"].id): 2})

    edit(client, created, {str(survey["note"].id): "Fixed now, thanks"})

    assert Answer.objects.get(question=survey["note"]).value == "Fixed now, thanks"
    assert not AnswerRevision.objects.exists()


def test_questions_left_out_of_an_edit_keep_their_answer(client, survey):
    created = submit(client, survey, {str(survey["rating"].id): 2, str(survey["note"].id): "Slow"})

    edit(client, created, {str(survey["rating"].id): 4})

    assert Answer.objects.get(question=survey["note"]).value == "Slow"


def test_an_invalid_edit_changes_nothing(client, survey):
    created = submit(client, survey, {str(survey["rating"].id): 2, str(survey["note"].id): "Slow"})

    result = edit(client, created, {str(survey["rating"].id): 4, str(survey["note"].id): ""})

    assert result.status_code == 400
    assert "cannot be empty" in json.dumps(result.json()["answers"])
    assert Answer.objects.get(question=survey["rating"]).value == "2"
    assert not AnswerRevision.objects.exists()


def test_an_edit_needs_at_least_one_answer(client, survey):
    created = submit(client, survey, {str(survey["rating"].id): 2})

    assert edit(client, created, {}).status_code == 400


def test_edit_does_not_create_a_new_response(client, survey):
    created = submit(client, survey, {str(survey["rating"].id): 2})

    edit(client, created, {str(survey["rating"].id): 4})

    assert Response.objects.count() == 1


# --- The table ----------------------------------------------------------------------


def test_table_shows_the_latest_value_with_the_original_and_edit_count(client, survey):
    created = submit(client, survey, {str(survey["rating"].id): 2})
    original_at = Answer.objects.get().updated_at
    edit(client, created, {str(survey["rating"].id): 3})
    edit(client, created, {str(survey["rating"].id): 5})

    result = cell(client, survey, survey["rating"])

    assert (result["value"], result["display"], result["state"]) == ("5", "Awesome", "ok")
    assert result["edited"] == {
        "original_value": "2",
        # The original is shown with the survey's current labels.
        "original_display": "Rough",
        "original_at": original_at.isoformat().replace("+00:00", "Z"),
        "edit_count": 2,
    }


def test_original_of_an_edited_selection_uses_current_option_labels(client, survey):
    created = submit(client, survey, {str(survey["pick"].id): [survey["docs"].id]})
    edit(client, created, {str(survey["pick"].id): [survey["pricing"].id]})
    survey["docs"].label = "Documentation"
    survey["docs"].save()

    result = cell(client, survey, survey["pick"])

    assert result["display"] == "Pricing"
    assert result["edited"]["original_display"] == "Documentation"


def test_answers_never_edited_have_no_edited_block(client, survey):
    submit(client, survey, {str(survey["rating"].id): 2})

    assert "edited" not in cell(client, survey, survey["rating"])


def test_query_count_stays_fixed_with_edited_answers(client, survey, django_assert_num_queries):
    for _ in range(12):
        created = submit(client, survey, {str(survey["rating"].id): 1, str(survey["note"].id): "a"})
        edit(client, created, {str(survey["rating"].id): 2, str(survey["note"].id): "b"})
        edit(client, created, {str(survey["rating"].id): 3})

    # count, rows, answers, revisions, surveys, questions, options
    with django_assert_num_queries(7):
        small = client.get("/api/feedback-table/", {"page_size": 3}).json()
    with django_assert_num_queries(7):
        large = client.get("/api/feedback-table/", {"page_size": 12}).json()

    assert len(small["results"]) == 3
    assert all(row["answers"][str(survey["rating"].id)]["edited"]["edit_count"] == 2 for row in large["results"])
