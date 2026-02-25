import asyncio
import contextlib
import json
import os
import re
import shutil
import subprocess
from datetime import datetime
from typing import Dict, Optional, Set
from fastapi import WebSocket

DEFAULT_PACKAGE_JSON = {
    "name": "one-project",
    "private": True,
    "version": "0.0.0",
    "type": "module",
    "scripts": {
        "dev": "vite",
        "build": "tsc -b && vite build",
        "lint": "eslint .",
        "preview": "vite preview",
    },
    "dependencies": {
        "react": "^18.3.1",
        "react-dom": "^18.3.1",
        "lucide-react": "^0.469.0",
        "class-variance-authority": "^0.7.1",
        "clsx": "^2.1.1",
        "tailwind-merge": "^2.6.0",
    },
    "devDependencies": {
        "@eslint/js": "^9.17.0",
        "@types/react": "^18.3.18",
        "@types/react-dom": "^18.3.5",
        "@vitejs/plugin-react-swc": "^3.5.0",
        "autoprefixer": "^10.4.20",
        "eslint": "^9.17.0",
        "eslint-plugin-react-hooks": "^5.0.0",
        "eslint-plugin-react-refresh": "^0.4.16",
        "globals": "^15.14.0",
        "postcss": "^8.4.49",
        "tailwindcss": "^3.4.17",
        "tailwindcss-animate": "^1.0.7",
        "typescript": "~5.6.2",
        "typescript-eslint": "^8.18.2",
        "vite": "^6.0.5",
    },
}


