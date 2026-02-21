"""
Terminal command security — allowlist/blocklist for shell commands.

Validates commands before execution to prevent dangerous operations.
"""

import re
import shlex
from typing import Optional

# Commands that are always allowed
ALLOWED_COMMANDS = {
    "npm", "npx", "node", "tsc", "eslint", "vite", "vitest", "pnpm", "yarn",
    "cat", "ls", "dir", "echo", "pwd", "cd", "mkdir", "cp", "copy",
    "type", "head", "tail", "find", "grep", "wc", "sort",
    "git",
}

# Patterns that are always blocked (case-insensitive)
BLOCKED_PATTERNS = [
    r"\brm\s+-rf\b",                         # rm -rf [anything]
    r"\brm\s+-fr\b",                         # rm -fr [anything]
    r"\brm\s+--recursive\b",                 # rm --recursive [anything]
    r"\bformat\s+[a-zA-Z]:\b",               # format C:
    r"\bshutdown\b",
    r"\breboot\b",
    r"\bhalt\b",
    r"\bpoweroff\b",
    r"\binit\s+0\b",
    r"\bdel\s+/[sS]\b",                       # del /s
    r"\brd\s+/[sS]\b",                        # rd /s
    r"\brmdir\s+/[sS]\b",
    r"\bpowershell\s+-enc",                   # encoded powershell
    r"\bpowershell\s+-encodedcommand",
    r"\bcmd\s*/c\s+.*del\b",                  # cmd /c del ...
    r"\bmkfs\b",
    r"\bdd\s+if=",
    r"\b:\(\)\s*\{\s*:\|\s*:\s*&\s*\}\s*;\s*:",  # fork bomb
    r"\bcurl\b.*\|\s*(bash|sh)\b",            # curl | bash
    r"\bwget\b.*\|\s*(bash|sh)\b",
    r"\bnc\s+-[el]",                          # netcat listen
    r"\bchmod\s+777\s+/\b",
]

_blocked_re = [re.compile(p, re.IGNORECASE) for p in BLOCKED_PATTERNS]
_blocked_control_chars = re.compile(r"[;&|`<>]")


def validate_command(command: str) -> Optional[str]:
    """
    Validate a shell command. Returns None if safe, or an error message if blocked.
    """
    if not command or not command.strip():
        return "Empty command"

    stripped = command.strip()
    if "\n" in stripped or "\r" in stripped or "\x00" in stripped:
        return "Newlines and null bytes are not allowed in commands"
    if _blocked_control_chars.search(stripped):
        return "Shell control operators are blocked for safety"

    # Check against blocked patterns
    for pattern in _blocked_re:
        if pattern.search(stripped):
            return f"Command blocked for safety: matches dangerous pattern"

    # Extract the base command (first token)
    try:
        tokens = shlex.split(stripped)
    except ValueError:
        # If shlex can't parse it, try simple split
        tokens = stripped.split()

    if not tokens:
        return "Empty command"

    base_cmd = tokens[0].lower()
    # Strip path prefixes (e.g., /usr/bin/npm -> npm)
    base_cmd = base_cmd.rsplit("/", 1)[-1]
    base_cmd = base_cmd.rsplit("\\", 1)[-1]
    # Strip .exe / .cmd / .bat extensions on Windows
    for ext in (".exe", ".cmd", ".bat", ".com"):
        if base_cmd.endswith(ext):
            base_cmd = base_cmd[: -len(ext)]

    if base_cmd not in ALLOWED_COMMANDS:
        return f"Command '{base_cmd}' is not in the allowed list. Allowed: {', '.join(sorted(ALLOWED_COMMANDS))}"

    return None
