import { Controller, Get, HttpStatus, Query, UseGuards } from '@nestjs/common';
import { AdminGuard } from '../admin-rights/admin.guard';
import { AuditPage, AuditService } from '../audit/audit.service';
import { apiError } from '../common/api-error';

const str = (v: unknown): string | undefined => (typeof v === 'string' && v !== '' ? v : undefined);

@Controller('api/admin/audit')
@UseGuards(AdminGuard)
export class AdminAuditController {
  constructor(private readonly audit: AuditService) {}

  @Get()
  list(
    @Query('actorId') actorId: unknown,
    @Query('targetType') targetType: unknown,
    @Query('targetId') targetId: unknown,
    @Query('cursor') cursor: unknown,
  ): Promise<AuditPage> {
    const actor = str(actorId);
    if (actor !== undefined && !/^\d{1,16}$/.test(actor)) {
      throw apiError(HttpStatus.BAD_REQUEST, 'VALIDATION', 'bad actorId');
    }
    return this.audit.list({
      actorId: actor === undefined ? undefined : Number(actor),
      targetType: str(targetType),
      targetId: str(targetId),
      cursor: str(cursor),
    });
  }
}
