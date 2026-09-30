"""Turn stored answer values into what the feedback table shows.

This is the single place that decides how a value is displayed, so the API,
and anything built on it, never guesses from the raw string. Each answer is
returned as its raw `value`, a human `display` string and a `state` the
frontend styles on (see docs/PRD.md §6).
"""
from .models import Question
from .scales import DEFAULT_RATING_LABELS

LEGACY_RATING_LABEL = "Unrated"

OK = "ok"
LEGACY = "legacy"
INVALID = "invalid"
UNANSWERED = "unanswered"


def resolve_answer(question, value, rating_labels=DEFAULT_RATING_LABELS):
    """Resolve one question's answer; `value` is None when it was not answered.

    `rating_labels` is the survey's current {score: label} map
    (scales.rating_labels), so renamed labels and changed scales show up
    immediately for every existing answer.
    """
    if value is None:
        return _cell(None, None, UNANSWERED)
    if question.type == Question.RATING:
        return _resolve_rating(value, rating_labels)
    return _cell(value, value, OK)


def _resolve_rating(value, labels):
    try:
        score = int(value)
    except (TypeError, ValueError):
        return _cell(value, None, INVALID)
    if score not in labels:
        # A number from an older or different scale, e.g. the seeded "0".
        return _cell(value, LEGACY_RATING_LABEL, LEGACY)
    return _cell(value, labels[score], OK)


def _cell(value, display, state):
    return {"value": value, "display": display, "state": state}
