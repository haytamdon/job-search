from typing import List, Optional
from pydantic import BaseModel, Field

# Define Pydantic models for structured job search output
class JobListing(BaseModel):
    title: str = Field(description="The job title")
    company: str = Field(description="The company name")
    location: str = Field(description="The city or country location")
    salaryrange: str = Field(description="The salary range/compensation (e.g. '$100k - $120k' or 'N/A')")
    description: str = Field(description="A brief 1-sentence description summary of the job")
    relocation_details: str = Field(description="Details on visa support or relocation support")
    link: str = Field(description="The job listing link/URL")

class JobListingsList(BaseModel):
    jobs: List[JobListing] = Field(description="List of job listings")

class SearchRequest(BaseModel):
    country: str = Field(default="Germany", description="Country to search in.")
    job_title: str = Field(default="AI engineer", description="Job title to search.")
    limit: int = Field(default=150, description="Minimum number of jobs to request.")
    last_days: int = Field(default=30, description="Lookback window in days.")
    experience_years: Optional[int] = Field(default=None, description="Preferred years of experience.")
    workplace_type: Optional[str] = Field(default=None, description="Workplace type: remote, hybrid, on-site, or all.")

class TaskResponse(BaseModel):
    task_id: str
    status: str
    message: str
    created_at: str
