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
