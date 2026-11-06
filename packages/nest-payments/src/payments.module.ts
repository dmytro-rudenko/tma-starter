import { DynamicModule, Global, Module, OnModuleInit } from '@nestjs/common';
import { AppSettingsRegistry } from '@dmytro-rudenko/tma-nest-core';
import { BotService } from '@dmytro-rudenko/tma-nest-bot';
import { EntitlementsService } from './entitlements.service';
import { resolvePaymentsOptions, TMA_PAYMENTS_OPTIONS, TmaPaymentsOptions } from './options';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';
import { ProductRegistry } from './product.registry';
import { PAYMENTS_TEST_USERS } from './settings';

@Global()
@Module({})
export class TmaPaymentsModule implements OnModuleInit {
  constructor(
    private readonly bots: BotService,
    private readonly payments: PaymentsService,
    private readonly settings: AppSettingsRegistry,
  ) {}

  static forRoot(opts: TmaPaymentsOptions): DynamicModule {
    const registry = new ProductRegistry(opts?.products ?? []);
    return {
      module: TmaPaymentsModule,
      controllers: [PaymentsController],
      providers: [
        { provide: TMA_PAYMENTS_OPTIONS, useValue: resolvePaymentsOptions(opts) },
        { provide: ProductRegistry, useValue: registry },
        EntitlementsService,
        PaymentsService,
      ],
      exports: [TMA_PAYMENTS_OPTIONS, ProductRegistry, EntitlementsService, PaymentsService],
    };
  }

  onModuleInit(): void {
    this.settings.register(PAYMENTS_TEST_USERS);
    this.bots.on('pre_checkout_query', (ctx) => this.payments.preCheckout(ctx), { critical: true });
    this.bots.on('message:successful_payment', (ctx) => this.payments.onPaid(ctx), {
      critical: true,
    });
  }
}
