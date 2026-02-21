from __future__ import annotations

import json
import os
import re
import uuid
from datetime import datetime, timezone
from typing import Literal

TodoStatus = Literal["pending", "in_progress", "done"]
MAX_OBJECTIVE_LENGTH = 120
MAX_TASK_TITLE_LENGTH = 72
MAX_REQUIREMENTS = 8
MAX_FEATURE_SUMMARY_ITEMS = 4
TARGET_PLAN_TASKS = 5


def utcnow_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def get_todo_path(project_id: str) -> str:
    base_dir = os.path.abspath(f"./generated/{project_id}")
    os.makedirs(base_dir, exist_ok=True)
    return os.path.join(base_dir, "todo_state.json")


def default_todo_state(project_id: str) -> dict:
    return {
        "project_id": project_id,
        "objective": "",
        "tasks": [],
        "project_complete": False,
        "updated_at": utcnow_iso(),
    }


def load_todo_state(project_id: str) -> dict:
    path = get_todo_path(project_id)
    if not os.path.exists(path):
        return default_todo_state(project_id)

    try:
        with open(path, "r", encoding="utf-8") as fh:
            data = json.load(fh)
        if isinstance(data, dict):
            state = default_todo_state(project_id)
            state.update(data)
            state["project_id"] = project_id
            return state
    except (OSError, json.JSONDecodeError):
        pass
    return default_todo_state(project_id)


def save_todo_state(project_id: str, state: dict) -> dict:
    payload = default_todo_state(project_id)
    payload.update(state)
    payload["project_id"] = project_id
    payload["updated_at"] = utcnow_iso()

    path = get_todo_path(project_id)
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(payload, fh, indent=2)
    return payload


def reset_todo_state(project_id: str) -> dict:
    return save_todo_state(project_id, default_todo_state(project_id))


def _normalize_sentence(text: str) -> str:
    trimmed = re.sub(r"\s+", " ", (text or "").strip())
    return trimmed[:240]


def _truncate_words(text: str, limit: int) -> str:
    value = (text or "").strip()
    if len(value) <= limit:
        return value

    clipped = value[:limit].rstrip(" ,.;:-")
    if " " in clipped and len(clipped) > int(limit * 0.6):
        clipped = clipped.rsplit(" ", 1)[0]
    clipped = clipped.rstrip(" ,.;:-")
    return f"{clipped}..."


def _titleize(text: str) -> str:
    cleaned = _normalize_sentence(text)
    if not cleaned:
        return "Task"
    titled = cleaned[0].upper() + cleaned[1:]
    return _truncate_words(titled, MAX_TASK_TITLE_LENGTH)


def _short_objective(text: str) -> str:
    return _truncate_words(_normalize_sentence(text), MAX_OBJECTIVE_LENGTH)


def _clean_requirement(text: str) -> str:
    cleaned = _normalize_sentence(text)
    cleaned = re.sub(
        r"^(?:and|with|plus|including|then|also|to)\s+",
        "",
        cleaned,
        flags=re.IGNORECASE,
    )
    return cleaned.strip(" ,.;:-")


def _extract_core_and_requirements(objective: str) -> tuple[str, list[str]]:
    sentence = _normalize_sentence(objective)
    if not sentence:
        return "", []

    parts = [part.strip() for part in re.split(r"\s*(?:,|;)\s*", sentence) if part.strip()]
    core = parts[0] if parts else sentence
    requirement_candidates = parts[1:]

    split_with_details = re.split(
        r"\b(?:with|including|featuring|that includes)\b",
        core,
        maxsplit=1,
        flags=re.IGNORECASE,
    )
    if len(split_with_details) == 2:
        core = split_with_details[0].strip()
        detail_part = split_with_details[1].strip()
        if detail_part:
            requirement_candidates.insert(0, detail_part)

    if not requirement_candidates and " and " in core.lower():
        core_and_parts = [
            _clean_requirement(part)
            for part in re.split(r"\band\b", core, flags=re.IGNORECASE)
            if _clean_requirement(part)
        ]
        if len(core_and_parts) >= 2 and len(" ".join(core_and_parts).split()) >= 8:
            core = core_and_parts[0]
            requirement_candidates.extend(core_and_parts[1:])

    requirements: list[str] = []
    seen: set[str] = set()
    for candidate in requirement_candidates:
        cleaned = _clean_requirement(candidate)
        if len(cleaned) < 3:
            continue
        key = cleaned.lower()
        if key in seen or key == core.lower():
            continue
        seen.add(key)
        requirements.append(cleaned)
        if len(requirements) >= MAX_REQUIREMENTS:
            break

    return core or sentence, requirements


