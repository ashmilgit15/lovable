import asyncio
import os
import uuid
import json
from typing import Optional, Any
from sqlmodel import Session, select

from database import engine
from models import Project, ProjectFile, FileSnapshot, Generation, ChatMessage, utcnow
from linter import run_typecheck, format_errors_for_prompt
from ai import parse_ai_response, stream_from_ollama
from memory import update_memory_from_generation
from runtime_security import is_untrusted_code_execution_enabled
from router import (
    Intent,
    get_model_for_intent,
    get_available_models,
    load_routing_overrides,
)

_autofix_locks: dict[str, asyncio.Lock] = {}


def get_project_lock(project_id: str) -> asyncio.Lock:
    if project_id not in _autofix_locks:
        _autofix_locks[project_id] = asyncio.Lock()
    return _autofix_locks[project_id]


async def safe_send_json(websocket: Optional[Any], payload: dict):
    if websocket is None:
        return
    try:
        await websocket.send_json(payload)
    except Exception:
        pass


def build_autofix_prompt(
    lint_output: str,
    runtime_error: Optional[str],
    files: list[ProjectFile],
) -> str:
    file_context_blocks = []
    for file in files:
        if not file.filename.endswith((".ts", ".tsx", ".js", ".jsx")):
            continue
        snippet = file.content[:6000]
        file_context_blocks.append(f"FILE: {file.filename}\n```tsx\n{snippet}\n```")

    runtime_section = ""
    if runtime_error:
        runtime_section = (
            "Runtime error report from preview:\n"
            f"{runtime_error}\n\n"
        )

    return (
        "Fix these TypeScript/runtime errors in the generated code.\n"
        "Return ONLY full updated files using the FILE: ... fenced block format.\n\n"
        f"{runtime_section}"
        f"{lint_output}\n\n"
        "Current file context:\n"
        + "\n\n".join(file_context_blocks[:12])
    )


def apply_file_to_disk(project_id: str, filename: str, content: str):
    base_dir = os.path.abspath(f"./generated/{project_id}")
    os.makedirs(base_dir, exist_ok=True)
    abs_target = os.path.abspath(os.path.join(base_dir, filename))
    if os.path.commonpath([base_dir, abs_target]) != base_dir:
        raise ValueError(f"Unsafe filename: {filename}")

    file_path = os.path.join(base_dir, filename)
    os.makedirs(os.path.dirname(file_path), exist_ok=True)
    with open(file_path, "w", encoding="utf-8") as f:
        f.write(content)


async def run_project_autofix(
    project_id: str,
    websocket: Optional[Any] = None,
    runtime_error: Optional[str] = None,
    user_id: Optional[str] = None,
) -> dict:
    if not is_untrusted_code_execution_enabled():
        return {"ok": False, "skipped": "untrusted_code_execution_disabled"}

    lock = get_project_lock(project_id)

    if lock.locked():
        return {"ok": False, "skipped": "autofix_already_running"}

    async with lock:
        with Session(engine) as session:
            project = session.get(Project, project_id)
            if not project:
                return {"ok": False, "error": "Project not found"}
            if not project.auto_fix_enabled:
                return {"ok": False, "skipped": "auto_fix_disabled"}

        lint_result = await run_typecheck(project_id)
        has_runtime = bool(runtime_error and runtime_error.strip())

        if not lint_result.has_errors and not has_runtime:
            return {"ok": True, "skipped": "no_errors"}

        await safe_send_json(
            websocket,
            {
                "type": "autofix_status",
                "phase": "running",
                "error_count": len(lint_result.errors),
                "runtime_error": runtime_error if has_runtime else None,
            },
        )

        with Session(engine) as session:
            all_files = list(
                session.exec(
                    select(ProjectFile).where(ProjectFile.project_id == project_id)
                ).all()
            )

        lint_output = format_errors_for_prompt(lint_result.errors)
        prompt = build_autofix_prompt(lint_output, runtime_error, all_files)

        available_models = await get_available_models()
        overrides = load_routing_overrides(user_id=user_id)
        debug_model = get_model_for_intent(
            Intent.DEBUG, available_models=available_models, user_overrides=overrides
        )

        messages = [
            {
                "role": "system",
                "content": (
                    "You are a strict TypeScript debugger. "
                    "Fix build/runtime errors and return only complete FILE blocks."
                ),
            },
            {"role": "user", "content": prompt},
        ]

        full_response = ""
        async for token in stream_from_ollama(messages, model=debug_model):
            full_response += token

        parsed = parse_ai_response(full_response)
        if not parsed.files:
            await safe_send_json(
                websocket,
                {
                    "type": "autofix_status",
                    "phase": "failed",
                    "message": "Model returned no file updates",
                },
            )
            return {"ok": False, "error": "No files returned"}

        generation_id = str(uuid.uuid4())
        changed_files: list[str] = []

        with Session(engine) as session:
            for pf in parsed.files:
                try:
                    apply_file_to_disk(project_id, pf.filename, pf.content)
                except ValueError:
                    continue

                existing = session.exec(
                    select(ProjectFile).where(
                        ProjectFile.project_id == project_id,
                        ProjectFile.filename == pf.filename,
                    )
                ).first()

                if existing:
                    session.add(
                        FileSnapshot(
                            project_id=project_id,
                            filename=existing.filename,
                            content=existing.content,
                            generation_id=generation_id,
                        )
                    )
                    existing.content = pf.content
                    existing.language = pf.language
                    existing.updated_at = utcnow()
                    session.add(existing)
                else:
                    session.add(
                        ProjectFile(
                            project_id=project_id,
                            filename=pf.filename,
                            content=pf.content,
                            language=pf.language,
                        )
                    )

                changed_files.append(pf.filename)

            session.add(
                Generation(
                    project_id=project_id,
                    user_message="Auto-fix TypeScript/runtime errors",
                    files_changed=json.dumps(changed_files),
                )
            )
            session.add(
                ChatMessage(
                    project_id=project_id,
                    role="system",
                    content=f"Auto-fixed {len(changed_files)} files.",
                    model_used=debug_model,
                )
            )

            project = session.get(Project, project_id)
            if project:
                project.updated_at = utcnow()
                session.add(project)

            session.commit()

            if changed_files:
                update_memory_from_generation(
                    project_id,
                    "Auto-fixed TypeScript/runtime errors",
                    changed_files,
                    session,
                )
                session.commit()

        await safe_send_json(
            websocket,
            {
                "type": "autofix_applied",
                "model_used": debug_model,
                "files": [
                    {
                        "filename": pf.filename,
                        "content": pf.content,
                        "language": pf.language,
                    }
                    for pf in parsed.files
                ],
            },
        )

        after_lint = await run_typecheck(project_id)
        await safe_send_json(
            websocket,
            {
                "type": "autofix_status",
                "phase": "complete",
                "remaining_error_count": len(after_lint.errors),
                "fixed_count": len(lint_result.errors) - len(after_lint.errors),
            },
        )

        return {
            "ok": True,
            "changed_files": changed_files,
            "remaining_error_count": len(after_lint.errors),
        }
