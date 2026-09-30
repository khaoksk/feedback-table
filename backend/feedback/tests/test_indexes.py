"""The feedback table's listing queries must be answerable from an index.

Test tables are tiny, so Postgres would normally pick a sequential or bitmap
scan (neither keeps index order). Turning both off leaves a plain index scan:
if an index matches the filter and the ordering, the plan reads it in order
and needs no separate Sort step.
"""
import pytest
from django.db import connection

from feedback.models import Response

from .factories import ResponseFactory

pytestmark = pytest.mark.django_db


@pytest.fixture
def plan_for():
    ResponseFactory.create_batch(5)
    ResponseFactory.create_batch(2, status=Response.STATUS_DRAFT)
    with connection.cursor() as cursor:
        # Scoped to the test's transaction, so it never leaks into other tests.
        cursor.execute("SET LOCAL enable_seqscan = off")
        cursor.execute("SET LOCAL enable_bitmapscan = off")
    return lambda queryset: queryset.explain()


def test_newest_first_listing_uses_submitted_index(plan_for):
    plan = plan_for(Response.objects.order_by("-submitted_at", "-id")[:50])

    assert "response_submitted_idx" in plan
    assert "Sort" not in plan


def test_status_filtered_listing_uses_status_index(plan_for):
    plan = plan_for(
        Response.objects.filter(status=Response.STATUS_COMPLETED).order_by("-submitted_at", "-id")[:50]
    )

    assert "response_status_submitted_idx" in plan
    assert "Sort" not in plan
