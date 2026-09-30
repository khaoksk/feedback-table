"""Conditional display (Req 6): a question shows only when an earlier rating meets a condition.

A question stores its condition as (source question, operator, threshold),
e.g. "show when Q1 > 2". The rules, from docs/PRD.md §11:

- the source must be an earlier, active rating question of the same survey;
- a source that was archived switches the condition off (the question always shows);
- an unanswered source fails the condition; a legacy score is still a number
  and is compared; an invalid value fails;
- a question hidden by its condition counts as unanswered for later conditions.
"""
import operator

from django.core.exceptions import ValidationError

from .models import Question

OPERATORS = {
    ">": operator.gt,
    ">=": operator.ge,
    "<": operator.lt,
    "<=": operator.le,
    "=": operator.eq,
}
THRESHOLD_RANGE = range(0, 11)


def condition_active(question, active_question_ids):
    """Whether the question has a condition that currently applies."""
    return question.condition_question_id is not None and question.condition_question_id in active_question_ids


def condition_met(question, source_value):
    if source_value is None:
        return False
    try:
        score = int(source_value)
    except (TypeError, ValueError):
        return False
    return OPERATORS[question.condition_operator](score, question.condition_value)


def hidden_questions(questions, values):
    """Ids of the questions hidden by their condition.

    `questions` are the survey's active questions in order; `values` maps
    question id to the stored answer value. A hidden question's own answer
    does not count, so conditions that chain stay consistent.
    """
    questions = list(questions)
    active_ids = {q.id for q in questions}
    hidden = set()
    for question in questions:
        if not condition_active(question, active_ids):
            continue
        source_value = None if question.condition_question_id in hidden else values.get(question.condition_question_id)
        if not condition_met(question, source_value):
            hidden.add(question.id)
    return hidden


def set_condition(question, source_id, op, threshold):
    """Set or (with source_id None) clear a question's condition, after checking it."""
    if source_id is None:
        question.condition_question, question.condition_operator, question.condition_value = None, "", None
        question.save(update_fields=["condition_question", "condition_operator", "condition_value"])
        return

    source = Question.objects.filter(pk=source_id).first()
    if source is None or source.survey_id != question.survey_id or source.archived_at is not None:
        raise ValidationError("The condition must depend on an active question of the same survey.")
    if source.type != Question.RATING:
        raise ValidationError("A condition can only depend on a rating question.")
    if source.order >= question.order:
        raise ValidationError("A condition can only depend on an earlier question.")
    if op not in OPERATORS:
        raise ValidationError(f"Operator must be one of {', '.join(OPERATORS)}.")
    if threshold not in THRESHOLD_RANGE:
        raise ValidationError("The threshold must be a whole number from 0 to 10.")

    question.condition_question, question.condition_operator, question.condition_value = source, op, threshold
    question.save(update_fields=["condition_question", "condition_operator", "condition_value"])
