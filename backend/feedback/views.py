from django.db.models import Exists, OuterRef, Prefetch, Q
from django.shortcuts import render
from rest_framework.generics import GenericAPIView
from rest_framework.pagination import PageNumberPagination
from rest_framework.response import Response as ApiResponse
from rest_framework.views import APIView

from .display import resolve_answer
from .models import Answer, Customer, Question, Response, Survey, Ticket
from .serializers import STATUS_ALL, FeedbackTableParamsSerializer


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
    return Survey.objects.order_by("id").prefetch_related(
        Prefetch("questions", queryset=Question.objects.order_by("order", "id"))
    )


def survey_payload(survey):
    return {
        "name": survey.name,
        "questions": [
            {"id": q.id, "order": q.order, "text": q.text, "type": q.type}
            for q in survey.questions.all()
        ],
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


class FeedbackTablePagination(PageNumberPagination):
    page_size = 50
    page_size_query_param = "page_size"
    max_page_size = 100


class FeedbackTableView(GenericAPIView):
    """One row per response, with answers keyed by question id.

    Query count is fixed per page (count, rows, answers, surveys, questions),
    whatever the page size or total number of responses.
    """

    pagination_class = FeedbackTablePagination

    def get(self, request):
        params = FeedbackTableParamsSerializer(data=request.query_params)
        params.is_valid(raise_exception=True)

        page = self.paginate_queryset(self._responses(params.validated_data))
        surveys = self._surveys({response.survey_id for response in page})

        response = self.get_paginated_response(
            [self._row(response, surveys[response.survey_id]) for response in page]
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

    def _row(self, response, survey):
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
                str(question.id): resolve_answer(question, values.get(question.id))
                for question in survey.questions.all()
            },
        }
