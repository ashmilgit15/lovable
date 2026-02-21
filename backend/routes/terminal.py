import asyncio
from fastapi import APIRouter, WebSocket, WebSocketDisconnect, Depends, Request, HTTPException
from sqlmodel import Session
from terminal import terminal_manager
import os
import json

from auth import authorize_websocket_or_close, get_claim_user_id, get_request_user_id
from command_security import validate_command
from database import get_session, engine
from project_access import require_project_for_user
from runtime_security import is_untrusted_code_execution_enabled

router = APIRouter()

@router.websocket("/ws/projects/{project_id}/terminal")
async def websocket_terminal(websocket: WebSocket, project_id: str):
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

        print(f"DEBUG: Terminal WS Connected: {project_id} User: {claims.get('sub')}")

        cwd = os.path.abspath(f"./generated/{project_id}")

        while True:
            data = await websocket.receive_text()
            message = json.loads(data)

            if "command" in message:
                command = str(message["command"])
                if len(command) > 2000:
                    await websocket.send_json({
                        "type": "error",
                        "data": "Command is too long (max 2000 chars).\r\n",
                    })
                    continue

                invalid_reason = validate_command(command)
                if invalid_reason:
                    await websocket.send_json({
                        "type": "error",
                        "data": f"{invalid_reason}\r\n",
                    })
                    continue

                if not os.path.exists(cwd):
                    os.makedirs(cwd, exist_ok=True)
                task = asyncio.create_task(
                    terminal_manager.run_command(project_id, command, cwd, websocket)
                )
                terminal_manager.set_task(project_id, task)

            elif "action" in message and message["action"] == "kill":
                await terminal_manager.kill(project_id)
                await websocket.send_json({
                    "type": "process_killed",
                    "project_id": project_id
                })

    except WebSocketDisconnect:
        print(f"DEBUG: Terminal WS Disconnected: {project_id}")
    except Exception as e:
        print(f"DEBUG: Terminal WS Error in {project_id}: {str(e)}")
        # traceback.print_exc()
        try:
            await websocket.close(code=1011)
        except:
            pass

@router.get("/api/projects/{project_id}/terminal/status")
async def get_terminal_status(
    project_id: str,
    request: Request,
    session: Session = Depends(get_session),
):
    if not is_untrusted_code_execution_enabled():
        return {
            "running": False,
            "pid": None,
            "disabled": True,
        }

    require_project_for_user(session, project_id, get_request_user_id(request))
    if project_id in terminal_manager.processes:
        process = terminal_manager.processes[project_id]
        return {"running": True, "pid": process.pid}
    return {"running": False, "pid": None, "disabled": False}

@router.post("/api/projects/{project_id}/terminal/kill")
async def kill_terminal_process(
    project_id: str,
    request: Request,
    session: Session = Depends(get_session),
):
    if not is_untrusted_code_execution_enabled():
        raise HTTPException(status_code=403, detail="Terminal feature is disabled")

    require_project_for_user(session, project_id, get_request_user_id(request))
    if project_id in terminal_manager.processes:
        await terminal_manager.kill(project_id)
        return {"status": "killed", "project_id": project_id}
    return {"status": "no_process_found", "project_id": project_id}
