import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { draftStarReply, loadMessageFeed, sendMessage, sendStarInstruction, type SendMessageInput } from '../api';
import type { MessageRecord, MessageThread, StarCoachState } from '../types';

function timeValue(message: MessageRecord): number {
  return Date.parse(message.createdAt || message.date || '') || 0;
}

function contactKeys(message: MessageRecord): string[] {
  const customerAccountId = String(message.customerAccountId || '').trim();
  const customerId = String(message.customerId || '').trim();
  const phone = String(message.phone || '').replace(/\D/g, '').slice(-10);
  const email = String(message.email || '').trim().toLowerCase();
  const name = String(message.customer || '').trim().toLowerCase().replace(/\s+/g, ' ');
  return [
    customerAccountId && `account:${customerAccountId}`,
    customerId && `customer:${customerId}`,
    phone && `phone:${phone}`,
    email && `email:${email}`,
    name && !/^unknown customer$/.test(name) && `name:${name}`
  ].filter(Boolean) as string[];
}

function starReviewRequired(message: MessageRecord): boolean {
  if (message.starReview) return true;
  const plan = message.aiPlan || {};
  return !!(plan.approvalRequired || plan.needsHuman || /needs approval|human needed|needs admin/i.test(message.status || ''));
}

function internalStarDraft(message: MessageRecord): boolean {
  return /AI draft|AI action/i.test(message.direction || '') || /Star AI/i.test(message.channel || '');
}

function buildThreads(messages: MessageRecord[]): MessageThread[] {
  const parents = messages.map((_, index) => index);
  const identityOwner = new Map<string, number>();
  const find = (index: number): number => {
    let root = index;
    while (parents[root] !== root) root = parents[root];
    while (parents[index] !== index) {
      const next = parents[index];
      parents[index] = root;
      index = next;
    }
    return root;
  };
  const union = (left: number, right: number) => {
    const leftRoot = find(left);
    const rightRoot = find(right);
    if (leftRoot !== rightRoot) parents[rightRoot] = leftRoot;
  };

  messages.forEach((message, index) => {
    const keys = contactKeys(message);
    if (!keys.length) keys.push(`message:${message.id}`);
    keys.forEach(key => {
      const owner = identityOwner.get(key);
      if (owner === undefined) identityOwner.set(key, index);
      else union(index, owner);
    });
  });

  const groups = new Map<number, MessageRecord[]>();
  messages.forEach((message, index) => {
    const root = find(index);
    groups.set(root, [...(groups.get(root) || []), message]);
  });

  return [...groups.values()].map(rows => {
    const ordered = rows.slice().sort((a, b) => timeValue(a) - timeValue(b));
    const visible = ordered.filter(message => !internalStarDraft(message));
    const latest = visible[visible.length - 1] || ordered[ordered.length - 1];
    const contact = ordered.slice().reverse().find(row => row.phone || row.email || row.customerAccountId) || latest;
    const named = ordered.slice().reverse().find(row => row.customer && !/^unknown customer$/i.test(row.customer)) || latest;
    const reviewRows = ordered.filter(starReviewRequired);
    const identities = ordered.flatMap(contactKeys);
    const key = ['account:', 'customer:', 'phone:', 'email:', 'name:'].map(prefix => identities.find(identity => identity.startsWith(prefix))).find(Boolean) || `message:${latest.id}`;
    return {
      key,
      customer: named.customer || contact.customer || 'Unknown customer',
      phone: contact.phone || '',
      email: contact.email || '',
      customerAccountId: contact.customerAccountId || '',
      messages: ordered,
      latest,
      unread: ordered.filter(row => /inbound/i.test(row.direction || '') && !/read/i.test(row.status || '')).length,
      starReviewCount: reviewRows.length,
      latestStarReview: reviewRows[reviewRows.length - 1]
    };
  }).sort((a, b) => timeValue(b.latest) - timeValue(a.latest));
}

