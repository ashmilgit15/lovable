from fastapi import APIRouter, Depends, HTTPException, Request, WebSocket, WebSocketDisconnect
from sqlmodel import Session

import os

from auth import authorize_websocket_or_close, get_claim_user_id, get_request_user_id
from database import engine, get_session
from devserver import dev_server_manager
from project_access import require_project_for_user
from runtime_security import is_untrusted_code_execution_enabled

router = APIRouter()


@router.get("/api/projects/{project_id}/devserver/status")
async def get_devserver_status(
    project_id: str,
    request: Request,
    session: Session = Depends(get_session),
):
    if not is_untrusted_code_execution_enabled():
        return {
            "running": False,
            "port": None,
            "disabled": True,
        }

    require_project_for_user(session, project_id, get_request_user_id(request))
    running = dev_server_manager.is_running(project_id)
    return {
        "running": running,
        "port": dev_server_manager.ports.get(project_id) if running else None,
        "disabled": False,
    }


@router.websocket("/ws/projects/{project_id}/devserver")
async def devserver_websocket(websocket: WebSocket, project_id: str):
    try:
        if not is_untrusted_code_execution_enabled():
            await websocket.close(code=4403)
            return

        claims = await authorize_websocket_or_close(websocket)
        if claims is None:
            return

        with Session(engine) as session:
            try:
                require_project_for_user(session, project_id, get_claim_user_id(claims))
            except HTTPException:
                await websocket.close(code=4404)
                return

        await websocket.accept()

        print(f"DEBUG: DevServer WS Connected: {project_id} User: {claims.get('sub')}")
        await dev_server_manager.register_websocket(project_id, websocket)
        
        cwd = os.path.abspath(f"./generated/{project_id}")
        
        while True:
            data = await websocket.receive_json()
            action = data.get("action")
            
            if action == "start":
                await dev_server_manager.start(project_id, cwd)
            elif action == "stop":
                await dev_server_manager.stop(project_id)
            elif action == "restart":
                await dev_server_manager.restart(project_id, cwd)
                
    except WebSocketDisconnect:
        print(f"DEBUG: DevServer WS Disconnected: {project_id}")
        await dev_server_manager.unregister_websocket(project_id, websocket)
    except Exception as e:
        print(f"DEBUG: DevServer WS Error in {project_id}: {str(e)}")
        await dev_server_manager.unregister_websocket(project_id, websocket)
        try:
            await websocket.close(code=1011)
        except:
            pass
