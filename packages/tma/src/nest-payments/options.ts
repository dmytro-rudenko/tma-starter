import type { Product } from './product';

export const TMA_PAYMENTS_OPTIONS = Symbol('TMA_PAYMENTS_OPTIONS');

export const SUBSCRIPTION_PERIOD_SEC = 2_592_000;

export interface TmaPaymentsOptions {
  products: Product[];
  runWorker: boolean;
  refundRetryIntervalMs?: number;
}

export interface ResolvedTmaPaymentsOptions {
  runWorker: boolean;
  refundRetryIntervalMs: number;
}

export function resolvePaymentsOptions(opts: TmaPaymentsOptions): ResolvedTmaPaymentsOptions {
  return { runWorker: opts.runWorker, refundRetryIntervalMs: opts.refundRetryIntervalMs ?? 300_000 };
}
