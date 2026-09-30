from io import StringIO

import pytest
from django.core.management import call_command
from django.core.management.base import CommandError

pytestmark = pytest.mark.django_db


def test_prints_a_row_per_scenario():
    call_command("seed_bulk", responses=120, clear=True, stdout=StringIO())
    out = StringIO()

    call_command("time_feedback_table", runs=2, stdout=out)

    lines = out.getvalue().splitlines()
    table = [line for line in lines if line.startswith("| ") and "Scenario" not in line]
    assert len(table) == 8
    assert any(line.startswith("| Last page |") for line in table)
    assert "120 responses" in lines[0]
    # Every scenario hits the endpoint's fixed query budget, not 0 or a stale count.
    query_counts = {line.split("|")[4].strip() for line in table}
    assert query_counts == {"6"}


def test_refuses_to_run_on_an_empty_database():
    with pytest.raises(CommandError, match="seed_bulk"):
        call_command("time_feedback_table", runs=1, stdout=StringIO())
