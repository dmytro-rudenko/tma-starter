import {
  useEffect,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type ReactNode,
} from 'react';

const DURATION_MS = 2300;

type ToastState = { id: number; text: string; lead?: ReactNode; durationMs: number } | null;

export interface ToastOptions {
  lead?: ReactNode;
  durationMs?: number;
}

let current: ToastState = null;
let seq = 0;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export function toast(text: string, opts: ToastOptions = {}): void {
  current = { id: ++seq, text, lead: opts.lead, durationMs: opts.durationMs ?? DURATION_MS };
  emit();
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}
const get = () => current;

const style = (on: boolean): CSSProperties => ({
  position: 'fixed',
  left: '50%',
  top: 'max(12px, var(--safe-top))',
  transform: `translate(-50%, ${on ? 0 : -12}px)`,
  background: 'rgba(24,24,24,.94)',
  color: '#fff',
  padding: '10px 14px',
  borderRadius: 12,
  fontSize: 13.5,
  maxWidth: '86%',
  textAlign: 'center',
  opacity: on ? 1 : 0,
  pointerEvents: 'none',
  transition: 'opacity .2s, transform .2s',
  zIndex: 200,
});

const pillStyle = (on: boolean): CSSProperties => ({
  ...style(on),
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  borderRadius: 999,
  padding: '6px 14px 6px 6px',
  whiteSpace: 'nowrap',
  transform: `translate(-50%, ${on ? '0' : 'calc(-100% - 24px - var(--safe-top, 0px))'})`,
  transition: 'opacity .2s, transform .28s cubic-bezier(.2,.8,.2,1)',
});

const pillTextStyle: CSSProperties = { overflow: 'hidden', textOverflow: 'ellipsis' };

export function ToastHost() {
  const state = useSyncExternalStore(subscribe, get, get);
  const [revealedId, setRevealedId] = useState<number | null>(null);
  const [expiredId, setExpiredId] = useState<number | null>(null);

  useEffect(() => {
    if (!state) return;
    const { id, lead, durationMs } = state;
    const frame = lead ? requestAnimationFrame(() => setRevealedId(id)) : 0;
    const timer = setTimeout(() => setExpiredId(id), durationMs);
    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(timer);
    };
  }, [state]);

  const on = !!state && expiredId !== state.id && (!state.lead || revealedId === state.id);
  const pill = !!state?.lead;

  return (
    <div
      role="status"
      aria-live="polite"
      data-toast=""
      data-visible={String(on)}
      data-pill={pill ? '' : undefined}
      style={pill ? pillStyle(on) : style(on)}
    >
      {state?.lead}
      <span style={pill ? pillTextStyle : undefined}>{state?.text}</span>
    </div>
  );
}
