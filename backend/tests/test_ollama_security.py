"""
Validation tests for Ollama model pull input guards.
"""

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from routes.ollama import is_valid_model_name


def test_safe_model_name_accepts_expected_names():
    assert is_valid_model_name("llama3.1")
    assert is_valid_model_name("qwen2.5-coder:7b")
    assert is_valid_model_name("namespace/model-name:latest")


def test_safe_model_name_rejects_dangerous_values():
    assert not is_valid_model_name("../etc/passwd")
    assert not is_valid_model_name("/abs/path-model")
    assert not is_valid_model_name("model;rm -rf /")
    assert not is_valid_model_name("model name with spaces")
