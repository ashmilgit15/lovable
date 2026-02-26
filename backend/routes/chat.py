import asyncio
import json
import os
import re
from contextlib import suppress
import traceback
import uuid
from fastapi import APIRouter, WebSocket, WebSocketDisconnect, Request, Depends, HTTPException
from sqlalchemy import and_
from sqlmodel import Session, select

def is_safe_path(base_dir: str, filename: str) -> bool:
    """Check if the filename stays within the base_dir."""
    abs_base = os.path.abspath(base_dir)
    abs_target = os.path.abspath(os.path.join(abs_base, filename))
    return os.path.commonpath([abs_base, abs_target]) == abs_base

from auth import (
    authorize_websocket_or_close,
    get_request_user_id,
    get_claim_user_id,
)
from database import engine, get_session
from models import (
    Project,
    ProjectFile,
    ChatMessage,
    FileSnapshot,
    Generation,
    ProviderConfig,
    utcnow,
)
from provider_access import normalize_provider_owner_id, owned_provider_filter
from provider_secrets import ProviderSecretError, resolve_provider_api_key
from ai import (
    SYSTEM_PROMPT,
    parse_ai_response,
    sanitize_assistant_message_text,
    stream_from_openai_compatible,
    AIProviderError,
)
from memory import (
    update_memory_from_generation,
    get_memory_context,
)
from router import (
    classify_intent_simple,
)
from autofix import run_project_autofix
from preview_bridge import ensure_preview_bridge
from search import (
    should_use_web_search,
    search_web,
    format_web_results_for_prompt,
)
from tools import (
    normalize_tool_config,
    build_project_analyzer_context,
    build_url_reader_context,
    build_typecheck_context,
    extract_urls,
)
from todo_planner import (
    build_plan_context,
    ensure_plan,
    mark_project_complete,
    progress_plan,
)
from project_access import require_project_for_user
from runtime_security import is_untrusted_code_execution_enabled

router = APIRouter()

GENERATION_CANCEL_FLAGS: dict[str, bool] = {}
GENERATION_ACTIVE: dict[str, bool] = {}

ESSENTIAL_CONTEXT_FILES = {
    "package.json",
    "vite.config.ts",
    "tsconfig.json",
    "tailwind.config.js",
    "src/main.tsx",
    "src/App.tsx",
    "src/index.css",
}


async def iter_tokens_with_timeouts(
    token_stream,
    *,
    first_token_timeout: float = 25.0,
    next_token_timeout: float = 90.0,
):
    iterator = token_stream.__aiter__()
    timeout = first_token_timeout

    while True:
        try:
            token = await asyncio.wait_for(iterator.__anext__(), timeout=timeout)
        except StopAsyncIteration:
            break
        except asyncio.TimeoutError as exc:
            raise TimeoutError("Model response timed out") from exc

        yield token
        timeout = next_token_timeout


@router.post("/api/projects/{project_id}/chat/cancel")
async def cancel_chat_generation(
    project_id: str,
    request: Request,
    session: Session = Depends(get_session),
):
    require_project_for_user(session, project_id, get_request_user_id(request))
    was_active = bool(GENERATION_ACTIVE.get(project_id))
    GENERATION_CANCEL_FLAGS[project_id] = True
    return {"ok": True, "project_id": project_id, "was_active": was_active}


async def safe_send(websocket: WebSocket, payload: dict):
    try:
        await websocket.send_json(payload)
    except Exception:
        return


def format_exception_detail(exc: BaseException) -> str:
    detail = str(exc).strip()
    if detail:
        return detail
    class_name = exc.__class__.__name__ or "Error"
    fallback_repr = repr(exc).strip()
    default_repr = f"{class_name}()"
    if fallback_repr and fallback_repr != default_repr:
        return fallback_repr
    return class_name


