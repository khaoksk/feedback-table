"""Tests for data migrations, run against the throwaway test database.

Each test rolls the schema back to an older migration, inserts rows through the
historical models, then migrates forward and checks the result.
"""
from datetime import datetime, timezone

import pytest
from django.core.management import call_command
from django.db import connection
from django.db.migrations.executor import MigrationExecutor

BEFORE_TIMESTAMPS = [("feedback", "0001_initial")]
TIMESTAMPS_BACKFILLED = [("feedback", "0002_answer_timestamps_unique")]
TIMESTAMPS_REQUIRED = [("feedback", "0003_answer_timestamps_required")]

pytestmark = pytest.mark.django_db(transaction=True)


@pytest.fixture
def migrate_to():
    """Migrate the test database to the given targets and return historical apps.

    Always restores the latest schema afterwards so later tests are unaffected.
    """

    def _migrate(targets):
        executor = MigrationExecutor(connection)
        executor.migrate(targets)
        return executor.loader.project_state(targets).apps

    yield _migrate

    # Rows left behind (e.g. deliberate duplicates) would block migrating forward.
    call_command("flush", verbosity=0, interactive=False)
    executor = MigrationExecutor(connection)
    executor.migrate(executor.loader.graph.leaf_nodes())


def _answer_columns():
    with connection.cursor() as cursor:
        description = connection.introspection.get_table_description(cursor, "feedback_answer")
    return {column.name for column in description}


def _seed_old_schema(apps):
    Customer = apps.get_model("feedback", "Customer")
    Survey = apps.get_model("feedback", "Survey")
    Question = apps.get_model("feedback", "Question")
    Response = apps.get_model("feedback", "Response")

    customer = Customer.objects.create(name="Ada", email="ada@example.com")
    survey = Survey.objects.create(name="CSAT")
    questions = [
        Question.objects.create(survey=survey, text=f"Q{order}", order=order)
        for order in (1, 2)
    ]
    response = Response.objects.create(
        survey=survey,
        customer=customer,
        submitted_at=datetime(2026, 6, 1, 12, 0, tzinfo=timezone.utc),
    )
    return response, questions


def test_existing_answers_get_timestamps_from_their_response(migrate_to):
    old_apps = migrate_to(BEFORE_TIMESTAMPS)
    OldAnswer = old_apps.get_model("feedback", "Answer")
    response, questions = _seed_old_schema(old_apps)
    for question in questions:
        OldAnswer.objects.create(response=response, question=question, value="4")

    new_apps = migrate_to(TIMESTAMPS_REQUIRED)

    Answer = new_apps.get_model("feedback", "Answer")
    answers = list(Answer.objects.all())
    assert len(answers) == 2
    for answer in answers:
        assert answer.created_at == response.submitted_at
        assert answer.updated_at == response.submitted_at


def test_duplicate_answers_stop_the_migration_and_leave_schema_untouched(migrate_to):
    old_apps = migrate_to(BEFORE_TIMESTAMPS)
    OldAnswer = old_apps.get_model("feedback", "Answer")
    response, questions = _seed_old_schema(old_apps)
    OldAnswer.objects.create(response=response, question=questions[0], value="4")
    OldAnswer.objects.create(response=response, question=questions[0], value="5")

    with pytest.raises(RuntimeError, match="Remove the duplicates before migrating"):
        migrate_to(TIMESTAMPS_BACKFILLED)

    # The whole migration ran in one transaction, so the new columns were rolled back.
    assert "created_at" not in _answer_columns()
    assert OldAnswer.objects.count() == 2
