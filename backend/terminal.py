import asyncio
import os
import re
import subprocess

class TerminalManager:
    def __init__(self):
        self.processes: dict[str, asyncio.subprocess.Process] = {}
        self.tasks: dict[str, asyncio.Task] = {}

    async def run_command(self, project_id: str, command: str, cwd: str, websocket):
        # Validate command against security rules
        from command_security import validate_command

        rejection = validate_command(command)
        if rejection:
            await websocket.send_json({
                "type": "error",
                "data": f"⛔ {rejection}\r\n"
            })
            return

        # Ensure the directory exists
        if not os.path.exists(cwd):
            await websocket.send_json({
                "type": "error",
                "data": f"Directory {cwd} does not exist. Please scaffold the project first.\r\n"
            })
            return

        if project_id in self.processes and self.processes[project_id].returncode is None:
            await websocket.send_json({
                "type": "error",
                "data": "A command is already running. Stop it first.\r\n"
            })
            return

        try:
            process = await asyncio.create_subprocess_shell(
                command,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.STDOUT,
                cwd=cwd,
                env={**os.environ, "FORCE_COLOR": "1"},
                creationflags=subprocess.CREATE_NEW_PROCESS_GROUP if os.name == "nt" else 0,
            )
            self.processes[project_id] = process

            # Notify that process started
            await websocket.send_json({
                "type": "process_started",
                "pid": process.pid
            })

            # Read stdout line by line
            if process.stdout:
                async for line in process.stdout:
                    if line:
                        decoded_line = line.decode("utf-8", errors="replace")

                        # Check for localhost:port pattern to detect running server
                        # Common patterns: "Local: http://localhost:5173", "running at http://localhost:3000"
                        match = re.search(r"localhost:(\d+)", decoded_line)
                        if match:
                            port = match.group(1)
                            await websocket.send_json({
                                "type": "server_started",
                                "port": port
                            })

                        await websocket.send_json({
                            "type": "terminal_output",
                            "data": decoded_line
                        })

            await process.wait()
            await websocket.send_json({
                "type": "terminal_done",
                "exit_code": process.returncode
            })

        except Exception as e:
            await websocket.send_json({
                "type": "error",
                "data": f"Error executing command: {str(e)}\r\n"
            })
        finally:
            if project_id in self.processes:
                del self.processes[project_id]
            if project_id in self.tasks:
                del self.tasks[project_id]

    async def kill(self, project_id: str):
        if project_id in self.processes:
            try:
                process = self.processes[project_id]
                if os.name == "nt":
                    subprocess.run(
                        ["taskkill", "/PID", str(process.pid), "/T", "/F"],
                        check=False,
                        stdout=subprocess.DEVNULL,
                        stderr=subprocess.DEVNULL,
                    )
                else:
                    process.terminate()

                try:
                    await asyncio.wait_for(process.wait(), timeout=3.0)
                except asyncio.TimeoutError:
                    process.kill()
            except ProcessLookupError:
                pass
            except Exception as e:
                print(f"Error killing process for project {project_id}: {e}")
            finally:
                if project_id in self.processes:
                    del self.processes[project_id]
                if project_id in self.tasks:
                    task = self.tasks.pop(project_id)
                    if not task.done():
                        task.cancel()

    def set_task(self, project_id: str, task: asyncio.Task):
        self.tasks[project_id] = task

# Global instance
terminal_manager = TerminalManager()