def select_context_files(
    files: list[ProjectFile],
    user_message: str,
    max_files: int = 8,
    max_chars_per_file: int = 1000,
    max_total_chars: int = 7000,
) -> list[ProjectFile]:
    if not files:
        return []

    tokens = {
        token.lower()
        for token in re.findall(r"[a-zA-Z0-9_./-]+", user_message)
        if len(token) >= 3
    }

    scored: list[tuple[int, ProjectFile]] = []
    for file in files:
        filename = file.filename.lower()
        score = 0

        if file.filename in ESSENTIAL_CONTEXT_FILES:
            score += 2

        if filename in tokens:
            score += 10

        for token in tokens:
            if token in filename:
                score += 3

        if "component" in tokens and filename.startswith("src/components"):
            score += 2
        if "page" in tokens and filename.startswith("src/pages"):
            score += 2

        scored.append((score, file))

    scored.sort(key=lambda item: (item[0], -len(item[1].content or "")), reverse=True)

    selected = [file for score, file in scored if score > 0][:max_files]
    if not selected:
        selected = [
            file
            for _, file in sorted(
                scored,
                key=lambda item: (
                    item[1].filename not in ESSENTIAL_CONTEXT_FILES,
                    len(item[1].content or ""),
                ),
            )
        ][:max_files]

    total_chars = 0
    trimmed: list[ProjectFile] = []
    for file in selected:
        content_length = min(len(file.content or ""), max_chars_per_file)
        if total_chars + content_length > max_total_chars:
            continue
        total_chars += content_length
        trimmed.append(file)

    return trimmed


def build_file_context(files: list[ProjectFile], user_message: str) -> str:
    context_files = select_context_files(files, user_message)
    if not context_files:
        return ""

    parts = ["\n\nCurrent project files (relevant subset):"]
    for file in context_files:
        content = file.content or ""
        snippet = content[:1000]
        if len(content) > 1000:
            snippet += "\n// ...truncated"
        parts.append(f"\n--- {file.filename} ---\n{snippet}\n")

    return "".join(parts)


