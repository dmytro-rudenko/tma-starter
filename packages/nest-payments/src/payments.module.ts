import { DynamicModule, Global, HttpStatus, Inject, Module, OnModuleInit } from '@nestjs/common';
import {
  AdminUserCardRegistry,
  apiError,
  AppSettingsRegistry,
  TMA_KNEX,
} from '@dmytro-rudenko/tma-nest-core';
import { BotService, BroadcastAudienceRegistry } from '@dmytro-rudenko/tma-nest-bot';
import type { Knex } from 'knex';
import { AdminEntitlementsController } from './admin-entitlements.controller';
import { AdminPaymentsController, toPaymentView } from './admin-payments.controller';
import { EntitlementRow, EntitlementsService, toEntitlementView, whereActive } from './entitlements.service';
import { resolvePaymentsOptions, TMA_PAYMENTS_OPTIONS, TmaPaymentsOptions } from './options';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';
import type { PaymentRow } from './product';
import { ProductRegistry } from './product.registry';
import { ReconcileService } from './reconcile.service';
import { RefundsService } from './refunds.service';
import { PAYMENTS_TEST_USERS } from './settings';
import { SubscriptionsController } from './subscriptions.controller';

export const PAYMENTS_CARD_LIMIT = 20;

const PRODUCT_ID_RE = /^[a-z0-9_]{1,24}$/;

@Global()
@Module({})
export class TmaPaymentsModule implements OnModuleInit {
  constructor(
    @Inject(TMA_KNEX) private readonly knex: Knex,
    private readonly bots: BotService,
    private readonly payments: PaymentsService,
    private readonly settings: AppSettingsRegistry,
    private readonly audiences: BroadcastAudienceRegistry,
    private readonly cards: AdminUserCardRegistry,
  ) {}

  static forRoot(opts: TmaPaymentsOptions): DynamicModule {
    const registry = new ProductRegistry(opts?.products ?? []);
    return {
      module: TmaPaymentsModule,
      controllers: [
        PaymentsController,
        SubscriptionsController,
        AdminPaymentsController,
        AdminEntitlementsController,
      ],
      providers: [
        { provide: TMA_PAYMENTS_OPTIONS, useValue: resolvePaymentsOptions(opts) },
        { provide: ProductRegistry, useValue: registry },
        EntitlementsService,
        RefundsService,
        ReconcileService,
        PaymentsService,
      ],
      exports: [
        TMA_PAYMENTS_OPTIONS,
        ProductRegistry,
        EntitlementsService,
        RefundsService,
        ReconcileService,
        PaymentsService,
      ],
    };
  }

  onModuleInit(): void {
    this.settings.register(PAYMENTS_TEST_USERS);
    this.bots.on('pre_checkout_query', (ctx) => this.payments.preCheckout(ctx), { critical: true });
    this.bots.on('message:successful_payment', (ctx) => this.payments.onPaid(ctx), {
      critical: true,
    });
    this.audiences.register({
      key: 'entitlement',
      label: 'Active product',
      apply: (qb, productId) => {
        if (typeof productId !== 'string' || !PRODUCT_ID_RE.test(productId)) {
          throw apiError(HttpStatus.BAD_REQUEST, 'VALIDATION', 'entitlement filter needs a product id');
        }
        qb.whereExists((sub) =>
          whereActive(
            sub
              .select(this.knex.raw('1'))
              .from('entitlements')
              .whereRaw('entitlements.user_id = users.id')
              .where('entitlements.product_id', productId),
            this.knex,
          ),
        );
      },
    });
    this.cards.register('payments', async (userId) => {
      const [payments, entitlements]: [PaymentRow[], EntitlementRow[]] = await Promise.all([
        this.knex('payments')
          .where({ payer_id: userId })
          .orderBy([
            { column: 'created_at', order: 'desc' },
            { column: 'id', order: 'desc' },
          ])
          .limit(PAYMENTS_CARD_LIMIT),
        this.knex('entitlements').where({ user_id: userId }).orderBy('product_id'),
      ]);
      return { payments: payments.map(toPaymentView), entitlements: entitlements.map(toEntitlementView) };
    });
  }
}
