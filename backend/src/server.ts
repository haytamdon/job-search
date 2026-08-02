import express from 'express';
import cors from 'cors';
import axios from 'axios';
import { validate as validateUuid, v4 as uuidv4 } from 'uuid';
import * as db from './db';

const app = express();
const port = process.env.PORT || process.env.BACKEND_PORT || 3000;
const MICROSERVICE_URL = process.env.MICROSERVICE_URL || `http://localhost:${process.env.AGENT_PORT || '8000'}`;
const POLL_INTERVAL_MS = 4000;
const MAX_POLL_FAILURES = 5;
const activePollers = new Map<string, NodeJS.Timeout>();

app.use(cors());
app.use(express.json());

const isValidUuid = (id: string) => validateUuid(id);

interface SearchInput {
  country: string;
  job_title: string;
  limit: number;
  last_days: number;
  experience_years: number | null;
  workplace_type: 'all' | 'remote' | 'hybrid' | 'on-site';
}

const parseStringField = (value: unknown, fallback: string, field: string, maxLength: number) => {
  const rawValue = value === undefined ? fallback : value;
  if (typeof rawValue !== 'string') {
    return { error: `${field} must be a string.` };
  }

  const trimmed = rawValue.trim();
  if (trimmed.length === 0 || trimmed.length > maxLength) {
    return { error: `${field} must be between 1 and ${maxLength} characters.` };
  }

  return { value: trimmed };
};

const parseIntegerField = (
  value: unknown,
  fallback: number,
  field: string,
  min: number,
  max: number,
  nullable = false
) => {
  if (nullable && (value === undefined || value === null || value === '')) {
    return { value: null };
  }

  const rawValue = value === undefined ? fallback : value;
  const parsed = typeof rawValue === 'number' ? rawValue : Number(rawValue);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    return { error: `${field} must be an integer between ${min} and ${max}.` };
  }

  return { value: parsed };
};

const parseSearchRequest = (body: any): { value?: SearchInput; error?: string } => {
  const country = parseStringField(body?.country, 'Germany', 'country', 100);
  if (country.error || country.value === undefined) return { error: country.error };

  const jobTitle = parseStringField(body?.job_title, 'AI engineer', 'job_title', 100);
  if (jobTitle.error || jobTitle.value === undefined) return { error: jobTitle.error };

  const limit = parseIntegerField(body?.limit, 150, 'limit', 1, 500);
  if (limit.error || limit.value === undefined || limit.value === null) return { error: limit.error };

  const lastDays = parseIntegerField(body?.last_days, 30, 'last_days', 1, 365);
  if (lastDays.error || lastDays.value === undefined || lastDays.value === null) return { error: lastDays.error };

  const experienceYears = parseIntegerField(body?.experience_years, 0, 'experience_years', 0, 50, true);
  if (experienceYears.error || experienceYears.value === undefined) return { error: experienceYears.error };

  const workplaceType = body?.workplace_type === undefined ? 'all' : body.workplace_type;
  if (!['all', 'remote', 'hybrid', 'on-site'].includes(workplaceType)) {
    return { error: 'workplace_type must be one of all, remote, hybrid, or on-site.' };
  }

  return {
    value: {
      country: country.value,
      job_title: jobTitle.value,
      limit: limit.value,
      last_days: lastDays.value,
      experience_years: experienceYears.value,
      workplace_type: workplaceType
    }
  };
};

