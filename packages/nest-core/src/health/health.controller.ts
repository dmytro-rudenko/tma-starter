import { Controller, Get, HttpException, HttpStatus, Inject } from '@nestjs/common';
import type { Knex } from 'knex';
import { Public } from '../auth/public.decorator';
import { TMA_KNEX } from '../tokens';

@Controller('api/health')
export class HealthController {
  constructor(@Inject(TMA_KNEX) private readonly knex: Knex) {}

  @Public()
  @Get()
  async check(): Promise<{ ok: true }> {
    try {
      await this.knex.raw('select 1');
    } catch {
      throw new HttpException({ ok: false }, HttpStatus.SERVICE_UNAVAILABLE);
    }
    return { ok: true };
  }
}
