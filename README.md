# Pyomo Sensitivity Studio

An LP/MILP sensitivity workbench with real Pyomo + HiGHS solves, bi-objective ε-constraint frontiers, hybrid sensitivity, and time-series comparison.

## Local development

Backend:

```powershell
cd backend
.\.venv\Scripts\python.exe -m uvicorn main:app --reload
```

Frontend:

```powershell
cd frontend
npm.cmd run dev
```

Open `http://localhost:5173`.

## Execution safety

Public requests do not execute inside the FastAPI process. Each operation is handled by a separate worker with:

- strict AST validation and a `pyomo.environ`-only import policy;
- rejection of file, process, network, reflection, external-solver, dunder, and unbounded-loop primitives;
- a 100 KB source limit and AST/literal-size limits;
- one concurrent solver job by default;
- a wall-clock timeout;
- Linux CPU, resident-memory, file-size, and file-descriptor limits;
- non-root execution in the production Docker container.

This is strong application-level hardening, not a VM-grade security boundary. For an unrestricted public Python service, use a dedicated microVM/container sandbox provider or replace Python input with a declarative model format.

## Free demo deployment

### 1. Backend on Render

1. Push the repository to GitHub.
2. In Render, choose **New > Blueprint** and select the repository.
3. Render reads the root `render.yaml` and builds `backend/Dockerfile`.
4. Enter `http://localhost:5173` temporarily for `ALLOWED_ORIGINS`.
5. Wait for the service and copy its URL, for example `https://pyomo-sensitivity-api.onrender.com`.
6. Confirm `https://YOUR-API.onrender.com/health` returns `{"status":"ok"}`.

### 2. Frontend on Vercel

1. Import the same GitHub repository into Vercel.
2. Set **Root Directory** to `frontend`.
3. Add `VITE_API_BASE_URL=https://YOUR-API.onrender.com`.
4. Deploy and copy the production URL.

### 3. Final CORS setting

In Render, change `ALLOWED_ORIGINS` to the exact Vercel production origin:

```text
https://YOUR-PROJECT.vercel.app
```

For multiple exact origins, use a comma-separated value. Do not use `*` for the public solver API.

## Production notes

- Render Free sleeps after inactivity, so the first request can be slow.
- Keep one Uvicorn worker and one sandbox job on a memory-constrained free instance.
- The free setup is suitable for a thesis demonstration or low-traffic preview, not an SLA-backed production service.
- Add authentication, request-rate limiting at the edge, logging, and a VM-grade sandbox before allowing unrestricted anonymous traffic at scale.
