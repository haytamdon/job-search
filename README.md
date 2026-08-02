# JobAgent Portal

JobAgent Portal is an AI-powered job search dashboard for finding tech roles that explicitly mention visa sponsorship and/or relocation support. It combines a React dashboard, a TypeScript Express gateway, PostgreSQL persistence, and a Python FastAPI search agent that uses LangChain, OpenRouter, and Bright Data MCP tooling to scan LinkedIn job listings.

## What it does

- Searches for jobs by role, country, posting age, experience level, and workplace type.
- Prioritizes postings that mention visa sponsorship or relocation support.
- Runs searches asynchronously so the UI can show live task progress.
- Persists search history and final structured results in PostgreSQL.
- Displays results in a searchable/filterable table.
- Exports matching jobs as CSV for spreadsheet use.
- Tracks gateway, database, and search microservice health.
- Supports light/dark UI themes.

## Architecture

```text
┌──────────────────────────┐
│ React + Vite Frontend    │
│ served by Nginx          │
│ default host port: 5174  │
└─────────────┬────────────┘
              │ HTTP
              ▼
┌──────────────────────────┐
│ TypeScript Express API   │
│ default host port: 3000  │
│ - API gateway            │
│ - PostgreSQL persistence │
│ - background polling     │
└───────┬────────────┬─────┘
        │            │
        │ SQL        │ HTTP
        ▼            ▼
┌──────────────┐   ┌──────────────────────────┐
│ PostgreSQL   │   │ Python FastAPI Agent     │
│ host: 5431   │   │ default host port: 8001  │
└──────────────┘   │ - LangChain MCPAgent     │
                   │ - OpenRouter LLMs        │
                   │ - Bright Data MCP        │
                   └──────────────────────────┘
```

### Services

| Service | Path | Purpose |
| --- | --- | --- |
| Frontend | `frontend/` | React/Vite UI for creating searches, monitoring active scans, browsing history, filtering results, and exporting CSV. |
| Backend gateway | `backend/` | Express API that stores tasks in PostgreSQL, triggers Python searches, polls task status, and serves history/results to the UI. |
| Search microservice | `microservices/job-search/` | FastAPI service that runs the LangChain MCP agent and structures raw results into JSON. |
| Database | Docker image `postgres:16-alpine` | Persists search task metadata and structured result JSON. |

## Prerequisites

For the recommended Docker workflow:

- Docker Desktop or Docker Engine with Docker Compose
- OpenRouter API key
- Bright Data API token with MCP access

For local development without Docker:

- Node.js 20+
- npm
- Python 3.13+
- `uv` Python package manager
- PostgreSQL 16+
- `npx` available on PATH, because the Python agent starts `@brightdata/mcp` through Node

## Environment variables

Copy the example file and fill in your secrets:

```bash
cp .env.example .env
```

Required values:

```env
OPENROUTER_API_KEY=your_openrouter_key
BRIGHTDATA_API_TOKEN=your_brightdata_token
```

Optional port overrides:

```env
DB_PORT=5431
AGENT_PORT=8001
BACKEND_PORT=3000
FRONTEND_PORT=5174
VITE_BACKEND_PORT=3000
```

### Variable reference

| Variable | Used by | Default | Description |
| --- | --- | --- | --- |
| `OPENROUTER_API_KEY` | Python microservice | none | Required. Used by `langchain_openrouter.ChatOpenRouter`. |
| `BRIGHTDATA_API_TOKEN` | Python microservice | none | Required. Passed to the Bright Data MCP server as `API_TOKEN`. |
| `DB_PORT` | Docker Compose / backend local fallback | `5431` in Compose, `5432` in backend local fallback | Host port for PostgreSQL. |
| `AGENT_PORT` | Docker Compose / backend local fallback | `8001` in Compose, `8000` in backend local fallback | Host port for the Python FastAPI service. |
| `BACKEND_PORT` | Docker Compose / backend local fallback | `3000` | Host port for the Express gateway. |
| `FRONTEND_PORT` | Docker Compose / Vite dev server | `5174` | Host port for the frontend. |
| `VITE_BACKEND_PORT` | Frontend build/dev | `3000` | Port used to build the default browser API URL: `http://localhost:<port>`. |
| `VITE_API_BASE` | Frontend build/dev | `http://localhost:${VITE_BACKEND_PORT || 3000}` | Optional full backend API base URL override. |

> Note: `.env.example` also contains `BRIGHT_DATA_API_KEY`, but the current code reads `BRIGHTDATA_API_TOKEN`. Fill `BRIGHTDATA_API_TOKEN` for the application to work.

## Quick start with Docker Compose

1. Create `.env`:

   ```bash
   cp .env.example .env
   ```

2. Edit `.env` and set:

   ```env
   OPENROUTER_API_KEY=...
   BRIGHTDATA_API_TOKEN=...
   ```

3. Build and start all services:

   ```bash
   docker compose up --build
   ```

