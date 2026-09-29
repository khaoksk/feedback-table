from django.shortcuts import render
from rest_framework.response import Response as ApiResponse
from rest_framework.views import APIView

from .models import Customer, Response, Ticket


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
