import { randomBytes } from 'crypto';

export const PAYLOAD_MAX_BYTES = 128;

export interface InvoicePayload {
  productId: string;
  targetId?: string;
  nonce: string;
}

const TARGET_RE = /^[^:]+$/;
const ID_CHARS_RE = /[.*+?^${}()|[\]\\]/g;

export function makePayload(productId: string, targetId?: string): string {
  if (targetId !== undefined && (!TARGET_RE.test(targetId) || targetId === '-')) {
    throw new Error(`invoice payload: invalid target "${targetId}"`);
  }
  const payload = `${productId}:${targetId ?? '-'}:${randomBytes(8).toString('base64url')}`;
  if (Buffer.byteLength(payload) > PAYLOAD_MAX_BYTES) {
    throw new Error(`invoice payload: longer than ${PAYLOAD_MAX_BYTES} bytes`);
  }
  return payload;
}

export function parsePayload(s: string, ids: readonly string[]): InvoicePayload | null {
  if (typeof s !== 'string' || ids.length === 0 || Buffer.byteLength(s) > PAYLOAD_MAX_BYTES) {
    return null;
  }
  const alternatives = ids.map((id) => id.replace(ID_CHARS_RE, '\\$&')).join('|');
  const m = new RegExp(`^(${alternatives}):([^:]+):([A-Za-z0-9_-]{11})$`).exec(s);
  if (!m) return null;
  return m[2] === '-'
    ? { productId: m[1], nonce: m[3] }
    : { productId: m[1], targetId: m[2], nonce: m[3] };
}