4. Open the dashboard:

   ```text
   http://localhost:5174
   ```

5. Check backend health:

   ```text
   http://localhost:3000/health
   ```

To stop the stack:

```bash
docker compose down
```

To stop the stack and delete the PostgreSQL volume:

```bash
docker compose down -v
```

## Local development

Docker Compose is the simplest way to run the full application. If you want to run services manually, start them in this order: PostgreSQL, Python microservice, backend gateway, frontend.

### 1. Start PostgreSQL

Use a local PostgreSQL instance with this database URL, or equivalent values:

```text
postgresql://postgres:postgres@localhost:5432/jobsearch
```

If you use the Compose database only, you can start just PostgreSQL:

```bash
docker compose up postgres-db
```

With the default Compose port, the local connection string is:

```text
postgresql://postgres:postgres@localhost:5431/jobsearch
```

### 2. Run the Python search microservice

```bash
cd microservices/job-search
uv sync
uv run uvicorn app:app --host 0.0.0.0 --port 8000 --reload
```

The microservice exposes:

```text
http://localhost:8000
```

Make sure the shell environment includes:

```env
OPENROUTER_API_KEY=...
BRIGHTDATA_API_TOKEN=...
```

### 3. Run the TypeScript backend gateway

```bash
cd backend
npm install
npm run dev
```

Useful local environment values:

```env
PORT=3000
DATABASE_URL=postgresql://postgres:postgres@localhost:5431/jobsearch
MICROSERVICE_URL=http://localhost:8000
```

The backend automatically bootstraps the `search_tasks` table on startup.

### 4. Run the frontend

```bash
cd frontend
npm install
npm run dev
```

Open the Vite dev server URL shown in the terminal, usually:

```text
http://localhost:5174
```

## API reference

### Backend gateway (`backend/src/server.ts`)

Base URL in Docker/default local setup:

```text
http://localhost:3000
```

| Method | Endpoint | Description |
| --- | --- | --- |
| `GET` | `/health` | Checks gateway, PostgreSQL, and Python microservice status. |
| `GET` | `/api/jobs/history` | Returns all persisted search tasks ordered newest first. |
| `GET` | `/api/jobs/tasks/:id` | Returns a specific task, including stored result JSON when available. |
| `DELETE` | `/api/jobs/tasks/:id` | Deletes a task and its results from PostgreSQL. |
| `POST` | `/api/jobs/search` | Creates a persisted async task, triggers the Python agent, and starts background polling. |
| `POST` | `/api/jobs/search/sync` | Runs a synchronous search through the Python service and stores the result. Use cautiously because it blocks until completion. |

Example async search request:

```bash
curl -X POST http://localhost:3000/api/jobs/search \
  -H "Content-Type: application/json" \
  -d '{
    "country": "Germany",
    "job_title": "AI engineer",
    "limit": 50,
    "last_days": 30,
    "experience_years": 3,
    "workplace_type": "hybrid"
  }'
```

Example response:

```json
{
  "task_id": "7c0d5d5b-0000-0000-0000-000000000000",
  "status": "PENDING",
  "message": "Job search task initiated successfully.",
  "created_at": "2026-08-02T12:00:00.000Z"
}
```

Then poll:

```bash
curl http://localhost:3000/api/jobs/tasks/<task_id>
```

### Python microservice (`microservices/job-search/app.py`)

Base URL in Docker/default host setup:

```text
http://localhost:8001
```

Base URL when running the service locally with the command above:

```text
http://localhost:8000
```

| Method | Endpoint | Description |
| --- | --- | --- |
| `GET` | `/` | Health check for the FastAPI service. |
| `POST` | `/api/jobs/search` | Starts an in-memory async search task. The backend gateway normally calls this endpoint. |
| `GET` | `/api/jobs/tasks/{task_id}` | Returns Python task status, progress, errors, and raw structured result map. |
| `POST` | `/api/jobs/search/sync` | Runs the search synchronously and returns results directly. |

## Search request fields

| Field | Type | Default | Description |
| --- | --- | --- | --- |
| `country` | string | `Germany` | Destination country to search in. |
| `job_title` | string | `AI engineer` | Target role/title. |
| `limit` | number | `150` | Maximum number of jobs requested from the agent. |
| `last_days` | number | `30` | Only search for jobs posted in this recent-day window. |
| `experience_years` | number \| null | `null` | Optional approximate target years of experience. |
| `workplace_type` | string | `all` | `all`, `remote`, `hybrid`, or `on-site`. |

## Data persistence

The backend creates and maintains a PostgreSQL table named `search_tasks`:

```sql
CREATE TABLE IF NOT EXISTS search_tasks (
  id UUID PRIMARY KEY,
  country VARCHAR(100) NOT NULL,
  job_title VARCHAR(100) NOT NULL,
  limit_count INT NOT NULL,
  last_days INT NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'PENDING',
  progress TEXT NOT NULL DEFAULT 'Task queued.',
  result_markdown TEXT,
  error_message TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  completed_at TIMESTAMP,
  experience_years INT,
  workplace_type VARCHAR(50),
  result_json TEXT
);
```

