import factory
from django.utils import timezone
from factory.django import DjangoModelFactory

from feedback.models import Answer, Customer, Question, Response, Survey, Ticket


class CustomerFactory(DjangoModelFactory):
    class Meta:
        model = Customer

    name = factory.Faker("name")
    email = factory.Faker("email")
    company = factory.Faker("company")


class TicketFactory(DjangoModelFactory):
    class Meta:
        model = Ticket

    customer = factory.SubFactory(CustomerFactory)
    subject = factory.Faker("sentence", nb_words=4)
    created_at = factory.LazyFunction(timezone.now)


class SurveyFactory(DjangoModelFactory):
    class Meta:
        model = Survey

    name = factory.Sequence(lambda n: f"Survey {n}")


class QuestionFactory(DjangoModelFactory):
    class Meta:
        model = Question

    survey = factory.SubFactory(SurveyFactory)
    text = factory.Faker("sentence", nb_words=6)
    type = Question.RATING
    order = factory.Sequence(lambda n: n + 1)


class ResponseFactory(DjangoModelFactory):
    class Meta:
        model = Response

    survey = factory.SubFactory(SurveyFactory)
    customer = factory.SubFactory(CustomerFactory)
    ticket = None
    submitted_at = factory.LazyFunction(timezone.now)
    status = Response.STATUS_COMPLETED


class AnswerFactory(DjangoModelFactory):
    class Meta:
        model = Answer

    response = factory.SubFactory(ResponseFactory)
    # Keep the question inside the response's survey, as real data does.
    question = factory.SubFactory(
        QuestionFactory, survey=factory.SelfAttribute("..response.survey")
    )
    value = "4"
