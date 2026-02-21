import asyncio
import os
import json
import re
from typing import List
from dataclasses import dataclass
from datetime import datetime, timezone

from models import utcnow
from runtime_security import is_untrusted_code_execution_enabled


@dataclass
class TypeError:
    file: str
    line: int
    column: int
    message: str
    code: str
    severity: str


@dataclass
class LintResult:
    has_errors: bool
    errors: List[TypeError]
    raw_output: str


async def run_typecheck(project_id: str) -> LintResult:
    if not is_untrusted_code_execution_enabled():
        return LintResult(
            has_errors=False,
            errors=[],
            raw_output="Typecheck disabled by server policy.",
        )

    base_dir = os.path.abspath(f"./generated/{project_id}")

    if not os.path.exists(os.path.join(base_dir, "tsconfig.json")):
        return LintResult(
            has_errors=False, errors=[], raw_output="No TypeScript project"
        )

    try:
        process = await asyncio.create_subprocess_exec(
            "npx",
            "tsc",
            "--noEmit",
            "--pretty",
            "false",
            cwd=base_dir,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )

        stdout, stderr = await asyncio.wait_for(process.communicate(), timeout=60.0)

        output = stdout.decode("utf-8", errors="replace")
        errors = parse_tsc_output(output)

        return LintResult(has_errors=len(errors) > 0, errors=errors, raw_output=output)
    except asyncio.TimeoutError:
        return LintResult(has_errors=False, errors=[], raw_output="Typecheck timed out")
    except FileNotFoundError:
        return LintResult(
            has_errors=False, errors=[], raw_output="TypeScript not found"
        )
    except Exception as e:
        return LintResult(
            has_errors=False, errors=[], raw_output=f"Error running typecheck: {str(e)}"
        )


def parse_tsc_output(output: str) -> List[TypeError]:
    errors = []
    pattern = re.compile(
        r"^(?P<file>.+?)\((?P<line>\d+),(?P<column>\d+)\):\s+error\s+(?P<code>TS\d+):\s+(?P<message>.+)$"
    )
    alt_pattern = re.compile(
        r"^(?P<file>.+?):(?P<line>\d+):(?P<column>\d+)\s*-\s*error\s+(?P<code>TS\d+):\s+(?P<message>.+)$"
    )

    for line in output.split("\n"):
        line = line.strip()
        if not line:
            continue

        match = pattern.match(line) or alt_pattern.match(line)
        if not match:
            continue

        try:
            errors.append(
                TypeError(
                    file=match.group("file"),
                    line=int(match.group("line")),
                    column=int(match.group("column")),
                    message=match.group("message").strip(),
                    code=match.group("code").strip(),
                    severity="error",
                )
            )
        except (ValueError, IndexError):
            continue

    return errors


async def run_eslint(project_id: str) -> LintResult:
    if not is_untrusted_code_execution_enabled():
        return LintResult(
            has_errors=False,
            errors=[],
            raw_output="ESLint disabled by server policy.",
        )

    base_dir = os.path.abspath(f"./generated/{project_id}")

    if not os.path.exists(os.path.join(base_dir, "package.json")):
        return LintResult(has_errors=False, errors=[], raw_output="No package.json")

    try:
        process = await asyncio.create_subprocess_exec(
            "npx",
            "eslint",
            "src",
            "--format",
            "json",
            cwd=base_dir,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )

        stdout, stderr = await asyncio.wait_for(process.communicate(), timeout=60.0)

        output = stdout.decode("utf-8", errors="replace")
        errors = parse_eslint_output(output)

        return LintResult(has_errors=len(errors) > 0, errors=errors, raw_output=output)
    except asyncio.TimeoutError:
        return LintResult(has_errors=False, errors=[], raw_output="ESLint timed out")
    except FileNotFoundError:
        return LintResult(has_errors=False, errors=[], raw_output="ESLint not found")
    except Exception as e:
        return LintResult(has_errors=False, errors=[], raw_output=f"Error: {str(e)}")


def parse_eslint_output(output: str) -> List[TypeError]:
    errors = []

    try:
        data = json.loads(output)
        for file_result in data:
            filepath = file_result.get("filePath", "")
            for msg in file_result.get("messages", []):
                errors.append(
                    TypeError(
                        file=filepath,
                        line=msg.get("line", 0),
                        column=msg.get("column", 0),
                        message=msg.get("message", ""),
                        code=msg.get("ruleId", "eslint"),
                        severity="error" if msg.get("severity") == 2 else "warning",
                    )
                )
    except json.JSONDecodeError:
        pass

    return errors


def format_errors_for_prompt(errors: List[TypeError]) -> str:
    if not errors:
        return ""

    lines = ["TypeScript errors found:"]
    for err in errors[:10]:
        lines.append(f"- {err.file}:{err.line}:{err.column}: {err.message}")

    if len(errors) > 10:
        lines.append(f"... and {len(errors) - 10} more errors")

    return "\n".join(lines)


async def lint_project(project_id: str) -> dict:
    tsc_result = await run_typecheck(project_id)

    return {
        "has_errors": tsc_result.has_errors,
        "errors": [
            {
                "file": e.file,
                "line": e.line,
                "column": e.column,
                "message": e.message,
                "code": e.code,
                "severity": e.severity,
            }
            for e in tsc_result.errors
        ],
        "raw_output": tsc_result.raw_output,
        "error_count": len(tsc_result.errors),
    }
