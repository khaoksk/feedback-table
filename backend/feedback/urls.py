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
    path("api/surveys/<int:survey_id>/questions/", views.SurveyQuestionsView.as_view(), name="survey_questions"),
    path("api/surveys/<int:survey_id>/responses/", views.SurveyResponsesView.as_view(), name="survey_responses"),
    path("api/responses/<int:response_id>/edit/", views.ResponseEditView.as_view(), name="response_edit"),
    path("api/questions/<int:question_id>/", views.QuestionView.as_view(), name="question"),
    path("api/questions/<int:question_id>/options/", views.QuestionOptionsView.as_view(), name="question_options"),
]
