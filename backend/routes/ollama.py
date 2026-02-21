import os
import httpx
import json
import re
from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from auth import authorize_websocket_or_close
from runtime_security import is_untrusted_code_execution_enabled

router = APIRouter(prefix="/api/ollama", tags=["ollama"])

OLLAMA_BASE_URL = os.getenv("OLLAMA_BASE_URL", "http://localhost:11434")
SAFE_MODEL_NAME = re.compile(r"^[a-zA-Z0-9._:/-]{1,128}$")


def is_valid_model_name(model_name: str) -> bool:
    value = (model_name or "").strip()
    if not SAFE_MODEL_NAME.fullmatch(value):
        return False
    if ".." in value:
        return False
    if value.startswith(("/", "\\")):
        return False
    return True


@router.get("/status")
async def ollama_status():
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            resp = await client.get(f"{OLLAMA_BASE_URL}/api/tags")
            if resp.status_code == 200:
                return {"status": "connected", "url": OLLAMA_BASE_URL}
    except Exception:
        pass
    return {"status": "disconnected", "url": OLLAMA_BASE_URL}


@router.get("/models")
async def list_models():
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.get(f"{OLLAMA_BASE_URL}/api/tags")
            if resp.status_code == 200:
                data = resp.json()
                models = [m["name"] for m in data.get("models", [])]
                return {"models": models}
    except Exception as e:
        return {"models": [], "error": str(e)}

@router.websocket("/pull")
async def pull_model(websocket: WebSocket):
    if not is_untrusted_code_execution_enabled():
        await websocket.close(code=4403)
        return

    authorized_claims = await authorize_websocket_or_close(websocket)
    if authorized_claims is None:
        return

    await websocket.accept()

    try:
        data = await websocket.receive_json()
        model_name = str(data.get("model") or "").strip()

        if not model_name:
            await websocket.send_json({"error": "No model name provided"})
            await websocket.close()
            return
        if not is_valid_model_name(model_name):
            await websocket.send_json({"error": "Invalid model name"})
            await websocket.close()
            return

        async with httpx.AsyncClient(timeout=None) as client:
            async with client.stream("POST", f"{OLLAMA_BASE_URL}/api/pull", json={"name": model_name}) as response:
                async for line in response.aiter_lines():
                    if line:
                        try:
                            # Parse JSON from Ollama
                            progress_data = json.loads(line)

                            # Forward directly to frontend
                            await websocket.send_json(progress_data)

                            if progress_data.get("status") == "success":
                                break
                        except json.JSONDecodeError:
                            pass

    except WebSocketDisconnect:
        pass
    except Exception as e:
        await websocket.send_json({"error": str(e)})
        try:
            await websocket.close()
        except:
            pass
