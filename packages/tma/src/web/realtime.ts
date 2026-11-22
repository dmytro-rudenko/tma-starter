import { io, type Socket } from 'socket.io-client';
import { tg } from './tg.js';

export function connectRealtime({ path = '/api/socket.io' }: { path?: string } = {}): Socket | null {
  const initData = tg.initDataRaw();
  if (!initData) return null;
  return io({ path, auth: { initData }, transports: ['websocket'] });
}
