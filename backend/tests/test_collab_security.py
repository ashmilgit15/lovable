"""
Security tests for collaboration room ownership behavior.
"""

import os
import sys

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from collab import CollaborationManager


class _DummyWebSocket:
    async def send_json(self, _payload):
        return None


@pytest.mark.asyncio
async def test_join_room_does_not_allow_owner_takeover_on_rejoin():
    manager = CollaborationManager()
    owner_ws = _DummyWebSocket()
    attacker_ws = _DummyWebSocket()

    room = await manager.join_room(
        project_id="project-1",
        user_id="owner-user",
        username="Owner",
        websocket=owner_ws,
    )
    assert room.owner_id == "owner-user"

    room = await manager.join_room(
        project_id="project-1",
        user_id="attacker-user",
        username="Attacker",
        websocket=attacker_ws,
    )

    assert room.owner_id == "owner-user"
    assert room.users["attacker-user"].is_owner is False
