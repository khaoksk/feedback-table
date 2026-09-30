from django.core.exceptions import ValidationError as DjangoValidationError
from django.db import transaction
from django.db.models import Count, Exists, Max, OuterRef, Prefetch, Q
from django.http import Http404
from django.shortcuts import get_object_or_404, render
from rest_framework import status
from rest_framework.exceptions import ValidationError
from rest_framework.generics import GenericAPIView
from rest_framework.pagination import PageNumberPagination
from rest_framework.response import Response as ApiResponse
from rest_framework.views import APIView

from .conditions import condition_active, hidden_questions, set_condition
from .display import resolve_answer
from .models import Answer, AnswerRevision, Customer, Option, Question, Response, Survey, Ticket
from .questions import active_questions, archive_question, replace_options
from .scales import rating_labels
from .serializers import (
    STATUS_ALL,
    ConditionUpdateSerializer,
    FeedbackTableParamsSerializer,
    OptionsUpdateSerializer,
    QuestionCreateSerializer,
    RatingLabelsSerializer,
    ResponseCreateSerializer,
    ResponseEditSerializer,
)
from .submissions import (
    AnswerErrors,
    answer_as_input,
    check_conditions,
    clean_answers,
    create_response,
    edit_response,
    token_matches,
)


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
    # Only active questions: archived ones have left the survey (Req 5).
    return Survey.objects.order_by("id").prefetch_related(
        Prefetch("questions", queryset=Question.objects.filter(archived_at__isnull=True).order_by("order", "id")),
        "questions__options",
    )


def question_payload(question, active_question_ids=None):
    """A question as the API returns it. `active_question_ids` (the survey's active
    questions) tells whether its condition applies; it is looked up when not given.
    """
    if active_question_ids is None:
        active_question_ids = set(active_questions(question.survey).values_list("id", flat=True))
    return {
        "id": question.id,
        "order": question.order,
        "text": question.text,
        "type": question.type,
        # Null without a condition; `active` is false when the source was archived.
        "condition": None if question.condition_question_id is None else {
            "question_id": question.condition_question_id,
            "operator": question.condition_operator,
            "value": question.condition_value,
            "active": condition_active(question, active_question_ids),
        },
        # Only choices a respondent can still pick; archived ones stay out.
        "options": [
            {"id": option.id, "label": option.label, "order": option.order}
            for option in question.options.all()
            if option.archived_at is None
        ],
    }


