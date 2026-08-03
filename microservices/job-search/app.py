import asyncio
import uuid
from datetime import datetime
from typing import Dict, Optional
from fastapi import FastAPI, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware

# Import local models, configuration, and services
from config import get_mcp_config, get_openrouter_api_key
from models import SearchRequest, TaskResponse
from services import run_search_logic

app = FastAPI(
    title="LinkedIn Job Search Agent API",
    description="An API exposing a LangChain MCPAgent with Bright Data MCP to search LinkedIn jobs with visa/relocation support.",
    version="1.0.0"
)

# Enable CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# In-memory database for tracking jobs/tasks (Note: gateway persists to PostgreSQL)
tasks_db: Dict[str, Dict] = {}
running_tasks: Dict[str, asyncio.Task] = {}
TASK_TTL_SECONDS = 60 * 60 * 6


def cleanup_completed_tasks():
    """Evict terminal in-memory tasks after a short retention window."""
    now = datetime.utcnow()
    expired_task_ids = []
    for task_id, task in tasks_db.items():
        if task.get("status") in {"PENDING", "RUNNING"}:
            continue
        completed_at = task.get("completed_at")
        if not completed_at:
            continue
        try:
            completed_time = datetime.fromisoformat(completed_at)
        except ValueError:
            continue
        if (now - completed_time).total_seconds() > TASK_TTL_SECONDS:
            expired_task_ids.append(task_id)

    for task_id in expired_task_ids:
        tasks_db.pop(task_id, None)
        running_tasks.pop(task_id, None)

async def background_search_task(
    task_id: str, 
    country: str, 
    job_title: str, 
    limit: int, 
    last_days: int,
    experience_years: Optional[int] = None,
    workplace_type: Optional[str] = None
):
    """Background task wrapping the search agent execution."""
    tasks_db[task_id]["status"] = "RUNNING"
    
    # Callback to update progress in tasks_db
    def update_progress(progress_msg: str):
        tasks_db[task_id]["progress"] = progress_msg
        
    try:
        results = await run_search_logic(
            country=country,
            job_title=job_title,
            limit=limit,
            last_days=last_days,
            experience_years=experience_years,
            workplace_type=workplace_type,
            on_progress=update_progress
        )
        tasks_db[task_id]["results"] = results
        tasks_db[task_id]["completed_at"] = datetime.utcnow().isoformat()
        tasks_db[task_id]["progress"] = "Search completed successfully."
        tasks_db[task_id]["status"] = "COMPLETED"
    except asyncio.CancelledError:
        tasks_db[task_id]["status"] = "FAILED"
        tasks_db[task_id]["progress"] = "Search cancelled."
        tasks_db[task_id]["error"] = "Search cancelled by user."
        tasks_db[task_id]["completed_at"] = datetime.utcnow().isoformat()
        raise
    except Exception as e:
        tasks_db[task_id]["status"] = "FAILED"
        tasks_db[task_id]["progress"] = "Search failed."
        tasks_db[task_id]["error"] = str(e)
        tasks_db[task_id]["completed_at"] = datetime.utcnow().isoformat()
    finally:
        running_tasks.pop(task_id, None)

@app.get("/", status_code=status.HTTP_200_OK)
async def health_check():
    """Health check endpoint."""
    config_errors = []
    try:
        get_openrouter_api_key()
    except ValueError as e:
        config_errors.append(str(e))
    try:
        get_mcp_config()
    except ValueError as e:
        config_errors.append(str(e))

    return {
        "status": "degraded" if config_errors else "healthy",
        "service": "LinkedIn Job Search Agent API",
        "config_errors": config_errors,
        "timestamp": datetime.utcnow().isoformat()
    }

@app.post("/api/jobs/search", response_model=TaskResponse, status_code=status.HTTP_202_ACCEPTED)
async def trigger_async_search(request: SearchRequest):
    """Trigger an asynchronous LinkedIn job search running in the background."""
    cleanup_completed_tasks()
    task_id = str(uuid.uuid4())
    created_at = datetime.utcnow().isoformat()
    
    tasks_db[task_id] = {
        "task_id": task_id,
        "status": "PENDING",
        "progress": "Task queued.",
        "country": request.country,
        "job_title": request.job_title,
        "limit": request.limit,
        "last_days": request.last_days,
        "experience_years": request.experience_years,
        "workplace_type": request.workplace_type,
        "created_at": created_at,
        "completed_at": None,
        "results": {},
        "error": None
    }
    
    running_tasks[task_id] = asyncio.create_task(background_search_task(
        task_id=task_id,
        country=request.country,
        job_title=request.job_title,
        limit=request.limit,
        last_days=request.last_days,
        experience_years=request.experience_years,
        workplace_type=request.workplace_type
    ))
    
    return TaskResponse(
        task_id=task_id,
        status="PENDING",
        message="Job search task initiated successfully in the background.",
        created_at=created_at
    )

@app.post("/api/jobs/tasks/{task_id}/cancel", status_code=status.HTTP_200_OK)
async def cancel_task(task_id: str):
    """Cancel an active job search task."""
    task = tasks_db.get(task_id)
    if not task:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Task with ID {task_id} not found."
        )

    running_task = running_tasks.get(task_id)
    if running_task and not running_task.done():
        running_task.cancel()
        task["status"] = "FAILED"
        task["progress"] = "Search cancellation requested."
        task["error"] = "Search cancelled by user."
        task["completed_at"] = datetime.utcnow().isoformat()
        return {"success": True, "message": "Search cancellation requested."}

    return {"success": False, "message": "Search task is not running."}

@app.get("/api/jobs/tasks/{task_id}", status_code=status.HTTP_200_OK)
async def get_task_status(task_id: str):
    """Retrieve status and results of a job search task."""
    cleanup_completed_tasks()
    task = tasks_db.get(task_id)
    if not task:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, 
            detail=f"Task with ID {task_id} not found."
        )
    return task

@app.post("/api/jobs/search/sync", status_code=status.HTTP_200_OK)
async def trigger_sync_search(request: SearchRequest):
    """Trigger a synchronous search. Blocks until completion (use with caution)."""
    try:
        results = await run_search_logic(
            country=request.country,
            job_title=request.job_title,
            limit=request.limit,
            last_days=request.last_days,
            experience_years=request.experience_years,
            workplace_type=request.workplace_type
        )
        return {
            "status": "COMPLETED",
            "results": results
        }
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Synchronous search failed: {str(e)}"
        )
