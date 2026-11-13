import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AdminGuard, AuthUser, CurrentUser } from '@dmytro-rudenko/tma-nest-core';
import { BroadcastAudienceFilterView, BroadcastAudienceRegistry } from './audience.registry';
import {
  BroadcastPage,
  BroadcastService,
  BroadcastView,
  parseBroadcastAudience,
  parseBroadcastInput,
} from './broadcast.service';

@Controller('api/admin/broadcasts')
@UseGuards(AdminGuard)
export class BroadcastAdminController {
  constructor(
    private readonly broadcasts: BroadcastService,
    private readonly registry: BroadcastAudienceRegistry,
  ) {}

  @Post()
  create(@CurrentUser() admin: AuthUser, @Body() body: unknown): Promise<{ id: string; total: number }> {
    return this.broadcasts.create(admin.id, parseBroadcastInput(body));
  }

  @Post('preview')
  @HttpCode(HttpStatus.OK)
  preview(@CurrentUser() admin: AuthUser, @Body() body: unknown): Promise<{ ok: true }> {
    const { text, button } = parseBroadcastInput(body);
    return this.broadcasts.preview(admin.id, { text, button });
  }

  @Post('estimate')
  @HttpCode(HttpStatus.OK)
  estimate(@Body() body: unknown): Promise<{ total: number }> {
    const audience = (body as { audience?: unknown } | null)?.audience;
    return this.broadcasts.estimate(parseBroadcastAudience(audience));
  }

  @Get('audience-filters')
  filters(): BroadcastAudienceFilterView[] {
    return this.registry.list();
  }

  @Get()
  list(@Query('cursor') cursor?: string, @Query('limit') limit?: string): Promise<BroadcastPage> {
    return this.broadcasts.list({ cursor: cursor || null, limit: limit ? Number(limit) : undefined });
  }

  @Get(':id')
  get(@Param('id') id: string): Promise<BroadcastView> {
    return this.broadcasts.get(id);
  }

  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  cancel(@CurrentUser() admin: AuthUser, @Param('id') id: string): Promise<BroadcastView> {
    return this.broadcasts.cancel(admin.id, id);
  }
}
