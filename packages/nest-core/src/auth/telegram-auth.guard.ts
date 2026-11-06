import { CanActivate, ExecutionContext, HttpStatus, Inject, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { apiError } from '../common/api-error';
import { isEnvAdmin, ResolvedTmaCoreOptions } from '../options';
import { TMA_CORE_OPTIONS } from '../tokens';
import { UsersService } from '../users/users.service';
import type { AuthUser } from './current-user.decorator';
import { validateInitData } from './init-data';
import { IS_PUBLIC_KEY } from './public.decorator';

@Injectable()
export class TelegramAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @Inject(TMA_CORE_OPTIONS) private readonly opts: ResolvedTmaCoreOptions,
    private readonly users: UsersService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    if (ctx.getType() !== 'http') return true;
    const req = ctx.switchToHttp().getRequest<{
      path: string;
      headers: Record<string, string | undefined>;
      user?: AuthUser;
    }>();
    // Express matches routes case-insensitively, so /API/me must not bypass the guard.
    if (!req.path.toLowerCase().startsWith('/api/')) return true;
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (isPublic) return true;

    const match = /^tma (.+)$/.exec(req.headers['authorization'] ?? '');
    const tg = match
      ? validateInitData(match[1], this.opts.botToken, this.opts.initDataMaxAgeSec)
      : null;
    if (!tg) throw apiError(HttpStatus.UNAUTHORIZED, 'UNAUTHORIZED', 'Invalid or expired initData');

    const user = await this.users.upsert(tg);
    if (user.blockedAt && !isEnvAdmin(this.opts, tg.id)) {
      throw apiError(HttpStatus.FORBIDDEN, 'USER_BLOCKED', 'User is blocked');
    }
    req.user = {
      id: tg.id,
      firstName: tg.first_name,
      username: tg.username,
      languageCode: tg.language_code,
    };
    return true;
  }
}
