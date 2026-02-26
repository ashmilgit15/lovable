import importlib
import os
import sys


sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))


def _reload_runtime_security():
    import runtime_security

    return importlib.reload(runtime_security)


def test_untrusted_code_execution_defaults_to_disabled(monkeypatch):
    monkeypatch.delenv("ENABLE_UNTRUSTED_CODE_EXECUTION", raising=False)
    monkeypatch.delenv("CLERK_SECRET_KEY", raising=False)

    runtime_security = _reload_runtime_security()
    assert runtime_security.is_untrusted_code_execution_enabled() is False


def test_untrusted_code_execution_can_be_enabled_explicitly(monkeypatch):
    monkeypatch.setenv("ENABLE_UNTRUSTED_CODE_EXECUTION", "true")

    runtime_security = _reload_runtime_security()
    assert runtime_security.is_untrusted_code_execution_enabled() is True

