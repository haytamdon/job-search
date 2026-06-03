from typing import Dict, Optional, Callable
import os
import json
from mcp_use import MCPAgent, MCPClient
from langchain_core.output_parsers import PydanticOutputParser
from langchain_core.prompts import PromptTemplate
from langchain_openrouter import ChatOpenRouter

from models import JobListingsList
from config import get_mcp_config, llm

async def structure_results(llm: ChatOpenRouter, raw_results: str) -> str:
    """Structure the raw agent output into a JSON string using PydanticOutputParser."""
    parser = PydanticOutputParser(pydantic_object=JobListingsList)
    prompt = PromptTemplate(
        template="Parse the following job search results into a structured format.\n{format_instructions}\n\n{query}\n",
        input_variables=["query"],
        partial_variables={"format_instructions": parser.get_format_instructions()},
    )
    chain = prompt | llm | parser
    try:
        response = await chain.ainvoke({"query": raw_results})
        jobs_list = [job.model_dump() for job in response.jobs]
        return json.dumps(jobs_list, indent=2)
    except Exception as e:
        print(f"Error structuring results with PydanticOutputParser: {e}")
        # Fallback to empty list serialized as JSON
        return json.dumps([])

async def run_search_logic(
    country: str, 
    job_title: str, 
    limit: int, 
    last_days: int,
    experience_years: Optional[int] = None,
    workplace_type: Optional[str] = None,
    on_progress: Optional[Callable[[str], None]] = None
) -> Dict[str, str]:
    """Execute the MCPAgent LinkedIn Job search logic."""
    config = get_mcp_config()
    client = MCPClient(config=config)
    
    # Create agent with memory disabled
    agent = MCPAgent(llm=llm, client=client, max_steps=1000, pretty_print=True, memory_enabled=False)
    
    # Ensure local directory for backup saves exists
    os.makedirs("jobs1", exist_ok=True)
    
    results = {}
    try:
        if on_progress:
            on_progress(f"Searching for {job_title} in {country}...")
        
        prompt = (
            f"Search Linkedin and any valid source and give me all of the {job_title} "
            f"jobs posted in {country} in the last {last_days} days (nothing before) that mention the possibility "
            f"of visa sponsorship and/or relocation support (A MUST).\n"
        )
        if experience_years is not None:
            prompt += f"The jobs should target candidates with around {experience_years} years of experience.\n"
        if workplace_type and workplace_type.lower() != 'all':
            prompt += f"The job office presence must be {workplace_type.upper()}.\n"
            
        prompt += (
            f"Give me the title, company, location, salary range, description summary (brief 1-sentence summary of the job/responsibilities), publishing date, and a link to the job.\n"
            f"All of the job should still be accepting applications.\n"
            f"Give me at least a {limit} jobs.\n"
            f"Structure it as a table with columns: Job Title, Company, Location, Salary Range, Description Summary, Relocation Details, Link.\n"
        )
        
        result = await agent.run(prompt, max_steps=1500)
        result_str = str(result)
        
        # Structure the raw output using Pydantic output parser
        result_json = await structure_results(llm, result_str)
        
        # Store structured JSON in result dictionary
        key = f"{country}_{job_title}"
        results[key] = result_json
        
        # Backup to disk (markdown and JSON)
        backup_filename_md = f"jobs1/result_{country}_{job_title.replace(' ', '_')}.md"
        with open(backup_filename_md, "w", encoding="utf-8") as f:
            f.write(result_str)
            
        backup_filename_json = f"jobs1/result_{country}_{job_title.replace(' ', '_')}.json"
        with open(backup_filename_json, "w", encoding="utf-8") as f:
            f.write(result_json)
                    
    finally:
        # Prevent resource/process leaks
        await client.close_all_sessions()
        
    return results
