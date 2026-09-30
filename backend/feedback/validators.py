from django.core.exceptions import ValidationError

# Until surveys define their own labels (Req 1), every rating uses this scale.
DEFAULT_RATING_SCALE = range(1, 6)


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
