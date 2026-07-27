import {
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
  useRef
} from 'react';

export function useSwipeTabs<T extends string>(items: readonly T[], active: T, onChange: (next: T) => void) {
  const start = useRef<{ id: number; x: number; y: number } | null>(null);
  const mouseStart = useRef<{ x: number; y: number } | null>(null);
  const suppressClickUntil = useRef(0);

  function finishSwipe(origin: { x: number; y: number } | null, x: number, y: number) {
    if (!origin || Date.now() < suppressClickUntil.current) return false;
    const deltaX = x - origin.x;
    const deltaY = y - origin.y;
    if (Math.abs(deltaX) < 44 || Math.abs(deltaX) <= Math.abs(deltaY) * 1.2) return false;
    const current = Math.max(0, items.indexOf(active));
    const next = deltaX < 0 ? Math.min(items.length - 1, current + 1) : Math.max(0, current - 1);
    if (next === current) return false;
    suppressClickUntil.current = Date.now() + 350;
    onChange(items[next]);
    return true;
  }

  return {
    onPointerDown(event: ReactPointerEvent<HTMLElement>) {
      if (!event.isPrimary) return;
      start.current = { id: event.pointerId, x: event.clientX, y: event.clientY };
      event.currentTarget.setPointerCapture?.(event.pointerId);
    },
    onPointerCancel() {
      start.current = null;
    },
    onPointerUp(event: ReactPointerEvent<HTMLElement>) {
      const origin = start.current;
      start.current = null;
      if (!origin || event.pointerId !== origin.id) return;
      if (finishSwipe(origin, event.clientX, event.clientY)) event.preventDefault();
    },
    onMouseDown(event: ReactMouseEvent<HTMLElement>) {
      mouseStart.current = { x: event.clientX, y: event.clientY };
    },
    onMouseUp(event: ReactMouseEvent<HTMLElement>) {
      const origin = mouseStart.current;
      mouseStart.current = null;
      if (finishSwipe(origin, event.clientX, event.clientY)) event.preventDefault();
    },
    onWheel(event: ReactWheelEvent<HTMLElement>) {
      if (Date.now() < suppressClickUntil.current || Math.abs(event.deltaX) < 35 || Math.abs(event.deltaX) <= Math.abs(event.deltaY)) return;
      const current = Math.max(0, items.indexOf(active));
      const next = event.deltaX > 0 ? Math.min(items.length - 1, current + 1) : Math.max(0, current - 1);
      if (next === current) return;
      suppressClickUntil.current = Date.now() + 350;
      onChange(items[next]);
    },
    onClickCapture(event: ReactMouseEvent<HTMLElement>) {
      if (Date.now() >= suppressClickUntil.current) return;
      event.preventDefault();
      event.stopPropagation();
    }
  };
}
