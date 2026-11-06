import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import type { Knex } from 'knex';
import { AuditService } from '../audit/audit.service';
import { apiError } from '../common/api-error';
import { isEnvAdmin, ResolvedTmaCoreOptions } from '../options';
import { TMA_CORE_OPTIONS, TMA_KNEX } from '../tokens';
import { TmaUser, toTmaUser, UserChange, UserRow, UsersService } from '../users/users.service';

export type AdminSource = 'env' | 'granted';

@Injectable()
export class AdminRightsService {
  constructor(
    @Inject(TMA_KNEX) private readonly knex: Knex,
    @Inject(TMA_CORE_OPTIONS) private readonly opts: ResolvedTmaCoreOptions,
    private readonly users: UsersService,
    private readonly audit: AuditService,
  ) {}

  sourceOf(id: number, adminGrantedAt: Date | null | undefined): AdminSource | null {
    if (isEnvAdmin(this.opts, id)) return 'env';
    return adminGrantedAt ? 'granted' : null;
  }

  async source(id: number): Promise<AdminSource | null> {
    if (isEnvAdmin(this.opts, id)) return 'env';
    const row = await this.knex('users').where({ id }).first('admin_granted_at');
    return row?.admin_granted_at ? 'granted' : null;
  }

  async isAdmin(id: number): Promise<boolean> {
    return (await this.source(id)) !== null;
  }

  async grant(actorId: number, id: number): Promise<TmaUser> {
    return this.knex.transaction(async (trx) => {
      const r = await this.applyGrant(trx, actorId, id);
      if (r.changed) {
        await this.audit.record(trx, { actorId, action: 'admin.grant', targetType: 'user', targetId: id });
      }
      return r.user;
    });
  }

  async revoke(actorId: number, id: number): Promise<TmaUser> {
    return this.knex.transaction(async (trx) => {
      const r = await this.applyRevoke(trx, actorId, id);
      if (r.changed) {
        await this.audit.record(trx, { actorId, action: 'admin.revoke', targetType: 'user', targetId: id });
      }
      return r.user;
    });
  }

  async applyGrant(trx: Knex.Transaction, actorId: number, id: number): Promise<UserChange> {
    const user = await this.users.lockForChange(trx, id);
    if (isEnvAdmin(this.opts, id)) return { user, changed: false };
    if (user.blockedAt) throw apiError(HttpStatus.CONFLICT, 'CANNOT_GRANT_BLOCKED');
    if (user.adminGrantedAt) return { user, changed: false };
    const [row]: UserRow[] = await trx('users')
      .where({ id })
      .update({ admin_granted_at: trx.fn.now(), admin_granted_by: actorId, updated_at: trx.fn.now() })
      .returning('*');
    return { user: toTmaUser(row), changed: true };
  }

  async applyRevoke(trx: Knex.Transaction, actorId: number, id: number): Promise<UserChange> {
    const user = await this.users.lockForChange(trx, id);
    if (actorId === id) throw apiError(HttpStatus.CONFLICT, 'CANNOT_TARGET_SELF');
    if (isEnvAdmin(this.opts, id)) throw apiError(HttpStatus.CONFLICT, 'CANNOT_REVOKE_ENV_ADMIN');
    if (!user.adminGrantedAt) return { user, changed: false };
    const [row]: UserRow[] = await trx('users')
      .where({ id })
      .update({ admin_granted_at: null, admin_granted_by: null, updated_at: trx.fn.now() })
      .returning('*');
    return { user: toTmaUser(row), changed: true };
  }
}
