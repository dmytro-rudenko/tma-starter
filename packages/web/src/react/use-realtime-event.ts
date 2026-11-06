import { useEffect, useRef } from 'react';
import { useTma } from './provider.js';

export function useRealtimeEvent<T = unknown>(event: string, handler: (payload: T) => void): void {
  const { realtime } = useTma();
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => realtime.subscribe(event, (payload) => ref.current(payload as T)), [realtime, event]);
}
