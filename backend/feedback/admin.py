from django.contrib import admin

from .models import Answer, Customer, Question, Response, Survey, Ticket


@admin.register(Customer)
class CustomerAdmin(admin.ModelAdmin):
    list_display = ("id", "name", "email", "company")
    search_fields = ("name", "email", "company")


@admin.register(Ticket)
class TicketAdmin(admin.ModelAdmin):
    list_display = ("id", "subject", "customer", "created_at")
    search_fields = ("subject",)


class QuestionInline(admin.TabularInline):
    model = Question
    extra = 0


@admin.register(Survey)
class SurveyAdmin(admin.ModelAdmin):
    list_display = ("id", "name")
    inlines = [QuestionInline]


@admin.register(Question)
class QuestionAdmin(admin.ModelAdmin):
    list_display = ("id", "text", "survey", "type", "order")
    list_filter = ("type", "survey")


class AnswerInline(admin.TabularInline):
    model = Answer
    extra = 0


@admin.register(Response)
class ResponseAdmin(admin.ModelAdmin):
    list_display = ("id", "survey", "customer", "ticket", "status", "submitted_at")
    list_filter = ("status", "survey")
    inlines = [AnswerInline]


@admin.register(Answer)
class AnswerAdmin(admin.ModelAdmin):
    list_display = ("id", "response", "question", "display_value")

    def display_value(self, answer):
        labels = {"1": "Terrible", "2": "Bad", "3": "Okay", "4": "Good", "5": "Great"}
        return labels.get(answer.value, answer.value)

    display_value.short_description = "value"
