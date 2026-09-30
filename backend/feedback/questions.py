"""Changing a survey's questions after responses exist (Req 5).

Nothing here deletes data: an archived question or option disappears from
forms and columns, but every answer that used it stays, and the table
resolves those answers against the current settings (docs/PRD.md §6, §11).
"""
from django.core.exceptions import ValidationError
from django.db import transaction
from django.utils import timezone

from .models import Option, Question


def active_questions(survey):
    return Question.objects.filter(survey=survey, archived_at__isnull=True).order_by("order", "id")


@transaction.atomic
def archive_question(question, when=None):
    """Archive a question and move the survey's later questions up.

    Columns are positions (Q1, Q2, ...), so renumbering keeps them free of
    gaps. The archived question keeps its old order and its answers. A
    survey must keep at least one question, or nobody could answer it.
    """
    remaining = list(active_questions(question.survey).select_for_update().exclude(pk=question.pk))
    if not remaining:
        raise ValidationError("A survey needs at least one question; add another before archiving this one.")
    question.archived_at = when or timezone.now()
    question.save(update_fields=["archived_at"])
    moved = []
    for position, other in enumerate(remaining, start=1):
        if other.order != position:
            other.order = position
            moved.append(other)
    Question.objects.bulk_update(moved, ["order"])


@transaction.atomic
def replace_options(question, specs):
    """Make the question's active options exactly `specs`, in that order.

    `specs` is a list of {"label": str} for a new option or {"id": int,
    "label": str} for an existing one (renamed and reordered in place).
    Active options left out are archived, not deleted: old answers still
    point at them and show them as removed.
    """
    if question.type != Question.MULTISELECT:
        raise ValidationError("Only multi-select questions have options.")

    active = {o.id: o for o in question.options.select_for_update().filter(archived_at__isnull=True)}
    ids = [spec["id"] for spec in specs if "id" in spec]
    unknown = sorted(set(ids) - set(active))
    if unknown:
        raise ValidationError(f"Not an active option of this question: {unknown}.")
    if len(set(ids)) != len(ids):
        raise ValidationError("Each option can only be listed once.")

    now = timezone.now()
    for order, spec in enumerate(specs, start=1):
        if "id" in spec:
            option = active[spec["id"]]
            option.label, option.order = spec["label"], order
            option.save(update_fields=["label", "order"])
        else:
            Option.objects.create(question=question, label=spec["label"], order=order)
    Option.objects.filter(id__in=set(active) - set(ids)).update(archived_at=now)
