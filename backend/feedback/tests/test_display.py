import pytest

from feedback.display import resolve_answer
from feedback.models import Question


def rating():
    return Question(type=Question.RATING)


@pytest.mark.parametrize(
    "value, display",
    [("1", "Terrible"), ("2", "Bad"), ("3", "Okay"), ("4", "Good"), ("5", "Great")],
)
def test_rating_on_the_scale_shows_its_label(value, display):
    assert resolve_answer(rating(), value) == {"value": value, "display": display, "state": "ok"}


@pytest.mark.parametrize("value", ["0", "6", "-2", "10"])
def test_number_off_the_scale_is_legacy(value):
    assert resolve_answer(rating(), value) == {"value": value, "display": "Unrated", "state": "legacy"}


@pytest.mark.parametrize("value", ["", "abc", "4.5", "four"])
def test_non_number_is_invalid_and_keeps_raw_value(value):
    assert resolve_answer(rating(), value) == {"value": value, "display": None, "state": "invalid"}


def test_missing_answer_is_unanswered():
    assert resolve_answer(rating(), None) == {"value": None, "display": None, "state": "unanswered"}
