"""Rating scales: which scores a survey accepts and what each one is called.

A survey stores its labels as `{"1": "Terrible", ...}` in `Survey.rating_labels`,
or null to use the defaults. The keys are the scale: a survey labelled 0-10
accepts 0-10, and stored scores outside it are shown as legacy (docs/PRD.md §7).
"""
from django.core.exceptions import ValidationError

DEFAULT_RATING_LABELS = {1: "Terrible", 2: "Bad", 3: "Okay", 4: "Good", 5: "Great"}

MIN_SCORE = 0
MAX_SCORE = 10
MIN_POINTS = 2
MAX_LABEL_LENGTH = 40


def rating_labels(survey):
    """The survey's labels as {score: label}, ordered by score."""
    if survey.rating_labels is None:
        return dict(DEFAULT_RATING_LABELS)
    return {int(score): label for score, label in sorted(survey.rating_labels.items(), key=lambda kv: int(kv[0]))}


def rating_scale(survey):
    """The scores the survey accepts, lowest first."""
    return list(rating_labels(survey))


def normalize_rating_labels(labels):
    """Validate labels from user input and return them in stored form.

    Accepts a mapping of score (int or numeric string) to label. Returns
    {"1": "Label", ...} with trimmed labels, ordered by score, or raises
    ValidationError describing every problem found.
    """
    if not isinstance(labels, dict):
        raise ValidationError("Rating labels must be an object mapping scores to labels.")

    errors = []
    parsed = {}
    for raw_score, raw_label in labels.items():
        try:
            score = int(str(raw_score))
        except ValueError:
            errors.append(f"{raw_score!r} is not a whole-number score.")
            continue
        if str(score) != str(raw_score).strip():
            errors.append(f"{raw_score!r} is not a whole-number score.")
            continue
        if not MIN_SCORE <= score <= MAX_SCORE:
            errors.append(f"Score {score} is outside {MIN_SCORE}-{MAX_SCORE}.")
            continue
        label = raw_label.strip() if isinstance(raw_label, str) else ""
        if not label:
            errors.append(f"Score {score} needs a label.")
        elif len(label) > MAX_LABEL_LENGTH:
            errors.append(f"The label for score {score} is longer than {MAX_LABEL_LENGTH} characters.")
        parsed[score] = label

    if errors:
        raise ValidationError(errors)

    scores = sorted(parsed)
    if len(scores) < MIN_POINTS:
        raise ValidationError(f"A scale needs at least {MIN_POINTS} scores.")
    if scores != list(range(scores[0], scores[-1] + 1)):
        raise ValidationError("Scores must be consecutive, e.g. 1-5 or 0-10.")
    lowered = [parsed[score].casefold() for score in scores]
    if len(set(lowered)) != len(lowered):
        raise ValidationError("Each score needs a different label.")

    return {str(score): parsed[score] for score in scores}
