import { FormEvent, useEffect, useMemo, useState } from 'react';
import { loadTasks, saveTask } from '../api';
import type { TaskRecord } from '../types';
import { useSwipeTabs } from '../useSwipeTabs';

type Filter = 'open' | 'due' | 'done';
const filters: readonly Filter[] = ['open', 'due', 'done'];

function todayKey() {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function emptyTask(): TaskRecord {
  return { id: `task-${Date.now()}`, title: '', type: 'Other', customer: '', vehicle: '', due: todayKey(), status: 'Open', owner: '', notes: '' };
}

function isClosed(task: TaskRecord) {
  return /done|closed|complete/i.test(task.status || '');
}

function taskTone(task: TaskRecord) {
  if (isClosed(task)) return 'good';
  if (task.due && task.due < todayKey()) return 'bad';
  if (task.due === todayKey()) return 'warn';
  return 'neutral';
}

export function DispatchPage() {
  const [tasks, setTasks] = useState<TaskRecord[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [draft, setDraft] = useState<TaskRecord | null>(null);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('open');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const refresh = async (signal?: AbortSignal, force = false) => {
    try {
      const feed = await loadTasks(signal, force);
      setTasks(feed.records || []);
      setError('');
    } catch (requestError) {
      if ((requestError as Error).name !== 'AbortError') setError((requestError as Error).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const controller = new AbortController();
    void refresh(controller.signal);
    const events = new EventSource('/api/events');
    const onPlatform = (event: MessageEvent) => {
      try {
        const payload = JSON.parse(event.data || '{}');
        if ((payload.topics || []).includes('tasks')) void refresh(undefined, true);
      } catch { /* The next valid event will refresh this feed. */ }
    };
    events.addEventListener('platform', onPlatform as EventListener);
    return () => { controller.abort(); events.close(); };
  }, []);

  useEffect(() => {
    if (!selectedId) return;
    const current = tasks.find(task => task.id === selectedId);
    if (current) setDraft({ ...current });
  }, [selectedId, tasks]);

  const visible = useMemo(() => {
    const words = query.toLowerCase().trim().split(/\s+/).filter(Boolean);
    return tasks.filter(task => {
      const closed = isClosed(task);
      if (filter === 'open' && closed) return false;
      if (filter === 'done' && !closed) return false;
      if (filter === 'due' && (closed || !task.due || task.due > todayKey())) return false;
      const text = [task.title, task.type, task.customer, task.vehicle, task.owner, task.notes, task.status].join(' ').toLowerCase();
      return words.every(word => text.includes(word));
    });
  }, [tasks, query, filter]);

  const counts = useMemo(() => ({
    open: tasks.filter(task => !isClosed(task)).length,
    due: tasks.filter(task => !isClosed(task) && !!task.due && task.due <= todayKey()).length,
    done: tasks.filter(isClosed).length
  }), [tasks]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!draft || !draft.title.trim() || saving) return;
    setSaving(true); setError(''); setNotice('');
    try {
      const result = await saveTask({ ...draft, expectedUpdatedAt: draft.updatedAt });
      await refresh(undefined, true);
      setSelectedId(result.task.id);
      setDraft(result.task);
      setNotice('Task saved');
    } catch (requestError) {
      setError((requestError as Error).message);
      await refresh(undefined, true);
    } finally {
      setSaving(false);
    }
  };

  const complete = async () => {
    if (!draft || saving) return;
    setSaving(true); setError(''); setNotice('');
    try {
      const result = await saveTask({ ...draft, status: 'Done', doneAt: new Date().toISOString(), expectedUpdatedAt: draft.updatedAt });
      await refresh(undefined, true);
      setSelectedId(result.task.id);
      setDraft(result.task);
      setNotice('Task completed');
    } catch (requestError) {
      setError((requestError as Error).message);
      await refresh(undefined, true);
    } finally {
      setSaving(false);
    }
  };

  const openNew = () => {
    setSelectedId('');
    setDraft(emptyTask());
    setError(''); setNotice('');
  };

  const filterSwipe = useSwipeTabs(filters, filter, setFilter);

  return <main className={`operations-workspace ${draft ? 'has-detail' : ''}`}>
    <section className="operations-index swipe-zone" {...filterSwipe}>
      <header className="workspace-title"><div><span>Operations</span><h1>Dispatch</h1></div><button className="primary-command" onClick={openNew}>New task</button></header>
      <div className="compact-metrics swipe-tabs" role="tablist" aria-label="Task status">
        <button role="tab" aria-selected={filter === 'open'} className={filter === 'open' ? 'active' : ''} onClick={() => setFilter('open')}><span>Open</span><strong>{counts.open}</strong></button>
        <button role="tab" aria-selected={filter === 'due'} className={filter === 'due' ? 'active' : ''} onClick={() => setFilter('due')}><span>Due now</span><strong>{counts.due}</strong></button>
        <button role="tab" aria-selected={filter === 'done'} className={filter === 'done' ? 'active' : ''} onClick={() => setFilter('done')}><span>Done</span><strong>{counts.done}</strong></button>
      </div>
      <label className="workspace-search"><span aria-hidden="true">/</span><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Search tasks, customers, vehicles" /></label>
      {error && !draft ? <div className="inline-alert error">{error}</div> : null}
      <div className="record-list">
        {loading ? <div className="empty-state">Loading tasks...</div> : null}
        {!loading && !visible.length ? <div className="empty-state">No tasks match this view.</div> : null}
        {visible.map(task => <button key={task.id} className={task.id === selectedId ? 'record-row active' : 'record-row'} onClick={() => setSelectedId(task.id)}>
          <span className={`status-line ${taskTone(task)}`} aria-hidden="true" />
          <span className="record-main"><strong>{task.title || task.type || 'Task'}</strong><span>{[task.customer, task.vehicle].filter(Boolean).join(' | ') || 'Internal work'}</span></span>
          <span className="record-side"><b>{task.status || 'Open'}</b><time>{task.due || 'No due date'}</time></span>
        </button>)}
      </div>
    </section>

    <section className="operations-detail">
      {!draft ? <div className="detail-empty"><strong>Select a task</strong><span>Open an item or create a new task.</span></div> : <form onSubmit={submit}>
        <header className="detail-header"><button type="button" className="detail-back" onClick={() => { setDraft(null); setSelectedId(''); }} aria-label="Back to tasks">Back</button><div><span>Dispatch task</span><h2>{draft.title || 'New task'}</h2></div>{draft.updatedAt ? <small>Updated {new Date(draft.updatedAt).toLocaleString()}</small> : null}</header>
        <div className="detail-scroll">
          {error ? <div className="inline-alert error">{error}</div> : null}
          {notice ? <div className="inline-alert">{notice}</div> : null}
          <div className="form-grid">
            <label className="span-2">Task title<input required value={draft.title} onChange={event => setDraft({ ...draft, title: event.target.value })} /></label>
            <label>Type<input value={draft.type || ''} onChange={event => setDraft({ ...draft, type: event.target.value })} /></label>
            <label>Status<select value={draft.status || 'Open'} onChange={event => setDraft({ ...draft, status: event.target.value })}><option>Open</option><option>In progress</option><option>Waiting</option><option>Done</option></select></label>
            <label>Customer<input value={draft.customer || ''} onChange={event => setDraft({ ...draft, customer: event.target.value })} /></label>
            <label>Vehicle<input value={draft.vehicle || ''} onChange={event => setDraft({ ...draft, vehicle: event.target.value })} /></label>
            <label>Due date<input type="date" value={draft.due || ''} onChange={event => setDraft({ ...draft, due: event.target.value })} /></label>
            <label>Owner<input value={draft.owner || ''} onChange={event => setDraft({ ...draft, owner: event.target.value })} /></label>
            <label className="span-2">Notes<textarea rows={7} value={draft.notes || ''} onChange={event => setDraft({ ...draft, notes: event.target.value })} /></label>
          </div>
        </div>
        <footer className="detail-actions"><button className="primary-command" disabled={saving || !draft.title.trim()}>{saving ? 'Saving...' : 'Save task'}</button>{draft.updatedAt && !isClosed(draft) ? <button type="button" className="secondary-command" onClick={complete} disabled={saving}>Mark done</button> : null}</footer>
      </form>}
    </section>
  </main>;
}
