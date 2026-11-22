import { createContext, useContext, useSyncExternalStore } from 'react';

export type EntryKind =
  // tma:shop:start
  | 'paywall'
  // tma:shop:end
  | 'adminUsers'
  | 'adminUser'
  | 'adminSettings'
  | 'adminBroadcasts'
  | 'adminBroadcast'
  | 'adminBroadcastNew'
  | 'adminAudit'
  | 'adminPayments';

export type Entry = { kind: EntryKind; props: Record<string, unknown> };

export const FULLSCREEN_KINDS: ReadonlySet<EntryKind> = new Set<EntryKind>();

let entries: readonly Entry[] = [];
const listeners = new Set<() => void>();

function set(next: readonly Entry[]): void {
  entries = next;
  listeners.forEach((l) => l());
}

export function push(entry: Entry): void {
  set([...entries, entry]);
}

export function pop(): void {
  if (entries.length) set(entries.slice(0, -1));
}

export function replaceTop(entry: Entry): void {
  set(entries.length ? [...entries.slice(0, -1), entry] : [entry]);
}

export function reset(): void {
  set([]);
}

export function getStack(): readonly Entry[] {
  return entries;
}

function subscribe(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function useStack(): readonly Entry[] {
  return useSyncExternalStore(subscribe, getStack, getStack);
}

export interface LayerInfo {
  index: number;
  isTop: boolean;
}

export const LayerContext = createContext<LayerInfo>({ index: 0, isTop: true });

export function useLayer(): LayerInfo {
  return useContext(LayerContext);
}
