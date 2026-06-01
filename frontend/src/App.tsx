import React, { useState, useEffect, useCallback, useRef } from 'react';
import axios from 'axios';
import { 
  Briefcase, 
  Search, 
  MapPin, 
  Clock, 
  Database, 
  Cpu, 
  Activity, 
  History, 
  ExternalLink, 
  AlertCircle, 
  CheckCircle, 
  Loader2, 
  ChevronRight, 
  Filter, 
  RefreshCw 
} from 'lucide-react';

const API_BASE = 'http://localhost:3000';

interface TaskHistory {
  id: string;
  country: string;
  job_title: string;
  limit_count: number;
  last_days: number;
  status: 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED';
  progress: string;
  error_message: string | null;
  created_at: string;
  completed_at: string | null;
}

interface SelectedTaskDetail extends TaskHistory {
  result_markdown: string | null;
}

interface ParsedJob {
  title: string;
  company: string;
  location: string;
  salaryrange?: string;
  salary?: string;
  description: string;
  publishingdate?: string;
  date?: string;
  link: string;
  link_url?: string;
}

export default function App() {
  // Input parameters
  const [country, setCountry] = useState('Germany');
  const [jobTitle, setJobTitle] = useState('AI engineer');
  const [limit, setLimit] = useState(150);
  const [lastDays, setLastDays] = useState(30);

  // App states
  const [history, setHistory] = useState<TaskHistory[]>([]);
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null);
  const [activeTask, setActiveTask] = useState<SelectedTaskDetail | null>(null);
  const [selectedTask, setSelectedTask] = useState<SelectedTaskDetail | null>(null);
  const [parsedJobs, setParsedJobs] = useState<ParsedJob[]>([]);
  
  // Table search filter
  const [searchTerm, setSearchTerm] = useState('');
  
  // Health status
  const [health, setHealth] = useState({
    gateway: 'offline',
    database: 'offline',
    microservice: 'offline'
  });

  // UI States
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  // Refs
  const pollingRef = useRef<NodeJS.Timeout | null>(null);
  const logConsoleEndRef = useRef<HTMLDivElement | null>(null);

  // Fetch task history
  const fetchHistory = async () => {
    try {
      const response = await axios.get(`${API_BASE}/api/jobs/history`);
      setHistory(response.data);
    } catch (err) {
      console.error('Error fetching history:', err);
    }
  };

  // Fetch health check
  const checkSystemHealth = async () => {
    try {
      const response = await axios.get(`${API_BASE}/health`);
      setHealth({
        gateway: 'online',
        database: response.data.database === 'online' ? 'online' : 'error',
        microservice: response.data.microservice === 'online' ? 'online' : 'offline'
      });
    } catch (err) {
      setHealth({
        gateway: 'offline',
        database: 'offline',
        microservice: 'offline'
      });
    }
  };

  // Parse Markdown table returned by MCPAgent
  const parseJobsMarkdown = (markdown: string | null): ParsedJob[] => {
    if (!markdown) return [];
    try {
      const lines = markdown.trim().split('\n');
      let tableStartIndex = -1;
      
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].includes('|') && lines[i].includes('-') && i > 0) {
          tableStartIndex = i - 1;
          break;
        }
      }
      
      if (tableStartIndex === -1) return [];

      const headers = lines[tableStartIndex]
        .split('|')
        .map(h => h.trim())
        .filter(h => h !== '');

      const jobs: ParsedJob[] = [];
      for (let i = tableStartIndex + 2; i < lines.length; i++) {
        const line = lines[i];
        if (!line.includes('|')) continue;
        const cells = line
          .split('|')
          .map(c => c.trim())
          .filter((_, idx) => idx > 0 && idx <= headers.length);

        if (cells.length === 0) continue;

        const jobObj: any = {};
        headers.forEach((header, index) => {
          // Normalize header key
          const key = header.toLowerCase().replace(/[\s_]+/g, '');
          let val = cells[index] || '';
          
          // Parse links in markdown [Text](URL)
          if (val.startsWith('[') && val.includes('](')) {
            const urlMatch = val.match(/\]\((.*?)\)/);
            const textMatch = val.match(/\[(.*?)\]/);
            if (urlMatch) {
              jobObj[key + '_url'] = urlMatch[1];
              val = textMatch ? textMatch[1] : urlMatch[1];
            }
          }
          jobObj[key] = val;
        });

        // Map to structured ParsedJob properties
        jobs.push({
          title: jobObj.title || jobObj.jobtitle || 'Job Title',
          company: jobObj.company || jobObj.employer || 'Company',
          location: jobObj.location || 'Location',
          salaryrange: jobObj.salaryrange || jobObj.salary || 'N/A',
          description: jobObj.description || jobObj.summary || '',
          publishingdate: jobObj.publishingdate || jobObj.date || 'N/A',
          link: jobObj.link || 'Apply Link',
          link_url: jobObj.link_url || jobObj.url || ''
        });
      }
      return jobs;
    } catch (err) {
      console.error('Failed to parse markdown table:', err);
      return [];
    }
  };

  // Get specific task detail
  const selectTaskDetail = async (id: string, select = true) => {
    try {
      const response = await axios.get(`${API_BASE}/api/jobs/tasks/${id}`);
      const taskDetail = response.data;
      if (select) {
        setSelectedTask(taskDetail);
        setParsedJobs(parseJobsMarkdown(taskDetail.result_markdown));
      }
      return taskDetail;
    } catch (err) {
      console.error('Error fetching task details:', err);
      return null;
    }
  };

  // Poll active task status
  const pollTaskStatus = useCallback(async () => {
    if (!activeTaskId) return;
    const task = await selectTaskDetail(activeTaskId, false);
    if (!task) return;

    setActiveTask(task);
    if (task.status === 'COMPLETED' || task.status === 'FAILED') {
      setActiveTaskId(null);
      setSelectedTask(task);
      setParsedJobs(parseJobsMarkdown(task.result_markdown));
      setIsLoading(false);
      fetchHistory();
      if (pollingRef.current) clearInterval(pollingRef.current);
    }
  }, [activeTaskId]);

  // Set up polling interval
  useEffect(() => {
    if (activeTaskId) {
      pollingRef.current = setInterval(pollTaskStatus, 3000);
    }
    return () => {
      if (pollingRef.current) clearInterval(pollingRef.current);
    };
  }, [activeTaskId, pollTaskStatus]);

  // Initial loads
  useEffect(() => {
    checkSystemHealth();
    fetchHistory();
    const systemInterval = setInterval(checkSystemHealth, 10000);
    return () => clearInterval(systemInterval);
  }, []);

  // Scroll active console logs to bottom
  useEffect(() => {
    if (logConsoleEndRef.current) {
      logConsoleEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [activeTask?.progress]);

  // Trigger search trigger
  const triggerSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError(null);
    setSelectedTask(null);
    setParsedJobs([]);
    setActiveTask(null);

    try {
      const response = await axios.post(`${API_BASE}/api/jobs/search`, {
        country,
        job_title: jobTitle,
        limit,
        last_days: lastDays
      });
      
      const newTaskId = response.data.task_id;
      setActiveTaskId(newTaskId);
      fetchHistory();
    } catch (err: any) {
      setError(err.response?.data?.error || err.message || 'Failed to initialize search agent.');
      setIsLoading(false);
    }
  };

  // Filter jobs based on search term
  const filteredJobs = parsedJobs.filter(job => {
    const term = searchTerm.toLowerCase();
    return (
      job.title.toLowerCase().includes(term) ||
      job.company.toLowerCase().includes(term) ||
      job.location.toLowerCase().includes(term) ||
      job.description.toLowerCase().includes(term)
    );
  });

  return (
    <div>
      {/* Navbar Header */}
      <header className="glass-panel" style={{ margin: '1.5rem', padding: '1rem 2rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderRadius: '14px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <div style={{ background: 'var(--primary)', padding: '0.5rem', borderRadius: '10px', boxShadow: '0 0 15px var(--primary-glow)', display: 'flex', alignItems: 'center' }}>
            <Briefcase style={{ color: 'white' }} size={24} />
          </div>
          <div>
            <h1 style={{ fontSize: '1.3rem' }} className="gradient-text">JobAgent Portal</h1>
            <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Multi-Microservices AI Relocation Search</p>
          </div>
        </div>

        {/* Health Monitors */}
        <div style={{ display: 'flex', gap: '1rem', fontSize: '0.8rem', fontWeight: 600 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', color: health.gateway === 'online' ? 'var(--success)' : 'var(--danger)' }}>
            <Activity size={16} />
            <span>Gateway API: {health.gateway.toUpperCase()}</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', color: health.database === 'online' ? 'var(--success)' : health.database === 'error' ? 'var(--warning)' : 'var(--danger)' }}>
            <Database size={16} />
            <span>PostgreSQL: {health.database.toUpperCase()}</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', color: health.microservice === 'online' ? 'var(--success)' : 'var(--danger)' }}>
            <Cpu size={16} />
            <span>Search Agent: {health.microservice.toUpperCase()}</span>
          </div>
        </div>
      </header>

      {/* Main Grid Section */}
      <main className="dashboard-grid">
        {/* Left column panels */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          
          {/* Query Console Form */}
          <section className="glass-panel">
            <div className="card-header">
              <h2 style={{ fontSize: '1.05rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <Search size={18} style={{ color: 'var(--primary-hover)' }} />
                Agent Search Console
              </h2>
              {isLoading && <Loader2 className="pulse-active" size={18} style={{ color: 'var(--primary-hover)' }} />}
            </div>
            
            <form onSubmit={triggerSearch} className="card-body">
              <div className="form-group">
                <label>Job Title</label>
                <input 
                  type="text" 
                  value={jobTitle} 
                  onChange={(e) => setJobTitle(e.target.value)} 
                  required 
                  disabled={isLoading}
                  placeholder="e.g. AI engineer, Data Scientist"
                />
              </div>

              <div className="form-group">
                <label>Country Destination</label>
                <input 
                  type="text" 
                  value={country} 
                  onChange={(e) => setCountry(e.target.value)} 
                  required 
                  disabled={isLoading}
                  placeholder="e.g. Germany, Netherlands"
                />
              </div>

              <div className="form-group">
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.25rem' }}>
                  <label>Required Job Limit</label>
                  <span style={{ fontSize: '0.8rem', color: 'var(--primary-hover)', fontWeight: 600 }}>{limit} jobs</span>
                </div>
                <input 
                  type="range" 
                  min="10" 
                  max="300" 
                  step="10"
                  value={limit} 
                  onChange={(e) => setLimit(parseInt(e.target.value))} 
                  disabled={isLoading}
                  style={{ accentColor: 'var(--primary)' }}
                />
              </div>

              <div className="form-group">
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.25rem' }}>
                  <label>Age of Postings</label>
                  <span style={{ fontSize: '0.8rem', color: 'var(--primary-hover)', fontWeight: 600 }}>Last {lastDays} days</span>
                </div>
                <input 
                  type="range" 
                  min="5" 
                  max="60" 
                  step="5"
                  value={lastDays} 
                  onChange={(e) => setLastDays(parseInt(e.target.value))} 
                  disabled={isLoading}
                  style={{ accentColor: 'var(--primary)' }}
                />
              </div>

              <button 
                type="submit" 
                className="btn-glow" 
                style={{ width: '100%', marginTop: '0.5rem', justifyContent: 'center' }}
                disabled={isLoading || health.gateway === 'offline'}
              >
                {isLoading ? (
                  <>
                    <Loader2 className="pulse-active" size={18} />
                    Scanning Job Market...
                  </>
                ) : (
                  <>
                    <Search size={18} />
                    Scan Visa Jobs
                  </>
                )}
              </button>
            </form>
          </section>

          {/* Search task History list */}
          <section className="glass-panel" style={{ flexGrow: 1, minHeight: '300px' }}>
            <div className="card-header">
              <h2 style={{ fontSize: '1.05rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <History size={18} style={{ color: 'var(--primary-hover)' }} />
                PostgreSQL Search History
              </h2>
              <button 
                onClick={fetchHistory} 
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}
                title="Refresh History"
              >
                <RefreshCw size={16} />
              </button>
            </div>
            
            <div className="card-body" style={{ maxHeight: '350px', overflowY: 'auto', padding: '0.75rem' }}>
              {history.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '2rem 0', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
                  No historical search queries logged in database.
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                  {history.map((task) => (
                    <div 
                      key={task.id} 
                      onClick={() => !isLoading && selectTaskDetail(task.id)}
                      className="glass-panel"
                      style={{ 
                        padding: '0.75rem', 
                        cursor: isLoading ? 'not-allowed' : 'pointer', 
                        fontSize: '0.85rem',
                        borderColor: selectedTask?.id === task.id ? 'var(--primary)' : 'var(--panel-border)',
                        background: selectedTask?.id === task.id ? 'rgba(139, 92, 246, 0.05)' : 'rgba(17, 24, 39, 0.4)'
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.4rem', fontWeight: 600 }}>
                        <span>{task.job_title}</span>
                        <span className={`badge badge-status badge-status-${task.status.toLowerCase()}`}>
                          {task.status}
                        </span>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--text-muted)', fontSize: '0.75rem' }}>
                        <span style={{ display: 'flex', alignItems: 'center', gap: '0.2rem' }}>
                          <MapPin size={12} />
                          {task.country}
                        </span>
                        <span style={{ display: 'flex', alignItems: 'center', gap: '0.2rem' }}>
                          <Clock size={12} />
                          {new Date(task.created_at).toLocaleDateString()}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </section>
        </div>

        {/* Right column details and datatables */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          
          {/* Active Job tracker loader console */}
          {activeTask && (
            <section className="glass-panel" style={{ borderColor: 'var(--primary)' }}>
              <div className="card-header">
                <h2 style={{ fontSize: '1.05rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <Loader2 className="pulse-active" size={18} style={{ color: 'var(--primary-hover)' }} />
                  Active Search Monitor: {activeTask.job_title} in {activeTask.country}
                </h2>
                <span className="badge badge-status badge-status-running">
                  {activeTask.status}
                </span>
              </div>
              <div className="card-body">
                <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '0.5rem' }}>
                  The MCPAgent is executing LinkedIn job scraping with visa Relocation filtering logic...
                </p>
                <div className="progress-console">
                  <div style={{ marginBottom: '0.25rem', color: 'var(--text-muted)' }}>
                    [{new Date().toLocaleTimeString()}] System connection established.
                  </div>
                  <div style={{ marginBottom: '0.25rem', color: 'var(--text-muted)' }}>
                    [{new Date().toLocaleTimeString()}] Spawning LangChain agent with Claude 3.5.
                  </div>
                  <div style={{ color: '#10b981', fontWeight: 'bold' }}>
                    &gt; {activeTask.progress}
                  </div>
                  <div ref={logConsoleEndRef} />
                </div>
              </div>
            </section>
          )}

          {/* Error alerts */}
          {error && (
            <div className="glass-panel" style={{ borderColor: 'var(--danger)', background: 'rgba(239, 68, 68, 0.05)', padding: '1rem', display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
              <AlertCircle style={{ color: 'var(--danger)' }} />
              <div>
                <h3 style={{ fontSize: '0.9rem', color: 'var(--danger)' }}>Agent Execution Error</h3>
                <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{error}</p>
              </div>
            </div>
          )}

          {/* Job results details and filterable table */}
          {selectedTask ? (
            <section className="glass-panel">
              <div className="card-header" style={{ display: 'flex', flexWrap: 'wrap', gap: '1rem' }}>
                <div>
                  <h2 style={{ fontSize: '1.1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <CheckCircle size={20} style={{ color: 'var(--success)' }} />
                    Results: {selectedTask.job_title} in {selectedTask.country}
                  </h2>
                  <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                    Fetched last {selectedTask.last_days} days. Database Log UUID: {selectedTask.id}
                  </p>
                </div>
                
                {/* Search Datatable input */}
                {parsedJobs.length > 0 && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginLeft: 'auto', background: 'rgba(3, 7, 18, 0.4)', padding: '0.4rem 0.8rem', borderRadius: '8px', border: '1px solid var(--panel-border)' }}>
                    <Filter size={16} style={{ color: 'var(--primary-hover)' }} />
                    <input 
                      type="text" 
                      value={searchTerm}
                      onChange={(e) => setSearchTerm(e.target.value)}
                      placeholder="Filter by keyword..."
                      style={{ border: 'none', background: 'none', fontSize: '0.85rem', width: '180px', padding: 0 }}
                    />
                  </div>
                )}
              </div>

              <div className="card-body">
                {selectedTask.status === 'FAILED' ? (
                  <div style={{ padding: '2rem', textAlign: 'center' }}>
                    <AlertCircle style={{ color: 'var(--danger)' }} size={36} />
                    <h3 style={{ marginTop: '0.5rem', fontSize: '1rem' }}>Search Failed</h3>
                    <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>{selectedTask.error_message}</p>
                  </div>
                ) : parsedJobs.length === 0 ? (
                  <div style={{ padding: '2.5rem', textAlign: 'center', color: 'var(--text-muted)' }}>
                    No job data could be extracted. The search agent might have found 0 items matching the criteria or returned an irregular table format.
                  </div>
                ) : (
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '0.5rem' }}>
                      <span>Showing {filteredJobs.length} of {parsedJobs.length} jobs retrieved</span>
                      <span>Target: &gt;={selectedTask.limit_count} jobs requested</span>
                    </div>
                    
                    {/* The Parsed Datatable */}
                    <div className="table-container">
                      <table>
                        <thead>
                          <tr>
                            <th>Job Title</th>
                            <th>Company</th>
                            <th>Location</th>
                            <th>Estimated Salary</th>
                            <th>Status Badge</th>
                            <th>Application</th>
                          </tr>
                        </thead>
                        <tbody>
                          {filteredJobs.map((job, idx) => (
                            <tr key={idx}>
                              <td style={{ fontWeight: 600 }}>{job.title}</td>
                              <td>{job.company}</td>
                              <td>{job.location}</td>
                              <td style={{ color: 'var(--warning)', fontWeight: 500 }}>{job.salaryrange}</td>
                              <td>
                                <span className="badge badge-relocation">
                                  Visa Support
                                </span>
                              </td>
                              <td>
                                {job.link_url ? (
                                  <a 
                                    href={job.link_url} 
                                    target="_blank" 
                                    rel="noopener noreferrer" 
                                    className="btn-apply"
                                  >
                                    Apply
                                    <ExternalLink size={12} />
                                  </a>
                                ) : (
                                  <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>N/A</span>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </div>
            </section>
          ) : (
            <div className="glass-panel" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '400px', textAlign: 'center', color: 'var(--text-muted)', padding: '2rem' }}>
              <Briefcase size={48} style={{ color: 'rgba(139, 92, 246, 0.2)', marginBottom: '1rem' }} />
              <h3>Select a Task or Run a New Scan</h3>
              <p style={{ fontSize: '0.85rem', maxWidth: '380px', marginTop: '0.5rem' }}>
                Launch a scan on the left pane to execute real-time scraping, or choose an item from the PostgreSQL history list to inspect results.
              </p>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
