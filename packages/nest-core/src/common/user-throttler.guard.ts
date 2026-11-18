import { ExecutionContext, HttpStatus, Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import { apiError } from './api-error';

@Injectable()
export class UserThrottlerGuard extends ThrottlerGuard {
  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    if (ctx.getType() !== 'http') return true;
    return super.canActivate(ctx);
  }

  protected async getTracker(req: Record<string, any>): Promise<string> {
    return req.user?.id ? 'u:' + req.user.id : 'ip:' + req.ip;
  }

  protected async throwThrottlingException(): Promise<void> {
    throw apiError(HttpStatus.TOO_MANY_REQUESTS, 'RATE_LIMITED', 'Too many requests');
  }
}
