import asyncio
import hashlib
from typing import Dict, List, Optional
from dataclasses import dataclass, field
from datetime import datetime, timezone
from fastapi import WebSocket
import socket

from models import utcnow

try:
    from zeroconf import ServiceInfo, Zeroconf

    ZEROCONF_AVAILABLE = True
except ImportError:
    ZEROCONF_AVAILABLE = False


def get_local_ip() -> str:
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except Exception:
        return "127.0.0.1"


def hash_username_to_color(username: str) -> str:
    colors = [
        "#f43f5e",
        "#ec4899",
        "#a855f7",
        "#8b5cf6",
        "#6366f1",
        "#3b82f6",
        "#0ea5e9",
        "#14b8a6",
        "#10b981",
        "#22c55e",
        "#84cc16",
        "#eab308",
        "#f97316",
        "#ef4444",
    ]
    hash_val = int(hashlib.md5(username.encode()).hexdigest(), 16)
    return colors[hash_val % len(colors)]


@dataclass
class CollabUser:
    id: str
    username: str
    color: str
    websocket: WebSocket = None
    is_owner: bool = False
    cursor_position: Optional[dict] = None
    last_seen: datetime = field(default_factory=utcnow)


@dataclass
class ProjectRoom:
    project_id: str
    owner_id: str
    users: Dict[str, CollabUser] = field(default_factory=dict)
    messages: List[dict] = field(default_factory=list)
    file_states: Dict[str, str] = field(default_factory=dict)
    suggestions: List[dict] = field(default_factory=list)


