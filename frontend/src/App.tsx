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

const BACKEND_PORT = import.meta.env.VITE_BACKEND_PORT || '3000';
const API_BASE = import.meta.env.VITE_API_BASE || (import.meta.env.PROD ? '' : `http://localhost:${BACKEND_PORT}`);
const apiClient = axios.create({
  baseURL: API_BASE,
  timeout: 15000,
});

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
  experience_years?: number | null;
  workplace_type?: string | null;
}

interface SelectedTaskDetail extends TaskHistory {
  result_json?: string | null;
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
  relocation_details?: string;
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
  const [expandedLogTaskIds, setExpandedLogTaskIds] = useState<string[]>([]);

  // App states
  const [history, setHistory] = useState<TaskHistory[]>([]);
  
  // Multi-scan state managers
  const [activeTaskIds, setActiveTaskIds] = useState<string[]>([]);
  const activeTaskIdsRef = useRef<string[]>([]);
  const changeActiveTaskIds = (ids: string[]) => {
    activeTaskIdsRef.current = ids;
    setActiveTaskIds(ids);
  };
  const [activeTasks, setActiveTasks] = useState<Record<string, SelectedTaskDetail>>({});
  // Track tasks that have finished (COMPLETED or FAILED) but remain visible in the panel
  const [settledTaskIds, setSettledTaskIds] = useState<string[]>([]);
  
  const [selectedTask, setSelectedTask] = useState<SelectedTaskDetail | null>(null);
  const [parsedJobs, setParsedJobs] = useState<ParsedJob[]>([]);
  const [currentView, setCurrentView] = useState<'overview' | 'active-scans' | 'results'>('overview');

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
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isSearchDisabled = isSubmitting || health.gateway === 'offline';

  // A simple tick to force time-based progress bar updates while scans are active
  const [, setTick] = useState(0);
  useEffect(() => {
    if (activeTaskIds.length === 0) return;

    const interval = setInterval(() => {
      setTick(t => t + 1);
    }, 1000);
    return () => clearInterval(interval);
  }, [activeTaskIds.length]);

  // Refs
  const pollingRef = useRef<any>(null);
  const logConsoleRefs = useRef<Record<string, HTMLDivElement | null>>({});

  // Fetch task history
  const fetchHistory = async () => {
    try {
      const response = await apiClient.get('/api/jobs/history');
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
      await apiClient.delete(`/api/jobs/tasks/${id}`);
      changeActiveTaskIds(activeTaskIdsRef.current.filter(activeId => activeId !== id));
      setActiveTasks(prev => {
        const copy = { ...prev };
        delete copy[id];
        return copy;
      });
      setSettledTaskIds(prev => prev.filter(settledId => settledId !== id));
      if (selectedTask?.id === id) {
        setSelectedTask(null);
        setParsedJobs([]);
        setCurrentView('overview');
      }
      fetchHistory();
    } catch (err) {
      console.error('Error deleting task:', err);
    }
  };

  // Cancel active scan and delete from database
  const cancelActiveScan = async (id: string) => {
    if (!window.confirm('Are you sure you want to cancel and delete this running scan?')) return;
    try {
      await apiClient.post(`/api/jobs/tasks/${id}/cancel`);

      const nextActiveIds = activeTaskIdsRef.current.filter(activeId => activeId !== id);
      changeActiveTaskIds(nextActiveIds);
      
      setActiveTasks(prev => {
        const copy = { ...prev };
        delete copy[id];
        return copy;
      });
      
      fetchHistory();
    } catch (err) {
      console.error(`Failed to cancel running scan ${id}:`, err);
    }
  };

