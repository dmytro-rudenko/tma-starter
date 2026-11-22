import type { ApiClient } from './api.js';
import type { Lang } from './i18n.js';
import type { ThemePref } from './theme.js';

export type AdminSource = 'env' | 'granted' | null;
export type TargetId = string | number;

export interface Me {
  id: number;
  firstName: string;
  username: string | null;
  language: Lang | null;
  theme: ThemePref;
  isAdmin: boolean;
  adminSource: AdminSource;
}

export interface UpdateMeDto {
  language?: Lang | null;
  theme?: ThemePref;
}

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

export interface AdminUser {
  id: number;
  firstName: string;
  username: string | null;
  isAdmin: boolean;
  blockedAt: string | null;
  [key: string]: unknown;
}

export interface AdminUserDetail extends AdminUser {
  adminSource: AdminSource;
  botBlockedAt: string | null;
  cards: Record<string, unknown>;
}

export interface AdminSetting {
  key: string;
  value: unknown;
  default: unknown;
}

export interface AuditEvent {
  id: string | number;
  at: string;
  actorId: number | null;
  action: string;
  targetType: string | null;
  targetId: string | null;
  meta: unknown;
}

export interface AuditQuery {
  actorId?: number;
  targetType?: string;
  targetId?: string;
  cursor?: string;
}

export type ProductKind = 'one_time' | 'subscription';

export interface ProductDto {
  id: string;
  kind: ProductKind;
  repeatable: boolean;
  priceStars: number;
  title: string;
  description: string;
}

export interface CreateInvoiceDto {
  productId: string;
  targetId?: TargetId;
}

export type InvoiceResponse = { invoiceLink: string } | { settled: true };

export type EntitlementSource = 'subscription' | 'one_time' | 'grant';

export interface EntitlementDto {
  productId: string;
  source: EntitlementSource;
  expiresAt: string | null;
  canceled: boolean;
}

export type PaymentStatus = 'paid' | 'refund_pending' | 'refunded';

export interface PaymentDto {
  id: string;
  payerId: number;
  productId: string;
  targetId: string | null;
  amountStars: number;
  status: PaymentStatus;
  createdAt: string;
  [key: string]: unknown;
}

export interface PaymentsQuery {
  userId?: number;
  status?: PaymentStatus;
  cursor?: string;
}

export interface GrantEntitlementDto {
  productId: string;
  expiresAt?: string;
}

export interface BroadcastAudience {
  languages?: Lang[];
  filters?: Record<string, unknown>;
}

export interface BroadcastButton {
  text: string;
  startParam?: string;
}

export interface CreateBroadcastDto {
  text: string;
  button?: BroadcastButton;
  audience: BroadcastAudience;
}

export type BroadcastStatus = 'queued' | 'running' | 'done' | 'canceled';

export interface BroadcastDto {
  id: string;
  createdBy: number;
  text: string;
  button: BroadcastButton | null;
  audience: BroadcastAudience;
  status: BroadcastStatus;
  total: number;
  sent: number;
  failed: number;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
}

export interface AudienceFilter {
  key: string;
  label: string;
}

function qs(params: Record<string, string | number | undefined | null>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') sp.set(k, String(v));
  }
  const s = sp.toString();
  return s ? `?${s}` : '';
}

const enc = encodeURIComponent;

export function tmaApi(client: ApiClient) {
  const r = client.request.bind(client);
  return {
    me: () => r<Me>('/api/me'),
    updateMe: (dto: UpdateMeDto) => r<Me>('/api/me', { method: 'PATCH', json: dto }),
    products: (opts: { targetId?: TargetId } = {}) =>
      r<ProductDto[]>(`/api/products${qs({ targetId: opts.targetId })}`),
    createInvoice: (dto: CreateInvoiceDto) =>
      r<InvoiceResponse>('/api/payments/invoice', { method: 'POST', json: dto }),
    entitlements: () => r<EntitlementDto[]>('/api/entitlements'),
    cancelSubscription: (productId: string) =>
      r<EntitlementDto>(`/api/subscriptions/${enc(productId)}/cancel`, { method: 'POST' }),
    resumeSubscription: (productId: string) =>
      r<EntitlementDto>(`/api/subscriptions/${enc(productId)}/resume`, { method: 'POST' }),
    admin: {
      users: {
        list: (q: { q?: string; cursor?: string } = {}) =>
          r<Page<AdminUser>>(`/api/admin/users${qs(q)}`),
        get: (id: number) => r<AdminUserDetail>(`/api/admin/users/${id}`),
        block: (id: number) => r<AdminUserDetail>(`/api/admin/users/${id}/block`, { method: 'POST' }),
        unblock: (id: number) => r<AdminUserDetail>(`/api/admin/users/${id}/block`, { method: 'DELETE' }),
        grant: (id: number) => r<AdminUserDetail>(`/api/admin/users/${id}/admin`, { method: 'POST' }),
        revoke: (id: number) => r<AdminUserDetail>(`/api/admin/users/${id}/admin`, { method: 'DELETE' }),
      },
      settings: {
        list: () => r<AdminSetting[]>('/api/admin/settings'),
        set: (key: string, value: unknown) =>
          r<AdminSetting[]>('/api/admin/settings', { method: 'PATCH', json: { key, value } }),
      },
      audit: {
        list: (q: AuditQuery = {}) => r<Page<AuditEvent>>(`/api/admin/audit${qs({ ...q })}`),
      },
      broadcasts: {
        list: (q: { cursor?: string } = {}) => r<Page<BroadcastDto>>(`/api/admin/broadcasts${qs(q)}`),
        get: (id: string) => r<BroadcastDto>(`/api/admin/broadcasts/${enc(id)}`),
        create: (dto: CreateBroadcastDto) =>
          r<{ id: string; total: number }>('/api/admin/broadcasts', { method: 'POST', json: dto }),
        preview: (dto: Omit<CreateBroadcastDto, 'audience'> & { audience?: BroadcastAudience }) =>
          r<unknown>('/api/admin/broadcasts/preview', { method: 'POST', json: dto }),
        estimate: (audience: BroadcastAudience) =>
          r<{ total: number }>('/api/admin/broadcasts/estimate', { method: 'POST', json: { audience } }),
        audienceFilters: () => r<AudienceFilter[]>('/api/admin/broadcasts/audience-filters'),
        cancel: (id: string) => r<BroadcastDto>(`/api/admin/broadcasts/${enc(id)}/cancel`, { method: 'POST' }),
      },
      payments: {
        list: (q: PaymentsQuery = {}) => r<Page<PaymentDto>>(`/api/admin/payments${qs({ ...q })}`),
        refund: (id: string) => r<PaymentDto>(`/api/admin/payments/${enc(id)}/refund`, { method: 'POST' }),
        reconcile: () => r<unknown>('/api/admin/payments/reconcile', { method: 'POST' }),
      },
      entitlements: {
        grant: (userId: number, dto: GrantEntitlementDto) =>
          r<EntitlementDto>(`/api/admin/users/${userId}/entitlements`, { method: 'POST', json: dto }),
        revoke: (userId: number, productId: string) =>
          r<void>(`/api/admin/users/${userId}/entitlements/${enc(productId)}`, { method: 'DELETE' }),
      },
    },
  };
}

export type TmaApi = ReturnType<typeof tmaApi>;
