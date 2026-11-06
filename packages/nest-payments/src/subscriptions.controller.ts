import { Controller, HttpCode, HttpStatus, Inject, Logger, Param, Post } from '@nestjs/common';
import { apiError, AuthUser, CurrentUser, TMA_KNEX } from '@dmytro-rudenko/tma-nest-core';
import { BotService, escapeHtml } from '@dmytro-rudenko/tma-nest-bot';
import type { Knex } from 'knex';
import {
  EntitlementRow,
  EntitlementsService,
  EntitlementView,
  toEntitlementView,
} from './entitlements.service';
import { ProductRegistry } from './product.registry';
import { RefundsService } from './refunds.service';

@Controller('api/subscriptions')
export class SubscriptionsController {
  private readonly logger = new Logger(SubscriptionsController.name);

  constructor(
    @Inject(TMA_KNEX) private readonly knex: Knex,
    private readonly registry: ProductRegistry,
    private readonly entitlements: EntitlementsService,
    private readonly bots: BotService,
    private readonly refunds: RefundsService,
  ) {}

  @Post(':productId/cancel')
  @HttpCode(HttpStatus.OK)
  cancel(@CurrentUser() user: AuthUser, @Param('productId') productId: string): Promise<EntitlementView> {
    return this.setCanceled(user.id, productId, true);
  }

  @Post(':productId/resume')
  @HttpCode(HttpStatus.OK)
  resume(@CurrentUser() user: AuthUser, @Param('productId') productId: string): Promise<EntitlementView> {
    return this.setCanceled(user.id, productId, false);
  }

  private async setCanceled(userId: number, productId: string, canceled: boolean): Promise<EntitlementView> {
    const product = this.registry.get(productId);
    if (!product) throw apiError(HttpStatus.NOT_FOUND, 'PRODUCT_NOT_FOUND');
    const ent = await this.entitlements.active(userId, productId);
    const charge = ent?.source === 'subscription' ? ent.subscription_charge_id : null;
    if (!charge) throw apiError(HttpStatus.CONFLICT, 'NO_SUBSCRIPTION');
    try {
      await this.bots.bot.api.editUserStarSubscription(userId, charge, canceled);
    } catch (err) {
      this.logger.error(`editUserStarSubscription ${charge} (${canceled}) failed: ${String(err)}`);
      throw apiError(HttpStatus.BAD_GATEWAY, 'PAYMENT_PROVIDER_UNAVAILABLE');
    }
    const [row]: EntitlementRow[] = await this.knex('entitlements')
      .where({ user_id: userId, product_id: productId, source: 'subscription', subscription_charge_id: charge })
      .update({
        canceled_at: canceled ? this.knex.raw('coalesce(canceled_at, now())') : null,
        updated_at: this.knex.fn.now(),
      })
      .returning('*');
    if (!row) throw apiError(HttpStatus.CONFLICT, 'NO_SUBSCRIPTION');
    if (canceled) {
      const until = (row.expires_at ?? new Date()).toISOString().slice(0, 10);
      void this.refunds.notify(userId, (copy, lang) =>
        copy.subscriptionCanceled?.(escapeHtml(product.title(lang)), until) ?? null,
      );
    }
    return toEntitlementView(row);
  }
}