  // Export matching job listings to CSV
  const downloadCSV = () => {
    if (filteredJobs.length === 0) return;
    try {
      const headers = ['Job Title', 'Company', 'Location', 'Compensation', 'Publishing Date', 'Relocation Details', 'Apply Link'];
      const csvRows = [];
      csvRows.push(headers.join(','));

      filteredJobs.forEach(job => {
        const row = [
          `"${job.title.replace(/"/g, '""')}"`,
          `"${job.company.replace(/"/g, '""')}"`,
          `"${job.location.replace(/"/g, '""')}"`,
          `"${(job.salaryrange || 'N/A').replace(/"/g, '""')}"`,
          `"${(job.publishingdate || job.date || 'N/A').replace(/"/g, '""')}"`,
          `"${(job.relocation_details || 'N/A').replace(/"/g, '""')}"`,
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

  // Helper to map log progress to step indices (0-4) with time-based progression
  const getActiveProgressStep = (createdAt: string, progress: string, status: string, completedAt?: string | null): number => {
    if (status === 'COMPLETED') return 5;

    const referenceTime = status === 'FAILED' && completedAt ? new Date(completedAt).getTime() : Date.now();
    const elapsedMs = referenceTime - new Date(createdAt).getTime();
    const elapsedSec = Math.max(0, elapsedMs / 1000);

    // Time-based steps
    let timeStep = 0;
    if (elapsedSec > 90) timeStep = 4;
    else if (elapsedSec > 60) timeStep = 3;
    else if (elapsedSec > 25) timeStep = 2;
    else if (elapsedSec > 8) timeStep = 1;

    // Content-based steps
    const lower = (progress || '').toLowerCase();
    let contentStep = 0;
    if (lower.includes('saving') || lower.includes('database') || lower.includes('postgres') || lower.includes('done')) contentStep = 4;
    else if (lower.includes('evaluat') || lower.includes('structur') || lower.includes('pars') || lower.includes('markdown') || lower.includes('table')) contentStep = 3;
    else if (lower.includes('routing') || lower.includes('scraping') || lower.includes('linkedin') || lower.includes('scan') || lower.includes('agent')) contentStep = 2;
    else if (lower.includes('spawning') || lower.includes('langchain') || lower.includes('openrouter') || lower.includes('client')) contentStep = 1;

    // For FAILED status: return the last known step (so the failure marker shows at the right position)
    // For all other statuses: combine both signals and take the maximum for progressive flow
    return Math.max(timeStep, contentStep);
  };

  // Fetch health check
  const checkSystemHealth = async () => {
    try {
      const response = await apiClient.get('/health');
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

  // Parse structured JSON returned by MCPAgent
  const parseJobsJson = (jsonStr: string | null): ParsedJob[] => {
    if (!jsonStr) return [];
    try {
      const parsed = JSON.parse(jsonStr);
      if (Array.isArray(parsed)) {
        return parsed.map((job: any) => ({
          title: job.title || 'Job Title',
          company: job.company || 'Company',
          location: job.location || 'Location',
          salaryrange: job.salaryrange || job.salary || 'N/A',
          description: job.description || '',
          publishingdate: job.publishingdate || job.date || 'N/A',
          link: job.link || 'Apply Link',
          link_url: job.link_url || job.link || '',
          relocation_details: job.relocation_details || job.relocationDetails || job.relocation || 'Visa/relocation support mentioned'
        }));
      }
    } catch (err) {
      console.error('Failed to parse jobs JSON:', err);
    }
    return [];
  };

  // Get specific task detail
  const selectTaskDetail = async (id: string, select = true) => {
    try {
      const response = await apiClient.get(`/api/jobs/tasks/${id}`);
      const taskDetail = response.data;
      if (select) {
        setSelectedTask(taskDetail);
        if (taskDetail.status === 'PENDING' || taskDetail.status === 'RUNNING') {
          setCurrentView('active-scans');
          return taskDetail;
        }

        const jobs = parseJobsJson(taskDetail.result_json || null);
        setParsedJobs(jobs);
        setCurrentView('results'); // Switch view when selecting a terminal task from history
      }
      return taskDetail;
    } catch (err) {
      console.error('Error fetching task details:', err);
      return null;
    }
  };

  // Poll active task status for all active scans concurrently
  const pollTaskStatus = useCallback(async () => {
    const currentIds = activeTaskIdsRef.current;
    if (currentIds.length === 0) return;

    try {
      const results = await Promise.all(
        currentIds.map(async (id) => {
          try {
            const response = await apiClient.get(`/api/jobs/tasks/${id}`);
            return { id, task: response.data };
          } catch (err: any) {
            console.error(`Error polling task ${id}:`, err);
            if (axios.isAxiosError(err) && err.response?.status === 404) {
              return { id, task: { status: 'FAILED', progress: 'Search task was removed.', error_message: 'Search task was removed.', completed_at: new Date().toISOString() } };
            }
            return { id, task: null };
          }
        })
      );

      // Discard if activeTaskIds changed while requests were in flight
      if (activeTaskIdsRef.current !== currentIds) {
        return;
      }

      const completedIds: string[] = [];
      const newlySettledIds: string[] = [];
      const taskUpdates: Record<string, SelectedTaskDetail> = {};

      results.forEach(({ id, task }) => {
        if (!task) return;

        if (task.status === 'FAILED') {
          // Stop polling this task, but keep it visible in the panel as FAILED
          completedIds.push(id);
          newlySettledIds.push(id);
          taskUpdates[id] = task; // keep in activeTasks so the card stays rendered
        } else if (task.status === 'COMPLETED') {
          completedIds.push(id);
          newlySettledIds.push(id);
          taskUpdates[id] = task; // keep card visible in active scans until dismissed or selected from history
        } else {
          taskUpdates[id] = task;
        }
      });

      if (newlySettledIds.length > 0) {
        setSettledTaskIds(prev => [...new Set([...prev, ...newlySettledIds])]);
      }

      // Update state for active tasks without resurrecting cards that were removed while polling
      setActiveTasks(prev => {
        const next = { ...prev };
        Object.entries(taskUpdates).forEach(([id, task]) => {
          if (activeTaskIdsRef.current.includes(id) || next[id]) {
            next[id] = task;
          }
        });
        return next;
      });

      if (completedIds.length > 0) {
        const nextActiveIds = currentIds.filter(id => !completedIds.includes(id));
        changeActiveTaskIds(nextActiveIds);
        fetchHistory();

      }
    } catch (err) {
      console.error('Error in batch polling status:', err);
    }
  }, []);

  // Set up polling interval
  useEffect(() => {
    if (activeTaskIds.length > 0) {
      pollingRef.current = setInterval(pollTaskStatus, 3000);
    }
    return () => {
      if (pollingRef.current) clearInterval(pollingRef.current);
    };
  }, [activeTaskIds.length, pollTaskStatus]);

  // Initial loads
  useEffect(() => {
    checkSystemHealth();
    fetchHistory();
    const systemInterval = setInterval(checkSystemHealth, 10000);
    return () => clearInterval(systemInterval);
  }, []);

  // Scroll expanded diagnostic logs to the bottom when progress changes
  useEffect(() => {
    expandedLogTaskIds.forEach(id => {
      const consoleEl = logConsoleRefs.current[id];
      if (consoleEl) {
        consoleEl.scrollTop = consoleEl.scrollHeight;
      }
    });
  }, [activeTasks, expandedLogTaskIds]);

  // Trigger search trigger
  const triggerSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setError(null);

    try {
      const response = await apiClient.post('/api/jobs/search', {
        country,
        job_title: jobTitle,
        limit,
        last_days: lastDays,
        experience_years: experienceYears !== '' ? Number(experienceYears) : null,
        workplace_type: workplaceType
      });

      const newTaskId = response.data.task_id;
      
      const updatedActiveIds = [...activeTaskIdsRef.current, newTaskId];
      changeActiveTaskIds(updatedActiveIds);
      
      setActiveTasks(prev => ({
        ...prev,
        [newTaskId]: {
          id: newTaskId,
          country,
          job_title: jobTitle,
          limit_count: limit,
          last_days: lastDays,
          status: 'PENDING',
          progress: 'Task queued...',
          error_message: null,
          experience_years: experienceYears !== '' ? Number(experienceYears) : null,
          workplace_type: workplaceType,
          created_at: new Date().toISOString(),
          completed_at: null,
          result_json: null
        }
      }));

      setCurrentView('active-scans');
      fetchHistory();
    } catch (err: any) {
      setError(err.response?.data?.error || err.message || 'Failed to initialize search agent.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const mentionsRemoteWork = (text: string) => {
    if (/\b(no|not|without)\s+remote\b/.test(text)) return false;
    return text.includes('remote') || text.includes('wfh') || text.includes('work from home');
  };

  const getSalaryMax = (salaryText: string) => {
    const normalized = salaryText.toLowerCase().replace(/,/g, '');
    const matches = [...normalized.matchAll(/(\d+(?:\.\d+)?)\s*(k|thousand)?/g)];
    const values = matches
      .filter(match => {
        const token = match[0];
        const value = Number(match[1]);
        if (token.includes('401k')) return false;
        if (!match[2] && value >= 1900 && value <= 2100) return false;
        return true;
      })
      .map(match => {
        const value = Number(match[1]);
        return match[2] || value < 1000 ? value * 1000 : value;
      });

    return values.length > 0 ? Math.max(...values) : null;
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
        matchesWorkplace = mentionsRemoteWork(textToSearch);
      } else if (resultsWorkplaceFilter === 'hybrid') {
        matchesWorkplace = textToSearch.includes('hybrid');
      } else if (resultsWorkplaceFilter === 'on-site') {
        matchesWorkplace = textToSearch.includes('on-site') || textToSearch.includes('onsite') || (!mentionsRemoteWork(textToSearch) && !textToSearch.includes('hybrid'));
      }
    }

    // 3. Salary Filter match
    let matchesSalary = true;
    if (resultsMinSalaryFilter !== '') {
      const salaryText = (job.salaryrange || '').toLowerCase();
      const filterNumStr = resultsMinSalaryFilter.replace(/[^0-9]/g, '');
      const filterVal = filterNumStr ? parseInt(filterNumStr, 10) : 0;

      if (filterVal > 0) {
        const actualFilterVal = filterVal < 1000 ? filterVal * 1000 : filterVal;
        const maxSalary = getSalaryMax(salaryText);
        matchesSalary = maxSalary !== null ? maxSalary >= actualFilterVal : false;
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
        if (isSearchDisabled) return;

        const searchForm = document.querySelector('.sidebar-nav form') as HTMLFormElement | null;
        searchForm?.requestSubmit();
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
  }, [filteredJobs, selectedTask, isSearchDisabled]);

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
                disabled={isSubmitting}
                placeholder="e.g. AI engineer"
              />
            </div>

            <div className="form-group">
              <label>Destination Country</label>
              <select
                value={country}
                onChange={(e) => setCountry(e.target.value)}
                disabled={isSubmitting}
                style={{
                  width: '100%',
                  background: 'var(--bg-color)',
                  color: 'var(--text-main)',
                  border: '1px solid var(--panel-border)',
                  borderRadius: '6px',
                  padding: '0.45rem 0.5rem',
                  fontSize: '0.82rem',
                  outline: 'none',
                  height: '2rem',
                  cursor: 'pointer'
                }}
              >
                <option value="Australia">Australia</option>
                <option value="Austria">Austria</option>
                <option value="Bahrain">Bahrain</option>
                <option value="Belgium">Belgium</option>
                <option value="Bulgaria">Bulgaria</option>
                <option value="Canada">Canada</option>
                <option value="Croatia">Croatia</option>
                <option value="Cyprus">Cyprus</option>
                <option value="Czechia">Czechia</option>
                <option value="Denmark">Denmark</option>
                <option value="Estonia">Estonia</option>
                <option value="Finland">Finland</option>
                <option value="France">France</option>
                <option value="Germany">Germany</option>
                <option value="Greece">Greece</option>
                <option value="Hungary">Hungary</option>
                <option value="Ireland">Ireland</option>
                <option value="Italy">Italy</option>
                <option value="Japan">Japan</option>
                <option value="Kuwait">Kuwait</option>
                <option value="Latvia">Latvia</option>
                <option value="Lithuania">Lithuania</option>
                <option value="Luxembourg">Luxembourg</option>
                <option value="Malta">Malta</option>
                <option value="Netherlands">Netherlands</option>
                <option value="New Zealand">New Zealand</option>
                <option value="Oman">Oman</option>
                <option value="Poland">Poland</option>
                <option value="Portugal">Portugal</option>
                <option value="Qatar">Qatar</option>
                <option value="Romania">Romania</option>
                <option value="Saudi Arabia">Saudi Arabia</option>
                <option value="Singapore">Singapore</option>
                <option value="Slovakia">Slovakia</option>
                <option value="Slovenia">Slovenia</option>
                <option value="Spain">Spain</option>
                <option value="Sweden">Sweden</option>
                <option value="Switzerland">Switzerland</option>
                <option value="United Arab Emirates">United Arab Emirates</option>
                <option value="United Kingdom">United Kingdom</option>
                <option value="United States">United States</option>
              </select>
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
                disabled={isSubmitting}
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
                disabled={isSubmitting}
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
                  disabled={isSubmitting}
                  placeholder="Any"
                  style={{ width: '100%' }}
                />
              </div>

              <div className="form-group" style={{ marginBottom: 0 }}>
                <label>Office Setup</label>
                <select
                  value={workplaceType}
                  onChange={(e) => setWorkplaceType(e.target.value)}
                  disabled={isSubmitting}
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
              disabled={isSearchDisabled}
            >
              {isSubmitting ? (
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
                  onClick={() => selectTaskDetail(task.id)}
                  className={`history-item ${selectedTask?.id === task.id ? 'selected' : ''}`}
                  style={{ cursor: 'pointer', marginBottom: '0.5rem' }}
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
                        title="Remove search history"
                        className="btn-delete"
                      >
                        <Trash2 size={13} />
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
                {currentView === 'overview'
                  ? 'Search Dashboard'
                  : currentView === 'active-scans'
                    ? 'Workspace: AI Search Assistant Active'
                    : `Scanned Jobs: ${selectedTask?.job_title} in ${selectedTask?.country}`}
              </h2>
            </div>
          </div>
          <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontWeight: 500, fontFamily: 'monospace' }}>
            {currentView === 'results' && selectedTask
              ? `ID: ${selectedTask.id.substring(0, 8)}...`
              : currentView === 'active-scans' && activeTaskIds.length > 0
                ? 'AI SEARCH RUNNING'
                : 'STORAGE STATUS: ACTIVE'}
          </div>
        </div>

        {/* Subheader view navigation tabs */}
        <div className="workspace-tabs" style={{
          display: 'flex',
          borderBottom: '1px solid var(--panel-border)',
          padding: '0 0.5rem',
          background: 'none',
          gap: '1.5rem',
          marginBottom: '1.5rem'
        }}>
          <button
            type="button"
            className={`workspace-tab ${currentView === 'overview' ? 'active' : ''}`}
            onClick={() => setCurrentView('overview')}
            style={{
              padding: '0.65rem 0',
              borderBottom: `2px solid ${currentView === 'overview' ? 'var(--primary)' : 'transparent'}`,
              color: currentView === 'overview' ? 'var(--text-main)' : 'var(--text-muted)',
              fontWeight: currentView === 'overview' ? 600 : 500,
              background: 'none',
              borderLeft: 'none',
              borderRight: 'none',
              borderTop: 'none',
              fontSize: '0.82rem',
              cursor: 'pointer',
              transition: 'all 0.2s ease',
              outline: 'none'
            }}
          >
            Overview & Guide
          </button>
          <button
            type="button"
            className={`workspace-tab ${currentView === 'active-scans' ? 'active' : ''}`}
            onClick={() => setCurrentView('active-scans')}
            style={{
              padding: '0.65rem 0',
              borderBottom: `2px solid ${currentView === 'active-scans' ? 'var(--primary)' : 'transparent'}`,
              color: currentView === 'active-scans' ? 'var(--text-main)' : 'var(--text-muted)',
              fontWeight: currentView === 'active-scans' ? 600 : 500,
              background: 'none',
              borderLeft: 'none',
              borderRight: 'none',
              borderTop: 'none',
              fontSize: '0.82rem',
              cursor: 'pointer',
              transition: 'all 0.2s ease',
              display: 'flex',
              alignItems: 'center',
              gap: '0.35rem',
              outline: 'none'
            }}
          >
            Active Scans
            {activeTaskIds.length > 0 && (
              <span style={{
                background: 'var(--primary-glow)',
                color: 'var(--primary)',
                fontSize: '0.68rem',
                padding: '0.1rem 0.4rem',
                borderRadius: '10px',
                fontWeight: 700,
                border: '1px solid rgba(79, 70, 229, 0.15)'
              }}>
                {activeTaskIds.length}
              </span>
            )}
          </button>
          <button
            type="button"
            className={`workspace-tab ${currentView === 'results' ? 'active' : ''}`}
            onClick={() => {
              if (selectedTask) {
                setCurrentView('results');
              }
            }}
            disabled={!selectedTask}
            style={{
              padding: '0.65rem 0',
              borderBottom: `2px solid ${currentView === 'results' ? 'var(--primary)' : 'transparent'}`,
              color: selectedTask ? (currentView === 'results' ? 'var(--text-main)' : 'var(--text-muted)') : 'var(--text-muted)',
              fontWeight: currentView === 'results' ? 600 : 500,
              background: 'none',
              borderLeft: 'none',
              borderRight: 'none',
              borderTop: 'none',
              fontSize: '0.82rem',
              cursor: selectedTask ? 'pointer' : 'not-allowed',
              opacity: selectedTask ? 1 : 0.5,
              transition: 'all 0.2s ease',
              outline: 'none'
            }}
          >
            Results Board
          </button>
        </div>

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

        {/* PANEL ROUTING */}
        {currentView === 'overview' && (
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
                  <li><strong>2. Start the AI Scan</strong>: Click the <strong>Scan Visa Jobs</strong> button. The AI will immediately connect and scan LinkedIn in real time. You can monitor its friendly progress steps in the active scans tab.</li>
                  <li><strong>3. Explore and Save</strong>: View your results in the dashboard. You can search them dynamically by typing in the keyword box, or download them as an Excel-friendly CSV sheet using the <strong>Save as Excel (CSV)</strong> button.</li>
                </ul>
              </div>
            </div>
          </div>
        )}

        {currentView === 'active-scans' && (
          /* ACTIVE SCANS PAGE (Beautiful grid panel displaying all running scans simultaneously) */
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
            {Object.keys(activeTasks).length === 0 ? (
              <div className="panel-card" style={{ padding: '3rem 1.5rem', textAlign: 'center' }}>
                <Activity size={32} style={{ color: 'var(--text-muted)', margin: '0 auto 1rem', display: 'block' }} />
                <h3 style={{ fontSize: '0.95rem', fontWeight: 600, color: 'var(--text-main)' }}>No Active Scans Running</h3>
                <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>
                  Configure your query in the left sidebar and click <strong>Scan Visa Jobs</strong> to trigger a live market scraping scan.
                </p>
              </div>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '1.5rem' }}>
                {Object.values(activeTasks).map((task) => {
                  const isFailed = task.status === 'FAILED';
                  const isCompleted = task.status === 'COMPLETED';
                  const isSettled = settledTaskIds.includes(task.id);
                  const isLogExpanded = expandedLogTaskIds.includes(task.id);
                  const currentStep = getActiveProgressStep(task.created_at, task.progress, task.status, task.completed_at);
                  
                  return (
                    <div key={task.id} className="panel-card" style={{
                      borderColor: isFailed ? 'var(--danger)' : isCompleted ? 'var(--success)' : 'var(--primary)'
                    }}>
                      {/* FAILED banner */}
                      {isFailed && (
                        <div style={{
                          background: 'rgba(220, 38, 38, 0.08)',
                          borderBottom: '1px solid rgba(220, 38, 38, 0.2)',
                          padding: '0.5rem 1rem',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '0.5rem',
                          borderRadius: '8px 8px 0 0'
                        }}>
                          <AlertCircle size={14} style={{ color: 'var(--danger)', flexShrink: 0 }} />
                          <span style={{ fontSize: '0.8rem', color: 'var(--danger)', fontWeight: 600 }}>
                            Scan Failed — {task.error_message || 'An error occurred during the job search.'}
                          </span>
                        </div>
                      )}
                      <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                          {isFailed ? (
                            <AlertCircle size={16} style={{ color: 'var(--danger)' }} />
                          ) : isCompleted ? (
                            <CheckCircle size={16} style={{ color: 'var(--success)' }} />
                          ) : (
                            <Loader2 className="animate-spin" size={16} style={{ color: 'var(--primary)', display: 'inline-block', transformOrigin: 'center' }} />
                          )}
                          <h3 style={{ fontSize: '0.92rem', margin: 0 }}>
                            {isFailed ? 'Scan failed:' : isCompleted ? 'Scan completed:' : 'AI Assistant scanning:'} {task.job_title} in {task.country}
                          </h3>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                          <span className={`badge badge-status badge-status-${task.status.toLowerCase()}`}>
                            {task.status === 'RUNNING' ? 'Running' : task.status === 'PENDING' ? 'Pending' : task.status}
                          </span>
                          {!isSettled && (
                            <button
                              type="button"
                              onClick={() => cancelActiveScan(task.id)}
                              className="btn-apply"
                              style={{
                                fontSize: '0.72rem',
                                padding: '0.2rem 0.45rem',
                                background: 'rgba(220, 38, 38, 0.06)',
                                color: 'var(--danger)',
                                border: '1px solid rgba(220, 38, 38, 0.2)',
                                cursor: 'pointer'
                              }}
                              title="Cancel running scan and delete task"
                            >
                              Cancel Scan
                            </button>
                          )}
                          {isSettled && (
                            <button
                              type="button"
                              onClick={() => {
                                // Dismiss this settled card from the active panel
                                setActiveTasks(prev => {
                                  const copy = { ...prev };
                                  delete copy[task.id];
                                  return copy;
                                });
                                setSettledTaskIds(prev => prev.filter(sid => sid !== task.id));
                              }}
                              className="btn-apply"
                              style={{
                                fontSize: '0.72rem',
                                padding: '0.2rem 0.45rem',
                                cursor: 'pointer'
                              }}
                              title="Dismiss this notification"
                            >
                              Dismiss
                            </button>
                          )}
                        </div>
                      </div>
                      <div className="card-body">
                        <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)', marginBottom: '1.25rem' }}>
                          Scanning LinkedIn for up to {task.limit_count} job postings posted in the last {task.last_days} days.
                          {task.experience_years !== null && ` Experience: ~${task.experience_years} years.`}
                          {task.workplace_type !== 'all' && ` Office: ${task.workplace_type}.`}
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
                            // For FAILED tasks: mark all steps up to the active one as failed, rest greyed
                            const isDone = isFailed
                              ? false // never show green check on failed tasks
                              : currentStep > item.step;
                            const isActive = !isFailed && currentStep === item.step;
                            const isFaultedStep = isFailed && currentStep === item.step;
                            // Steps before the failure point still show as completed grey
                            const isPastFailed = isFailed && currentStep > item.step;

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
                                  background: isFaultedStep
                                    ? 'rgba(220,38,38,0.12)'
                                    : isPastFailed
                                      ? 'var(--bg-color)'
                                      : isDone
                                        ? 'var(--success-glow)'
                                        : isActive
                                          ? 'var(--primary-glow)'
                                          : 'var(--bg-color)',
                                  color: isFaultedStep
                                    ? 'var(--danger)'
                                    : isPastFailed
                                      ? 'var(--text-muted)'
                                      : isDone
                                        ? 'var(--success)'
                                        : isActive
                                          ? 'var(--primary)'
                                          : 'var(--text-muted)',
                                  border: `1px solid ${
                                    isFaultedStep
                                      ? 'var(--danger)'
                                      : isPastFailed
                                        ? 'var(--panel-border)'
                                        : isDone
                                          ? 'var(--success)'
                                          : isActive
                                            ? 'var(--primary)'
                                            : 'var(--panel-border)'
                                  }`,
                                  transition: 'all 0.3s ease'
                                }}>
                                  {isFaultedStep ? '✗' : isPastFailed ? idx + 1 : isDone ? '✓' : idx + 1}
                                </div>
                                <span style={{
                                  fontWeight: isActive || isFaultedStep ? 600 : 400,
                                  color: isFaultedStep
                                    ? 'var(--danger)'
                                    : isActive
                                      ? 'var(--text-main)'
                                      : 'var(--text-muted)',
                                  transition: 'all 0.3s ease'
                                }}>
                                  {item.label}
                                  {isActive && ' (Active...)'}
                                  {isFaultedStep && ' — FAILED'}
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
                            onClick={() => {
                              setExpandedLogTaskIds(prev => (
                                prev.includes(task.id)
                                  ? prev.filter(id => id !== task.id)
                                  : [...prev, task.id]
                              ));
                            }}
                            style={{ fontSize: '0.75rem', padding: '0.25rem 0.5rem', cursor: 'pointer' }}
                          >
                            {isLogExpanded ? 'Hide Technical Diagnostic Details' : 'Show Technical Diagnostic Details'}
                          </button>

                          {isLogExpanded && (
                            <div
                              className="progress-console"
                              ref={(el) => { logConsoleRefs.current[task.id] = el; }}
                              style={{ marginTop: '0.75rem' }}
                            >
                              <div style={{ marginBottom: '0.2rem', color: 'var(--text-muted)' }}>
                                [{new Date(task.created_at).toLocaleTimeString()}] Pipeline triggered. Bootstrapping MCP server environments.
                              </div>
                              <div style={{ marginBottom: '0.2rem', color: 'var(--text-muted)' }}>
                                [{new Date(task.created_at).toLocaleTimeString()}] Claude 3.5 routing queries to LinkedIn API gateway.
                              </div>
                              <div style={{ color: '#10b981', fontWeight: 'bold' }}>
                                &gt; {task.progress}
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {currentView === 'results' && selectedTask && (
          /* JOB RESULTS BOARD */
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
                  </div>                  {/* High-density zebra styled datatable */}
                  <div className="table-container">
                    <div className="table-inner-wrapper">
                      <table>
                        <thead>
                          <tr>
                            <th>Job Title</th>
                            <th>Company</th>
                            <th>City / Country</th>
                            <th>Salary Estimate</th>
                            <th>Published</th>
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
                              <td>{job.publishingdate || job.date || 'N/A'}</td>
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
                                <span className="badge badge-relocation" title={job.relocation_details || 'N/A'}>
                                  {job.relocation_details || 'N/A'}
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
                </div>
              )}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
