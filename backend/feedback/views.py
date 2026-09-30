from django.db.models import Exists, OuterRef, Prefetch, Q
from django.shortcuts import get_object_or_404, render
from rest_framework.generics import GenericAPIView
from rest_framework.pagination import PageNumberPagination
from rest_framework.response import Response as ApiResponse
from rest_framework.views import APIView

from .display import resolve_answer
from .models import Answer, Customer, Question, Response, Survey, Ticket
from .scales import rating_labels
from .serializers import STATUS_ALL, FeedbackTableParamsSerializer, RatingLabelsSerializer


class ResponseListView(APIView):
    def get(self, request):
        rows = []
        for response in Response.objects.all().order_by("-submitted_at"):
            customer = Customer.objects.get(pk=response.customer_id)
            ticket_subject = ""
            if response.ticket_id:
                ticket_subject = Ticket.objects.get(pk=response.ticket_id).subject
            csat = {
                "1": "😖 Terrible",
                "2": "🙁 Bad",
                "3": "😐 Okay",
                "4": "🙂 Good",
                "5": "😀 Great",
            }
            answers = []
            for answer in response.answers.all().order_by("question__order"):
                answers.append({
                    "question": answer.question.text,
                    "rating": csat.get(answer.value, "Unknown"),
                })
            rows.append({
                "id": response.id,
                "customer_name": customer.name,
                "ticket_subject": ticket_subject,
                "status": response.status,
                "submitted_at": response.submitted_at,
                "answers": answers,
            })
        return ApiResponse(rows)


def responses_page(request):
    labels = {"1": "Terrible", "2": "Bad", "3": "Okay", "4": "Good", "5": "Great"}
    rows = []
    for response in Response.objects.all().order_by("-submitted_at"):
        ratings = []
        for answer in response.answers.all().order_by("question__order"):
            ratings.append(labels.get(answer.value, "—"))
        rows.append({
            "response": response,
            "ticket_subject": response.ticket.subject if response.ticket else "—",
            "ratings": ratings,
        })
    return render(request, "feedback/responses.html", {"rows": rows})


def surveys_with_questions():
    # Options include archived ones: old answers still point at them.
    return Survey.objects.order_by("id").prefetch_related(
        Prefetch("questions", queryset=Question.objects.order_by("order", "id")),
        "questions__options",
    )


def question_payload(question):
    return {
        "id": question.id,
        "order": question.order,
        "text": question.text,
        "type": question.type,
        # Only choices a respondent can still pick; archived ones stay out.
        "options": [
            {"id": option.id, "label": option.label, "order": option.order}
            for option in question.options.all()
            if option.archived_at is None
        ],
    }


def survey_payload(survey):
    return {
        "name": survey.name,
        # The scale in score order; `custom_labels` is false when the survey
        # uses the defaults, so the UI can offer "reset to defaults".
        "rating_scale": [
            {"score": score, "label": label} for score, label in rating_labels(survey).items()
        ],
        "custom_labels": survey.rating_labels is not None,
        "questions": [question_payload(question) for question in survey.questions.all()],
    }


class SurveyListView(APIView):
    """Every survey with its questions, for filters and the table's columns.

    The feedback table only describes the surveys on the current page; the UI
    needs all of them to keep columns stable across pages.
    """

    def get(self, request):
        return ApiResponse(
            [{"id": survey.id, **survey_payload(survey)} for survey in surveys_with_questions()]
        )


class SurveyRatingLabelsView(APIView):
    """PUT {"labels": {"1": "Meh", ...}} to set a survey's labels, or null to reset.

    The keys become the survey's scale. Existing answers are not touched: the
    table resolves them against the new labels, and scores outside the new
    scale show as legacy.
    """

    # Auth is out of scope (docs/PRD.md §3). Without this, a browser that is
    # logged into /admin would send its session cookie and DRF would demand a
    # CSRF token that the frontend has no way to obtain.
    authentication_classes = []

    def put(self, request, survey_id):
        survey = get_object_or_404(Survey, pk=survey_id)
        serializer = RatingLabelsSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        survey.rating_labels = serializer.validated_data["labels"]
        survey.save(update_fields=["rating_labels"])

        survey = surveys_with_questions().get(pk=survey.pk)
        return ApiResponse({"id": survey.id, **survey_payload(survey)})


class FeedbackTablePagination(PageNumberPagination):
    page_size = 50
    page_size_query_param = "page_size"
    max_page_size = 100


class FeedbackTableView(GenericAPIView):
    """One row per response, with answers keyed by question id.

    Query count is fixed per page (count, rows, answers, surveys, questions,
    options), whatever the page size or total number of responses.
    """

    pagination_class = FeedbackTablePagination

    def get(self, request):
        params = FeedbackTableParamsSerializer(data=request.query_params)
        params.is_valid(raise_exception=True)

        page = self.paginate_queryset(self._responses(params.validated_data))
        surveys = self._surveys({response.survey_id for response in page})
        labels = {survey_id: rating_labels(survey) for survey_id, survey in surveys.items()}
        options = {
            question.id: {option.id: option for option in question.options.all()}
            for survey in surveys.values()
            for question in survey.questions.all()
        }

        response = self.get_paginated_response(
            [
                self._row(response, surveys[response.survey_id], labels[response.survey_id], options)
                for response in page
            ]
        )
        response.data["surveys"] = {
            str(survey.id): survey_payload(survey) for survey in surveys.values()
        }
        return response

    def _responses(self, params):
        queryset = Response.objects.select_related("customer", "ticket").prefetch_related(
            Prefetch("answers", queryset=Answer.objects.only("id", "response_id", "question_id", "value"))
        )

        if params["status"] != STATUS_ALL:
            queryset = queryset.filter(status=params["status"])
        if "survey" in params:
            queryset = queryset.filter(survey_id=params["survey"])
        if params["ticketless"]:
            queryset = queryset.filter(ticket__isnull=True)
        if params.get("search", "").strip():
            term = params["search"].strip()
            queryset = queryset.filter(
                Q(customer__name__icontains=term) | Q(customer__company__icontains=term)
            )
        if "rating" in params:
            question = (
                {"question_id": params["rating_question"]}
                if "survey" in params
                else {"question__order": params["rating_question"]}
            )
            queryset = queryset.filter(
                Exists(
                    Answer.objects.filter(
                        response=OuterRef("pk"), value=str(params["rating"]), **question
                    )
                )
            )

        # id breaks ties so rows never jump between pages.
        direction = "-" if params["ordering"].startswith("-") else ""
        return queryset.order_by(f"{direction}submitted_at", f"{direction}id")

    def _surveys(self, survey_ids):
        return {survey.id: survey for survey in surveys_with_questions().filter(id__in=survey_ids)}

    def _row(self, response, survey, labels, options):
        values = {answer.question_id: answer.value for answer in response.answers.all()}
        return {
            "id": response.id,
            "submitted_at": response.submitted_at,
            "status": response.status,
            "customer": {
                "name": response.customer.name,
                "email": response.customer.email,
                "company": response.customer.company,
            },
            "ticket": (
                {"id": response.ticket.id, "subject": response.ticket.subject}
                if response.ticket
                else None
            ),
            "survey_id": response.survey_id,
            "answers": {
                str(question.id): resolve_answer(
                    question, values.get(question.id), labels, options[question.id]
                )
                for question in survey.questions.all()
            },
        }
