FROM python:3.13-slim-bookworm

# Install system dependencies (curl, gnupg, and Node.js for running npx MCP commands)
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    gnupg \
    && curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y nodejs \
    && rm -rf /var/lib/apt/lists/*

# Install uv for rapid Python packaging
COPY --from=ghcr.io/astral-sh/uv:latest /uv /uvx /bin/

# Set environment variables
ENV PYTHONUNBUFFERED=1 \
    UV_SYSTEM_PYTHON=1

# Set working directory
WORKDIR /app

# Copy pyproject config first to leverage Docker build cache
COPY pyproject.toml /app/

# Sync dependencies using UV
RUN uv pip install -r pyproject.toml

# Copy microservice code
COPY app.py /app/

# Expose microservice port
EXPOSE 8000

# Run FastAPI using Uvicorn
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8000"]
