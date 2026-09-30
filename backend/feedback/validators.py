import json

from django.core.exceptions import ValidationError

from .scales import DEFAULT_RATING_LABELS

# The scale of a survey without custom labels; see scales.rating_scale.
DEFAULT_RATING_SCALE = range(min(DEFAULT_RATING_LABELS), max(DEFAULT_RATING_LABELS) + 1)


def validate_rating(value, scale=DEFAULT_RATING_SCALE):
    """Reject a rating answer that is not a whole number within the scale.

    `value` is the raw string stored in `Answer.value`.
    """
    try:
        score = int(value)
    except (TypeError, ValueError):
        raise ValidationError(f"Rating must be a whole number, got {value!r}.")
    if score not in scale:
        raise ValidationError(
            f"Rating must be between {scale[0]} and {scale[-1]}, got {score}."
        )


MAX_COMMENT_LENGTH = 2000


def validate_comment(value):
    """Reject a comment that is not text, is blank, or is over 2,000 characters.

    Returns the text with surrounding whitespace removed, as it is stored.
    """
    if not isinstance(value, str):
        raise ValidationError("A comment must be text.")
    text = value.strip()
    if not text:
        raise ValidationError("A comment cannot be empty.")
    if len(text) > MAX_COMMENT_LENGTH:
        raise ValidationError(
            f"A comment can be at most {MAX_COMMENT_LENGTH:,} characters (this one has {len(text):,})."
        )
    return text


def parse_selection(value):
    """Read a stored multi-select answer ("[3, 7]") as a list of ids, or None if malformed."""
    try:
        ids = json.loads(value)
    except (TypeError, ValueError):
        return None
    if not isinstance(ids, list) or not all(type(i) is int for i in ids):
        return None
    return ids


def serialize_selection(ids):
    """Store a multi-select answer: sorted, as a JSON list."""
    return json.dumps(sorted(ids))


def validate_selection(value, allowed_ids):
    """Reject a multi-select answer that is empty, repeats an option or names an unknown one.

    `value` is either the stored JSON string or a list of ids from the API.
    Returns the ids.
    """
    ids = parse_selection(value) if isinstance(value, str) else value
    if not isinstance(ids, list) or not all(type(i) is int for i in ids):
        raise ValidationError("Choose options by their ids, e.g. [3, 7].")
    if not ids:
        raise ValidationError("Choose at least one option.")
    if len(set(ids)) != len(ids):
        raise ValidationError("Each option can only be chosen once.")
    unknown = sorted(set(ids) - set(allowed_ids))
    if unknown:
        raise ValidationError(f"Not an option of this question: {unknown}.")
    return ids
