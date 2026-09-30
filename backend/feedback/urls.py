from django.urls import path

from . import views

urlpatterns = [
    path("", views.responses_page, name="responses_page"),
    path("api/responses/", views.ResponseListView.as_view(), name="response_list"),
    path("api/feedback-table/", views.FeedbackTableView.as_view(), name="feedback_table"),
    path("api/surveys/", views.SurveyListView.as_view(), name="survey_list"),
    path(
        "api/surveys/<int:survey_id>/rating-labels/",
        views.SurveyRatingLabelsView.as_view(),
        name="survey_rating_labels",
    ),
]