// Background polling manager for active python microservice tasks
const startPollingTask = (taskId: string, pythonTaskId: string) => {
  let consecutiveFailures = 0;

  const stopPolling = (interval: NodeJS.Timeout) => {
    clearInterval(interval);
    activePollers.delete(taskId);
  };

  const failTaskAndStop = async (interval: NodeJS.Timeout, message: string) => {
    stopPolling(interval);
    await db.query(
      `UPDATE search_tasks
       SET status = 'FAILED', progress = $1, error_message = $2, completed_at = $3
       WHERE id = $4`,
      [message, message, new Date().toISOString(), taskId]
    );
  };

  const interval = setInterval(async () => {
    try {
      console.log(`Polling status for Python task: ${pythonTaskId} (Local DB ID: ${taskId})`);
      const response = await axios.get(`${MICROSERVICE_URL}/api/jobs/tasks/${pythonTaskId}`);
      consecutiveFailures = 0;
      const data = response.data;

      const status = data.status;
      const progress = data.progress || 'Scanning jobs...';
      const errorMessage = data.error || null;
      let completedAt = null;
      let resultJson = null;

      if (status === 'COMPLETED') {
        completedAt = new Date().toISOString();
        const resultKeys = Object.keys(data.results || {});
        if (resultKeys.length > 0) {
          resultJson = data.results[resultKeys[0]]; // structured JSON string
        }
      } else if (status === 'FAILED') {
        completedAt = new Date().toISOString();
      }

      if (status === 'COMPLETED' || status === 'FAILED') {
        stopPolling(interval);
        console.log(`Task ${taskId} finished with status: ${status}. Updating database...`);
        await db.query(
          `UPDATE search_tasks
           SET status = $1, progress = $2, result_json = $3, error_message = $4, completed_at = $5
           WHERE id = $6`,
          [status, progress, resultJson, errorMessage, completedAt, taskId]
        );
      } else {
        // Task still running, update progress and status
        await db.query(
          `UPDATE search_tasks
           SET status = $1, progress = $2
           WHERE id = $3`,
          [status, progress, taskId]
        );
      }
    } catch (err: any) {
      consecutiveFailures += 1;
      console.error(`Error polling Python task ${pythonTaskId} for Local DB ID ${taskId}:`, err.message);

      if (axios.isAxiosError(err) && err.response?.status === 404) {
        await failTaskAndStop(interval, 'Search task was lost by the Python microservice.');
        return;
      }

      if (consecutiveFailures >= MAX_POLL_FAILURES) {
        await failTaskAndStop(interval, 'Search agent polling failed repeatedly.');
      }
    }
  }, POLL_INTERVAL_MS);

  activePollers.set(taskId, interval);
};

// Health Check
app.get('/health', async (req, res) => {
  try {
    const dbCheck = await db.query('SELECT NOW()');
    let microserviceStatus = 'offline';
    
    try {
      const msCheck = await axios.get(`${MICROSERVICE_URL}/`);
      if (msCheck.status === 200) {
        microserviceStatus = 'online';
      }
    } catch (e) {
      // Microservice offline
    }
    
    res.json({
      status: 'healthy',
      database: dbCheck.rows.length > 0 ? 'online' : 'error',
      microservice: microserviceStatus,
      timestamp: new Date().toISOString()
    });
  } catch (err: any) {
    res.status(500).json({
      status: 'unhealthy',
      error: err.message
    });
  }
});

