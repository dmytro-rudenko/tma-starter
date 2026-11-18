import { Injectable, Logger } from '@nestjs/common';
import type { Server } from 'socket.io';

export const userRoom = (userId: number): string => `user:${userId}`;

@Injectable()
export class RealtimeService {
  private readonly logger = new Logger(RealtimeService.name);
  private server?: Pick<Server, 'to'>;

  attach(server: Pick<Server, 'to'>): void {
    this.server = server;
  }

  emitToUser(userId: number, event: string, payload: unknown): void {
    if (!this.server) return;
    try {
      this.server.to(userRoom(userId)).emit(event, payload);
    } catch (err) {
      this.logger.warn(`emit ${event} failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}
