from fastapi import APIRouter, WebSocket, WebSocketDisconnect, Depends, Query, Request, HTTPException
from sqlmodel import Session
import uuid

from database import get_session, engine
from collab import collab_manager
from auth import authorize_websocket_or_close, get_claim_user_id, get_request_user_id
from project_access import require_project_for_user

router = APIRouter(prefix="/api/collab", tags=["collaboration"])


def _sanitize_username(raw: str) -> str:
    value = (raw or "").replace("\r", " ").replace("\n", " ").strip()
    return value[:64] if value else "Anonymous"


@router.get("/{project_id}/users")
def get_room_users(
    project_id: str,
    request: Request,
    session: Session = Depends(get_session),
):
    try:
        require_project_for_user(session, project_id, get_request_user_id(request))
    except HTTPException:
        return {"users": []}

    users = collab_manager.get_room_users(project_id)
    return {"users": users}


@router.websocket("/ws/{project_id}")
async def collab_websocket(
    websocket: WebSocket,
    project_id: str,
    username: str = Query(default="Anonymous"),
):
    claims = await authorize_websocket_or_close(websocket)
    if claims is None:
        return

    claim_user_id = get_claim_user_id(claims)
    with Session(engine) as session:
        try:
            require_project_for_user(session, project_id, claim_user_id)
        except HTTPException:
            await websocket.close(code=4404)
            return

    await websocket.accept()

    user_id: str
    if claim_user_id != "local":
        user_id = claim_user_id
    else:
        user_id = str(uuid.uuid4())

    username = _sanitize_username(username)
    if username == "Anonymous":
        claim_name = (
            claims.get("username")
            or claims.get("name")
            or claims.get("email")
            if isinstance(claims, dict)
            else None
        )
        username = _sanitize_username(str(claim_name or f"User-{str(user_id)[:6]}"))

    try:
        room = await collab_manager.join_room(
            project_id=project_id,
            user_id=user_id,
            username=username,
            websocket=websocket,
        )

        await websocket.send_json(
            {
                "type": "joined",
                "user_id": user_id,
                "room_info": {
                    "project_id": project_id,
                    "users": collab_manager.get_room_users(project_id),
                    "owner_id": room.owner_id,
                    "suggestions": room.suggestions[-50:],
                },
            }
        )

        while True:
            data = await websocket.receive_json()
            msg_type = data.get("type")

            if msg_type == "cursor_move":
                await collab_manager.sync_cursor(
                    project_id=project_id,
                    user_id=user_id,
                    cursor=data.get("cursor", {}),
                )

            elif msg_type == "file_update":
                await collab_manager.sync_file(
                    project_id=project_id,
                    filename=data.get("filename"),
                    content=data.get("content"),
                    from_user=user_id,
                )

            elif msg_type == "chat_message":
                await collab_manager.sync_chat_message(
                    project_id=project_id,
                    message=data.get("message", {}),
                    from_user=user_id,
                )

            elif msg_type == "suggestion":
                await collab_manager.add_suggestion(
                    project_id=project_id, user_id=user_id, message=data.get("message")
                )

            elif msg_type == "approve_suggestion":
                room_state = collab_manager.get_room_state(project_id)
                if room_state.get("owner_id") != user_id:
                    continue
                suggestion_id = data.get("suggestion_id")
                suggestion = await collab_manager.approve_suggestion(
                    project_id=project_id, suggestion_id=suggestion_id
                )
                if suggestion:
                    await collab_manager.broadcast_to_room(
                        project_id,
                        {"type": "suggestion_approved", "suggestion": suggestion},
                    )

            elif msg_type == "ping":
                await websocket.send_json({"type": "pong"})

    except WebSocketDisconnect:
        await collab_manager.leave_room(project_id, user_id)
    except Exception as e:
        print(f"Collab WebSocket error: {e}")
        await collab_manager.leave_room(project_id, user_id)


@router.post("/{project_id}/start-discovery")
async def start_discovery(
    project_id: str,
    request: Request,
    port: int = Query(default=5173, ge=1, le=65535),
    session: Session = Depends(get_session),
):
    require_project_for_user(session, project_id, get_request_user_id(request))
    await collab_manager.start_mdns(port)
    return {"status": "discovery_started", "service": "forge.local"}


@router.post("/{project_id}/stop-discovery")
async def stop_discovery(
    project_id: str,
    request: Request,
    session: Session = Depends(get_session),
):
    require_project_for_user(session, project_id, get_request_user_id(request))
    await collab_manager.stop_mdns()
    return {"status": "discovery_stopped"}
