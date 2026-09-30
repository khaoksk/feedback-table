from django.core.exceptions import ValidationError
from django.db import models
from django.utils import timezone

from .scales import normalize_rating_labels, rating_scale
from .validators import validate_comment, validate_rating, validate_selection


class Customer(models.Model):
    name = models.CharField(max_length=200)
    email = models.EmailField()
    company = models.CharField(max_length=200, blank=True)

    def __str__(self):
        return self.name


class Ticket(models.Model):
    customer = models.ForeignKey(
        Customer, on_delete=models.CASCADE, related_name="tickets"
    )
    subject = models.CharField(max_length=255)
    created_at = models.DateTimeField()

    def __str__(self):
        return self.subject


class Survey(models.Model):
    name = models.CharField(max_length=200)
    # {"1": "Terrible", ...}; the keys are the survey's scale. Null means the
    # default labels (feedback/scales.py).
    rating_labels = models.JSONField(null=True, blank=True)

    def clean(self):
        if self.rating_labels is not None:
            try:
                self.rating_labels = normalize_rating_labels(self.rating_labels)
            except ValidationError as error:
                raise ValidationError({"rating_labels": error.messages})

    def __str__(self):
        return self.name


class Question(models.Model):
    RATING = "rating"
    MULTISELECT = "multiselect"
    COMMENT = "comment"
    TYPE_CHOICES = [
        (RATING, "Rating"),
        (MULTISELECT, "Multi-select"),
        (COMMENT, "Comment"),
    ]

    survey = models.ForeignKey(
        Survey, on_delete=models.CASCADE, related_name="questions"
    )
    text = models.CharField(max_length=255)
    type = models.CharField(max_length=20, choices=TYPE_CHOICES, default=RATING)
    order = models.PositiveIntegerField(default=1)

    class Meta:
        ordering = ["order"]

    def __str__(self):
        return self.text


class Option(models.Model):
    """One choice of a multi-select question.

    Answers store option ids, not labels, so renaming an option relabels every
    existing answer and archiving one keeps old answers readable (docs/PRD.md §7).
    """

    question = models.ForeignKey(Question, on_delete=models.CASCADE, related_name="options")
    label = models.CharField(max_length=100)
    order = models.PositiveIntegerField(default=1)
    # Set when an option is removed from the question; answers keep pointing at it.
    archived_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["order", "id"]

    def __str__(self):
        return self.label


class Response(models.Model):
    STATUS_DRAFT = "draft"
    STATUS_COMPLETED = "completed"
    STATUS_CHOICES = [
        (STATUS_DRAFT, "Draft"),
        (STATUS_COMPLETED, "Completed"),
    ]

    survey = models.ForeignKey(
        Survey, on_delete=models.CASCADE, related_name="responses"
    )
    customer = models.ForeignKey(
        Customer, on_delete=models.CASCADE, related_name="responses"
    )
    ticket = models.ForeignKey(
        Ticket,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="responses",
    )
    submitted_at = models.DateTimeField()
    status = models.CharField(
        max_length=20, choices=STATUS_CHOICES, default=STATUS_COMPLETED
    )
    # Secret in the respondent's private edit link (Req 4). Null for responses
    # that did not come through the respond page, which cannot be edited.
    edit_token = models.CharField(max_length=64, null=True, blank=True, editable=False)

    class Meta:
        # The feedback table pages through responses newest first, usually
        # filtered by status. Postgres reads either index backwards for DESC.
        indexes = [
            models.Index(fields=["submitted_at", "id"], name="response_submitted_idx"),
            models.Index(
                fields=["status", "submitted_at", "id"],
                name="response_status_submitted_idx",
            ),
        ]

    def __str__(self):
        return f"Response #{self.pk}"


class Answer(models.Model):
    response = models.ForeignKey(
        Response, on_delete=models.CASCADE, related_name="answers"
    )
    question = models.ForeignKey(
        Question, on_delete=models.CASCADE, related_name="answers"
    )
    value = models.TextField()
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["response", "question"],
                name="uniq_answer_response_question",
            ),
        ]

    def clean(self):
        # Runs for the admin and model forms; the write API calls the same
        # validators. bulk_create skips it, so seed_bulk validates explicitly.
        if self.question_id is None:
            return
        try:
            if self.question.type == Question.RATING:
                scale = rating_scale(self.question.survey)
                validate_rating(self.value, range(scale[0], scale[-1] + 1))
            elif self.question.type == Question.MULTISELECT:
                active = self.question.options.filter(archived_at__isnull=True)
                validate_selection(self.value, set(active.values_list("id", flat=True)))
            elif self.question.type == Question.COMMENT:
                self.value = validate_comment(self.value)
        except ValidationError as error:
            raise ValidationError({"value": error.messages})

    def __str__(self):
        return f"Answer #{self.pk}"


class AnswerRevision(models.Model):
    """A value an answer had before the respondent changed it (Req 4).

    The answer itself always holds the latest value; revisions keep every
    earlier one, oldest first, so the table can show the original.
    """

    answer = models.ForeignKey(Answer, on_delete=models.CASCADE, related_name="revisions")
    value = models.TextField()
    # When this value was given (the answer's time before it was replaced).
    answered_at = models.DateTimeField()
    # default rather than auto_now_add: bulk_create (seed_bulk) must be able
    # to set historical times, and auto_now_add would overwrite them.
    replaced_at = models.DateTimeField(default=timezone.now)

    class Meta:
        ordering = ["answered_at", "id"]

    def __str__(self):
        return f"Revision #{self.pk} of answer #{self.answer_id}"
