import {
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Injectable,
  Param,
  PipeTransform,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import type { Knex } from 'knex';
import { AdminGuard } from '../admin-rights/admin.guard';
import { AdminRightsService, AdminSource } from '../admin-rights/admin-rights.service';
import { AuthUser, CurrentUser } from '../auth/current-user.decorator';
import { apiError } from '../common/api-error';
import { TMA_KNEX } from '../tokens';
import { TmaLanguage, TmaTheme, TmaUser, toTmaUser, UserRow, UsersService } from '../users/users.service';
import { AdminUserCardRegistry } from './admin-user-card.registry';

export interface AdminUser {
  id: number;
  firstName: string;
  username: string | null;
  photoUrl: string | null;
  languageCode: string | null;
  language: TmaLanguage | null;
  theme: TmaTheme;
  isAdmin: boolean;
  adminSource: AdminSource | null;
  blockedAt: Date | null;
  createdAt: Date;
}

export interface AdminUserDetail extends AdminUser {
  updatedAt: Date;
  adminGrantedAt: Date | null;
  adminGrantedBy: number | null;
  botBlockedAt: Date | null;
  cards: Record<string, unknown>;
}

export interface AdminUsersPage {
  items: AdminUser[];
  nextCursor: string | null;
}

@Injectable()
export class UserIdPipe implements PipeTransform<string, number> {
  transform(value: string): number {
    if (!/^\d{1,16}$/.test(String(value))) throw apiError(HttpStatus.BAD_REQUEST, 'VALIDATION', 'bad user id');
    return Number(value);
  }
}

const str = (v: unknown): string | undefined => (typeof v === 'string' && v !== '' ? v : undefined);

@Controller('api/admin/users')
@UseGuards(AdminGuard)
export class AdminUsersController {
  constructor(
    @Inject(TMA_KNEX) private readonly knex: Knex,
    private readonly users: UsersService,
    private readonly rights: AdminRightsService,
    private readonly cards: AdminUserCardRegistry,
  ) {}

  @Get()
  async list(@Query('q') q: unknown, @Query('cursor') cursor: unknown): Promise<AdminUsersPage> {
    const page = await this.users.list({ q: str(q), cursor: str(cursor) });
    return { items: page.items.map((u) => this.summary(u)), nextCursor: page.nextCursor };
  }

  @Get(':id')
  detail(@Param('id', UserIdPipe) id: number): Promise<AdminUserDetail> {
    return this.load(id);
  }

  @Post(':id/block')
  @HttpCode(200)
  async block(@CurrentUser() admin: AuthUser, @Param('id', UserIdPipe) id: number): Promise<AdminUserDetail> {
    await this.users.block(admin.id, id);
    return this.load(id);
  }

  @Delete(':id/block')
  async unblock(@CurrentUser() admin: AuthUser, @Param('id', UserIdPipe) id: number): Promise<AdminUserDetail> {
    await this.users.unblock(admin.id, id);
    return this.load(id);
  }

  @Post(':id/admin')
  @HttpCode(200)
  async grant(@CurrentUser() admin: AuthUser, @Param('id', UserIdPipe) id: number): Promise<AdminUserDetail> {
    await this.rights.grant(admin.id, id);
    return this.load(id);
  }

  @Delete(':id/admin')
  async revoke(@CurrentUser() admin: AuthUser, @Param('id', UserIdPipe) id: number): Promise<AdminUserDetail> {
    await this.rights.revoke(admin.id, id);
    return this.load(id);
  }

  private summary(u: TmaUser): AdminUser {
    const adminSource = this.rights.sourceOf(u.id, u.adminGrantedAt);
    return {
      id: u.id,
      firstName: u.firstName,
      username: u.username,
      photoUrl: u.photoUrl,
      languageCode: u.languageCode,
      language: u.language,
      theme: u.theme,
      isAdmin: adminSource !== null,
      adminSource,
      blockedAt: u.blockedAt,
      createdAt: u.createdAt,
    };
  }

  private async load(id: number): Promise<AdminUserDetail> {
    const row: (UserRow & { bot_blocked_at?: Date | null }) | undefined = await this.knex('users')
      .where({ id })
      .first();
    if (!row) throw apiError(HttpStatus.NOT_FOUND, 'USER_NOT_FOUND');
    const user = toTmaUser(row);
    return {
      ...this.summary(user),
      updatedAt: user.updatedAt,
      adminGrantedAt: user.adminGrantedAt,
      adminGrantedBy: user.adminGrantedBy,
      botBlockedAt: row.bot_blocked_at ?? null,
      cards: await this.cards.collect(id),
    };
  }
}