def survey_payload(survey):
    active_ids = {question.id for question in survey.questions.all()}
    return {
        "name": survey.name,
        # The scale in score order; `custom_labels` is false when the survey
        # uses the defaults, so the UI can offer "reset to defaults".
        "rating_scale": [
            {"score": score, "label": label} for score, label in rating_labels(survey).items()
        ],
        "custom_labels": survey.rating_labels is not None,
        "questions": [question_payload(question, active_ids) for question in survey.questions.all()],
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


class SurveyQuestionsView(APIView):
    """POST {"text", "type": "rating" | "multiselect", "options": [...]} to add a question.

    The question goes last in the survey. Multi-select options keep the order given.
    """

    authentication_classes = []  # see SurveyRatingLabelsView

    def post(self, request, survey_id):
        survey = get_object_or_404(Survey, pk=survey_id)
        serializer = QuestionCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        with transaction.atomic():
            last = active_questions(survey).aggregate(last=Max("order"))["last"] or 0
            question = Question.objects.create(
                survey=survey, text=data["text"], type=data["type"], order=last + 1
            )
            Option.objects.bulk_create(
                Option(question=question, label=label, order=order)
                for order, label in enumerate(data["options"], start=1)
            )

        question = Question.objects.prefetch_related("options").get(pk=question.pk)
        return ApiResponse(question_payload(question), status=status.HTTP_201_CREATED)


class SurveyResponsesView(APIView):
    """POST a respondent's answers: {"email", "name", "company", "answers": {question_id: value}}.

    A rating answer is a score, a multi-select answer a list of option ids,
    a comment answer text (trimmed, at most 2,000 characters).
    Questions may be skipped, but at least one must be answered. The customer
    is matched by email (case-insensitive) or created. The reply carries the
    edit token for the respondent's private edit link (Req 4).
    """

    authentication_classes = []  # see SurveyRatingLabelsView

    def post(self, request, survey_id):
        survey = get_object_or_404(surveys_with_questions(), pk=survey_id)
        serializer = ResponseCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        try:
            cleaned = clean_answers(survey, data["answers"])
            check_conditions(survey, cleaned)
        except AnswerErrors as error:
            raise ValidationError({"answers": error.errors})

        response = create_response(survey, data["email"], data["name"], data["company"], cleaned)
        return ApiResponse({"id": response.id, "edit_token": response.edit_token}, status=status.HTTP_201_CREATED)


class SurveyArchivedQuestionsView(APIView):
    """GET a survey's archived questions, newest first, with how many answers each keeps.

    Archived questions have no column and no form field (Req 5); this is the
    one place the UI can show that they, and their answers, still exist.
    """

    def get(self, request, survey_id):
        survey = get_object_or_404(Survey, pk=survey_id)
        questions = (
            Question.objects.filter(survey=survey, archived_at__isnull=False)
            .annotate(answer_count=Count("answers"))
            .order_by("-archived_at", "-id")
        )
        return ApiResponse([
            {
                "id": question.id,
                "text": question.text,
                "type": question.type,
                "archived_at": question.archived_at,
                "answer_count": question.answer_count,
            }
            for question in questions
        ])


class QuestionView(APIView):
    """DELETE archives a question: it leaves the survey, its answers stay (Req 5)."""

    authentication_classes = []  # see SurveyRatingLabelsView

    def delete(self, request, question_id):
        question = get_object_or_404(Question, pk=question_id, archived_at__isnull=True)
        try:
            archive_question(question)
        except DjangoValidationError as error:
            raise ValidationError({"question": error.messages})
        return ApiResponse(status=status.HTTP_204_NO_CONTENT)


class QuestionConditionView(APIView):
    """PUT {"condition": {"question_id", "operator", "value"}} to show a question only
    when an earlier rating meets it, or {"condition": null} to always show it (Req 6)."""

    authentication_classes = []  # see SurveyRatingLabelsView

    def put(self, request, question_id):
        question = get_object_or_404(Question, pk=question_id, archived_at__isnull=True)
        serializer = ConditionUpdateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        condition = serializer.validated_data["condition"]
        try:
            if condition is None:
                set_condition(question, None, None, None)
            else:
                set_condition(question, condition["question_id"], condition["operator"], condition["value"])
        except DjangoValidationError as error:
            raise ValidationError({"condition": error.messages})
        question = Question.objects.prefetch_related("options").get(pk=question.pk)
        return ApiResponse(question_payload(question))


class QuestionOptionsView(APIView):
    """PUT the full list of a multi-select question's options (Req 5).

    Listed ids are renamed and reordered, new labels added, and active options
    left out archived, so old answers show them as removed.
    """

    authentication_classes = []  # see SurveyRatingLabelsView

    def put(self, request, question_id):
        question = get_object_or_404(Question, pk=question_id, archived_at__isnull=True)
        serializer = OptionsUpdateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        try:
            replace_options(question, serializer.validated_data["options"])
        except DjangoValidationError as error:
            raise ValidationError({"options": error.messages})
        question = Question.objects.prefetch_related("options").get(pk=question.pk)
        return ApiResponse(question_payload(question))


class ResponseEditView(APIView):
    """A respondent's private edit link: GET the response, PUT changed answers.

    Both need ?token=... from the link. A wrong or missing token is a 404, the
    same as a response that does not exist, so ids cannot be probed.
    """

    authentication_classes = []  # see SurveyRatingLabelsView

    def _response(self, request, response_id):
        response = Response.objects.select_related("customer").filter(pk=response_id).first()
        if response is None or not token_matches(response, request.query_params.get("token")):
            raise Http404
        response.survey = surveys_with_questions().get(pk=response.survey_id)
        return response

    def get(self, request, response_id):
        response = self._response(request, response_id)
        questions = {question.id: question for question in response.survey.questions.all()}
        return ApiResponse({
            "id": response.id,
            "survey_id": response.survey_id,
            "customer": {
                "name": response.customer.name,
                "email": response.customer.email,
                "company": response.customer.company,
            },
            "answers": {
                str(answer.question_id): answer_as_input(questions[answer.question_id], answer.value)
                for answer in response.answers.all()
                if answer.question_id in questions
            },
        })

    def put(self, request, response_id):
        response = self._response(request, response_id)
        serializer = ResponseEditSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        try:
            cleaned = clean_answers(response.survey, serializer.validated_data["answers"])
            saved = {answer.question_id: answer.value for answer in response.answers.all()}
            check_conditions(response.survey, cleaned, existing=saved)
        except AnswerErrors as error:
            raise ValidationError({"answers": error.errors})

        return ApiResponse({"id": response.id, "changed": edit_response(response, cleaned)})


class FeedbackTablePagination(PageNumberPagination):
    page_size = 50
    page_size_query_param = "page_size"
    max_page_size = 100


class FeedbackTableView(GenericAPIView):
    """One row per response, with answers keyed by question id.

    Query count is fixed per page (count, rows, answers, answer revisions,
    surveys, questions, options), whatever the page size or total number of
    responses.
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
            Prefetch(
                "answers",
                queryset=Answer.objects.only("id", "response_id", "question_id", "value").prefetch_related(
                    Prefetch(
                        "revisions",
                        queryset=AnswerRevision.objects.only("id", "answer_id", "value", "answered_at"),
                    )
                ),
            )
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
                        response=OuterRef("pk"),
                        value=str(params["rating"]),
                        # Only ratings: a comment of "5" is text, not a score.
                        question__type=Question.RATING,
                        # Positions count active questions only (Req 5).
                        question__archived_at__isnull=True,
                        **question,
                    )
                )
            )

        # id breaks ties so rows never jump between pages.
        direction = "-" if params["ordering"].startswith("-") else ""
        return queryset.order_by(f"{direction}submitted_at", f"{direction}id")

    def _surveys(self, survey_ids):
        return {survey.id: survey for survey in surveys_with_questions().filter(id__in=survey_ids)}

    def _row(self, response, survey, labels, options):
        answers = {answer.question_id: answer for answer in response.answers.all()}
        hidden = hidden_questions(survey.questions.all(), {qid: a.value for qid, a in answers.items()})
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
                str(question.id): (
                    self._hidden_cell(answers.get(question.id))
                    if question.id in hidden
                    else self._cell(question, answers.get(question.id), labels, options[question.id])
                )
                for question in survey.questions.all()
            },
        }

    def _hidden_cell(self, answer):
        # The design's "blank — condition not met". A kept answer (from before
        # the source was re-answered) stays in `value` but is not shown.
        return {"value": answer.value if answer else None, "display": None, "state": "condition_not_met"}

    def _cell(self, question, answer, labels, options):
        cell = resolve_answer(question, answer.value if answer else None, labels, options)
        revisions = list(answer.revisions.all()) if answer else []
        if revisions:
            # The design's "Originally X on DATE", plus how many edits happened
            # since: the first value does not change however often it is edited.
            original = revisions[0]
            cell["edited"] = {
                "original_value": original.value,
                "original_display": resolve_answer(question, original.value, labels, options)["display"],
                "original_at": original.answered_at,
                "edit_count": len(revisions),
            }
        return cell
