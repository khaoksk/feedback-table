from django.core.exceptions import ValidationError as DjangoValidationError
from rest_framework import serializers

from .scales import normalize_rating_labels

STATUS_ALL = "all"


class FeedbackTableParamsSerializer(serializers.Serializer):
    """Query parameters accepted by GET /api/feedback-table/."""

    survey = serializers.IntegerField(required=False, min_value=1)
    status = serializers.ChoiceField(
        choices=["completed", "draft", STATUS_ALL], default="completed"
    )
    ticketless = serializers.BooleanField(required=False, default=False)
    search = serializers.CharField(required=False, allow_blank=True, max_length=200)
    rating = serializers.IntegerField(required=False)
    # A question id when `survey` is given, otherwise a question position
    # (1 = Q1) applied across every survey.
    rating_question = serializers.IntegerField(required=False, min_value=1)
    ordering = serializers.ChoiceField(
        choices=["-submitted_at", "submitted_at"], default="-submitted_at"
    )

    def validate(self, attrs):
        if ("rating" in attrs) != ("rating_question" in attrs):
            raise serializers.ValidationError(
                "rating and rating_question must be given together."
            )
        return attrs


class RatingLabelsSerializer(serializers.Serializer):
    """Body of PUT /api/surveys/<id>/rating-labels/."""

    labels = serializers.JSONField(allow_null=True)

    def validate_labels(self, value):
        if value is None:
            return None
        try:
            return normalize_rating_labels(value)
        except DjangoValidationError as error:
            raise serializers.ValidationError(error.messages)


class QuestionCreateSerializer(serializers.Serializer):
    """Body of POST /api/surveys/<id>/questions/."""

    text = serializers.CharField(max_length=255)
    type = serializers.ChoiceField(choices=["rating", "multiselect", "comment"])
    options = serializers.ListField(
        child=serializers.CharField(max_length=100), required=False, default=list
    )

    def validate(self, attrs):
        options = attrs["options"]
        if attrs["type"] == "rating":
            if options:
                raise serializers.ValidationError(
                    {"options": "Rating questions use the survey's scale, not options."}
                )
            return attrs
        if attrs["type"] == "comment":
            if options:
                raise serializers.ValidationError({"options": "Comment questions take free text, not options."})
            return attrs
        if len(options) < 2:
            raise serializers.ValidationError({"options": "A multi-select question needs at least 2 options."})
        folded = [option.casefold() for option in options]
        if len(set(folded)) != len(folded):
            raise serializers.ValidationError({"options": "Each option needs a different label."})
        return attrs


class ResponseCreateSerializer(serializers.Serializer):
    """Body of POST /api/surveys/<id>/responses/.

    `answers` maps question id to a score (rating), a list of option ids
    (multi-select) or text (comment); the view checks them against the survey's questions.
    """

    name = serializers.CharField(max_length=200, required=False, allow_blank=True, default="")
    email = serializers.EmailField()
    company = serializers.CharField(max_length=200, required=False, allow_blank=True, default="")
    answers = serializers.DictField(child=serializers.JSONField(), allow_empty=False)
