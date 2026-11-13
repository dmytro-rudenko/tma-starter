import { Body, Controller, Get, HttpCode, HttpStatus, Post, Query } from '@nestjs/common';
import { apiError, AuthUser, CurrentUser } from '@dmytro-rudenko/tma-nest-core';
import { EntitlementsService, EntitlementView } from './entitlements.service';
import { InvoiceResult, PaymentsService, ProductView } from './payments.service';

const optionalString = (v: unknown): v is string | undefined =>
  v === undefined || (typeof v === 'string' && v.length > 0);

@Controller()
export class PaymentsController {
  constructor(
    private readonly payments: PaymentsService,
    private readonly entitlements: EntitlementsService,
  ) {}

  @Get('api/products')
  products(@CurrentUser() user: AuthUser, @Query('targetId') targetId: unknown): Promise<ProductView[]> {
    if (!optionalString(targetId)) throw apiError(HttpStatus.BAD_REQUEST, 'VALIDATION', 'targetId must be a string');
    return this.payments.products(user.id, targetId);
  }

  @Post('api/payments/invoice')
  @HttpCode(HttpStatus.OK)
  invoice(@CurrentUser() user: AuthUser, @Body() body: unknown): Promise<InvoiceResult> {
    const { productId, targetId } = (body ?? {}) as { productId?: unknown; targetId?: unknown };
    if (typeof productId !== 'string' || productId.length === 0) {
      throw apiError(HttpStatus.BAD_REQUEST, 'VALIDATION', 'productId must be a string');
    }
    if (!optionalString(targetId)) {
      throw apiError(HttpStatus.BAD_REQUEST, 'VALIDATION', 'targetId must be a string');
    }
    return this.payments.createInvoiceLink(user.id, productId, targetId);
  }

  @Get('api/entitlements')
  list(@CurrentUser() user: AuthUser): Promise<EntitlementView[]> {
    return this.entitlements.list(user.id);
  }
}