def _to_noun_phrase(text: str) -> str:
    cleaned = _clean_requirement(text)
    cleaned = re.sub(
        r"^(?:build|create|make|develop|implement|design|craft)\s+",
        "",
        cleaned,
        flags=re.IGNORECASE,
    )
    cleaned = cleaned.strip()
    return cleaned or _clean_requirement(text)


def _join_human_list(items: list[str]) -> str:
    if not items:
        return ""
    if len(items) == 1:
        return items[0]
    if len(items) == 2:
        return f"{items[0]} and {items[1]}"
    return f"{', '.join(items[:-1])}, and {items[-1]}"


def _summarize_requirements(requirements: list[str]) -> str:
    if not requirements:
        return "core interactions and UX details"

    compact = [
        _truncate_words(_clean_requirement(item), 22)
        for item in requirements[:MAX_FEATURE_SUMMARY_ITEMS]
        if _clean_requirement(item)
    ]
    if not compact:
        return "core interactions and UX details"

    summary = _join_human_list(compact)
    extra = len(requirements) - len(compact)
    if extra > 0:
        summary = f"{summary} (+{extra} more)"
    return summary


def _build_task_titles(objective: str) -> list[str]:
    core, requirements = _extract_core_and_requirements(objective)
    core_phrase = _to_noun_phrase(core or objective or "requested feature")
    core_phrase = _truncate_words(core_phrase, 40)
    feature_summary = _summarize_requirements(requirements)

    return [
        _titleize(f"Plan scope, files, and acceptance criteria for {core_phrase}"),
        _titleize(f"Implement core flow and state for {core_phrase}"),
        _titleize(f"Add requested features: {feature_summary}"),
        _titleize("Run lint/type checks, test edge cases, and fix issues"),
        _titleize("Finalize polish, verify outcomes, and mark project complete"),
    ][:TARGET_PLAN_TASKS]


def _build_task_objects(task_titles: list[str]) -> list[dict]:
    tasks = [
        {
            "id": str(uuid.uuid4()),
            "title": title,
            "status": "pending",
        }
        for title in task_titles
    ]
    if tasks:
        tasks[0]["status"] = "in_progress"
    return tasks


def _calculate_progress_ratio(tasks: list[dict]) -> float:
    if not tasks:
        return 0.0
    total = len(tasks)
    done_count = sum(1 for task in tasks if task.get("status") == "done")
    has_in_progress = any(task.get("status") == "in_progress" for task in tasks)
    ratio = (done_count + (0.5 if has_in_progress else 0.0)) / total
    return max(0.0, min(1.0, ratio))


def _apply_progress_ratio(tasks: list[dict], ratio: float) -> list[dict]:
    if not tasks:
        return tasks

    ratio = max(0.0, min(1.0, ratio))
    done_count = int(len(tasks) * ratio)
    if ratio >= 1.0:
        done_count = len(tasks)

    for index, task in enumerate(tasks):
        if index < done_count:
            task["status"] = "done"
        elif index == done_count and done_count < len(tasks):
            task["status"] = "in_progress"
        else:
            task["status"] = "pending"
    return tasks


