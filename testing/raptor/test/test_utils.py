import os
import sys
import tempfile
from unittest.mock import patch

import mozunit
import pytest
import yaml

# need this so raptor imports work both from /raptor and via mach
here = os.path.abspath(os.path.dirname(__file__))

raptor_dir = os.path.join(os.path.dirname(here), "raptor")
sys.path.insert(0, raptor_dir)

from utils import bool_from_str, transform_platform, write_yml_file


@pytest.mark.parametrize("platform", ["win", "mac", "linux64"])
def test_transform_platform(platform):
    transformed = transform_platform("mitmproxy-rel-bin-{platform}.manifest", platform)
    assert "{platform}" not in transformed
    if platform == "mac":
        assert "osx" in transformed
    else:
        assert platform in transformed


def test_transform_platform_no_change():
    starting_string = "nothing-in-here-to-transform"
    assert transform_platform(starting_string, "mac") == starting_string


@pytest.mark.parametrize("processor", ["x86_64", "other"])
def test_transform_platform_processor(processor):
    transformed = transform_platform(
        "string-with-processor-{x64}.manifest", "win", processor
    )
    assert "{x64}" not in transformed
    if processor == "x86_64":
        assert "_x64" in transformed


@pytest.mark.parametrize(
    "platform, processor, version",
    [
        ("mac", None, None),
        ("mac", "arm", None),
        ("mac", "arm", "11.0.0"),
        ("mac", None, "11.0.0"),
        ("mac", None, "8.1.1"),
    ],
)
def test_transform_platform_macos_arm(platform, processor, version):
    # For this test assume platform is mac for all
    transformed = transform_platform(
        "mitmproxy-rel-bin-{platform}.manifest", platform, processor, version
    )
    assert "{platform}" not in transformed
    if processor == "arm" and version != "11.0.0":
        assert "osx-arm64" not in transformed
    if processor == "arm" and version == "11.0.0":
        assert "osx-arm64" in transformed
    if not processor and not version:
        # include check for .manifest extension so no ambiguity
        assert "osx.manifest" in transformed
    if not processor and version == "11.0.0":
        # E.g. intel macs using latest mitmproxy
        assert "osx.manifest" in transformed
    if not processor and version != "11.0.0":
        assert "osx.manifest" in transformed


@patch("logger.logger.RaptorLogger.info")
def test_write_yml_file(mock_info):
    yml_file = os.path.join(tempfile.mkdtemp(), "utils.yaml")

    yml_data = dict(args=["--a", "apple", "--b", "banana"], env=dict(LOG_VERBOSE=1))

    assert not os.path.exists(yml_file)
    write_yml_file(yml_file, yml_data)
    assert os.path.exists(yml_file)

    with open(yml_file) as yml_in:
        yml_loaded = yaml.unsafe_load(yml_in)
        assert yml_loaded == yml_data


@pytest.mark.parametrize(
    "value, expected_result",
    [
        ("true", True),
        ("TRUE", True),
        ("True", True),
        ("false", False),
        ("FALSE", False),
        ("False", False),
    ],
)
def test_bool_from_str(value, expected_result):
    assert expected_result == bool_from_str(value)


@pytest.mark.parametrize("invalid_value", ["invalid_str", ""])
def test_bool_from_str_with_invalid_values(invalid_value):
    with pytest.raises(ValueError):
        bool_from_str(invalid_value)


if __name__ == "__main__":
    mozunit.main()