function shortTime(message: MessageRecord): string {
  const parsed = new Date(message.createdAt || message.date || '');
  if (Number.isNaN(parsed.getTime())) return '';
  const today = new Date();
  return parsed.toDateString() === today.toDateString()
    ? parsed.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
    : parsed.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

function availableChannels(thread: MessageThread): SendMessageInput['channel'][] {
  const channels: SendMessageInput['channel'][] = [];
  if (thread.customerAccountId) channels.push('Customer portal');
  if (thread.email) channels.push('Email');
  if (thread.phone) channels.push('SMS');
  return channels.length ? channels : ['Customer portal'];
}

export function MessagesPage() {
  const [messages, setMessages] = useState<MessageRecord[]>([]);
  const [selectedKey, setSelectedKey] = useState('');
  const [inboxView, setInboxView] = useState<'inbox' | 'star'>('inbox');
  const [query, setQuery] = useState('');
  const [body, setBody] = useState('');
  const [channel, setChannel] = useState<SendMessageInput['channel']>('Customer portal');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [starLoading, setStarLoading] = useState(false);
  const [coachSending, setCoachSending] = useState(false);
  const [coachInput, setCoachInput] = useState('');
  const [starCoach, setStarCoach] = useState<StarCoachState>({ autoSendEnabled: false, instructions: [] });
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const feedRevision = useRef('');
  const messageEnd = useRef<HTMLDivElement>(null);

  const refresh = async (signal?: AbortSignal, force = false) => {
    try {
      const feed = await loadMessageFeed(signal, force);
      if (feed.revision !== feedRevision.current) {
        feedRevision.current = feed.revision;
        setMessages(feed.messages || []);
      }
      if (feed.starCoach) setStarCoach(feed.starCoach);
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
    let refreshTimer = 0;
    let refreshInFlight = false;
    let refreshQueued = false;
    const runLiveRefresh = async () => {
      if (refreshInFlight) { refreshQueued = true; return; }
      refreshInFlight = true;
      await refresh(undefined, true);
      refreshInFlight = false;
      if (refreshQueued) { refreshQueued = false; scheduleLiveRefresh(); }
    };
    const scheduleLiveRefresh = () => {
      window.clearTimeout(refreshTimer);
      refreshTimer = window.setTimeout(() => { void runLiveRefresh(); }, 120);
    };
    const onPlatform = (event: MessageEvent) => {
      try {
        const payload = JSON.parse(event.data || '{}');
        if ((payload.topics || []).includes('messages')) scheduleLiveRefresh();
      } catch { /* Ignore malformed event frames; the connection will deliver the next valid frame. */ }
    };
    events.addEventListener('platform', onPlatform as EventListener);
    return () => { controller.abort(); events.close(); window.clearTimeout(refreshTimer); };
  }, []);

  const threads = useMemo(() => buildThreads(messages), [messages]);
  const reviewCount = useMemo(() => threads.reduce((total, thread) => total + thread.starReviewCount, 0), [threads]);
  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    const visibleThreads = inboxView === 'star' ? threads.filter(thread => thread.starReviewCount > 0) : threads;
    const searched = normalized
      ? visibleThreads.filter(thread => [thread.customer, thread.phone, thread.email, thread.latest.body, thread.latest.subject, thread.latestStarReview?.body].join(' ').toLowerCase().includes(normalized))
      : visibleThreads;
    return inboxView === 'star'
      ? searched.slice().sort((a, b) => timeValue(b.latestStarReview || b.latest) - timeValue(a.latestStarReview || a.latest))
      : searched;
  }, [inboxView, query, threads]);
  const selected = threads.find(thread => thread.key === selectedKey) || null;

  useEffect(() => {
    if (!selected && selectedKey) setSelectedKey('');
  }, [selected, selectedKey]);

  useEffect(() => {
    if (!selected) return;
    const channels = availableChannels(selected);
    if (!channels.includes(channel)) setChannel(channels[0]);
    requestAnimationFrame(() => messageEnd.current?.scrollIntoView({ block: 'end' }));
  }, [selected?.key, selected?.messages.length]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!selected || !body.trim() || sending) return;
    const text = body.trim();
    const deliveryId = crypto.randomUUID();
    const optimisticId = `sending-${deliveryId}`;
    const optimistic: MessageRecord = {
      id: optimisticId,
      customer: selected.customer,
      customerId: selected.latest.customerId,
      customerAccountId: selected.customerAccountId,
      phone: selected.phone,
      email: selected.email,
      direction: 'Outbound',
      channel,
      body: text,
      status: 'Sending',
      createdAt: new Date().toISOString()
    };
    setSending(true); setError(''); setNotice(''); setBody('');
    setMessages(current => [...current, optimistic]);
    try {
      const result = await sendMessage({
        customer: selected.customer,
        customerId: selected.latest.customerId,
        customerAccountId: selected.customerAccountId,
        phone: selected.phone,
        email: selected.email,
        channel,
        body: text,
        deliveryId
      });
      setMessages(current => current.map(message => message.id === optimisticId ? result.message : message));
      setNotice(result.sent ? 'Message sent' : result.warning || 'Message saved');
    } catch (requestError) {
      setMessages(current => current.filter(message => message.id !== optimisticId));
      setBody(current => current || text);
      setError((requestError as Error).message);
    } finally {
      setSending(false);
    }
  };

  const askStar = async () => {
    if (!selected || starLoading) return;
    setStarLoading(true); setError(''); setNotice('');
    try {
      const source = selected.messages.slice().reverse().find(message => /inbound|customer action/i.test(message.direction || '')) || selected.latest;
      const result = await draftStarReply(source);
      if (result.autoSend?.sent && result.autoSend.message) {
        setMessages(current => [...current.filter(message => ![result.draft.id, result.autoSend?.message?.id].includes(message.id)), result.draft, result.autoSend!.message!]);
        setBody('');
        setNotice('Star sent the safe reply automatically.');
      } else if (result.plan?.approvalRequired || result.plan?.needsHuman || result.draft?.starReview) {
        setBody(result.draft?.body || result.plan?.reply || '');
        setInboxView('star');
        setNotice('Star held this for review. Nothing sensitive was sent or changed.');
      } else {
        setBody(result.draft?.body || result.plan?.reply || '');
        setNotice(result.autoSend?.warning || 'Star prepared the reply, but the delivery provider is not ready.');
      }
      void refresh(undefined, true);
    } catch (requestError) {
      setError((requestError as Error).message);
    } finally {
      setStarLoading(false);
    }
  };

  const coachStar = async (event: FormEvent) => {
    event.preventDefault();
    const instruction = coachInput.trim();
    if (!instruction || coachSending) return;
    setCoachSending(true); setError(''); setNotice('');
    try {
      const result = await sendStarInstruction(instruction);
      setStarCoach(result.starCoach);
      setCoachInput('');
      setNotice(result.response);
    } catch (requestError) {
      setError((requestError as Error).message);
    } finally {
      setCoachSending(false);
    }
  };

  const owner = String(window.__WOA_STAFF_USER__?.role || '').toLowerCase() === 'owner';

  return <main className={`next-messages ${selected ? 'has-thread' : ''}`}>
    <aside className="thread-list" aria-label="Customer conversations">
      <div className="message-view-tabs" role="tablist" aria-label="Message queues">
        <button type="button" role="tab" aria-selected={inboxView === 'inbox'} className={inboxView === 'inbox' ? 'active' : ''} onClick={() => { setInboxView('inbox'); setSelectedKey(''); }}>Inbox</button>
        <button type="button" role="tab" aria-selected={inboxView === 'star'} className={inboxView === 'star' ? 'active' : ''} onClick={() => { setInboxView('star'); setSelectedKey(''); }}>Star review <b>{reviewCount}</b></button>
      </div>
      {inboxView === 'star' ? <section className="star-coach" aria-label="Coach Star">
        <header><div><strong>Coach Star</strong><span>{starCoach.autoSendEnabled ? 'Safe auto-replies on' : 'Auto-replies paused'}</span></div></header>
        <div className="star-coach-log">
          {starCoach.instructions.length ? starCoach.instructions.slice(0, 3).map(row => <div key={row.id}><b>You</b><span>{row.instruction}</span><b>Star</b><span>{row.response}</span></div>) : <span>Tell Star how customer replies should sound, or say “pause auto-replies.”</span>}
        </div>
        {owner ? <form onSubmit={coachStar}><input value={coachInput} onChange={event => setCoachInput(event.target.value)} maxLength={800} placeholder="Tell Star what to change..." aria-label="Instruction for Star" /><button disabled={!coachInput.trim() || coachSending}>{coachSending ? 'Saving' : 'Tell Star'}</button></form> : null}
      </section> : null}
      <label className="search-field"><span aria-hidden="true">⌕</span><input value={query} onChange={event => setQuery(event.target.value)} placeholder={`Search ${threads.length} conversations`} aria-label="Search customer conversations" /></label>
      <div className="threads" aria-live="polite">
        {loading ? <div className="empty-state">Loading conversations...</div> : null}
        {!loading && !filtered.length ? <div className="empty-state">No conversations match this search.</div> : null}
        {filtered.map(thread => {
          const preview = inboxView === 'star' ? thread.latestStarReview || thread.latest : thread.latest;
          return <button key={thread.key} className={thread.key === selectedKey ? 'thread active' : 'thread'} onClick={() => setSelectedKey(thread.key)}>
          <span className="avatar" aria-hidden="true">{thread.customer.slice(0, 1).toUpperCase()}</span>
          <span className="thread-copy"><strong>{thread.customer}</strong><span>{preview.body || preview.subject || 'No message text'}</span></span>
          <span className="thread-meta"><time>{shortTime(preview)}</time>{inboxView === 'star' && thread.starReviewCount ? <b>{thread.starReviewCount}</b> : thread.unread ? <b>{thread.unread}</b> : null}</span>
        </button>;
        })}
      </div>
    </aside>

    <section className="conversation" aria-label={selected ? `Conversation with ${selected.customer}` : 'Select a conversation'}>
      {!selected ? <div className="conversation-empty"><strong>Select a customer</strong><span>Open a conversation to read and reply.</span></div> : <>
        <header className="conversation-header">
          <button className="back-button" onClick={() => setSelectedKey('')} aria-label="Back to conversations">‹</button>
          <span className="avatar" aria-hidden="true">{selected.customer.slice(0, 1).toUpperCase()}</span>
          <div><strong>{selected.customer}</strong><span>{selected.phone || selected.email || 'WheelsonAuto customer'}</span></div>
          {inboxView === 'star' && selected.starReviewCount ? <span className="review-label">Review required</span> : null}
          <button className="star-button" onClick={askStar} disabled={starLoading}>{starLoading ? 'Drafting...' : 'Star draft'}</button>
        </header>
        <div className="message-history">
          {selected.messages.filter(message => inboxView === 'star' || !internalStarDraft(message)).map(message => {
            const inbound = /inbound|customer action/i.test(message.direction || '');
            const star = /star|ai/i.test([message.channel, message.direction, message.provider].join(' '));
            return <article key={message.id} className={`bubble ${inbound ? 'inbound' : 'outbound'} ${star ? 'star' : ''}`}>
              <p>{message.body || message.subject || 'No message text saved'}</p>
              <footer><time>{shortTime(message)}</time><span>{message.status || message.channel || ''}</span></footer>
            </article>;
          })}
          <div ref={messageEnd} />
        </div>
        <form className="composer" onSubmit={submit}>
          {error ? <div className="composer-alert error" role="alert">{error}</div> : null}
          {notice ? <div className="composer-alert" role="status">{notice}</div> : null}
          <div className="channel-control" aria-label="Delivery channel">
            {availableChannels(selected).map(option => <button type="button" key={option} className={channel === option ? 'active' : ''} onClick={() => setChannel(option)}>{option === 'Customer portal' ? 'App' : option}</button>)}
          </div>
          <div className="compose-row">
            <textarea value={body} onChange={event => setBody(event.target.value)} placeholder={`Message ${selected.customer}`} rows={1} maxLength={4000} />
            <button className="send-button" disabled={!body.trim() || sending}>{sending ? 'Sending' : 'Send'}</button>
          </div>
        </form>
      </>}
    </section>
  </main>;
}