def _compact_tasks(tasks: list[dict]) -> list[dict]:
    compacted: list[dict] = []
    for task in tasks:
        status = str(task.get("status") or "pending")
        if status not in {"pending", "in_progress", "done"}:
            status = "pending"
        compacted.append(
            {
                "id": task.get("id") or str(uuid.uuid4()),
                "title": _titleize(str(task.get("title") or "Task")),
                "status": status,
            }
        )
    return compacted


def create_plan(project_id: str, objective: str) -> dict:
    task_titles = _build_task_titles(objective)
    tasks = _build_task_objects(task_titles)

    return save_todo_state(
        project_id,
        {
            "objective": _short_objective(objective),
            "tasks": tasks,
            "project_complete": False,
        },
    )


def ensure_plan(project_id: str, objective: str) -> dict:
    current = load_todo_state(project_id)
    incoming_objective = _short_objective(objective)
    current_objective = _short_objective(str(current.get("objective") or ""))
    has_tasks = bool(current.get("tasks"))
    if has_tasks and current_objective and current_objective == incoming_objective:
        tasks = _compact_tasks(list(current.get("tasks") or []))
        normalized = dict(current)
        normalized["objective"] = current_objective
        if len(tasks) != TARGET_PLAN_TASKS:
            rebuilt = _build_task_objects(_build_task_titles(current_objective))
            progress_ratio = _calculate_progress_ratio(tasks)
            normalized["tasks"] = _apply_progress_ratio(rebuilt, progress_ratio)
        else:
            normalized["tasks"] = tasks
        if (
            normalized["objective"] != current.get("objective")
            or normalized["tasks"] != current.get("tasks")
        ):
            return save_todo_state(project_id, normalized)
        return current

    if incoming_objective:
        return create_plan(project_id, objective)

    return create_plan(project_id, objective)


def set_task_status(project_id: str, task_id: str, status: TodoStatus) -> dict:
    state = load_todo_state(project_id)
    tasks = list(state.get("tasks") or [])
    for task in tasks:
        if task.get("id") == task_id:
            task["status"] = status
            break

    state["tasks"] = tasks
    state["project_complete"] = all(task.get("status") == "done" for task in tasks) if tasks else False
    return save_todo_state(project_id, state)


def progress_plan(project_id: str, ratio: float) -> dict:
    state = load_todo_state(project_id)
    tasks = list(state.get("tasks") or [])
    if not tasks:
        return state

    ratio = max(0.0, min(1.0, ratio))
    done_count = int(len(tasks) * ratio)
    if ratio >= 1.0:
        done_count = len(tasks)

    for index, task in enumerate(tasks):
        if index < done_count:
            task["status"] = "done"
        elif index == done_count and done_count < len(tasks):
            task["status"] = "in_progress"
        else:
            task["status"] = "pending"

    state["tasks"] = tasks
    state["project_complete"] = ratio >= 1.0
    return save_todo_state(project_id, state)


def mark_project_complete(project_id: str) -> dict:
    state = load_todo_state(project_id)
    tasks = list(state.get("tasks") or [])
    for task in tasks:
        task["status"] = "done"
    state["tasks"] = tasks
    state["project_complete"] = True
    return save_todo_state(project_id, state)


def build_plan_context(project_id: str) -> str:
    state = load_todo_state(project_id)
    tasks = list(state.get("tasks") or [])
    if not tasks:
        return ""

    lines = [
        "Task Planner Context:",
        "- Follow this checklist in order and keep code changes aligned with the active task.",
        "- Complete implementation and verification for each step before moving to the next.",
    ]
    objective = state.get("objective", "")
    if objective:
        lines.append(f"- Objective: {objective}")

    for idx, task in enumerate(tasks, start=1):
        lines.append(
            f"- [{task.get('status', 'pending')}] {idx}. {task.get('title', 'Task')}"
        )

    if state.get("project_complete"):
        lines.append("- Project completion: complete")

    return "\n".join(lines)
