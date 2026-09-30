from rest_framework import serializers

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
