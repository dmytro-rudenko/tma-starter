import { CanActivate, ExecutionContext, HttpStatus, Injectable, mixin, Type } from '@nestjs/common';
import { apiError, AuthUser } from '@dmytro-rudenko/tma-nest-core';
import { EntitlementsService } from './entitlements.service';

export function EntitlementGuard(productId: string): Type<CanActivate> {
  @Injectable()
  class ProductEntitlementGuard implements CanActivate {
    constructor(private readonly entitlements: EntitlementsService) {}

    async canActivate(ctx: ExecutionContext): Promise<boolean> {
      const user = ctx.switchToHttp().getRequest<{ user?: AuthUser }>().user;
      if (!user || !(await this.entitlements.has(user.id, productId))) {
        throw apiError(HttpStatus.FORBIDDEN, 'NO_ENTITLEMENT');
      }
      return true;
    }
  }
  return mixin(ProductEntitlementGuard);
}
