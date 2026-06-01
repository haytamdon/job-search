import express from 'express';
import cors from 'cors';
import axios from 'axios';
import { v4 as uuidv4 } from 'uuid';
import * as db from './db';

const app = express();
const port = process.env.PORT || 3000;
const MICROSERVICE_URL = process.env.MICROSERVICE_URL || 'http://microservice-job-search:8000';

app.use(cors());
app.use(express.json());

// Background polling manager for active python microservice tasks
const startPollingTask = (taskId: string, pythonTaskId: string) => {
  const interval = setInterval(async () => {
    try {
      console.log(`Polling status for Python task: ${pythonTaskId} (Local DB ID: ${taskId})`);
      const response = await axios.get(`${MICROSERVICE_URL}/api/jobs/tasks/${pythonTaskId}`);
      const data = response.data;
      
      const status = data.status;
      const progress = data.progress || 'Scanning jobs...';
      const errorMessage = data.error || null;
      let completedAt = null;
      let resultMarkdown = null;
      
      if (status === 'COMPLETED') {
        completedAt = new Date().toISOString();
        const resultKeys = Object.keys(data.results || {});
        if (resultKeys.length > 0) {
          resultMarkdown = data.results[resultKeys[0]]; // markdown table string
        }
      } else if (status === 'FAILED') {
        completedAt = new Date().toISOString();
      }
      
      if (status === 'COMPLETED' || status === 'FAILED') {
        clearInterval(interval);
        console.log(`Task ${taskId} finished with status: ${status}. Updating database...`);
        await db.query(
          `UPDATE search_tasks 
           SET status = $1, progress = $2, result_markdown = $3, error_message = $4, completed_at = $5
           WHERE id = $6`,
          [status, progress, resultMarkdown, errorMessage, completedAt, taskId]
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
      console.error(`Error polling Python task ${pythonTaskId} for Local DB ID ${taskId}:`, err.message);
      // In case the microservice is unreachable, we do not clear the interval immediately to handle transient network issues.
    }
  }, 4000);
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
      'SELECT id, country, job_title, limit_count, last_days, status, progress, error_message, created_at, completed_at FROM search_tasks ORDER BY created_at DESC'
    );
    res.json(result.rows);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/jobs/tasks/:id - Retrieve status and result of a specific search
app.get('/api/jobs/tasks/:id', async (req, res) => {
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
  try {
    await db.query('DELETE FROM search_tasks WHERE id = $1', [req.params.id]);
    res.json({ success: true, message: `Task ${req.params.id} successfully deleted.` });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/jobs/search - Trigger an asynchronous job search
app.post('/api/jobs/search', async (req, res) => {
  const { country = 'Germany', job_title = 'AI engineer', limit = 150, last_days = 30 } = req.body;
  const taskId = uuidv4();
  const createdAt = new Date().toISOString();
  
  try {
    // 1. Insert search task into PostgreSQL
    await db.query(
      `INSERT INTO search_tasks (id, country, job_title, limit_count, last_days, status, progress, created_at)
       VALUES ($1, $2, $3, $4, $5, 'PENDING', 'Task queued.', $6)`,
      [taskId, country, job_title, limit, last_days, createdAt]
    );
    
    // 2. Call Python microservice to trigger search
    console.log(`Triggering search on microservice: ${country} - ${job_title}`);
    const msResponse = await axios.post(`${MICROSERVICE_URL}/api/jobs/search`, {
      country,
      job_title,
      limit,
      last_days
    });
    
    const pythonTaskId = msResponse.data.task_id;
    
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
    const resultMarkdown = resultKeys.length > 0 ? results[resultKeys[0]] : null;
    const completedAt = new Date().toISOString();
    
    // Update database as COMPLETED
    await db.query(
      `UPDATE search_tasks 
       SET status = 'COMPLETED', progress = 'Search completed successfully.', result_markdown = $1, completed_at = $2
       WHERE id = $3`,
      [resultMarkdown, completedAt, taskId]
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
