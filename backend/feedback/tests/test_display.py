import pytest
from django.utils import timezone

from feedback.display import resolve_answer
from feedback.models import Option, Question


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


# --- Multi-select -----------------------------------------------------------


def multiselect():
    return Question(type=Question.MULTISELECT)


def options(*specs):
    """{id: Option} from (id, label, order, archived) tuples."""
    return {
        id_: Option(id=id_, label=label, order=order, archived_at=timezone.now() if archived else None)
        for id_, label, order, archived in specs
    }


DOCS_PRICING = options((3, "Docs", 1, False), (7, "Pricing", 2, False), (9, "Slack channel", 3, True))


def test_selection_shows_current_labels_in_option_order():
    cell = resolve_answer(multiselect(), "[7, 3]", options=DOCS_PRICING)

    assert cell == {
        "value": "[7, 3]",
        "display": "Docs, Pricing",
        "state": "ok",
        "selections": [
            {"id": 3, "label": "Docs", "removed": False},
            {"id": 7, "label": "Pricing", "removed": False},
        ],
    }


def test_renamed_option_shows_its_new_label():
    renamed = options((3, "Documentation", 1, False))

    assert resolve_answer(multiselect(), "[3]", options=renamed)["display"] == "Documentation"


def test_archived_option_is_kept_and_marked_removed():
    cell = resolve_answer(multiselect(), "[3, 9]", options=DOCS_PRICING)

    assert cell["state"] == "removed_option"
    assert cell["selections"][-1] == {"id": 9, "label": "Slack channel", "removed": True}


def test_option_that_no_longer_exists_is_shown_as_unknown():
    cell = resolve_answer(multiselect(), "[3, 404]", options=DOCS_PRICING)

    assert cell["state"] == "removed_option"
    assert cell["selections"][-1] == {"id": 404, "label": "Unknown option", "removed": True}


@pytest.mark.parametrize("stored", ["Docs", "", "{}", "[\"3\"]"])
def test_malformed_selection_is_invalid(stored):
    assert resolve_answer(multiselect(), stored, options=DOCS_PRICING) == {
        "value": stored,
        "display": None,
        "state": "invalid",
    }


def test_rating_answer_never_gets_selections():
    assert "selections" not in resolve_answer(rating(), "4")
