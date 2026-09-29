from django.urls import path

from . import views

urlpatterns = [
    path("", views.responses_page, name="responses_page"),
    path("api/responses/", views.ResponseListView.as_view(), name="response_list"),
]
