import pytest
from django.db import IntegrityError, transaction

from feedback.models import Answer

from .factories import AnswerFactory, ResponseFactory

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
