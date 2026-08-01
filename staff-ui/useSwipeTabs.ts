import {
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
  useRef
} from 'react';

const swipeBlockedSelector = 'input, textarea, select, option, [contenteditable="true"], [data-swipe-lock]';

function swipeBlocked(target: EventTarget | null) {
  return target instanceof Element && !!target.closest(swipeBlockedSelector);
}

export function useSwipeTabs<T extends string>(items: readonly T[], active: T, onChange: (next: T) => void, enabled: boolean | (() => boolean) = true) {
  const start = useRef<{ id: number; x: number; y: number; axis: 'horizontal' | 'vertical' | null } | null>(null);
  const suppressClickUntil = useRef(0);

  const swipeEnabled = () => typeof enabled === 'function' ? enabled() : enabled;

  function finishSwipe(origin: { x: number; y: number; axis: 'horizontal' | 'vertical' | null } | null, x: number, y: number) {
    if (!swipeEnabled() || !origin || Date.now() < suppressClickUntil.current) return false;
    const deltaX = x - origin.x;
    const deltaY = y - origin.y;
    if (origin.axis === 'vertical' || Math.abs(deltaX) < 36 || Math.abs(deltaX) <= Math.abs(deltaY) * 1.08) return false;
    const current = Math.max(0, items.indexOf(active));
    const next = deltaX < 0 ? Math.min(items.length - 1, current + 1) : Math.max(0, current - 1);
    if (next === current) return false;
    suppressClickUntil.current = Date.now() + 350;
    onChange(items[next]);
    return true;
  }

  return {
    onPointerDown(event: ReactPointerEvent<HTMLElement>) {
      if (event.isPrimary) suppressClickUntil.current = 0;
      if (!swipeEnabled() || !event.isPrimary || swipeBlocked(event.target)) {
        start.current = null;
        return;
      }
      start.current = { id: event.pointerId, x: event.clientX, y: event.clientY, axis: null };
      try { event.currentTarget.setPointerCapture(event.pointerId); } catch { /* Pointer capture is an enhancement. */ }
    },
    onPointerMove(event: ReactPointerEvent<HTMLElement>) {
      const origin = start.current;
      if (!origin || origin.id !== event.pointerId) return;
      const deltaX = event.clientX - origin.x;
      const deltaY = event.clientY - origin.y;
      if (!origin.axis && Math.max(Math.abs(deltaX), Math.abs(deltaY)) >= 9) origin.axis = Math.abs(deltaX) > Math.abs(deltaY) * 1.08 ? 'horizontal' : 'vertical';
      if (origin.axis === 'horizontal') event.preventDefault();
    },
    onPointerCancel() {
      start.current = null;
    },
    onPointerUp(event: ReactPointerEvent<HTMLElement>) {
      const origin = start.current;
      start.current = null;
      try { event.currentTarget.releasePointerCapture(event.pointerId); } catch { /* Already released by the browser. */ }
      if (!origin || event.pointerId !== origin.id) return;
      if (finishSwipe(origin, event.clientX, event.clientY)) {
        event.preventDefault();
        event.stopPropagation();
      }
    },
    onWheel(event: ReactWheelEvent<HTMLElement>) {
      if (!swipeEnabled() || swipeBlocked(event.target) || Date.now() < suppressClickUntil.current || Math.abs(event.deltaX) < 35 || Math.abs(event.deltaX) <= Math.abs(event.deltaY)) return;
      const current = Math.max(0, items.indexOf(active));
      const next = event.deltaX > 0 ? Math.min(items.length - 1, current + 1) : Math.max(0, current - 1);
      if (next === current) return;
      suppressClickUntil.current = Date.now() + 350;
      onChange(items[next]);
      event.preventDefault();
      event.stopPropagation();
    },
    onClickCapture(event: ReactMouseEvent<HTMLElement>) {
      if (Date.now() >= suppressClickUntil.current) return;
      event.preventDefault();
      event.stopPropagation();
    }
  };
}
