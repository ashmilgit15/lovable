"""
Security tests for URL reader network guardrails.
"""

import os
import sys

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from tools import _validate_public_fetch_url


def test_validate_public_fetch_url_allows_public_ip():
    _validate_public_fetch_url("https://8.8.8.8")


@pytest.mark.parametrize(
    "url",
    [
        "http://127.0.0.1",
        "http://localhost",
        "http://10.0.0.2",
        "http://192.168.1.30",
        "http://172.16.0.9",
        "http://[::1]",
    ],
)
def test_validate_public_fetch_url_blocks_private_targets(url: str):
    with pytest.raises(RuntimeError):
        _validate_public_fetch_url(url)


def test_validate_public_fetch_url_blocks_non_standard_ports():
    with pytest.raises(RuntimeError):
        _validate_public_fetch_url("https://8.8.8.8:8443/path")
