import { Inject, Logger } from '@nestjs/common';
import { OnGatewayConnection, OnGatewayInit, WebSocketGateway } from '@nestjs/websockets';
import type { Server, Socket } from 'socket.io';
import { validateInitData } from '../auth/init-data';
import { isEnvAdmin, ResolvedTmaCoreOptions } from '../options';
import { TMA_CORE_OPTIONS } from '../tokens';
import { UsersService } from '../users/users.service';
import { RealtimeService, userRoom } from './realtime.service';

export const TMA_REALTIME_PATH = '/api/socket.io';

@WebSocketGateway({ path: TMA_REALTIME_PATH, serveClient: false, maxHttpBufferSize: 10_000 })
export class TmaRealtimeGateway implements OnGatewayInit, OnGatewayConnection {
  private readonly logger = new Logger(TmaRealtimeGateway.name);

  constructor(
    @Inject(TMA_CORE_OPTIONS) private readonly opts: ResolvedTmaCoreOptions,
    private readonly users: UsersService,
    private readonly realtime: RealtimeService,
  ) {}

  afterInit(server: Server): void {
    this.realtime.attach(server);
  }

  async handleConnection(socket: Socket): Promise<void> {
    const raw: unknown = (socket.handshake.auth as Record<string, unknown> | undefined)?.initData;
    const tg =
      typeof raw === 'string' && raw.length > 0
        ? validateInitData(raw, this.opts.botToken, this.opts.initDataMaxAgeSec)
        : null;
    if (!tg) {
      socket.disconnect(true);
      return;
    }
    try {
      if (!isEnvAdmin(this.opts, tg.id) && (await this.users.isBlocked(tg.id))) {
        socket.disconnect(true);
        return;
      }
    } catch (err) {
      this.logger.warn(`blocked check failed: ${err instanceof Error ? err.message : String(err)}`);
      socket.disconnect(true);
      return;
    }
    if (socket.disconnected) return;
    socket.data.userId = tg.id;
    await socket.join(userRoom(tg.id));
  }
}