The Python microservice also writes backup output files under `jobs1/` inside its runtime working directory. That directory is ignored by git.

## Frontend usage guide

1. Open the dashboard.
2. In the left sidebar, choose:
   - target job title
   - destination country
   - maximum listings
   - posting timeframe
   - optional experience years
   - workplace setup
3. Click **Scan Visa Jobs**.
4. Watch progress in **Active Scans**.
5. After completion, review results in **Results Board**.
6. Filter results by keyword, workplace type, or minimum salary.
7. Click **Save as Excel (CSV)** to export the currently matching rows.

Keyboard shortcuts:

| Shortcut | Action |
| --- | --- |
| `Ctrl+Enter` / `Cmd+Enter` | Submit the search form. |
| `/` or `Ctrl+K` / `Cmd+K` | Focus the results keyword search box when not typing in another input. |

## NPM scripts

### Backend

Run from `backend/`:

| Script | Description |
| --- | --- |
| `npm run dev` | Starts the Express gateway with `ts-node-dev`. |
| `npm run build` | Compiles TypeScript to `dist/`. |
| `npm start` | Runs the compiled server from `dist/server.js`. |

### Frontend

Run from `frontend/`:

| Script | Description |
| --- | --- |
| `npm run dev` | Starts the Vite dev server. |
| `npm run build` | Type-checks and builds the production frontend. |
| `npm run preview` | Serves the built frontend locally with Vite preview. |
| `npm run lint` | Runs ESLint if lint dependencies/configuration are installed. |

## Docker ports

Default host ports from `docker-compose.yml`:

| Service | Container port | Host port |
| --- | ---: | ---: |
| PostgreSQL | `5432` | `${DB_PORT:-5431}` |
| Python microservice | `8000` | `${AGENT_PORT:-8001}` |
| Backend gateway | `3000` | `${BACKEND_PORT:-3000}` |
| Frontend | `80` | `${FRONTEND_PORT:-5174}` |

## Project structure

```text
.
├── backend/
│   ├── src/
│   │   ├── db.ts          # PostgreSQL pool and schema bootstrap
│   │   └── server.ts      # Express API gateway and polling manager
│   ├── Dockerfile
│   ├── package.json
│   └── tsconfig.json
├── frontend/
│   ├── src/
│   │   ├── App.tsx        # Main dashboard UI
│   │   ├── index.css      # Application styling and theme variables
│   │   └── main.tsx       # React entry point
│   ├── Dockerfile
│   ├── nginx.conf
│   ├── package.json
│   └── vite.config.ts
├── microservices/
│   └── job-search/
│       ├── app.py         # FastAPI endpoints and in-memory task tracking
│       ├── config.py      # OpenRouter and Bright Data MCP configuration
│       ├── models.py      # Pydantic request/result models
│       ├── services.py    # LangChain MCP search and result structuring
│       ├── Dockerfile
│       └── pyproject.toml
├── docker-compose.yml
├── .env.example
├── DESIGN.md
├── PRODUCT.md
└── README.md
```

## Troubleshooting

### Frontend says the gateway is offline

- Confirm the backend is running: `http://localhost:3000/health`.
- If you changed `BACKEND_PORT`, make sure the frontend build/dev environment uses the same port through `VITE_BACKEND_PORT` or `VITE_API_BASE`.
- In Docker, rebuild the frontend after changing Vite environment values.

### Backend cannot connect to PostgreSQL

- Confirm PostgreSQL is running.
- Check `DATABASE_URL` if running locally.
- Check `DB_PORT` if using Compose.
- The backend retries database startup five times before exiting.

### Search task fails immediately

- Confirm `OPENROUTER_API_KEY` is set.
- Confirm `BRIGHTDATA_API_TOKEN` is set, not only `BRIGHT_DATA_API_KEY`.
- Confirm the Python service can start `npx @brightdata/mcp`.
- Check the Python microservice logs for MCP or LLM errors.

### Search completes but returns no rows

- The agent may have found no listings matching all criteria.
- Try increasing `last_days`, lowering `limit`, changing the role title, or setting workplace type to `all`.
- Check the task detail response for `result_json` and `error_message`.

### Docker build is slow

- The Python image installs Node.js because Bright Data MCP is launched through `npx`.
- Rebuilds are faster after Docker caches dependency layers.

## Notes and limitations

- The Python microservice stores its own task state in memory. The Express gateway is the source of persisted history through PostgreSQL.
- Cancelling/deleting a task from the UI deletes the gateway database record; it does not currently stop an already-running Python background task.
- The search quality depends on OpenRouter model availability, Bright Data MCP access, and the target job market.
- The app is intended for personal job-search automation and review. Always verify job details on the original posting before applying.
