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


CUSTOM = {1: "Meh", 2: "Rough", 3: "Fine", 4: "Nice", 5: "Awesome"}


def test_rating_uses_the_survey_labels_it_is_given():
    assert resolve_answer(rating(), "4", CUSTOM) == {"value": "4", "display": "Nice", "state": "ok"}


def test_zero_is_a_real_score_on_a_zero_based_scale():
    nps = {score: f"{score}/10" for score in range(0, 11)}

    assert resolve_answer(rating(), "0", nps)["state"] == "ok"


def test_score_outside_a_shrunk_scale_becomes_legacy():
    three_point = {1: "Low", 2: "Mid", 3: "High"}

    assert resolve_answer(rating(), "5", three_point) == {"value": "5", "display": "Unrated", "state": "legacy"}
