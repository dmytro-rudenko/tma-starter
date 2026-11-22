import { useSyncExternalStore } from 'react';

export type Tab =
  | 'home'
  // tma:shop:start
  | 'shop'
  // tma:shop:end
  | 'settings';

let tab: Tab = 'home';
const listeners = new Set<() => void>();

export function getTab(): Tab {
  return tab;
}

export function setTab(next: Tab): void {
  if (next === tab) return;
  tab = next;
  listeners.forEach((l) => l());
}

function subscribe(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function useTab(): Tab {
  return useSyncExternalStore(subscribe, getTab, getTab);
}
