import os
from dotenv import load_dotenv
from langchain_openrouter import ChatOpenRouter

# Load environment variables
load_dotenv()

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

# Initialize and configure the ChatOpenRouter LLM model instance
openrouter_api_key = os.getenv("OPENROUTER_API_KEY")
if not openrouter_api_key:
    raise ValueError("OPENROUTER_API_KEY environment variable is not set.")

llm = ChatOpenRouter(
    # model="deepseek/deepseek-v4-flash",
    model="anthropic/claude-opus-4.8",
    api_key=openrouter_api_key,
)

llm_structured = ChatOpenRouter(
    model="deepseek/deepseek-v4-flash",
    api_key=openrouter_api_key,
)
    