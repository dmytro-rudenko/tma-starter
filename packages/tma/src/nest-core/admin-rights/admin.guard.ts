import { CanActivate, ExecutionContext, HttpStatus, Injectable } from '@nestjs/common';
import type { AuthUser } from '../auth/current-user.decorator';
import { apiError } from '../common/api-error';
import { AdminRightsService } from './admin-rights.service';

@Injectable()
export class AdminGuard implements CanActivate {
  constructor(private readonly rights: AdminRightsService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const user = ctx.switchToHttp().getRequest<{ user?: AuthUser }>().user;
    if (!user || !(await this.rights.isAdmin(user.id))) {
      throw apiError(HttpStatus.FORBIDDEN, 'NOT_ADMIN', 'Admin rights required');
    }
    return true;
  }
}
