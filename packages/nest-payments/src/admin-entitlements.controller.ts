import {
  Body,
  Controller,
  Delete,
  HttpCode,
  HttpStatus,
  Inject,
  Logger,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  AdminGuard,
  apiError,
  AuditService,
  AuthUser,
  CurrentUser,
  TMA_KNEX,
  UserIdPipe,
  UsersService,
} from '@dmytro-rudenko/tma-nest-core';
import { BotService } from '@dmytro-rudenko/tma-nest-bot';
import type { Knex } from 'knex';
import { EntitlementRow, EntitlementView, toEntitlementView } from './entitlements.service';
import { ProductRegistry } from './product.registry';

const isActive = (r: EntitlementRow): boolean =>
  r.expires_at === null || new Date(r.expires_at).getTime() > Date.now();

function parseExpiresAt(v: unknown): Date | null {
  if (v === undefined || v === null) return null;
  const d = typeof v === 'string' && v !== '' ? new Date(v) : new Date(NaN);
  if (Number.isNaN(d.getTime())) {
    throw apiError(HttpStatus.BAD_REQUEST, 'VALIDATION', 'expiresAt must be an ISO date');
  }
  return d;
}

@Controller('api/admin/users/:id/entitlements')
@UseGuards(AdminGuard)
export class AdminEntitlementsController {
  private readonly logger = new Logger(AdminEntitlementsController.name);

  constructor(
    @Inject(TMA_KNEX) private readonly knex: Knex,
    private readonly registry: ProductRegistry,
    private readonly users: UsersService,
    private readonly bots: BotService,
    private readonly audit: AuditService,
  ) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  async grant(
    @CurrentUser() admin: AuthUser,
    @Param('id', UserIdPipe) userId: number,
    @Body() body: unknown,
  ): Promise<EntitlementView> {
    const { productId, expiresAt: rawExpiresAt } = (body ?? {}) as { productId?: unknown; expiresAt?: unknown };
    if (typeof productId !== 'string' || productId.length === 0) {
      throw apiError(HttpStatus.BAD_REQUEST, 'VALIDATION', 'productId must be a string');
    }
    const expiresAt = parseExpiresAt(rawExpiresAt);
    if (!this.registry.get(productId)) throw apiError(HttpStatus.NOT_FOUND, 'PRODUCT_NOT_FOUND');
    if (!(await this.users.get(userId))) throw apiError(HttpStatus.NOT_FOUND, 'USER_NOT_FOUND');
    const row = await this.knex.transaction(async (trx) => {
      const held: EntitlementRow | undefined = await trx('entitlements')
        .where({ user_id: userId, product_id: productId })
        .forUpdate()
        .first();
      if (held && held.source === 'subscription' && isActive(held)) {
        throw apiError(HttpStatus.CONFLICT, 'ENTITLEMENT_HELD_BY_SUBSCRIPTION');
      }
      const fields = {
        source: 'grant',
        expires_at: expiresAt,
        subscription_charge_id: null,
        canceled_at: null,
        updated_at: trx.fn.now(),
      };
      const [saved]: EntitlementRow[] = await trx('entitlements')
        .insert({ user_id: userId, product_id: productId, ...fields })
        .onConflict(['user_id', 'product_id'])
        .merge(fields)
        .returning('*');
      await this.audit.record(trx, {
        actorId: admin.id,
        action: 'entitlement.grant',
        targetType: 'user',
        targetId: userId,
        meta: { productId, expiresAt: expiresAt?.toISOString() ?? null, previousSource: held?.source ?? null },
      });
      return saved;
    });
    return toEntitlementView(row);
  }

  @Delete(':productId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async revoke(
    @CurrentUser() admin: AuthUser,
    @Param('id', UserIdPipe) userId: number,
    @Param('productId') productId: string,
  ): Promise<void> {
    const key = { user_id: userId, product_id: productId };
    const row: EntitlementRow | undefined = await this.knex('entitlements').where(key).first();
    if (!row) throw apiError(HttpStatus.NOT_FOUND, 'NO_ENTITLEMENT');
    const charge = row.source === 'subscription' ? row.subscription_charge_id : null;
    if (charge && row.canceled_at === null && isActive(row)) {
      try {
        await this.bots.bot.api.editUserStarSubscription(userId, charge, true);
      } catch (err) {
        this.logger.error(`editUserStarSubscription ${charge} before revoke failed: ${String(err)}`);
        throw apiError(HttpStatus.BAD_GATEWAY, 'PAYMENT_PROVIDER_UNAVAILABLE');
      }
    }
    await this.knex.transaction(async (trx) => {
      const deleted = await trx('entitlements').where(key).del();
      if (deleted === 0) return;
      await this.audit.record(trx, {
        actorId: admin.id,
        action: 'entitlement.revoke',
        targetType: 'user',
        targetId: userId,
        meta: { productId, source: row.source, subscriptionChargeId: charge },
      });
    });
  }
}
