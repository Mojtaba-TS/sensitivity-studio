from __future__ import annotations

import multiprocessing as mp
import os
import threading
from typing import Any

from fastapi import HTTPException

from security import MAX_CODE_BYTES


WALL_TIMEOUT_SECONDS = int(os.getenv("SANDBOX_TIMEOUT_SECONDS", "60"))
CPU_LIMIT_SECONDS = int(os.getenv("SANDBOX_CPU_SECONDS", "45"))
MEMORY_LIMIT_MB = int(os.getenv("SANDBOX_MEMORY_MB", "384"))
MAX_CONCURRENT_JOBS = int(os.getenv("SANDBOX_MAX_CONCURRENT", "1"))

_capacity = threading.BoundedSemaphore(MAX_CONCURRENT_JOBS)


def _apply_linux_limits() -> None:
    if os.name == "nt":
        return
    import resource

    memory_bytes = MEMORY_LIMIT_MB * 1024 * 1024
    resource.setrlimit(resource.RLIMIT_CPU, (CPU_LIMIT_SECONDS, CPU_LIMIT_SECONDS + 1))
    resource.setrlimit(resource.RLIMIT_AS, (memory_bytes, memory_bytes))
    resource.setrlimit(resource.RLIMIT_FSIZE, (1_048_576, 1_048_576))
    resource.setrlimit(resource.RLIMIT_NOFILE, (64, 64))
    os.nice(10)


def _worker(operation: str, payload: dict[str, Any], connection: Any) -> None:
    try:
        _apply_linux_limits()
        from main import sandbox_dispatch

        connection.send({"ok": True, "data": sandbox_dispatch(operation, payload)})
    except HTTPException as error:
        connection.send({"ok": False, "status": error.status_code, "detail": error.detail})
    except MemoryError:
        connection.send({"ok": False, "status": 422, "detail": "The model exceeded the sandbox memory limit."})
    except BaseException:
        connection.send({"ok": False, "status": 422, "detail": "The isolated model worker failed safely."})
    finally:
        connection.close()


def run_sandboxed(operation: str, payload: dict[str, Any]) -> dict[str, Any]:
    code = payload.get("code", "")
    if not isinstance(code, str) or len(code.encode("utf-8")) > MAX_CODE_BYTES:
        raise HTTPException(status_code=413, detail=f"Model code must be at most {MAX_CODE_BYTES // 1000} KB.")

    if not _capacity.acquire(blocking=False):
        raise HTTPException(status_code=429, detail="The solver is busy. Wait for the current analysis and try again.")

    context = mp.get_context("spawn")
    receiving, sending = context.Pipe(duplex=False)
    process = context.Process(target=_worker, args=(operation, payload, sending), daemon=True)
    try:
        process.start()
        sending.close()
        if not receiving.poll(WALL_TIMEOUT_SECONDS):
            process.terminate()
            process.join(timeout=2)
            if process.is_alive():
                process.kill()
                process.join(timeout=1)
            raise HTTPException(status_code=408, detail=f"Analysis exceeded the {WALL_TIMEOUT_SECONDS}-second sandbox limit.")

        response = receiving.recv()
        process.join(timeout=2)
        if not response.get("ok"):
            raise HTTPException(status_code=int(response.get("status", 422)), detail=str(response.get("detail", "Analysis failed.")))
        return response["data"]
    except EOFError as error:
        raise HTTPException(status_code=422, detail="The isolated model worker stopped before returning a result.") from error
    finally:
        receiving.close()
        if process.is_alive():
            process.terminate()
            process.join(timeout=1)
        _capacity.release()
