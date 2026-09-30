"""Turn stored answer values into what the feedback table shows.

This is the single place that decides how a value is displayed, so the API,
and anything built on it, never guesses from the raw string. Each answer is
returned as its raw `value`, a human `display` string and a `state` the
frontend styles on (see docs/PRD.md §6).
"""
from .models import Question
from .scales import DEFAULT_RATING_LABELS
from .validators import parse_selection

LEGACY_RATING_LABEL = "Unrated"
UNKNOWN_OPTION_LABEL = "Unknown option"

OK = "ok"
LEGACY = "legacy"
INVALID = "invalid"
UNANSWERED = "unanswered"
REMOVED_OPTION = "removed_option"


def resolve_answer(question, value, rating_labels=DEFAULT_RATING_LABELS, options=None):
    """Resolve one question's answer; `value` is None when it was not answered.

    `rating_labels` is the survey's current {score: label} map
    (scales.rating_labels) and `options` the question's {id: Option} map,
    archived ones included, so renamed labels, changed scales and removed
    options show up immediately for every existing answer.
    """
    if value is None:
        return _cell(None, None, UNANSWERED)
    if question.type == Question.RATING:
        return _resolve_rating(value, rating_labels)
    if question.type == Question.MULTISELECT:
        return _resolve_selection(value, options or {})
    if question.type == Question.COMMENT:
        # Text, whatever it looks like: a comment of "5" is not a score.
        return _cell(value, value, OK) if value.strip() else _cell(value, None, INVALID)
    return _cell(value, value, OK)


def _resolve_selection(value, options):
    ids = parse_selection(value)
    if ids is None:
        return _cell(value, None, INVALID)
    # Show choices in the question's option order; ids that no longer exist go last.
    known = sorted((options[i] for i in ids if i in options), key=lambda o: (o.order, o.id))
    selections = [
        {"id": option.id, "label": option.label, "removed": option.archived_at is not None}
        for option in known
    ] + [{"id": i, "label": UNKNOWN_OPTION_LABEL, "removed": True} for i in ids if i not in options]
    state = REMOVED_OPTION if any(s["removed"] for s in selections) else OK
    cell = _cell(value, ", ".join(s["label"] for s in selections), state)
    cell["selections"] = selections
    return cell


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
