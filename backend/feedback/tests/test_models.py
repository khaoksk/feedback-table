import pytest
from django.core.exceptions import ValidationError
from django.db import IntegrityError, transaction

from feedback.models import Answer

from .factories import AnswerFactory, ResponseFactory, SurveyFactory

pytestmark = pytest.mark.django_db


def test_answer_gets_timestamps_on_create():
    answer = AnswerFactory()

    assert answer.created_at is not None
    assert answer.updated_at is not None


def test_saving_again_moves_updated_at_but_not_created_at():
    answer = AnswerFactory()
    created_at, updated_at = answer.created_at, answer.updated_at

    answer.value = "5"
    answer.save()
    answer.refresh_from_db()

    assert answer.created_at == created_at
    assert answer.updated_at > updated_at


def test_second_answer_to_same_question_in_same_response_is_rejected():
    answer = AnswerFactory()

    with pytest.raises(IntegrityError, match="uniq_answer_response_question"):
        with transaction.atomic():
            Answer.objects.create(
                response=answer.response, question=answer.question, value="2"
            )


def test_same_question_can_be_answered_in_different_responses():
    answer = AnswerFactory()
    other_response = ResponseFactory(survey=answer.response.survey)

    Answer.objects.create(response=other_response, question=answer.question, value="2")

    assert Answer.objects.filter(question=answer.question).count() == 2


# --- Validation (full_clean runs for the admin and model forms) ------------


def test_survey_normalises_valid_labels_on_clean():
    survey = SurveyFactory.build(rating_labels={2: " Rough ", 1: "Meh"})

    survey.full_clean()

    assert survey.rating_labels == {"1": "Meh", "2": "Rough"}


def test_survey_rejects_invalid_labels_on_clean():
    survey = SurveyFactory.build(rating_labels={"1": "Meh", "3": "Fine"})

    with pytest.raises(ValidationError) as error:
        survey.full_clean()

    assert "rating_labels" in error.value.message_dict


@pytest.mark.parametrize(
    "labels, value, valid",
    [
        (None, "5", True),
        (None, "6", False),
        (None, "abc", False),
        ({str(score): f"S{score}" for score in range(0, 11)}, "0", True),
        ({str(score): f"S{score}" for score in range(0, 11)}, "10", True),
        ({"1": "Low", "2": "Mid", "3": "High"}, "4", False),
    ],
)
def test_answer_rating_is_checked_against_its_survey_scale(labels, value, valid):
    answer = AnswerFactory(response__survey__rating_labels=labels)
    answer.value = value

    if valid:
        answer.full_clean()
    else:
        with pytest.raises(ValidationError) as error:
            answer.full_clean()
        assert "value" in error.value.message_dict
