import pytest
from django.core.exceptions import ValidationError

from feedback.validators import validate_rating


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