class CollaborationManager:
    def __init__(self):
        self.rooms: Dict[str, ProjectRoom] = {}
        self.zeroconf: Optional[Zeroconf] = None
        self.service_info: Optional[ServiceInfo] = None

    async def start_mdns(self, port: int = 5173):
        if not ZEROCONF_AVAILABLE:
            print("Zeroconf not available - collaboration discovery disabled")
            return

        try:
            local_ip = get_local_ip()
            self.zeroconf = Zeroconf()

            self.service_info = ServiceInfo(
                "_http._tcp.local.",
                "one._http._tcp.local.",
                addresses=[socket.inet_aton(local_ip)],
                port=port,
                properties={"name": "One", "version": "1.0.0", "path": "/"},
                server="one.local.",
            )

            await asyncio.get_event_loop().run_in_executor(
                None, self.zeroconf.register_service, self.service_info
            )
            print(f"mDNS service registered at one.local:{port}")
        except Exception as e:
            print(f"Failed to start mDNS: {e}")

    async def stop_mdns(self):
        if self.zeroconf and self.service_info:
            await asyncio.get_event_loop().run_in_executor(
                None, self.zeroconf.unregister_service, self.service_info
            )
            self.zeroconf.close()

    def get_or_create_room(self, project_id: str, owner_id: str) -> ProjectRoom:
        if project_id not in self.rooms:
            self.rooms[project_id] = ProjectRoom(
                project_id=project_id, owner_id=owner_id
            )
        return self.rooms[project_id]

    async def join_room(
        self,
        project_id: str,
        user_id: str,
        username: str,
        websocket: WebSocket,
        owner_id: Optional[str] = None,
    ) -> ProjectRoom:
        resolved_owner_id = (owner_id or user_id).strip() or user_id
        room = self.rooms.get(project_id)
        owner_changed = False
        if room is None:
            room = ProjectRoom(project_id=project_id, owner_id=resolved_owner_id)
            self.rooms[project_id] = room
        elif room.owner_id != resolved_owner_id:
            room.owner_id = resolved_owner_id
            owner_changed = True
            for existing in room.users.values():
                existing.is_owner = existing.id == room.owner_id

        user = CollabUser(
            id=user_id,
            username=username,
            color=hash_username_to_color(username),
            websocket=websocket,
            is_owner=room.owner_id == user_id,
        )

        room.users[user_id] = user
        if owner_changed:
            await self.broadcast_to_room(
                project_id,
                {
                    "type": "owner_changed",
                    "owner_id": room.owner_id,
                    "users": self.get_room_users(project_id),
                },
            )

        await self.broadcast_to_room(
            project_id,
            {
                "type": "user_joined",
                "user": {
                    "id": user.id,
                    "username": user.username,
                    "color": user.color,
                    "is_owner": user.is_owner,
                },
            },
            exclude_user=user_id,
        )

        return room

    async def leave_room(self, project_id: str, user_id: str):
        if project_id not in self.rooms:
            return

        room = self.rooms[project_id]
        if user_id in room.users:
            was_owner = room.owner_id == user_id
            del room.users[user_id]

            await self.broadcast_to_room(
                project_id, {"type": "user_left", "user_id": user_id}
            )

            if was_owner and room.users:
                # Transfer ownership to the first connected user if owner leaves.
                next_owner = next(iter(room.users.values()))
                room.owner_id = next_owner.id
                for existing in room.users.values():
                    existing.is_owner = existing.id == room.owner_id
                await self.broadcast_to_room(
                    project_id,
                    {
                        "type": "owner_changed",
                        "owner_id": room.owner_id,
                        "users": self.get_room_users(project_id),
                    },
                )

        if len(room.users) == 0:
            del self.rooms[project_id]

    async def broadcast_to_room(
        self, project_id: str, message: dict, exclude_user: str = None
    ):
        if project_id not in self.rooms:
            return

        room = self.rooms[project_id]
        for user_id, user in room.users.items():
            if exclude_user and user_id == exclude_user:
                continue
            try:
                await user.websocket.send_json(message)
            except Exception:
                pass

    async def sync_file(
        self, project_id: str, filename: str, content: str, from_user: str
    ):
        if project_id not in self.rooms:
            return

        room = self.rooms[project_id]
        room.file_states[filename] = content

        await self.broadcast_to_room(
            project_id,
            {
                "type": "file_update",
                "filename": filename,
                "content": content,
                "from_user": from_user,
            },
            exclude_user=from_user,
        )

    async def sync_chat_message(
        self,
        project_id: str,
        message: dict,
        from_user: str,
    ):
        if project_id not in self.rooms:
            return

        room = self.rooms[project_id]
        room.messages.append(message)
        room.messages = room.messages[-200:]

        await self.broadcast_to_room(
            project_id,
            {"type": "chat_message", "message": message, "from_user": from_user},
            exclude_user=from_user,
        )

    async def sync_cursor(self, project_id: str, user_id: str, cursor: dict):
        if project_id not in self.rooms:
            return

        room = self.rooms[project_id]
        if user_id in room.users:
            room.users[user_id].cursor_position = cursor
            room.users[user_id].last_seen = utcnow()

        await self.broadcast_to_room(
            project_id,
            {"type": "cursor_update", "user_id": user_id, "cursor": cursor},
            exclude_user=user_id,
        )

    async def add_suggestion(self, project_id: str, user_id: str, message: str):
        if project_id not in self.rooms:
            return

        room = self.rooms[project_id]
        user = room.users.get(user_id)

        if user and not user.is_owner:
            suggestion = {
                "id": hashlib.md5(f"{user_id}{message}{utcnow()}".encode()).hexdigest()[
                    :8
                ],
                "user_id": user_id,
                "username": user.username,
                "message": message,
                "timestamp": utcnow().isoformat(),
            }
            room.suggestions.append(suggestion)

            await self.broadcast_to_room(
                project_id, {"type": "new_suggestion", "suggestion": suggestion}
            )

    async def approve_suggestion(
        self, project_id: str, suggestion_id: str
    ) -> Optional[dict]:
        if project_id not in self.rooms:
            return None

        room = self.rooms[project_id]
        for suggestion in room.suggestions:
            if suggestion["id"] == suggestion_id:
                room.suggestions.remove(suggestion)
                await self.broadcast_to_room(
                    project_id,
                    {"type": "suggestion_removed", "suggestion_id": suggestion_id},
                )
                return suggestion
        return None

    def get_room_users(self, project_id: str) -> List[dict]:
        if project_id not in self.rooms:
            return []

        room = self.rooms[project_id]
        return [
            {
                "id": u.id,
                "username": u.username,
                "color": u.color,
                "is_owner": u.id == room.owner_id,
            }
            for u in room.users.values()
        ]

    def get_room_state(self, project_id: str) -> dict:
        if project_id not in self.rooms:
            return {"users": [], "owner_id": None, "suggestions": []}

        room = self.rooms[project_id]
        return {
            "users": self.get_room_users(project_id),
            "owner_id": room.owner_id,
            "suggestions": room.suggestions[-50:],
        }


collab_manager = CollaborationManager()
