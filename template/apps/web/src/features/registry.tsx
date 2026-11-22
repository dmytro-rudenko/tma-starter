import type { ComponentType } from 'react';
import type { EntryKind } from '../state/stack';
import { AdminAuditSheet } from './admin/AdminAuditSheet';
import { AdminBroadcastNewSheet } from './admin/AdminBroadcastNewSheet';
import { AdminBroadcastSheet } from './admin/AdminBroadcastSheet';
import { AdminBroadcastsSheet } from './admin/AdminBroadcastsSheet';
import { AdminPaymentsSheet } from './admin/AdminPaymentsSheet';
import { AdminSettingsSheet } from './admin/AdminSettingsSheet';
import { AdminUserSheet } from './admin/AdminUserSheet';
import { AdminUsersSheet } from './admin/AdminUsersSheet';
// tma:shop:start
import { PaywallSheet } from './shop/PaywallSheet';
// tma:shop:end

export const registry: Record<EntryKind, ComponentType<any>> = {
  // tma:shop:start
  paywall: PaywallSheet,
  // tma:shop:end
  adminUsers: AdminUsersSheet,
  adminUser: AdminUserSheet,
  adminSettings: AdminSettingsSheet,
  adminBroadcasts: AdminBroadcastsSheet,
  adminBroadcast: AdminBroadcastSheet,
  adminBroadcastNew: AdminBroadcastNewSheet,
  adminAudit: AdminAuditSheet,
  adminPayments: AdminPaymentsSheet,
};