class DevServerManager:
    def __init__(self):
        self.processes: Dict[str, asyncio.subprocess.Process] = {}
        self.ports: Dict[str, str] = {}
        self.websockets: Dict[str, Set[WebSocket]] = {}
        self.logs: Dict[str, list] = {}

    async def register_websocket(self, project_id: str, websocket: WebSocket):
        if project_id not in self.websockets:
            self.websockets[project_id] = set()
        self.websockets[project_id].add(websocket)
        
        # Send current state
        if project_id in self.ports and self.is_running(project_id):
            await websocket.send_json({
                "type": "started",
                "port": self.ports[project_id]
            })
        elif project_id in self.ports and not self.is_running(project_id):
            del self.ports[project_id]
        
        # Send existing logs
        if project_id in self.logs:
            for log in self.logs[project_id][-100:]:
                await websocket.send_json({"type": "log", "data": log})

    async def unregister_websocket(self, project_id: str, websocket: WebSocket):
        if project_id in self.websockets:
            self.websockets[project_id].discard(websocket)

    async def _emit_log(self, project_id: str, message: str):
        if project_id not in self.logs:
            self.logs[project_id] = []
        self.logs[project_id].append(message)
        if len(self.logs[project_id]) > 500:
            self.logs[project_id] = self.logs[project_id][-500:]
        await self.broadcast(project_id, {"type": "log", "data": message})

    async def _run_command(self, project_id: str, command: str, cwd: str):
        proc = await asyncio.create_subprocess_shell(
            command,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.STDOUT,
            cwd=cwd,
        )
        tail_lines: list[str] = []
        if proc.stdout:
            async for line in proc.stdout:
                decoded = line.decode("utf-8", errors="replace")
                tail_lines.append(decoded.strip())
                tail_lines = tail_lines[-40:]
                await self._emit_log(project_id, decoded)
        await proc.wait()
        return proc.returncode, [line for line in tail_lines if line]

    def _write_default_package_json(self, cwd: str):
        package_json_path = os.path.join(cwd, "package.json")
        with open(package_json_path, "w", encoding="utf-8") as file_handle:
            json.dump(DEFAULT_PACKAGE_JSON, file_handle, indent=2)
            file_handle.write("\n")

    async def _ensure_package_json(self, project_id: str, cwd: str):
        package_json_path = os.path.join(cwd, "package.json")
        if not os.path.exists(package_json_path):
            await self._emit_log(
                project_id,
                "\033[33mpackage.json missing. Restoring a default Vite package manifest.\033[0m\n",
            )
            self._write_default_package_json(cwd)
            return

        try:
            with open(package_json_path, "r", encoding="utf-8") as file_handle:
                package_json = json.load(file_handle)
            scripts = package_json.get("scripts", {}) if isinstance(package_json, dict) else {}
            if not isinstance(package_json, dict) or "dev" not in scripts:
                raise ValueError("package.json is missing required scripts.dev")
        except Exception as exc:
            backup_name = f"package.invalid.{datetime.utcnow().strftime('%Y%m%d%H%M%S')}.json"
            backup_path = os.path.join(cwd, backup_name)
            try:
                shutil.copy2(package_json_path, backup_path)
            except Exception:
                pass
            await self._emit_log(
                project_id,
                (
                    "\033[33mInvalid package.json detected "
                    f"({exc}). Restoring a default manifest and backing up original to {backup_name}.\033[0m\n"
                ),
            )
            self._write_default_package_json(cwd)

    async def broadcast(self, project_id: str, message: dict):
        if project_id in self.websockets:
            disconnected = set()
            for ws in self.websockets[project_id]:
                try:
                    await ws.send_json(message)
                except:
                    disconnected.add(ws)
            for ws in disconnected:
                self.websockets[project_id].discard(ws)

    def is_running(self, project_id: str) -> bool:
        return project_id in self.processes and self.processes[project_id].returncode is None

    async def start(self, project_id: str, cwd: str):
        if self.is_running(project_id):
            return

        if not os.path.exists(cwd):
            await self.broadcast(project_id, {"type": "error", "message": f"Directory {cwd} not found"})
            return

        # Clear stale port state before startup.
        if project_id in self.ports:
            del self.ports[project_id]

        if project_id not in self.logs:
            self.logs[project_id] = []

        await self._ensure_package_json(project_id, cwd)

        # Check if node_modules exists and required dependencies are installed.
        node_modules_dir = os.path.join(cwd, "node_modules")
        package_json_path = os.path.join(cwd, "package.json")
        should_install = not os.path.exists(node_modules_dir)

        if not should_install and os.path.exists(package_json_path):
            try:
                with open(package_json_path, "r", encoding="utf-8") as file_handle:
                    package_json = json.load(file_handle)
                required = set(package_json.get("dependencies", {}).keys()) | set(
                    package_json.get("devDependencies", {}).keys()
                )
                for dep in required:
                    dep_path = os.path.join(node_modules_dir, *dep.split("/"))
                    if not os.path.exists(dep_path):
                        should_install = True
                        break
            except Exception:
                should_install = True

        if should_install:
            await self._emit_log(
                project_id,
                "\033[1;34mInstalling dependencies...\033[0m\n",
            )
            install_return_code, install_tail = await self._run_command(
                project_id,
                "npm install --no-audit --no-fund",
                cwd,
            )

            if install_return_code != 0:
                await self._emit_log(
                    project_id,
                    "\033[33mnpm install failed. Retrying with a clean install...\033[0m\n",
                )
                with contextlib.suppress(Exception):
                    shutil.rmtree(node_modules_dir, ignore_errors=True)
                with contextlib.suppress(Exception):
                    os.remove(os.path.join(cwd, "package-lock.json"))

                install_return_code, install_tail = await self._run_command(
                    project_id,
                    "npm install --legacy-peer-deps --no-audit --no-fund",
                    cwd,
                )

            if install_return_code != 0:
                reason = install_tail[-1] if install_tail else "Check logs for install details."
                await self.broadcast(
                    project_id,
                    {"type": "error", "message": f"npm install failed: {reason}"},
                )
                return

        await self._emit_log(project_id, "\033[1;34mStarting dev server...\033[0m\n")
        
        # Set FORCE_COLOR for better logs
        env = {**os.environ, "FORCE_COLOR": "1"}
        
        process = await asyncio.create_subprocess_shell(
            "npm run dev",
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.STDOUT,
            cwd=cwd,
            env=env,
            creationflags=subprocess.CREATE_NEW_PROCESS_GROUP if os.name == "nt" else 0,
        )
        self.processes[project_id] = process

        # Consume logs in a background task
        asyncio.create_task(self._consume_output(project_id, process))

    async def _consume_output(self, project_id: str, process: asyncio.subprocess.Process):
        if not process.stdout:
            return

        ansi_pattern = re.compile(r"\x1B\[[0-?]*[ -/]*[@-~]")
        local_port_pattern = re.compile(
            r"(?:Local:\s+http://(?:localhost|127\.0\.0\.1):(\d+))|(?:http://(?:localhost|127\.0\.0\.1):(\d+))"
        )
        
        try:
            async for line in process.stdout:
                decoded = line.decode("utf-8", errors="replace")
                plain = ansi_pattern.sub("", decoded)
                
                # Store and broadcast log
                if project_id not in self.logs:
                    self.logs[project_id] = []
                self.logs[project_id].append(decoded)
                
                # Limit logs to last 500 lines
                if len(self.logs[project_id]) > 500:
                    self.logs[project_id] = self.logs[project_id][-500:]
                    
                await self.broadcast(project_id, {"type": "log", "data": decoded})

                # Detect port
                match = local_port_pattern.search(plain)
                if match:
                    # Get the first non-None group
                    port = next(g for g in match.groups() if g is not None)
                    if self.ports.get(project_id) != port:
                        self.ports[project_id] = port
                        await self.broadcast(project_id, {"type": "started", "port": port})

            exit_code = await process.wait()
            await self.broadcast(project_id, {"type": "stopped", "exit_code": exit_code})
        except Exception as e:
            await self.broadcast(project_id, {"type": "error", "message": str(e)})
        finally:
            if project_id in self.processes and self.processes[project_id] == process:
                del self.processes[project_id]
            if project_id in self.ports:
                del self.ports[project_id]

    async def stop(self, project_id: str):
        if project_id in self.processes:
            process = self.processes[project_id]
            try:
                if os.name == 'nt':
                    subprocess.run(
                        ["taskkill", "/PID", str(process.pid), "/T", "/F"],
                        check=False,
                        stdout=subprocess.DEVNULL,
                        stderr=subprocess.DEVNULL,
                    )
                else:
                    process.terminate()
                
                try:
                    await asyncio.wait_for(process.wait(), timeout=5.0)
                except asyncio.TimeoutError:
                    process.kill()
            except Exception as e:
                print(f"Error stopping process for {project_id}: {e}")
            finally:
                if project_id in self.processes:
                    del self.processes[project_id]
                if project_id in self.ports:
                    del self.ports[project_id]
                await self.broadcast(project_id, {"type": "stopped"})

    async def restart(self, project_id: str, cwd: str):
        await self.stop(project_id)
        # Wait a bit for port to clear
        await asyncio.sleep(1)
        await self.start(project_id, cwd)

# Global instance
dev_server_manager = DevServerManager()
