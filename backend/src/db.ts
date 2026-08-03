import path from 'path';
import dotenv from 'dotenv';
import { Pool } from 'pg';

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const connectionString = process.env.DATABASE_URL || `postgresql://postgres:postgres@localhost:${process.env.DB_PORT || '5432'}/jobsearch`;

export const pool = new Pool({
  connectionString,
});

export const query = (text: string, params?: any[]) => {
  return pool.query(text, params);
};

export const bootstrapDatabase = async () => {
  let retries = 5;
  while (retries > 0) {
    try {
      console.log('Connecting to PostgreSQL database...');
      // Test the connection
      await pool.query('SELECT NOW()');
      console.log('Successfully connected to PostgreSQL.');
      
      // Auto-bootstrap schema
      const initTableQuery = `
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
          created_at TIMESTAMPTZ DEFAULT NOW(),
          completed_at TIMESTAMPTZ
        );
        ALTER TABLE search_tasks
          ALTER COLUMN created_at TYPE TIMESTAMPTZ USING created_at AT TIME ZONE 'UTC',
          ALTER COLUMN created_at SET DEFAULT NOW(),
          ALTER COLUMN completed_at TYPE TIMESTAMPTZ USING completed_at AT TIME ZONE 'UTC';
        ALTER TABLE search_tasks ADD COLUMN IF NOT EXISTS experience_years INT;
        ALTER TABLE search_tasks ADD COLUMN IF NOT EXISTS workplace_type VARCHAR(50);
        ALTER TABLE search_tasks ADD COLUMN IF NOT EXISTS result_json TEXT;
      `;
      
      await pool.query(initTableQuery);

      await pool.query(
        `UPDATE search_tasks
         SET status = 'FAILED',
             progress = 'Search interrupted by backend restart.',
             error_message = 'Backend restarted before this search completed.',
             completed_at = NOW()
         WHERE status IN ('PENDING', 'RUNNING')
           AND completed_at IS NULL`
      );

      console.log('PostgreSQL database bootstrapping completed (schema is verified/created).');
      break;
    } catch (err: any) {
      retries -= 1;
      console.error(`PostgreSQL connection failed. Retries remaining: ${retries}. Error: ${err.message}`);
      if (retries === 0) {
        console.error('Could not connect to database. Server exiting.');
        process.exit(1);
      }
      // Wait 3 seconds before retrying
      await new Promise((resolve) => setTimeout(resolve, 3000));
    }
  }
};
