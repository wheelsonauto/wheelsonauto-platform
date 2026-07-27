import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { draftStarReply, loadMessageFeed, sendMessage, type SendMessageInput } from '../api';
import type { MessageRecord, MessageThread } from '../types';

function timeValue(message: MessageRecord): number {
  return Date.parse(message.createdAt || message.date || '') || 0;
}

function contactKey(message: MessageRecord): string {
  const customerAccountId = String(message.customerAccountId || '').trim();
  const customerId = String(message.customerId || '').trim();
  const phone = String(message.phone || '').replace(/\D/g, '').slice(-10);
  const email = String(message.email || '').trim().toLowerCase();
  const name = String(message.customer || 'Unknown customer').trim().toLowerCase();
  return customerAccountId ? `account:${customerAccountId}` : phone ? `phone:${phone}` : email ? `email:${email}` : customerId ? `customer:${customerId}` : `name:${name}`;
}

function buildThreads(messages: MessageRecord[]): MessageThread[] {
  const groups = new Map<string, MessageRecord[]>();
  messages.forEach(message => {
    const key = contactKey(message);
    groups.set(key, [...(groups.get(key) || []), message]);
  });
  return [...groups.entries()].map(([key, rows]) => {
    const ordered = rows.slice().sort((a, b) => timeValue(a) - timeValue(b));
    const latest = ordered[ordered.length - 1];
    const contact = ordered.slice().reverse().find(row => row.phone || row.email || row.customerAccountId) || latest;
    return {
      key,
      customer: latest.customer || contact.customer || 'Unknown customer',
      phone: contact.phone || '',
      email: contact.email || '',
      customerAccountId: contact.customerAccountId || '',
      messages: ordered,
      latest,
      unread: ordered.filter(row => /inbound/i.test(row.direction || '') && !/read/i.test(row.status || '')).length
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
  const [query, setQuery] = useState('');
  const [body, setBody] = useState('');
  const [channel, setChannel] = useState<SendMessageInput['channel']>('Customer portal');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [starLoading, setStarLoading] = useState(false);
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
        if ((payload.topics || []).includes('messages')) void refresh(undefined, true);
      } catch { /* Ignore malformed event frames; the connection will deliver the next valid frame. */ }
    };
    events.addEventListener('platform', onPlatform as EventListener);
    return () => { controller.abort(); events.close(); };
  }, []);

  const threads = useMemo(() => buildThreads(messages), [messages]);
  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return threads;
    return threads.filter(thread => [thread.customer, thread.phone, thread.email, thread.latest.body, thread.latest.subject].join(' ').toLowerCase().includes(normalized));
  }, [query, threads]);
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
    setSending(true); setError(''); setNotice('');
    try {
      const result = await sendMessage({
        customer: selected.customer,
        customerId: selected.latest.customerId,
        customerAccountId: selected.customerAccountId,
        phone: selected.phone,
        email: selected.email,
        channel,
        body: text,
        deliveryId: crypto.randomUUID()
      });
      setMessages(current => current.some(message => message.id === result.message.id)
        ? current.map(message => message.id === result.message.id ? result.message : message)
        : [...current, result.message]);
      setBody('');
      setNotice(result.sent ? 'Message sent' : result.warning || 'Message saved');
      void refresh(undefined, true);
    } catch (requestError) {
      setError((requestError as Error).message);
    } finally {
      setSending(false);
    }
  };

  const askStar = async () => {
    if (!selected || starLoading) return;
    setStarLoading(true); setError(''); setNotice('');
    try {
      const result = await draftStarReply(selected.latest);
      setBody(result.draft?.body || result.plan?.reply || '');
      setNotice('Star prepared a draft. Review it before sending.');
    } catch (requestError) {
      setError((requestError as Error).message);
    } finally {
      setStarLoading(false);
    }
  };

  return <main className={`next-messages ${selected ? 'has-thread' : ''}`}>
    <aside className="thread-list" aria-label="Customer conversations">
      <label className="search-field"><span aria-hidden="true">⌕</span><input value={query} onChange={event => setQuery(event.target.value)} placeholder={`Search ${threads.length} conversations`} aria-label="Search customer conversations" /></label>
      <div className="threads" aria-live="polite">
        {loading ? <div className="empty-state">Loading conversations...</div> : null}
        {!loading && !filtered.length ? <div className="empty-state">No conversations match this search.</div> : null}
        {filtered.map(thread => <button key={thread.key} className={thread.key === selectedKey ? 'thread active' : 'thread'} onClick={() => setSelectedKey(thread.key)}>
          <span className="avatar" aria-hidden="true">{thread.customer.slice(0, 1).toUpperCase()}</span>
          <span className="thread-copy"><strong>{thread.customer}</strong><span>{thread.latest.body || thread.latest.subject || 'No message text'}</span></span>
          <span className="thread-meta"><time>{shortTime(thread.latest)}</time>{thread.unread ? <b>{thread.unread}</b> : null}</span>
        </button>)}
      </div>
    </aside>

    <section className="conversation" aria-label={selected ? `Conversation with ${selected.customer}` : 'Select a conversation'}>
      {!selected ? <div className="conversation-empty"><strong>Select a customer</strong><span>Open a conversation to read and reply.</span></div> : <>
        <header className="conversation-header">
          <button className="back-button" onClick={() => setSelectedKey('')} aria-label="Back to conversations">‹</button>
          <span className="avatar" aria-hidden="true">{selected.customer.slice(0, 1).toUpperCase()}</span>
          <div><strong>{selected.customer}</strong><span>{selected.phone || selected.email || 'WheelsonAuto customer'}</span></div>
          <button className="star-button" onClick={askStar} disabled={starLoading}>{starLoading ? 'Drafting...' : 'Star draft'}</button>
        </header>
        <div className="message-history">
          {selected.messages.map(message => {
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
