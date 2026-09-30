"""Saving a respondent's answers: the first submission and later edits (Req 4).

The API views only parse requests and shape responses; the rules for what a
valid answer is, and how an edit keeps history, live here.
"""
import secrets

from django.core.exceptions import ValidationError
from django.db import transaction
from django.utils import timezone

from .conditions import hidden_questions
from .models import Answer, AnswerRevision, Customer, Question, Response
from .scales import rating_scale
from .validators import parse_selection, serialize_selection, validate_comment, validate_rating, validate_selection


class AnswerErrors(Exception):
    """Validation messages keyed by question id (as a string)."""

    def __init__(self, errors):
        super().__init__(errors)
        self.errors = errors


def clean_answers(survey, raw_answers):
    """Check {question id: value} against the survey's questions.

    A rating is a whole number on the survey's scale, a multi-select answer a
    list of active option ids, a comment non-blank text of at most 2,000
    characters. Returns [(question, value as stored)] or raises AnswerErrors.
    `survey` must have its questions and their options prefetched.
    """
    questions = {str(question.id): question for question in survey.questions.all()}
    scale = rating_scale(survey)
    errors, cleaned = {}, []
    for key, value in raw_answers.items():
        question = questions.get(str(key))
        if question is None:
            errors[str(key)] = ["Not a question of this survey."]
            continue
        try:
            if question.type == Question.RATING:
                # bool is an int subclass; a checkbox value must not pass as 1.
                if type(value) is not int:
                    raise ValidationError("A rating must be a whole number.")
                validate_rating(str(value), range(scale[0], scale[-1] + 1))
                cleaned.append((question, str(value)))
            elif question.type == Question.COMMENT:
                cleaned.append((question, validate_comment(value)))
            else:
                active = {o.id for o in question.options.all() if o.archived_at is None}
                cleaned.append((question, serialize_selection(validate_selection(value, active))))
        except ValidationError as error:
            errors[str(key)] = error.messages
    if errors:
        raise AnswerErrors(errors)
    return cleaned


def check_conditions(survey, cleaned, existing=None):
    """Reject answers to questions hidden by their condition (Req 6).

    `existing` holds a response's saved values when editing: a kept answer to
    a now-hidden question stays, but a new one cannot be sent for it.
    """
    values = dict(existing or {})
    values.update({question.id: value for question, value in cleaned})
    hidden = hidden_questions(survey.questions.all(), values)
    errors = {
        str(question.id): ["This question is hidden by its condition, so it cannot be answered."]
        for question, _ in cleaned
        if question.id in hidden
    }
    if errors:
        raise AnswerErrors(errors)


@transaction.atomic
def create_response(survey, email, name, company, cleaned):
    """Save a new completed response. The customer is matched by email or created."""
    customer = Customer.objects.filter(email__iexact=email).first()
    if customer is None:
        customer = Customer.objects.create(name=name.strip(), email=email, company=company.strip())
    response = Response.objects.create(
        survey=survey,
        customer=customer,
        submitted_at=timezone.now(),
        status=Response.STATUS_COMPLETED,
        edit_token=secrets.token_urlsafe(32),
    )
    Answer.objects.bulk_create(Answer(response=response, question=question, value=value) for question, value in cleaned)
    return response


@transaction.atomic
def edit_response(response, cleaned):
    """Apply re-answers to a response; returns how many answers changed.

    A changed answer keeps its previous value as an AnswerRevision (with the
    time that value was given) before taking the new one. A question answered
    for the first time just gets an answer. Unchanged values, and questions
    left out, are not touched: an edit never removes an answer or its history.
    """
    existing = {answer.question_id: answer for answer in response.answers.select_for_update()}
    changed = 0
    for question, value in cleaned:
        answer = existing.get(question.id)
        if answer is None:
            Answer.objects.create(response=response, question=question, value=value)
            changed += 1
        elif answer.value != value:
            AnswerRevision.objects.create(answer=answer, value=answer.value, answered_at=answer.updated_at)
            answer.value = value
            answer.save(update_fields=["value", "updated_at"])
            changed += 1
    return changed


def token_matches(response, token):
    """Constant-time check of an edit link's token; responses without one cannot be edited."""
    return bool(response.edit_token) and secrets.compare_digest(str(token or ""), response.edit_token)


def answer_as_input(question, value):
    """A stored answer in the shape the respond form sends it back (int, [ids] or text)."""
    if question.type == Question.RATING:
        try:
            return int(value)
        except ValueError:
            return None
    if question.type == Question.MULTISELECT:
        return parse_selection(value)
    return value
