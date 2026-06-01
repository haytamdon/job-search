import os
import uuid
import asyncio
from datetime import datetime
from typing import List, Dict, Optional
from fastapi import FastAPI, BackgroundTasks, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from dotenv import load_dotenv

from langchain_openrouter import ChatOpenRouter
from mcp_use import MCPAgent, MCPClient

# Load environment variables
load_dotenv()

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

# In-memory database for tracking jobs/tasks (Note: gateway will now persist to PostgreSQL)
tasks_db: Dict[str, Dict] = {}

class SearchRequest(BaseModel):
    country: str = Field(default="Germany", description="Country to search in.")
    job_title: str = Field(default="AI engineer", description="Job title to search.")
    limit: int = Field(default=150, description="Minimum number of jobs to request.")
    last_days: int = Field(default=30, description="Lookback window in days.")

class TaskResponse(BaseModel):
    task_id: str
    status: str
    message: str
    created_at: str

def get_mcp_config() -> dict:
    """Retrieve MCP Configuration for Bright Data."""
    brightdata_token = os.getenv("BRIGHTDATA_API_TOKEN")
    if not brightdata_token:
        raise ValueError("BRIGHTDATA_API_TOKEN environment variable is not set.")
    return {
        "mcpServers": {
            "Bright Data": {
                "command": "npx",
                "args": ["@brightdata/mcp"],
                "env": {
                    "API_TOKEN": brightdata_token,
                    "GROUPS": "advanced_scraping,browser",
                    "TOOLS": "web_data_linkedin_person_profile,web_data_linkedin_company_profile,web_data_linkedin_job_listings,web_data_linkedin_posts,web_data_linkedin_people_search"
                }
            }
        }
    }

async def run_search_logic(
    country: str, 
    job_title: str, 
    limit: int, 
    last_days: int,
    task_id: Optional[str] = None
) -> Dict[str, str]:
    """Execute the MCPAgent LinkedIn Job search logic."""
    config = get_mcp_config()
    client = MCPClient(config=config)
    
    # Initialize ChatOpenRouter LLM
    openrouter_api_key = os.getenv("OPENROUTER_API_KEY")
    if not openrouter_api_key:
        raise ValueError("OPENROUTER_API_KEY environment variable is not set.")
        
    llm = ChatOpenRouter(
        model="anthropic/claude-opus-4.8",
        api_key=openrouter_api_key,
    )
    
    # Create agent with memory enabled
    agent = MCPAgent(llm=llm, client=client, max_steps=1000, pretty_print=True, memory_enabled=True)
    
    # Ensure local directory for backup saves exists
    os.makedirs("jobs1", exist_ok=True)
    
    results = {}
    try:
        if task_id and task_id in tasks_db:
            tasks_db[task_id]["progress"] = f"Searching for {job_title} in {country}..."
        
        prompt = (
            f"Search Linkedin and any valid source and give me all of the {job_title} "
            f"jobs posted in {country} in the last {last_days} days (nothing before) that mention the possibility "
            f"of visa sponsorship and/or relocation support (A MUST).\n"
            f"Give me the title, company, location, salary range, description, publishing date, and a link to the job.\n"
            f"All of the job should still be accepting applications.\n"
            f"Give me at least a {limit} jobs.\n"
            f"Structure it as a table."
        )
        
        result = await agent.run(prompt, max_steps=1500)
        result_str = str(result)
        
        # Store in result dictionary
        key = f"{country}_{job_title}"
        results[key] = result_str
        
        # Backup to disk
        backup_filename = f"jobs1/result_{country}_{job_title.replace(' ', '_')}.md"
        with open(backup_filename, "w", encoding="utf-8") as f:
            f.write(result_str)
                    
    finally:
        # Prevent resource/process leaks
        await client.close_all_sessions()
        
    return results

async def background_search_task(
    task_id: str, 
    country: str, 
    job_title: str, 
    limit: int, 
    last_days: int
):
    """Background task wrapping the search agent execution."""
    tasks_db[task_id]["status"] = "RUNNING"
    try:
        results = await run_search_logic(
            country=country,
            job_title=job_title,
            limit=limit,
            last_days=last_days,
            task_id=task_id
        )
        tasks_db[task_id]["status"] = "COMPLETED"
        tasks_db[task_id]["progress"] = "Search completed successfully."
        tasks_db[task_id]["results"] = results
        tasks_db[task_id]["completed_at"] = datetime.utcnow().isoformat()
    except Exception as e:
        tasks_db[task_id]["status"] = "FAILED"
        tasks_db[task_id]["progress"] = "Search failed."
        tasks_db[task_id]["error"] = str(e)
        tasks_db[task_id]["completed_at"] = datetime.utcnow().isoformat()

@app.get("/", status_code=status.HTTP_200_OK)
async def health_check():
    """Health check endpoint."""
    return {
        "status": "healthy",
        "service": "LinkedIn Job Search Agent API",
        "timestamp": datetime.utcnow().isoformat()
    }

@app.post("/api/jobs/search", response_model=TaskResponse, status_code=status.HTTP_202_ACCEPTED)
async def trigger_async_search(request: SearchRequest, background_tasks: BackgroundTasks):
    """Trigger an asynchronous LinkedIn job search running in the background."""
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
        "created_at": created_at,
        "completed_at": None,
        "results": {},
        "error": None
    }
    
    background_tasks.add_task(
        background_search_task,
        task_id=task_id,
        country=request.country,
        job_title=request.job_title,
        limit=request.limit,
        last_days=request.last_days
    )
    
    return TaskResponse(
        task_id=task_id,
        status="PENDING",
        message="Job search task initiated successfully in the background.",
        created_at=created_at
    )

@app.get("/api/jobs/tasks/{task_id}", status_code=status.HTTP_200_OK)
async def get_task_status(task_id: str):
    """Retrieve status and results of a job search task."""
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
            last_days=request.last_days
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
