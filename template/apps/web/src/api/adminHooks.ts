import type {
  AuditQuery,
  BroadcastAudience,
  BroadcastDto,
  PaymentStatus,
} from '@dmytro-rudenko/tma-web';
import { useTma } from '@dmytro-rudenko/tma-web/react';
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';

export const adminKeys = {
  all: ['admin'] as const,
  users: (q: string) => ['admin', 'users', q] as const,
  user: (id: number) => ['admin', 'user', id] as const,
  settings: ['admin', 'settings'] as const,
  audit: (q: Omit<AuditQuery, 'cursor'>) => ['admin', 'audit', q] as const,
  broadcasts: ['admin', 'broadcasts'] as const,
  broadcast: (id: string) => ['admin', 'broadcast', id] as const,
  estimate: (audience: BroadcastAudience) => ['admin', 'estimate', audience] as const,
  audienceFilters: ['admin', 'audience-filters'] as const,
  payments: (status: PaymentStatus | '') => ['admin', 'payments', status] as const,
};

const BROADCAST_POLL_MS = 3000;

const isRunning = (b: BroadcastDto | undefined) =>
  b?.status === 'queued' || b?.status === 'running';

export function useAdminUsers(q: string) {
  const { api } = useTma();
  return useInfiniteQuery({
    queryKey: adminKeys.users(q),
    queryFn: ({ pageParam }) => api.admin.users.list({ q, cursor: pageParam ?? undefined }),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
  });
}

export function useAdminUser(id: number) {
  const { api } = useTma();
  return useQuery({ queryKey: adminKeys.user(id), queryFn: () => api.admin.users.get(id) });
}

export function useAdminSettings() {
  const { api } = useTma();
  return useQuery({ queryKey: adminKeys.settings, queryFn: () => api.admin.settings.list() });
}

export function useAdminAudit(q: Omit<AuditQuery, 'cursor'>) {
  const { api } = useTma();
  return useInfiniteQuery({
    queryKey: adminKeys.audit(q),
    queryFn: ({ pageParam }) => api.admin.audit.list({ ...q, cursor: pageParam ?? undefined }),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
  });
}

export function useAdminBroadcasts() {
  const { api } = useTma();
  return useInfiniteQuery({
    queryKey: adminKeys.broadcasts,
    queryFn: ({ pageParam }) => api.admin.broadcasts.list({ cursor: pageParam ?? undefined }),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
  });
}

export function useAdminBroadcast(id: string) {
  const { api } = useTma();
  return useQuery({
    queryKey: adminKeys.broadcast(id),
    queryFn: () => api.admin.broadcasts.get(id),
    refetchInterval: (query) => (isRunning(query.state.data) ? BROADCAST_POLL_MS : false),
  });
}

export function useBroadcastEstimate(audience: BroadcastAudience, enabled: boolean) {
  const { api } = useTma();
  return useQuery({
    queryKey: adminKeys.estimate(audience),
    queryFn: () => api.admin.broadcasts.estimate(audience),
    enabled,
  });
}

export function useAudienceFilters() {
  const { api } = useTma();
  return useQuery({
    queryKey: adminKeys.audienceFilters,
    queryFn: () => api.admin.broadcasts.audienceFilters(),
  });
}

export function useAdminPayments(status: PaymentStatus | '') {
  const { api } = useTma();
  return useInfiniteQuery({
    queryKey: adminKeys.payments(status),
    queryFn: ({ pageParam }) =>
      api.admin.payments.list({ ...(status ? { status } : {}), cursor: pageParam ?? undefined }),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
  });
}

export function useAdminRefresh(): () => Promise<void> {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: adminKeys.all });
}
