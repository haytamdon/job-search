import React, { useState, useEffect, useCallback, useRef } from 'react';
import axios from 'axios';
import { 
  Briefcase, 
  Search, 
  MapPin, 
  Clock, 
  Activity, 
  ExternalLink, 
  AlertCircle, 
  CheckCircle, 
  Loader2, 
  RefreshCw,
  Sun,
  Moon,
  Trash2,
  Download
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
  // Theme state
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    const saved = localStorage.getItem('theme');
    if (saved === 'dark' || saved === 'light') return saved;
    return 'light'; // Default to light mode
  });

  // Sync theme with HTML document element class
  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'dark') {
      root.classList.add('theme-dark');
    } else {
      root.classList.remove('theme-dark');
    }
    localStorage.setItem('theme', theme);
  }, [theme]);

  // Input parameters
  const [country, setCountry] = useState('Germany');
  const [jobTitle, setJobTitle] = useState('AI engineer');
  const [limit, setLimit] = useState(150);
  const [lastDays, setLastDays] = useState(30);
  const [experienceYears, setExperienceYears] = useState<number | ''>('');
  const [workplaceType, setWorkplaceType] = useState('all');

  // UI toggles
  const [showRawLogs, setShowRawLogs] = useState(false);

  // App states
  const [history, setHistory] = useState<TaskHistory[]>([]);
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null);
  const activeTaskIdRef = useRef<string | null>(null);
  const changeActiveTaskId = (id: string | null) => {
    activeTaskIdRef.current = id;
    setActiveTaskId(id);
  };
  const [activeTask, setActiveTask] = useState<SelectedTaskDetail | null>(null);
  const [selectedTask, setSelectedTask] = useState<SelectedTaskDetail | null>(null);
  const [parsedJobs, setParsedJobs] = useState<ParsedJob[]>([]);
  
  // Table search filters
  const [searchTerm, setSearchTerm] = useState('');
  const [resultsWorkplaceFilter, setResultsWorkplaceFilter] = useState('all');
  const [resultsMinSalaryFilter, setResultsMinSalaryFilter] = useState('');
  
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
  const pollingRef = useRef<any>(null);
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

  // Delete task record from database history
  const deleteTaskDetail = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation(); // Prevent card selection click trigger
    if (!window.confirm('Are you sure you want to permanently delete this search log from the database?')) return;
    try {
      await axios.delete(`${API_BASE}/api/jobs/tasks/${id}`);
      if (selectedTask?.id === id) {
        setSelectedTask(null);
        setParsedJobs([]);
      }
      fetchHistory();
    } catch (err) {
      console.error('Error deleting task:', err);
    }
  };

  // Export matching job listings to CSV
  const downloadCSV = () => {
    if (filteredJobs.length === 0) return;
    try {
      const headers = ['Job Title', 'Company', 'Location', 'Compensation', 'Classification', 'Apply Link'];
      const csvRows = [];
      csvRows.push(headers.join(','));

      filteredJobs.forEach(job => {
        const row = [
          `"${job.title.replace(/"/g, '""')}"`,
          `"${job.company.replace(/"/g, '""')}"`,
          `"${job.location.replace(/"/g, '""')}"`,
          `"${(job.salaryrange || 'N/A').replace(/"/g, '""')}"`,
          '"Visa Sponsor"',
          `"${(job.link_url || '').replace(/"/g, '""')}"`
        ];
        csvRows.push(row.join(','));
      });

      const csvContent = csvRows.join('\n');
      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.setAttribute('href', url);
      const filename = `${selectedTask?.job_title.toLowerCase().replace(/\s+/g, '_')}_${selectedTask?.country.toLowerCase()}_jobs.csv`;
      link.setAttribute('download', filename);
      link.style.visibility = 'hidden';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } catch (err) {
      console.error('Failed to export CSV:', err);
    }
  };

  // Helper to map log progress to step indices (0-4)
  const getActiveProgressStep = (progress: string, status: string): number => {
    if (status === 'COMPLETED') return 5;
    if (status === 'FAILED') return -1;
    
    const lower = progress.toLowerCase();
    if (lower.includes('saving') || lower.includes('database') || lower.includes('postgres') || lower.includes('done')) return 4;
    if (lower.includes('evaluat') || lower.includes('structur') || lower.includes('pars') || lower.includes('markdown') || lower.includes('table')) return 3;
    if (lower.includes('routing') || lower.includes('scraping') || lower.includes('linkedin') || lower.includes('scan') || lower.includes('agent')) return 2;
    if (lower.includes('spawning') || lower.includes('langchain') || lower.includes('openrouter') || lower.includes('client')) return 1;
    return 0;
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
          description: jobObj.descriptionsummary || jobObj.description || jobObj.summary || '',
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
    const currentId = activeTaskIdRef.current;
    if (!currentId) return;
    const task = await selectTaskDetail(currentId, false);
    
    // Discard if the active task ID changed or was cleared while this request was in flight!
    if (activeTaskIdRef.current !== currentId) {
      return;
    }
    
    if (!task) return;

    if (task.status === 'COMPLETED' || task.status === 'FAILED') {
      changeActiveTaskId(null);
      setActiveTask(null); // Clear active task so the monitor panel collapses upon completion
      setSelectedTask(task);
      setParsedJobs(parseJobsMarkdown(task.result_markdown));
      setIsLoading(false);
      fetchHistory();
      if (pollingRef.current) clearInterval(pollingRef.current);
    } else {
      setActiveTask(task);
    }
  }, []);

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
  }, [activeTask?.progress, showRawLogs]);

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
        last_days: lastDays,
        experience_years: experienceYears !== '' ? Number(experienceYears) : null,
        workplace_type: workplaceType
      });
      
      const newTaskId = response.data.task_id;
      changeActiveTaskId(newTaskId);
      fetchHistory();
    } catch (err: any) {
      setError(err.response?.data?.error || err.message || 'Failed to initialize search agent.');
      setIsLoading(false);
    }
  };

  // Filter jobs based on search term and criteria
  const filteredJobs = parsedJobs.filter(job => {
    // 1. Search term match
    const term = searchTerm.toLowerCase();
    const matchesSearch = term === '' || (
      job.title.toLowerCase().includes(term) ||
      job.company.toLowerCase().includes(term) ||
      job.location.toLowerCase().includes(term) ||
      job.description.toLowerCase().includes(term)
    );

    // 2. Workplace Filter match
    let matchesWorkplace = true;
    if (resultsWorkplaceFilter !== 'all') {
      const textToSearch = `${job.location} ${job.title} ${job.description}`.toLowerCase();
      if (resultsWorkplaceFilter === 'remote') {
        matchesWorkplace = textToSearch.includes('remote') || textToSearch.includes('wfh') || textToSearch.includes('work from home');
      } else if (resultsWorkplaceFilter === 'hybrid') {
        matchesWorkplace = textToSearch.includes('hybrid');
      } else if (resultsWorkplaceFilter === 'on-site') {
        matchesWorkplace = textToSearch.includes('on-site') || textToSearch.includes('onsite') || (!textToSearch.includes('remote') && !textToSearch.includes('hybrid'));
      }
    }

    // 3. Salary Filter match
    let matchesSalary = true;
    if (resultsMinSalaryFilter !== '') {
      const salaryText = (job.salaryrange || '').toLowerCase();
      const filterNumStr = resultsMinSalaryFilter.replace(/[^0-9]/g, '');
      const filterVal = filterNumStr ? parseInt(filterNumStr, 10) : 0;
      
      if (filterVal > 0) {
        // Try to extract numbers from salaryText
        const salaryNums = salaryText.replace(/,/g, '').match(/\d+/g);
        if (salaryNums && salaryNums.length > 0) {
          const parsedNums = salaryNums.map(n => {
            let val = parseInt(n, 10);
            if (val < 1000 && (salaryText.includes('k') || salaryText.includes('thousand'))) {
              val *= 1000;
            }
            return val;
          });
          const actualFilterVal = filterVal < 1000 ? filterVal * 1000 : filterVal;
          const maxSalary = Math.max(...parsedNums);
          const maxSalaryScaled = maxSalary < 1000 ? maxSalary * 1000 : maxSalary;
          matchesSalary = maxSalaryScaled >= actualFilterVal;
        } else {
          matchesSalary = salaryText.includes(resultsMinSalaryFilter.toLowerCase());
        }
      } else {
        matchesSalary = salaryText.includes(resultsMinSalaryFilter.toLowerCase());
      }
    }

    return matchesSearch && matchesWorkplace && matchesSalary;
  });

  // Keyboard shortcut listeners
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const activeEl = document.activeElement;
      const isInput = activeEl && (
        activeEl.tagName === 'INPUT' || 
        activeEl.tagName === 'SELECT' || 
        activeEl.tagName === 'TEXTAREA'
      );

      // CMD+Enter or Ctrl+Enter to trigger search scans
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault();
        const searchForm = document.querySelector('sidebar-nav form') || document.querySelector('form');
        if (searchForm) {
          searchForm.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
        }
      }

      // CMD+K or '/' to focus matches keyword search match input (only when not typing in form)
      if (!isInput && (e.key === '/' || ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k'))) {
        e.preventDefault();
        const filterInput = document.querySelector('.datatable-filter input') as HTMLInputElement;
        if (filterInput) {
          filterInput.focus();
          filterInput.select();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [filteredJobs, selectedTask]);

  return (
    <div className="app-layout">
      {/* LEFT COLUMN: Sidebar Navigation */}
      <aside className="sidebar-nav">
        {/* Brand Logo & Theme Toggler */}
        <div className="sidebar-brand">
          <div className="brand-title-group">
            <div className="sidebar-logo">
              <Briefcase size={18} />
            </div>
            <div>
              <h1 style={{ fontSize: '0.95rem', display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                JobAgent Portal
                <span className="brand-dot" />
              </h1>
              <p style={{ fontSize: '0.65rem', color: 'var(--text-muted)' }}>Multi-Microservices AI Engine</p>
            </div>
          </div>
          <button 
            type="button" 
            className="theme-toggle-btn"
            onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')}
            title={`Switch to ${theme === 'light' ? 'Dark' : 'Light'} Mode`}
            aria-label="Toggle Theme"
          >
            {theme === 'light' ? <Moon size={14} /> : <Sun size={14} />}
          </button>
        </div>

        {/* System Diagnostics Health gauges */}
        <div className="sidebar-section">
          <div className="sidebar-section-title">
            <span>System Status</span>
            <Activity size={11} />
          </div>
          <div className="diagnostics-stack">
            <div className="diagnostic-item">
              <span>Dashboard Service</span>
              <div className="diagnostic-status">
                <span className={`status-dot ${health.gateway === 'online' ? 'online' : 'offline'}`} />
                <span>{health.gateway === 'online' ? 'OPERATIONAL' : 'OFFLINE'}</span>
              </div>
            </div>
            <div className="diagnostic-item">
              <span>Database Storage</span>
              <div className="diagnostic-status">
                <span className={`status-dot ${health.database === 'online' ? 'online' : health.database === 'error' ? 'warning' : 'offline'}`} />
                <span>{health.database === 'online' ? 'OPERATIONAL' : health.database === 'error' ? 'WARNING' : 'OFFLINE'}</span>
              </div>
            </div>
            <div className="diagnostic-item">
              <span>AI Search Engine</span>
              <div className="diagnostic-status">
                <span className={`status-dot ${health.microservice === 'online' ? 'online' : 'offline'}`} />
                <span>{health.microservice === 'online' ? 'OPERATIONAL' : 'OFFLINE'}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Search Parameter Options Form */}
        <div className="sidebar-section">
          <div className="sidebar-section-title">
            <span>Scan Options</span>
            <Search size={11} />
          </div>
          <form onSubmit={triggerSearch}>
            <div className="form-group">
              <label>Target Job Title</label>
              <input 
                type="text" 
                value={jobTitle} 
                onChange={(e) => setJobTitle(e.target.value)} 
                required 
                disabled={isLoading}
                placeholder="e.g. AI engineer"
              />
            </div>

            <div className="form-group">
              <label>Destination Country</label>
              <input 
                type="text" 
                value={country} 
                onChange={(e) => setCountry(e.target.value)} 
                required 
                disabled={isLoading}
                placeholder="e.g. Germany"
              />
            </div>

            <div className="form-group">
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.25rem' }}>
                <label>Max Jobs to Scan</label>
                <span style={{ fontSize: '0.75rem', color: 'var(--primary)', fontWeight: 600 }}>{limit} listings</span>
              </div>
              <input 
                type="range" 
                min="10" 
                max="300" 
                step="10"
                value={limit} 
                onChange={(e) => setLimit(parseInt(e.target.value))} 
                disabled={isLoading}
                style={{ width: '100%' }}
                aria-label="Max Jobs Slider"
                aria-valuemin={10}
                aria-valuemax={300}
                aria-valuenow={limit}
              />
            </div>

            <div className="form-group">
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.25rem' }}>
                <label>Scraping Timeframe</label>
                <span style={{ fontSize: '0.75rem', color: 'var(--primary)', fontWeight: 600 }}>Last {lastDays} days</span>
              </div>
              <input 
                type="range" 
                min="5" 
                max="60" 
                step="5"
                value={lastDays} 
                onChange={(e) => setLastDays(parseInt(e.target.value))} 
                disabled={isLoading}
                style={{ width: '100%' }}
                aria-label="Timeframe Slider"
                aria-valuemin={5}
                aria-valuemax={60}
                aria-valuenow={lastDays}
              />
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', marginBottom: '0.75rem' }}>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label>Experience Years</label>
                <input 
                  type="number" 
                  min="0"
                  max="25"
                  value={experienceYears} 
                  onChange={(e) => setExperienceYears(e.target.value === '' ? '' : parseInt(e.target.value))} 
                  disabled={isLoading}
                  placeholder="Any"
                  style={{ width: '100%' }}
                />
              </div>

              <div className="form-group" style={{ marginBottom: 0 }}>
                <label>Office Setup</label>
                <select 
                  value={workplaceType} 
                  onChange={(e) => setWorkplaceType(e.target.value)} 
                  disabled={isLoading}
                  style={{ 
                    width: '100%', 
                    background: 'var(--bg-color)', 
                    color: 'var(--text-main)', 
                    border: '1px solid var(--panel-border)', 
                    borderRadius: '6px', 
                    padding: '0.45rem 0.5rem', 
                    fontSize: '0.82rem', 
                    outline: 'none',
                    height: '2rem'
                  }}
                >
                  <option value="all">Any</option>
                  <option value="remote">Remote</option>
                  <option value="hybrid">Hybrid</option>
                  <option value="on-site">On-site</option>
                </select>
              </div>
            </div>

            <button 
              type="submit" 
              className="btn-glow" 
              style={{ width: '100%', marginTop: '0.5rem', justifyContent: 'center' }}
              disabled={isLoading || health.gateway === 'offline'}
            >
              {isLoading ? (
                <>
                  <Loader2 className="animate-spin" size={16} style={{ display: 'inline-block', transformOrigin: 'center' }} />
                  Scanning Market...
                </>
              ) : (
                <>
                  <Search size={16} />
                  Scan Visa Jobs
                </>
              )}
            </button>
          </form>
        </div>

        {/* Database Search History list */}
        <div className="sidebar-section" style={{ borderBottom: 'none', flex: 1, display: 'flex', flexDirection: 'column', minHeight: '220px' }}>
          <div className="sidebar-section-title">
            <span>Search History</span>
            <button 
              onClick={fetchHistory} 
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', display: 'flex', alignItems: 'center' }}
              title="Refresh History"
            >
              <RefreshCw size={11} />
            </button>
          </div>
          
          <div className="history-feed" style={{ flex: 1 }}>
            {history.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '1.5rem 0', color: 'var(--text-muted)', fontSize: '0.78rem' }}>
                No previous searches found.
              </div>
            ) : (
              history.map((task) => (
                <div 
                  key={task.id} 
                  onClick={() => !isLoading && selectTaskDetail(task.id)}
                  className={`history-item ${selectedTask?.id === task.id ? 'selected' : ''}`}
                  style={{ cursor: isLoading ? 'not-allowed' : 'pointer', marginBottom: '0.5rem' }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.25rem', fontWeight: 600, alignItems: 'center' }}>
                    <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '140px' }}>
                      {task.job_title}
                    </span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                      <span className={`badge badge-status badge-status-${task.status.toLowerCase()}`} style={{ fontSize: '0.62rem', padding: '0.1rem 0.35rem' }}>
                        {task.status}
                      </span>
                      <button 
                        type="button" 
                        onClick={(e) => deleteTaskDetail(e, task.id)}
                        style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '0.1rem', display: 'flex', color: 'var(--text-muted)' }}
                        title="Remove search history"
                        className="btn-icon"
                      >
                        <Trash2 size={11} />
                      </button>
                    </div>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--text-muted)', fontSize: '0.7rem' }}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: '0.2rem' }}>
                      <MapPin size={10} />
                      {task.country}
                    </span>
                    <span style={{ display: 'flex', alignItems: 'center', gap: '0.2rem' }}>
                      <Clock size={10} />
                      {new Date(task.created_at).toLocaleDateString()}
                    </span>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </aside>

      {/* RIGHT COLUMN: Workspace Content Area */}
      <main className="main-workspace">
        {/* Workspace Context Navigation Header */}
        <div className="workspace-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <div className="sidebar-logo" style={{ background: 'var(--panel-border-glow)', color: 'var(--text-main)' }}>
              <Briefcase size={14} />
            </div>
            <div>
              <h2 style={{ fontSize: '0.85rem', fontWeight: 600 }}>
                {selectedTask 
                  ? `Scanned Jobs: ${selectedTask.job_title} in ${selectedTask.country}` 
                  : activeTask 
                    ? `Workspace: AI Search Assistant Active` 
                    : 'Search Dashboard'}
              </h2>
            </div>
          </div>
          <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontWeight: 500, fontFamily: 'monospace' }}>
            {selectedTask 
              ? `ID: ${selectedTask.id.substring(0, 8)}...` 
              : activeTask 
                ? 'AI SEARCH RUNNING' 
                : 'STORAGE STATUS: ACTIVE'}
          </div>
        </div>

        {/* Active Search Monitor with friendly visual progress bar checklist */}
        {activeTask && (
          <div className="panel-card" style={{ borderColor: 'var(--primary)', marginBottom: '1.5rem' }}>
            <div className="card-header">
              <h2 style={{ fontSize: '0.92rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <Loader2 className="animate-spin" size={16} style={{ color: 'var(--primary)', display: 'inline-block', transformOrigin: 'center' }} />
                AI Assistant is Scanning the Job Market
              </h2>
              <span className={`badge badge-status badge-status-${activeTask.status.toLowerCase()}`}>
                {activeTask.status === 'RUNNING' ? 'Running' : activeTask.status === 'PENDING' ? 'Pending' : activeTask.status}
              </span>
            </div>
            <div className="card-body">
              <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)', marginBottom: '1.25rem' }}>
                The AI is looking for up to {activeTask.limit_count} job postings posted on LinkedIn within the last {activeTask.last_days} days.
              </p>

              {/* Graphical Step Checklist for easy non-tech understanding */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', marginBottom: '1.25rem' }}>
                {[
                  { label: 'Connecting to the AI service engine', step: 0 },
                  { label: 'Initializing the LinkedIn scraper agent', step: 1 },
                  { label: 'Scanning LinkedIn for visa-friendly job leads', step: 2 },
                  { label: 'Evaluating relocation & sponsorship details', step: 3 },
                  { label: 'Saving search results safely to your storage', step: 4 }
                ].map((item, idx) => {
                  const currentStep = getActiveProgressStep(activeTask.progress, activeTask.status);
                  const isDone = currentStep > item.step;
                  const isActive = currentStep === item.step;
                  
                  return (
                    <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: '0.65rem', fontSize: '0.82rem' }}>
                      <div style={{
                        width: '16px',
                        height: '16px',
                        borderRadius: '50%',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: '0.65rem',
                        fontWeight: 700,
                        background: isDone ? 'var(--success-glow)' : isActive ? 'var(--primary-glow)' : 'var(--bg-color)',
                        color: isDone ? 'var(--success)' : isActive ? 'var(--primary)' : 'var(--text-muted)',
                        border: `1px solid ${isDone ? 'var(--success)' : isActive ? 'var(--primary)' : 'var(--panel-border)'}`,
                        transition: 'all 0.3s ease'
                      }}>
                        {isDone ? '✓' : idx + 1}
                      </div>
                      <span style={{
                        fontWeight: isActive ? 600 : 400,
                        color: isActive ? 'var(--text-main)' : 'var(--text-muted)',
                        transition: 'all 0.3s ease'
                      }}>
                        {item.label}
                        {isActive && ' (Active...)'}
                      </span>
                    </div>
                  );
                })}
              </div>

              {/* Technical logs hidden behind progressive disclosure switch */}
              <div style={{ borderTop: '1px solid var(--panel-border)', paddingTop: '0.85rem' }}>
                <button
                  type="button"
                  className="btn-apply"
                  onClick={() => setShowRawLogs(!showRawLogs)}
                  style={{ fontSize: '0.75rem', padding: '0.25rem 0.5rem', cursor: 'pointer' }}
                >
                  {showRawLogs ? 'Hide Technical Diagnostic Details' : 'Show Technical Diagnostic Details'}
                </button>
                
                {showRawLogs && (
                  <div className="progress-console" style={{ marginTop: '0.75rem' }}>
                    <div style={{ marginBottom: '0.2rem', color: 'var(--text-muted)' }}>
                      [{new Date().toLocaleTimeString()}] Pipeline triggered. Bootstrapping MCP server environments.
                    </div>
                    <div style={{ marginBottom: '0.2rem', color: 'var(--text-muted)' }}>
                      [{new Date().toLocaleTimeString()}] Claude 3.5 routing queries to LinkedIn API gateway.
                    </div>
                    <div style={{ color: '#10b981', fontWeight: 'bold' }}>
                      &gt; {activeTask.progress}
                    </div>
                    <div ref={logConsoleEndRef} />
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Error Alerts */}
        {error && (
          <div className="panel-card" style={{ borderColor: 'var(--danger)', background: 'rgba(239, 68, 68, 0.04)', padding: '1rem', display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1.5rem' }}>
            <AlertCircle style={{ color: 'var(--danger)' }} size={18} />
            <div>
              <h3 style={{ fontSize: '0.85rem', color: 'var(--danger)' }}>AI Scan Interrupted</h3>
              <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>{error}</p>
            </div>
          </div>
        )}

        {/* Job Results Board */}
        {selectedTask ? (
          <div className="panel-card" style={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
            <div className="card-header" style={{ flexWrap: 'wrap', gap: '1rem' }}>
              <div>
                <h2 style={{ fontSize: '0.98rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <CheckCircle size={16} style={{ color: 'var(--success)' }} />
                  Job Listings Found: {selectedTask.job_title} in {selectedTask.country}
                </h2>
                <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                  Scanned LinkedIn vacancies posted in the last {selectedTask.last_days} days.
                </p>
              </div>
              
              {/* Dynamic Table search & multi-criteria filters */}
              {parsedJobs.length > 0 && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem', marginLeft: 'auto', flexWrap: 'wrap' }}>
                  <button 
                    type="button" 
                    onClick={downloadCSV}
                    className="btn-apply"
                    style={{ display: 'inline-flex', alignItems: 'center', gap: '0.25rem', height: '2.1rem', fontSize: '0.78rem', background: 'var(--panel-bg)', cursor: 'pointer', padding: '0 0.75rem' }}
                    title="Export matching jobs to CSV"
                  >
                    <Download size={12} />
                    Save as Excel (CSV)
                  </button>
                  
                  {/* Keyword search input (enlarged) */}
                  <div className="datatable-filter" style={{ minWidth: '240px', height: '2.1rem', padding: '0 0.75rem' }}>
                    <Search size={12} style={{ color: 'var(--text-muted)' }} />
                    <input 
                      type="text" 
                      value={searchTerm}
                      onChange={(e) => setSearchTerm(e.target.value)}
                      placeholder="Search title, company, skills..."
                      style={{ border: 'none', background: 'none', color: 'var(--text-main)', fontSize: '0.78rem', width: '100%', padding: 0, outline: 'none' }}
                      aria-label="Result keyword search"
                    />
                  </div>

                  {/* Workplace Setup Criteria Filter */}
                  <div className="datatable-filter" style={{ minWidth: '135px', height: '2.1rem', padding: '0 0.5rem' }}>
                    <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontWeight: 600, marginRight: '0.25rem', whiteSpace: 'nowrap' }}>Setup:</span>
                    <select
                      value={resultsWorkplaceFilter}
                      onChange={(e) => setResultsWorkplaceFilter(e.target.value)}
                      style={{ border: 'none', background: 'none', color: 'var(--text-main)', fontSize: '0.78rem', width: '100%', outline: 'none', cursor: 'pointer' }}
                      aria-label="Workplace Setup Filter"
                    >
                      <option value="all">All Setup</option>
                      <option value="remote">Remote WFH</option>
                      <option value="hybrid">Hybrid</option>
                      <option value="on-site">On-site</option>
                    </select>
                  </div>

                  {/* Salary Threshold Criteria Filter */}
                  <div className="datatable-filter" style={{ minWidth: '150px', height: '2.1rem', padding: '0 0.5rem' }}>
                    <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontWeight: 600, marginRight: '0.25rem', whiteSpace: 'nowrap' }}>Min Salary:</span>
                    <input
                      type="text"
                      value={resultsMinSalaryFilter}
                      onChange={(e) => setResultsMinSalaryFilter(e.target.value)}
                      placeholder="e.g. 80k or 100000"
                      style={{ border: 'none', background: 'none', color: 'var(--text-main)', fontSize: '0.78rem', width: '100%', outline: 'none', padding: 0 }}
                      aria-label="Minimum Salary Filter"
                    />
                  </div>
                </div>
              )}
            </div>

            <div className="card-body" style={{ flex: 1, display: 'flex', flexDirection: 'column', padding: '1.25rem' }}>
              {selectedTask.status === 'FAILED' ? (
                <div style={{ padding: '3rem 1.5rem', textAlign: 'center' }}>
                  <AlertCircle style={{ color: 'var(--danger)' }} size={32} />
                  <h3 style={{ marginTop: '0.5rem', fontSize: '0.92rem' }}>AI Scan Stopped</h3>
                  <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem', marginTop: '0.25rem' }}>{selectedTask.error_message}</p>
                </div>
              ) : parsedJobs.length === 0 ? (
                <div style={{ padding: '3rem 1.5rem', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.82rem' }}>
                  No job postings were returned by the AI. This may happen if zero vacancies matched the criteria or if Nginx parsing was interrupted.
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', flex: 1 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                    <span>Showing <strong>{filteredJobs.length}</strong> of <strong>{parsedJobs.length}</strong> visa relocation items resolved</span>
                    <span>Requested maximum limit: {selectedTask.limit_count} listings</span>
                  </div>
                  
                  {/* High-density zebra styled datatable */}
                  <div className="table-container">
                    <table>
                      <thead>
                        <tr>
                          <th>Job Title</th>
                          <th>Company</th>
                          <th>City / Country</th>
                          <th>Salary Estimate</th>
                          <th>Description Summary</th>
                          <th>Relocation Support</th>
                          <th>Apply Link</th>
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
                              <div style={{ 
                                maxWidth: '240px', 
                                fontSize: '0.78rem', 
                                color: 'var(--text-muted)',
                                display: '-webkit-box',
                                WebkitLineClamp: 2,
                                WebkitBoxOrient: 'vertical',
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                whiteSpace: 'normal',
                                lineHeight: '1.3'
                              }} title={job.description}>
                                {job.description || 'N/A'}
                              </div>
                            </td>
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
                                  <ExternalLink size={10} />
                                </a>
                              ) : (
                                <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>N/A</span>
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
          </div>
        ) : (
          /* WORKSPACE OVERVIEW (Approachable non-technical welcome dashboard) */
          <div className="workspace-overview">
            <div className="overview-grid">
              <div className="overview-stat-card">
                <span className="overview-stat-label">Searches Performed</span>
                <span className="overview-stat-value">{history.length}</span>
              </div>
              <div className="overview-stat-card">
                <span className="overview-stat-label">Completed Scans</span>
                <span className="overview-stat-value">
                  {history.filter(t => t.status === 'COMPLETED').length}
                </span>
              </div>
              <div className="overview-stat-card">
                <span className="overview-stat-label">System Status</span>
                <span className="overview-stat-value" style={{ color: health.gateway === 'online' ? 'var(--success)' : 'var(--danger)', fontSize: '1.15rem', display: 'flex', alignItems: 'center', gap: '0.35rem', marginTop: '0.2rem' }}>
                  <Activity size={16} />
                  {health.gateway === 'online' ? 'OPERATIONAL' : 'OFFLINE'}
                </span>
              </div>
            </div>

            <div className="panel-card">
              <div className="card-header">
                <h3 style={{ fontSize: '0.92rem' }}>Welcome to your AI Career Relocation Assistant</h3>
              </div>
              <div className="card-body">
                <p style={{ fontSize: '0.82rem', color: 'var(--text-main)', marginBottom: '0.85rem', lineHeight: '1.6' }}>
                  This assistant uses advanced artificial intelligence to index job vacancies, filtering out positions that do not officially support international relocation packages or visa sponsorships. It simplifies your search for work abroad by isolating verified postings instantly.
                </p>
                <h4 style={{ fontSize: '0.82rem', fontWeight: 600, color: 'var(--text-main)', marginBottom: '0.5rem', marginTop: '1.25rem' }}>
                  How to get started:
                </h4>
                <ul style={{ paddingLeft: '1.25rem', fontSize: '0.78rem', color: 'var(--text-muted)', display: 'flex', flexDirection: 'column', gap: '0.5rem', lineHeight: '1.5' }}>
                  <li><strong>1. Choose your Target Role and Country</strong>: In the <strong>Scan Options</strong> form on the left sidebar, enter the job title you want and select the destination country.</li>
                  <li><strong>2. Start the AI Scan</strong>: Click the <strong>Scan Visa Jobs</strong> button. The AI will immediately connect and scan LinkedIn in real time. You can monitor its friendly progress steps above.</li>
                  <li><strong>3. Explore and Save</strong>: View your results in the dashboard. You can search them dynamically by typing in the keyword box, or download them as an Excel-friendly CSV sheet using the <strong>Save as Excel (CSV)</strong> button.</li>
                </ul>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