// GET /api/jobs/history - Fetch past queries & outputs
app.get('/api/jobs/history', async (req, res) => {
  try {
    const result = await db.query(
      'SELECT id, country, job_title, limit_count, last_days, status, progress, error_message, created_at, completed_at, experience_years, workplace_type FROM search_tasks ORDER BY created_at DESC'
    );
    res.json(result.rows);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/jobs/tasks/:id - Retrieve status and result of a specific search
app.get('/api/jobs/tasks/:id', async (req, res) => {
  if (!isValidUuid(req.params.id)) {
    return res.status(400).json({ error: 'Invalid task id.' });
  }

  try {
    const result = await db.query('SELECT * FROM search_tasks WHERE id = $1', [req.params.id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Search task not found.' });
    }
    res.json(result.rows[0]);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/jobs/tasks/:id - Delete a specific search task and its results from history
app.delete('/api/jobs/tasks/:id', async (req, res) => {
  if (!isValidUuid(req.params.id)) {
    return res.status(400).json({ error: 'Invalid task id.' });
  }

  try {
    const poller = activePollers.get(req.params.id);
    if (poller) {
      clearInterval(poller);
      activePollers.delete(req.params.id);
    }

    const result = await db.query('DELETE FROM search_tasks WHERE id = $1', [req.params.id]);
    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Search task not found.' });
    }

    res.json({ success: true, message: `Task ${req.params.id} successfully deleted.` });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/jobs/search - Trigger an asynchronous job search
app.post('/api/jobs/search', async (req, res) => {
  const parsedRequest = parseSearchRequest(req.body);
  if (!parsedRequest.value) {
    return res.status(400).json({ error: parsedRequest.error });
  }

  const { country, job_title, limit, last_days, experience_years, workplace_type } = parsedRequest.value;
  const taskId = uuidv4();
  const createdAt = new Date().toISOString();
  
  try {
    // 1. Insert search task into PostgreSQL
    await db.query(
      `INSERT INTO search_tasks (id, country, job_title, limit_count, last_days, experience_years, workplace_type, status, progress, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'PENDING', 'Task queued.', $8)`,
      [taskId, country, job_title, limit, last_days, experience_years, workplace_type, createdAt]
    );
    
    // 2. Call Python microservice to trigger search
    console.log(`Triggering search on microservice: ${country} - ${job_title}`);
    const msResponse = await axios.post(`${MICROSERVICE_URL}/api/jobs/search`, {
      country,
      job_title,
      limit,
      last_days,
      experience_years,
      workplace_type
    });
    
    const pythonTaskId = msResponse.data.task_id;
    if (typeof pythonTaskId !== 'string' || pythonTaskId.trim() === '') {
      throw new Error('Search agent did not return a valid task id.');
    }

    // 3. Start background polling
    startPollingTask(taskId, pythonTaskId);
    
    res.status(202).json({
      task_id: taskId,
      status: 'PENDING',
      message: 'Job search task initiated successfully.',
      created_at: createdAt
    });
  } catch (err: any) {
    console.error('Failed to trigger job search:', err.message);
    
    // Update task to FAILED in database if it was inserted
    await db.query(
      `UPDATE search_tasks 
       SET status = 'FAILED', progress = 'Failed to trigger search agent.', error_message = $1, completed_at = $2
       WHERE id = $3`,
      [err.message, new Date().toISOString(), taskId]
    ).catch(() => {});
    
    res.status(500).json({
      error: `Failed to trigger search agent: ${err.message}`
    });
  }
});

// POST /api/jobs/search/sync - Trigger a synchronous search
app.post('/api/jobs/search/sync', async (req, res) => {
  const { country = 'Germany', job_title = 'AI engineer', limit = 150, last_days = 30 } = req.body;
  const taskId = uuidv4();
  const createdAt = new Date().toISOString();
  
  try {
    // Insert task as PENDING first
    await db.query(
      `INSERT INTO search_tasks (id, country, job_title, limit_count, last_days, status, progress, created_at)
       VALUES ($1, $2, $3, $4, $5, 'RUNNING', 'Running synchronous search...', $6)`,
      [taskId, country, job_title, limit, last_days, createdAt]
    );
    
    // Call Python microservice synchronously
    const msResponse = await axios.post(`${MICROSERVICE_URL}/api/jobs/search/sync`, {
      country,
      job_title,
      limit,
      last_days
    });
    
    const results = msResponse.data.results || {};
    const resultKeys = Object.keys(results);
    const resultJson = resultKeys.length > 0 ? results[resultKeys[0]] : null;
    const completedAt = new Date().toISOString();
    
    // Update database as COMPLETED
    await db.query(
      `UPDATE search_tasks 
       SET status = 'COMPLETED', progress = 'Search completed successfully.', result_json = $1, completed_at = $2
       WHERE id = $3`,
      [resultJson, completedAt, taskId]
    );
    
    res.json({
      task_id: taskId,
      status: 'COMPLETED',
      results: results
    });
  } catch (err: any) {
    console.error('Failed synchronous search:', err.message);
    const completedAt = new Date().toISOString();
    
    await db.query(
      `UPDATE search_tasks 
       SET status = 'FAILED', progress = 'Synchronous search failed.', error_message = $1, completed_at = $2
       WHERE id = $3`,
      [err.message, completedAt, taskId]
    ).catch(() => {});
    
    res.status(500).json({
      error: `Synchronous search failed: ${err.message}`
    });
  }
});

// Bootstrap database and start Express server
db.bootstrapDatabase().then(() => {
  app.listen(port, () => {
    console.log(`TypeScript Gateway server running on port ${port}`);
  });
});
