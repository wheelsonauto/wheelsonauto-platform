import { useCallback, useEffect, useMemo, useState } from 'react';

type IdentifiedRecord = { id: string };

function storageKey(namespace: string) {
  return `wheelsonauto-viewed-${namespace}`;
}

function readSeen(namespace: string): Set<string> | null {
  try {
    const saved = localStorage.getItem(storageKey(namespace));
    if (saved === null) return null;
    const ids = JSON.parse(saved);
    return new Set(Array.isArray(ids) ? ids.map(String) : []);
  } catch {
    return new Set();
  }
}

function saveSeen(namespace: string, seen: Set<string>) {
  try { localStorage.setItem(storageKey(namespace), JSON.stringify(Array.from(seen).slice(-1500))); }
  catch { /* Unread state remains available for this browser session. */ }
}

export function useViewedRecords<T extends IdentifiedRecord>(namespace: string, records: T[], enabled = true) {
  const [seen, setSeen] = useState<Set<string>>(new Set());
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!enabled || ready) return;
    const saved = readSeen(namespace);
    const initial = saved === null ? new Set(records.map(row => String(row.id))) : saved;
    setSeen(initial);
    if (saved === null) saveSeen(namespace, initial);
    setReady(true);
  }, [enabled, namespace, ready, records]);

  const unreadIds = useMemo(() => ready ? new Set(records.filter(row => !seen.has(String(row.id))).map(row => String(row.id))) : new Set<string>(), [ready, records, seen]);
  const markViewed = useCallback((id: string) => {
    if (!id) return;
    setSeen(current => {
      if (current.has(id)) return current;
      const next = new Set(current);
      next.add(id);
      saveSeen(namespace, next);
      return next;
    });
  }, [namespace]);
  const markAllViewed = useCallback(() => {
    const next = new Set(records.map(row => String(row.id)));
    setSeen(next);
    saveSeen(namespace, next);
  }, [namespace, records]);

  return { unreadIds, unreadCount: unreadIds.size, markViewed, markAllViewed };
}
