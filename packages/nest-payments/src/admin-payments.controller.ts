import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AdminGuard, apiError, AuthUser, CurrentUser, TMA_KNEX } from '@dmytro-rudenko/tma-nest-core';
import type { Knex } from 'knex';
import type { PaymentRow, PaymentStatus } from './product';
import { ReconcileReport, ReconcileService } from './reconcile.service';
import { RefundsService } from './refunds.service';

export const ADMIN_PAYMENTS_PAGE_SIZE = 50;

const STATUSES: readonly PaymentStatus[] = ['paid', 'refund_pending', 'refunded'];
const CURSOR_RE =
  /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z)_([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/;

export interface PaymentView {
  id: string;
  payerId: number;
  productId: string;
  targetId: string | null;
  amountStars: number;
  chargeId: string;
  isRecurring: boolean;
  subscriptionExpiresAt: Date | null;
  status: PaymentStatus;
  settledAt: Date | null;
  refundedAt: Date | null;
  refundAttempts: number;
  createdAt: Date;
}

export interface AdminPaymentsPage {
  items: PaymentView[];
  nextCursor: string | null;
}

export function toPaymentView(r: PaymentRow): PaymentView {
  return {
    id: r.id,
    payerId: Number(r.payer_id),
    productId: r.product_id,
    targetId: r.target_id,
    amountStars: r.amount_stars,
    chargeId: r.telegram_payment_charge_id,
    isRecurring: r.is_recurring,
    subscriptionExpiresAt: r.subscription_expires_at,
    status: r.status,
    settledAt: r.settled_at,
    refundedAt: r.refunded_at,
    refundAttempts: r.refund_attempts,
    createdAt: r.created_at,
  };
}

@Controller('api/admin/payments')
@UseGuards(AdminGuard)
export class AdminPaymentsController {
  constructor(
    @Inject(TMA_KNEX) private readonly knex: Knex,
    private readonly refunds: RefundsService,
    private readonly reconciler: ReconcileService,
  ) {}

  @Get()
  async list(
    @Query('userId') userId: unknown,
    @Query('status') status: unknown,
    @Query('cursor') cursor: unknown,
  ): Promise<AdminPaymentsPage> {
    const query = this.knex('payments')
      .select(
        '*',
        this.knex.raw(
          `to_char(created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as created_cursor`,
        ),
      )
      .orderBy([
        { column: 'created_at', order: 'desc' },
        { column: 'id', order: 'desc' },
      ])
      .limit(ADMIN_PAYMENTS_PAGE_SIZE + 1);
    if (userId !== undefined && userId !== '') {
      if (typeof userId !== 'string' || !/^\d{1,16}$/.test(userId)) {
        throw apiError(HttpStatus.BAD_REQUEST, 'VALIDATION', 'bad userId');
      }
      query.where('payer_id', Number(userId));
    }
    if (status !== undefined && status !== '') {
      if (!STATUSES.includes(status as PaymentStatus)) {
        throw apiError(HttpStatus.BAD_REQUEST, 'VALIDATION', 'bad status');
      }
      query.where('status', status as PaymentStatus);
    }
    if (cursor !== undefined && cursor !== '') {
      const m = typeof cursor === 'string' ? CURSOR_RE.exec(cursor) : null;
      if (!m) throw apiError(HttpStatus.BAD_REQUEST, 'VALIDATION', 'bad cursor');
      query.whereRaw('(created_at, id) < (?::timestamptz, ?::uuid)', [m[1], m[2]]);
    }
    const rows: (PaymentRow & { created_cursor: string })[] = await query;
    const page = rows.slice(0, ADMIN_PAYMENTS_PAGE_SIZE);
    const last = page[page.length - 1];
    return {
      items: page.map(toPaymentView),
      nextCursor: rows.length > ADMIN_PAYMENTS_PAGE_SIZE && last ? `${last.created_cursor}_${last.id}` : null,
    };
  }

  @Post('reconcile')
  @HttpCode(HttpStatus.OK)
  reconcile(@Query('offset') offset: unknown): Promise<ReconcileReport> {
    let from = 0;
    if (offset !== undefined && offset !== '') {
      if (typeof offset !== 'string' || !/^\d{1,9}$/.test(offset)) {
        throw apiError(HttpStatus.BAD_REQUEST, 'VALIDATION', 'bad offset');
      }
      from = Number(offset);
    }
    return this.reconciler.reconcile(from);
  }

  @Post(':id/refund')
  @HttpCode(HttpStatus.OK)
  async refund(@CurrentUser() admin: AuthUser, @Param('id') id: string): Promise<PaymentView> {
    return toPaymentView(await this.refunds.refund(admin.id, id));
  }
}
