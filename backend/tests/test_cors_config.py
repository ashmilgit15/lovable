from cors_config import DEFAULT_CORS_ORIGINS, load_cors_settings, parse_cors_origins


def test_parse_cors_origins_normalizes_and_deduplicates():
    parsed = parse_cors_origins(
        " https://lovable-rose.vercel.app/ , https://lovable-rose.vercel.app , http://localhost:5173/ "
    )

    assert parsed == ["https://lovable-rose.vercel.app", "http://localhost:5173"]


def test_load_cors_settings_defaults_when_empty(monkeypatch):
    monkeypatch.setenv("CORS_ORIGINS", "")
    monkeypatch.delenv("CORS_ORIGIN_REGEX", raising=False)

    settings = load_cors_settings()

    assert settings.allow_origins == DEFAULT_CORS_ORIGINS
    assert settings.allow_origin_regex is None
    assert settings.allow_credentials is True


def test_load_cors_settings_supports_regex_and_wildcard(monkeypatch):
    monkeypatch.setenv("CORS_ORIGINS", "*")
    monkeypatch.setenv("CORS_ORIGIN_REGEX", r"https://.*\.vercel\.app")

    settings = load_cors_settings()

    assert settings.allow_origins == ["*"]
    assert settings.allow_origin_regex == r"https://.*\.vercel\.app"
    assert settings.allow_credentials is False