@router.websocket("/ws/projects/{project_id}/chat")
async def chat_websocket(websocket: WebSocket, project_id: str):
    try:
        claims = await authorize_websocket_or_close(websocket)
        if claims is None:
            return

        claim_user_id = normalize_provider_owner_id(get_claim_user_id(claims))

        await websocket.accept()

        print(f"DEBUG: Chat WS Connected: {project_id} User: {claims.get('sub')}")

        with Session(engine) as session:
            try:
                require_project_for_user(
                    session,
                    project_id,
                    claim_user_id,
                )
            except HTTPException:
                await safe_send(websocket, {"type": "error", "content": "Project not found"})
                await websocket.close()
                return

        await safe_send(websocket, {"type": "connected", "project_id": project_id})
        base_dir = os.path.abspath(f"./generated/{project_id}")
        os.makedirs(base_dir, exist_ok=True)

        while True:
            try:
                data = await websocket.receive_json()
            except RuntimeError as runtime_error:
                if "WebSocket is not connected" in str(runtime_error):
                    break
                raise
            message_type = data.get("type", "chat")

            if message_type == "runtime_error":
                runtime_error = (data.get("error") or "").strip()
                if runtime_error and is_untrusted_code_execution_enabled():
                    asyncio.create_task(
                        run_project_autofix(
                            project_id,
                            websocket=websocket,
                            runtime_error=runtime_error,
                            user_id=claim_user_id,
                        )
                    )
                elif runtime_error:
                    await safe_send(
                        websocket,
                        {
                            "type": "autofix_status",
                            "phase": "skipped",
                            "message": "Auto-fix disabled by server policy.",
                        },
                    )
                continue

            if message_type == "cancel":
                GENERATION_CANCEL_FLAGS[project_id] = True
                await safe_send(
                    websocket,
                    {"type": "progress", "phase": "cancel", "status": "in_progress", "message": "Stopping generation..."},
                )
                continue

            user_message = (data.get("message") or "").strip()
            requested_model = (data.get("model") or "").strip()
            requested_provider_id = (data.get("provider_id") or "").strip()
            requested_tools = normalize_tool_config(data.get("tools"))
            requested_response_mode = (data.get("response_mode") or "build").strip().lower()
            ask_mode = requested_response_mode == "ask"
            task_planner_enabled = bool(
                requested_tools.get("task_planner", False) and not ask_mode
            )

            if not user_message:
                continue

            GENERATION_CANCEL_FLAGS[project_id] = False
            GENERATION_ACTIVE[project_id] = True

            await safe_send(
                websocket,
                {
                    "type": "progress",
                    "phase": "routing",
                    "status": "in_progress",
                    "message": "Classifying intent and selecting best model...",
                },
            )

            provider_config: ProviderConfig | None = None
            if requested_provider_id:
                with Session(engine) as session:
                    provider_config = session.exec(
                        select(ProviderConfig).where(
                            and_(
                                ProviderConfig.id == requested_provider_id,
                                owned_provider_filter(claim_user_id),
                            )
                        )
                    ).first()
                if not provider_config:
                    await safe_send(
                        websocket,
                        {"type": "error", "content": "Selected provider was not found."},
                    )
                    continue
            else:
                with Session(engine) as session:
                    provider_config = session.exec(
                        select(ProviderConfig).where(
                            and_(
                                owned_provider_filter(claim_user_id),
                                ProviderConfig.is_active,
                            )
                        )
                    ).first()

            if not provider_config:
                await safe_send(
                    websocket,
                    {
                        "type": "error",
                        "content": (
                            "No active provider configured. Connect and activate a provider in Settings."
                        ),
                    },
                )
                GENERATION_ACTIVE[project_id] = False
                GENERATION_CANCEL_FLAGS[project_id] = False
                continue

            intent_result = classify_intent_simple(user_message)
            resolved_model = requested_model or provider_config.model
            model_used = f"{provider_config.provider}:{resolved_model}"
            provider_payload = {
                "provider_id": provider_config.id,
                "provider": provider_config.provider,
            }

            await safe_send(
                websocket,
                {
                    "type": "model_routed",
                    "intent": "manual" if requested_model else intent_result.intent.value,
                    "model_used": model_used,
                    "response_mode": "ask" if ask_mode else "build",
                    **provider_payload,
                },
            )

            await safe_send(
                websocket,
                {
                    "type": "progress",
                    "phase": "routing",
                    "status": "complete",
                    "message": f"Using {model_used}",
                },
            )

            with Session(engine) as session:
                user_msg = ChatMessage(
                    project_id=project_id,
                    role="user",
                    content=user_message,
                    model_used=model_used,
                )
                session.add(user_msg)
                session.commit()

                files = session.exec(
                    select(ProjectFile).where(ProjectFile.project_id == project_id)
                ).all()
                history = session.exec(
                    select(ChatMessage)
                    .where(ChatMessage.project_id == project_id)
                    .order_by(ChatMessage.created_at.desc())
                    .limit(8)
                ).all()
                history.reverse()

            await safe_send(
                websocket,
                {
                    "type": "progress",
                    "phase": "context",
                    "status": "in_progress",
                    "message": "Preparing focused project context...",
                },
            )

            memory_context = get_memory_context(project_id)
            file_context = build_file_context(files, user_message)
            web_context = ""
            tool_contexts: list[str] = []
            tools_used: dict[str, bool] = {
                "web_search": False,
                "url_reader": False,
                "project_analyzer": False,
                "typecheck": False,
                "task_planner": False,
            }

            if task_planner_enabled:
                await safe_send(
                    websocket,
                    {
                        "type": "progress",
                        "phase": "planning",
                        "status": "in_progress",
                        "message": "Planning task checklist...",
                    },
                )
                todo_state = ensure_plan(project_id, user_message)
                await safe_send(
                    websocket,
                    {
                        "type": "todo_state",
                        "state": todo_state,
                    },
                )
                tools_used["task_planner"] = True
                todo_context = build_plan_context(project_id)
                if todo_context:
                    tool_contexts.append(todo_context)
                await safe_send(
                    websocket,
                    {
                        "type": "progress",
                        "phase": "planning",
                        "status": "complete",
                        "message": "Task checklist ready",
                    },
                )

            if requested_tools.get("project_analyzer", False):
                await safe_send(
                    websocket,
                    {
                        "type": "progress",
                        "phase": "tools",
                        "status": "in_progress",
                        "message": "Analyzing project structure...",
                    },
                )
                analyzer_context = build_project_analyzer_context(files)
                if analyzer_context:
                    tool_contexts.append(analyzer_context)
                    tools_used["project_analyzer"] = True
                    await safe_send(
                        websocket,
                        {
                            "type": "progress",
                            "phase": "tools",
                            "status": "complete",
                            "message": "Project analyzer context ready",
                        },
                    )

            if requested_tools.get("url_reader", False):
                urls = extract_urls(user_message, max_urls=2)
                if urls:
                    await safe_send(
                        websocket,
                        {
                            "type": "progress",
                            "phase": "tools",
                            "status": "in_progress",
                            "message": "Reading linked URLs...",
                        },
                    )
                    url_context, url_failures = await build_url_reader_context(
                        user_message,
                        max_urls=2,
                    )
                    if url_context:
                        tool_contexts.append(url_context)
                        tools_used["url_reader"] = True
                        await safe_send(
                            websocket,
                            {
                                "type": "progress",
                                "phase": "tools",
                                "status": "complete",
                                "message": f"URL reader extracted {len(urls)} source(s)",
                            },
                        )
                    elif url_failures:
                        await safe_send(
                            websocket,
                            {
                                "type": "progress",
                                "phase": "tools",
                                "status": "failed",
                                "message": f"URL reader failed: {url_failures[0]}",
                            },
                        )

            if requested_tools.get("typecheck", False):
                if not is_untrusted_code_execution_enabled():
                    await safe_send(
                        websocket,
                        {
                            "type": "progress",
                            "phase": "tools",
                            "status": "failed",
                            "message": "Typecheck tool disabled by server policy.",
                        },
                    )
                else:
                    await safe_send(
                        websocket,
                        {
                            "type": "progress",
                            "phase": "tools",
                            "status": "in_progress",
                            "message": "Running TypeScript typecheck context...",
                        },
                    )
                    typecheck_context, type_error_count = await build_typecheck_context(
                        project_id
                    )
                    if typecheck_context:
                        tool_contexts.append(typecheck_context)
                    tools_used["typecheck"] = True
                    await safe_send(
                        websocket,
                        {
                            "type": "progress",
                            "phase": "tools",
                            "status": "complete",
                            "message": f"Typecheck context ready ({type_error_count} errors)",
                        },
                    )

            use_web_search = requested_tools.get("web_search", False) or should_use_web_search(
                user_message
            )
            if use_web_search:
                await safe_send(
                    websocket,
                    {
                        "type": "progress",
                        "phase": "search",
                        "status": "in_progress",
                        "message": "Searching the web for live information...",
                    },
                )

                search_results, search_error = await search_web(user_message)
                if search_results:
                    web_context = format_web_results_for_prompt(
                        user_message,
                        search_results,
                    )
                    tools_used["web_search"] = True
                    await safe_send(
                        websocket,
                        {
                            "type": "progress",
                            "phase": "search",
                            "status": "complete",
                            "message": f"Found {len(search_results)} web results",
                        },
                    )
                else:
                    await safe_send(
                        websocket,
                        {
                            "type": "progress",
                            "phase": "search",
                            "status": "failed",
                            "message": search_error or "Web search returned no results",
                        },
                    )

            enhanced_system_prompt = f"{SYSTEM_PROMPT}\n\n{memory_context}"
            if requested_tools.get("web_search", False):
                enhanced_system_prompt += (
                    "\n\nWeb Search tool is explicitly enabled for this request. "
                    "Ground your answer using search context when available."
                )
            if web_context:
                enhanced_system_prompt += (
                    "\n\nYou are provided with live web-search context. "
                    "Use it for factual answers and cite URLs when relevant. "
                    "If the user asks for information and not code edits, answer directly without FILE blocks.\n\n"
                    f"{web_context}"
                )
            if tool_contexts:
                enhanced_system_prompt += (
                    "\n\nAdditional tool context:\n"
                    + "\n\n".join(tool_contexts)
                )
            if task_planner_enabled:
                enhanced_system_prompt += (
                    "\n\nTask planner is enabled. Execute work using the provided checklist. "
                    "Prioritize the current in-progress task and keep changes scoped to checklist items."
                )
            if ask_mode:
                enhanced_system_prompt += (
                    "\n\nAsk mode is enabled. Reply directly to the user question in plain markdown. "
                    "Do not output FILE blocks and do not propose file edits unless explicitly asked to switch to build mode."
                )

            ollama_messages = [
                {
                    "role": "system",
                    "content": enhanced_system_prompt + file_context,
                }
            ]
            for msg in history:
                ollama_messages.append({"role": msg.role, "content": msg.content})

            await safe_send(
                websocket,
                {
                    "type": "progress",
                    "phase": "context",
                    "status": "complete",
                    "message": "Context ready",
                },
            )
            if task_planner_enabled:
                todo_state = progress_plan(project_id, 0.2)
                await safe_send(websocket, {"type": "todo_state", "state": todo_state})

            if GENERATION_CANCEL_FLAGS.get(project_id):
                await safe_send(
                    websocket,
                    {"type": "canceled", "content": "Generation stopped by user."},
                )
                GENERATION_ACTIVE[project_id] = False
                GENERATION_CANCEL_FLAGS[project_id] = False
                continue

            await safe_send(
                websocket,
                {
                    "type": "progress",
                    "phase": "generation",
                    "status": "in_progress",
                    "message": "Generating response...",
                },
            )

            full_response = ""
            first_token_sent = False
            canceled = False
            generation_model_used = model_used

            try:
                extra_headers = None
                if provider_config.provider == "openrouter":
                    extra_headers = {
                        "HTTP-Referer": "http://localhost:5173",
                        "X-Title": "One",
                    }

                try:
                    provider_api_key = resolve_provider_api_key(provider_config)
                except ProviderSecretError as secret_error:
                    raise AIProviderError(str(secret_error))

                token_stream = stream_from_openai_compatible(
                    ollama_messages,
                    model=resolved_model,
                    base_url=provider_config.base_url or "",
                    api_key=provider_api_key,
                    extra_headers=extra_headers,
                )

                token_count = 0
                todo_progress_tick = 0
                TOKENS_PER_TODO_TICK = 150

                async for token in iter_tokens_with_timeouts(token_stream):
                    if GENERATION_CANCEL_FLAGS.get(project_id):
                        canceled = True
                        break

                    if not first_token_sent:
                        first_token_sent = True
                        await safe_send(
                            websocket,
                            {
                                "type": "progress",
                                "phase": "generation",
                                "status": "in_progress",
                                "message": "Streaming response...",
                            },
                        )
                    full_response += token
                    token_count += 1
                    await safe_send(websocket, {"type": "token", "content": token})

                    # Smoothly progress todo plan during streaming
                    if task_planner_enabled:
                        new_tick = token_count // TOKENS_PER_TODO_TICK
                        if new_tick > todo_progress_tick and new_tick <= 8:
                            todo_progress_tick = new_tick
                            # Smoothly progress from 0.2 to 0.85 over streaming
                            ratio = min(0.85, 0.2 + (new_tick * 0.08))
                            todo_state = progress_plan(project_id, ratio)
                            await safe_send(websocket, {"type": "todo_state", "state": todo_state})

                if canceled:
                    await safe_send(
                        websocket,
                        {"type": "canceled", "content": "Generation stopped by user."},
                    )
                    GENERATION_ACTIVE[project_id] = False
                    GENERATION_CANCEL_FLAGS[project_id] = False
                    continue

                if ask_mode:
                    parsed_files = []
                    assistant_content = (full_response or "").strip() or "Reply generated."
                    assistant_summary = assistant_content
                else:
                    parsed = parse_ai_response(full_response)
                    parsed_files = parsed.files
                    assistant_summary = sanitize_assistant_message_text(full_response)
                    if not assistant_summary:
                        assistant_summary = (
                            f"Updated {len(parsed_files)} files."
                            if parsed_files
                            else "Generation complete."
                        )
                    assistant_content = assistant_summary

                generation_id = str(uuid.uuid4())
                files_changed: list[str] = []
                total_files = len(parsed_files)

                if total_files:
                    await safe_send(
                        websocket,
                        {
                            "type": "progress",
                            "phase": "apply",
                            "status": "in_progress",
                            "message": f"Applying {total_files} file updates...",
                        },
                    )
                    if task_planner_enabled:
                        todo_state = progress_plan(project_id, 0.55)
                        await safe_send(websocket, {"type": "todo_state", "state": todo_state})

                with Session(engine) as session:
                    for index, pf in enumerate(parsed_files, start=1):
                        if not is_safe_path(base_dir, pf.filename):
                            await safe_send(
                                websocket,
                                {
                                    "type": "error",
                                    "content": f"Unsafe filename rejected: {pf.filename}",
                                },
                            )
                            continue

                        await safe_send(
                            websocket,
                            {
                                "type": "file_progress",
                                "filename": pf.filename,
                                "status": "editing",
                                "index": index,
                                "total": total_files,
                            },
                        )

                        existing = session.exec(
                            select(ProjectFile).where(
                                ProjectFile.project_id == project_id,
                                ProjectFile.filename == pf.filename,
                            )
                        ).first()

                        if existing:
                            snapshot = FileSnapshot(
                                project_id=project_id,
                                filename=existing.filename,
                                content=existing.content,
                                generation_id=generation_id,
                            )
                            session.add(snapshot)

                            existing.content = pf.content
                            existing.language = pf.language
                            existing.updated_at = utcnow()
                            session.add(existing)
                        else:
                            new_file = ProjectFile(
                                project_id=project_id,
                                filename=pf.filename,
                                content=pf.content,
                                language=pf.language,
                            )
                            session.add(new_file)

                        files_changed.append(pf.filename)
                        file_path = os.path.join(base_dir, pf.filename)

                        os.makedirs(os.path.dirname(file_path), exist_ok=True)
                        with open(file_path, "w", encoding="utf-8") as file_handle:
                            file_handle.write(pf.content)

                        await safe_send(
                            websocket,
                            {
                                "type": "file_progress",
                                "filename": pf.filename,
                                "status": "edited",
                                "index": index,
                                "total": total_files,
                            },
                        )

                    ensure_preview_bridge(project_id, session)

                    generation = Generation(
                        project_id=project_id,
                        user_message=user_message,
                        files_changed=json.dumps(files_changed),
                    )
                    session.add(generation)

                    assistant_msg = ChatMessage(
                        project_id=project_id,
                        role="assistant",
                        content=assistant_content,
                        model_used=model_used,
                    )
                    session.add(assistant_msg)

                    project = session.get(Project, project_id)
                    if project:
                        project.updated_at = utcnow()
                        session.add(project)
                    session.commit()

                    if files_changed:
                        update_memory_from_generation(
                            project_id,
                            user_message,
                            files_changed,
                            session,
                        )
                        session.commit()

                if parsed_files and is_untrusted_code_execution_enabled():
                    from devserver import dev_server_manager

                    critical_files = [
                        "package.json",
                        "vite.config.ts",
                        "tsconfig.json",
                        "tailwind.config.js",
                        "postcss.config.js",
                    ]
                    should_restart = any(
                        f.filename in critical_files for f in parsed_files
                    )
                    try:
                        if should_restart:
                            await dev_server_manager.restart(project_id, base_dir)
                        else:
                            await dev_server_manager.start(project_id, base_dir)
                    except Exception as devserver_error:
                        devserver_error_detail = format_exception_detail(devserver_error)
                        await safe_send(
                            websocket,
                            {
                                "type": "progress",
                                "phase": "devserver",
                                "status": "failed",
                                "message": (
                                    "Preview server update failed: "
                                    f"{devserver_error_detail}"
                                ),
                            },
                        )
                elif parsed_files:
                    await safe_send(
                        websocket,
                        {
                            "type": "progress",
                            "phase": "devserver",
                            "status": "skipped",
                            "message": "Preview server disabled by server policy.",
                        },
                    )

                if task_planner_enabled and parsed_files:
                    todo_state = mark_project_complete(project_id)
                    await safe_send(websocket, {"type": "todo_state", "state": todo_state})

                await safe_send(
                    websocket,
                    {
                        "type": "complete",
                        "files": [
                            {
                                "filename": f.filename,
                                "content": f.content,
                                "language": f.language,
                            }
                            for f in parsed_files
                        ],
                        "explanation": assistant_summary,
                        "content": assistant_content,
                        "generation_id": generation_id,
                        "model_used": generation_model_used,
                        "response_mode": "ask" if ask_mode else "build",
                        "intent": "manual"
                        if requested_model
                        else intent_result.intent.value,
                        "web_search_used": bool(web_context),
                        "tools_used": tools_used,
                    },
                )

                await safe_send(
                    websocket,
                    {
                        "type": "progress",
                        "phase": "complete",
                        "status": "complete",
                        "message": "Generation complete",
                    },
                )

                if parsed_files and is_untrusted_code_execution_enabled():
                    asyncio.create_task(
                        run_project_autofix(
                            project_id,
                            websocket=websocket,
                            user_id=claim_user_id,
                        )
                    )
                GENERATION_ACTIVE[project_id] = False
                GENERATION_CANCEL_FLAGS[project_id] = False

            except AIProviderError as e:
                GENERATION_ACTIVE[project_id] = False
                GENERATION_CANCEL_FLAGS[project_id] = False
                error_detail = format_exception_detail(e)
                if task_planner_enabled:
                    with suppress(Exception):
                        todo_state = progress_plan(project_id, 0.15)
                        await safe_send(websocket, {"type": "todo_state", "state": todo_state})
                await safe_send(
                    websocket,
                    {
                        "type": "error",
                        "content": (
                            "Model error: "
                            + error_detail
                            + " Check your active provider and model settings, then try again."
                        ),
                    },
                )
            except Exception as e:
                GENERATION_ACTIVE[project_id] = False
                GENERATION_CANCEL_FLAGS[project_id] = False
                error_detail = format_exception_detail(e)
                print(f"DEBUG: Chat generation error in {project_id}: {error_detail}")
                traceback.print_exc()
                if task_planner_enabled:
                    with suppress(Exception):
                        todo_state = progress_plan(project_id, 0.15)
                        await safe_send(websocket, {"type": "todo_state", "state": todo_state})
                await safe_send(websocket, {"type": "error", "content": f"Error: {error_detail}"})

    except WebSocketDisconnect:
        print(f"DEBUG: Chat WS Disconnected: {project_id}")
    except Exception as e:
        print(f"DEBUG: Chat WS Error in {project_id}: {format_exception_detail(e)}")
        traceback.print_exc()
        try:
            await websocket.close(code=1011)
        except Exception:
            pass
