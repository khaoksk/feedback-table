import pytest
from django.core.exceptions import ValidationError

from feedback.models import Survey
from feedback.scales import DEFAULT_RATING_LABELS, normalize_rating_labels, rating_labels, rating_scale


def test_survey_without_custom_labels_uses_the_defaults():
    survey = Survey(rating_labels=None)

    assert rating_labels(survey) == DEFAULT_RATING_LABELS
    assert rating_scale(survey) == [1, 2, 3, 4, 5]


def test_custom_labels_are_read_by_score_in_order():
    survey = Survey(rating_labels={"10": "Top", "2": "Low", "9": "High", "3": "Mid"})

    # Stored keys are strings; "10" must sort after "9", not after "1".
    assert rating_labels(survey) == {2: "Low", 3: "Mid", 9: "High", 10: "Top"}


def test_normalize_trims_orders_and_stringifies_scores():
    assert normalize_rating_labels({3: " Fine ", "1": "Meh", "2": "Rough"}) == {
        "1": "Meh",
        "2": "Rough",
        "3": "Fine",
    }


def test_normalize_accepts_a_zero_to_ten_scale():
    labels = {score: f"Score {score}" for score in range(0, 11)}

    assert list(normalize_rating_labels(labels)) == [str(score) for score in range(0, 11)]


@pytest.mark.parametrize(
    "labels, message",
    [
        ([["1", "Meh"]], "must be an object"),
        ({"1": "Only one"}, "at least 2 scores"),
        ({"1": "Meh", "3": "Fine"}, "consecutive"),
        ({"one": "Meh", "2": "Rough"}, "not a whole-number score"),
        ({"1.5": "Meh", "2": "Rough"}, "not a whole-number score"),
        ({"-1": "Meh", "0": "Rough"}, "outside 0-10"),
        ({"10": "Meh", "11": "Rough"}, "outside 0-10"),
        ({"1": "  ", "2": "Rough"}, "Score 1 needs a label"),
        ({"1": None, "2": "Rough"}, "Score 1 needs a label"),
        ({"1": "x" * 41, "2": "Rough"}, "longer than 40"),
        ({"1": "Good", "2": "good"}, "different label"),
    ],
)
def test_normalize_rejects_bad_labels(labels, message):
    with pytest.raises(ValidationError, match=message):
        normalize_rating_labels(labels)


def test_normalize_reports_every_problem_at_once():
    with pytest.raises(ValidationError) as error:
        normalize_rating_labels({"1": "", "2": "", "3": "Fine"})

    assert error.value.messages == ["Score 1 needs a label.", "Score 2 needs a label."]
