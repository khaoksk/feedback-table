import pytest
from django.core.exceptions import ValidationError

from feedback.validators import parse_selection, serialize_selection, validate_rating, validate_selection


@pytest.mark.parametrize("value", ["1", "3", "5"])
def test_accepts_whole_numbers_on_the_scale(value):
    validate_rating(value)


@pytest.mark.parametrize("value", ["0", "6", "-1"])
def test_rejects_numbers_off_the_scale(value):
    with pytest.raises(ValidationError, match="between 1 and 5"):
        validate_rating(value)


@pytest.mark.parametrize("value", ["", "abc", "3.5", None])
def test_rejects_non_numbers(value):
    with pytest.raises(ValidationError, match="whole number"):
        validate_rating(value)


def test_uses_the_scale_it_is_given():
    validate_rating("7", scale=range(0, 11))
    with pytest.raises(ValidationError, match="between 0 and 10"):
        validate_rating("11", scale=range(0, 11))


# --- Multi-select ------------------------------------------------------------


@pytest.mark.parametrize("value, ids", [([3], [3]), ([3, 7], [3, 7]), ("[7, 3]", [7, 3])])
def test_selection_accepts_known_options_as_list_or_stored_json(value, ids):
    assert validate_selection(value, {3, 7, 9}) == ids


@pytest.mark.parametrize(
    "value, message",
    [
        ([], "at least one"),
        ([3, 3], "only be chosen once"),
        ([3, 42], r"Not an option of this question: \[42\]"),
        (["3"], "by their ids"),
        ([True], "by their ids"),
        ("not json", "by their ids"),
        ("{\"3\": true}", "by their ids"),
        (3, "by their ids"),
    ],
)
def test_selection_rejects_bad_answers(value, message):
    with pytest.raises(ValidationError, match=message):
        validate_selection(value, {3, 7})


def test_selection_is_stored_sorted_and_read_back():
    stored = serialize_selection([7, 3])

    assert stored == "[3, 7]"
    assert parse_selection(stored) == [3, 7]


@pytest.mark.parametrize("stored", ["", "abc", "{}", "[1, \"2\"]", None])
def test_malformed_stored_selection_reads_as_none(stored):
    assert parse_selection(stored) is None
