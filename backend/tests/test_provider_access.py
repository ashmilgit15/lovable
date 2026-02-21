"""
Tests for per-user provider ownership filters.
"""

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from sqlmodel import Session, SQLModel, create_engine, select
from sqlalchemy.pool import StaticPool

from models import ProviderConfig
from provider_access import owned_provider_filter


def _make_session() -> Session:
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    SQLModel.metadata.create_all(engine)
    return Session(engine)


def test_owned_provider_filter_for_named_user():
    with _make_session() as session:
        session.add(
            ProviderConfig(
                owner_id="user_a",
                name="A",
                provider="openrouter",
                model="model-a",
            )
        )
        session.add(
            ProviderConfig(
                owner_id="user_b",
                name="B",
                provider="openrouter",
                model="model-b",
            )
        )
        session.commit()

        providers = session.exec(
            select(ProviderConfig).where(owned_provider_filter("user_a"))
        ).all()
        assert len(providers) == 1
        assert providers[0].owner_id == "user_a"


def test_owned_provider_filter_for_local_user():
    with _make_session() as session:
        session.add(
            ProviderConfig(
                owner_id="local",
                name="Local",
                provider="openrouter",
                model="model-local",
            )
        )
        legacy = ProviderConfig(
            owner_id="legacy-temp",
            name="Legacy",
            provider="openrouter",
            model="model-legacy",
        )
        session.add(legacy)
        session.commit()

        providers = session.exec(
            select(ProviderConfig).where(owned_provider_filter("local"))
        ).all()
        owners = {provider.owner_id for provider in providers}
        assert "local" in owners
        assert "legacy-temp" not in owners
