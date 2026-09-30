"""Req 3: free-text comment questions share Answer.value with ratings."""
import pytest
from django.core.exceptions import ValidationError
from rest_framework.test import APIClient

from feedback.display import resolve_answer
from feedback.models import Answer, Question, Response
from feedback.validators import MAX_COMMENT_LENGTH, validate_comment

from .factories import AnswerFactory, QuestionFactory, ResponseFactory, SurveyFactory


def comment():
    return Question(type=Question.COMMENT)


# --- Validation ---------------------------------------------------------------


def test_comment_is_trimmed():
    assert validate_comment("  Thanks!  \n") == "Thanks!"


def test_comment_may_be_exactly_the_limit():
    assert len(validate_comment("x" * MAX_COMMENT_LENGTH)) == 2000


@pytest.mark.parametrize(
    "value, message",
    [
        ("", "cannot be empty"),
        ("   \n\t", "cannot be empty"),
        ("x" * 2001, "at most 2,000 characters"),
        (5, "must be text"),
        (["a"], "must be text"),
        (None, "must be text"),
    ],
)
def test_comment_rejects_blank_long_or_non_text(value, message):
    with pytest.raises(ValidationError, match=message):
        validate_comment(value)


# --- Display: a comment is never read as a score -----------------------------


@pytest.mark.parametrize("text", ["5", "0", "10/10 would recommend", "บริการดีมาก", "Line one\nLine two"])
def test_comment_is_shown_as_its_text(text):
    assert resolve_answer(comment(), text) == {"value": text, "display": text, "state": "ok"}


def test_same_value_means_a_score_only_on_a_rating_question():
    assert resolve_answer(Question(type=Question.RATING), "5")["display"] == "Great"
    assert resolve_answer(comment(), "5")["display"] == "5"


def test_blank_stored_comment_is_invalid():
    assert resolve_answer(comment(), "  ")["state"] == "invalid"


# --- Model --------------------------------------------------------------------


@pytest.mark.django_db
def test_answer_clean_trims_and_limits_comments():
    answer = AnswerFactory(question__type=Question.COMMENT, value="x")

    answer.value = "  fine  "
    answer.full_clean()
    assert answer.value == "fine"

    answer.value = "x" * 2001
    with pytest.raises(ValidationError) as error:
        answer.full_clean()
    assert "value" in error.value.message_dict


# --- API ------------------------------------------------------------------------


@pytest.mark.django_db
class TestCommentApi:
    @pytest.fixture
    def client(self):
        return APIClient()

    @pytest.fixture
    def survey(self):
        survey = SurveyFactory()
        rating = QuestionFactory(survey=survey, order=1, type=Question.RATING)
        note = QuestionFactory(survey=survey, order=2, type=Question.COMMENT, text="Anything you would add?")
        return survey, rating, note

    def submit(self, client, survey, answers):
        return client.post(
            f"/api/surveys/{survey.id}/responses/",
            {"email": "ada@example.com", "answers": answers},
            format="json",
        )

    def test_creates_a_comment_question(self, client):
        survey = SurveyFactory()

        body = client.post(
            f"/api/surveys/{survey.id}/questions/", {"text": "Anything else?", "type": "comment"}, format="json"
        ).json()

        assert (body["type"], body["options"]) == ("comment", [])

    def test_comment_question_takes_no_options(self, client):
        survey = SurveyFactory()

        result = client.post(
            f"/api/surveys/{survey.id}/questions/",
            {"text": "Q", "type": "comment", "options": ["A", "B"]},
            format="json",
        )

        assert result.status_code == 400
        assert "options" in result.json()

    def test_saves_a_trimmed_comment_next_to_a_rating(self, client, survey):
        survey, rating, note = survey

        result = self.submit(client, survey, {str(rating.id): 5, str(note.id): "  5  "})

        assert result.status_code == 201
        values = {a.question_id: a.value for a in Response.objects.get().answers.all()}
        assert values == {rating.id: "5", note.id: "5"}

    def test_table_shows_the_rating_as_a_score_and_the_comment_as_text(self, client, survey):
        survey, rating, note = survey
        self.submit(client, survey, {str(rating.id): 5, str(note.id): "5"})

        answers = client.get("/api/feedback-table/").json()["results"][0]["answers"]

        assert answers[str(rating.id)]["display"] == "Great"
        assert answers[str(note.id)] == {"value": "5", "display": "5", "state": "ok"}

    @pytest.mark.parametrize(
        "value, message",
        [("", "cannot be empty"), ("x" * 2001, "at most 2,000"), (5, "must be text")],
    )
    def test_rejects_bad_comments_and_saves_nothing(self, client, survey, value, message):
        survey, _, note = survey

        result = self.submit(client, survey, {str(note.id): value})

        assert result.status_code == 400
        assert message in str(result.json()["answers"][str(note.id)])
        assert not Answer.objects.exists()

    def test_long_comment_round_trips_whole(self, client, survey):
        survey, _, note = survey
        text = "Long feedback. " * 130  # ~1,950 characters

        self.submit(client, survey, {str(note.id): text})

        cell = client.get("/api/feedback-table/").json()["results"][0]["answers"][str(note.id)]
        assert cell["display"] == text.strip()


@pytest.mark.django_db
def test_comment_answers_do_not_match_the_rating_filter():
    survey = SurveyFactory()
    note = QuestionFactory(survey=survey, order=1, type=Question.COMMENT)
    response = ResponseFactory(survey=survey)
    Answer.objects.create(response=response, question=note, value="5")

    data = APIClient().get("/api/feedback-table/", {"rating": 5, "rating_question": 1}).json()

    assert data["count"] == 0
