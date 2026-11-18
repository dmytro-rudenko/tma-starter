import { Inject, Injectable } from '@nestjs/common';
import {
  isEnvAdmin,
  ResolvedTmaCoreOptions,
  TMA_CORE_OPTIONS,
  TMA_KNEX,
  TmaUser,
  UsersService,
} from '@dmytro-rudenko/tma-nest-core';
import { Bot, Context, Filter, FilterQuery, matchFilter, Middleware } from 'grammy';
import type { InlineKeyboardMarkup, Update, UserFromGetMe } from 'grammy/types';
import { Knex } from 'knex';
import { BotCopyEntries, BotCopyTable } from './copy';
import { BotLang, escapeHtml, langOf } from './lang';
import { ResolvedTmaBotOptions, TMA_BOT_OPTIONS } from './options';
import { StartParamRouter } from './start-param.router';

export interface BotOnOptions {
  critical?: boolean;
}

@Injectable()
export class BotService {
  readonly bot: Bot;
  readonly copy: BotCopyTable;
  private readonly router: StartParamRouter;
  private readonly critical: Array<(ctx: Context) => boolean> = [];
  private readonly touched = new WeakMap<Context, TmaUser>();

  constructor(
    @Inject(TMA_BOT_OPTIONS) private readonly opts: ResolvedTmaBotOptions,
    @Inject(TMA_CORE_OPTIONS) private readonly coreOpts: ResolvedTmaCoreOptions,
    @Inject(TMA_KNEX) private readonly knex: Knex,
    private readonly users: UsersService,
  ) {
    this.copy = opts.copy;
    this.router = new StartParamRouter(opts.startParams);
    this.bot = new Bot(opts.botToken, {
      botInfo: botInfoOf(opts.botToken, opts.botUsername),
      client: opts.apiRoot ? { apiRoot: opts.apiRoot } : undefined,
    });
    this.bot.use((ctx, next) => this.touch(ctx, next));
    this.bot.use((ctx, next) => this.dropBlocked(ctx, next));
    this.bot.command('start', (ctx) => this.onStart(ctx));
    this.bot.command('help', (ctx) => this.help(ctx));
  }

  on<Q extends FilterQuery>(
    filter: Q | Q[],
    handler: Middleware<Filter<Context, Q>>,
    opts: BotOnOptions = {},
  ): void {
    if (opts.critical) this.critical.push(matchFilter(filter));
    this.bot.on(filter, handler);
  }

  command(name: string | string[], handler: Middleware<Context>): void {
    this.bot.command(name, handler);
  }

  startAppUrl(param: string): string {
    return `https://t.me/${this.opts.botUsername}?startapp=${param}`;
  }

  isCritical(update: Update | Context): boolean {
    const ctx =
      update instanceof Context ? update : new Context(update, this.bot.api, this.bot.botInfo);
    return this.critical.some((match) => match(ctx));
  }

  langFor(ctx: Context): BotLang {
    const user = this.touched.get(ctx);
    return langOf(user?.language ?? user?.languageCode ?? ctx.from?.language_code);
  }

  copyFor(ctx: Context): BotCopyEntries {
    return this.copy[this.langFor(ctx)];
  }

  openMarkup(lang: BotLang): InlineKeyboardMarkup | undefined {
    const text = this.copy[lang].openButton;
    if (text === null) return undefined;
    return { inline_keyboard: [[{ text, web_app: { url: this.opts.webappUrl } }]] };
  }

  private async touch(ctx: Context, next: () => Promise<void>): Promise<void> {
    const from = ctx.from;
    if (from) {
      const user = await this.users.upsert(from);
      await this.knex('users')
        .where({ id: from.id })
        .whereNotNull('bot_blocked_at')
        .update({ bot_blocked_at: null });
      this.touched.set(ctx, user);
    }
    await next();
  }

  private async dropBlocked(ctx: Context, next: () => Promise<void>): Promise<void> {
    const id = ctx.from?.id;
    if (
      id === undefined ||
      this.isCritical(ctx) ||
      isEnvAdmin(this.coreOpts, id) ||
      !(await this.users.isBlocked(id))
    ) {
      await next();
    }
  }

  private async onStart(ctx: Context): Promise<void> {
    const param = typeof ctx.match === 'string' ? ctx.match.trim() : '';
    if (await this.router.route(ctx, param)) return;
    await this.greet(ctx);
  }

  private async greet(ctx: Context): Promise<void> {
    const lang = this.langFor(ctx);
    const greeting = this.copy[lang].greeting;
    if (greeting === null) return;
    const name = escapeHtml(ctx.from?.first_name ?? '') || undefined;
    await ctx.reply(greeting(name), { parse_mode: 'HTML', reply_markup: this.openMarkup(lang) });
  }

  private async help(ctx: Context): Promise<void> {
    const lang = this.langFor(ctx);
    const help = this.copy[lang].help;
    if (help === null) return;
    await ctx.reply(help, { parse_mode: 'HTML', reply_markup: this.openMarkup(lang) });
  }
}

function botInfoOf(token: string, username: string): UserFromGetMe {
  return {
    id: Number(token.split(':')[0]),
    is_bot: true,
    first_name: username,
    username,
    can_join_groups: false,
    can_read_all_group_messages: false,
    supports_inline_queries: false,
    can_connect_to_business: false,
    has_main_web_app: true,
  } as UserFromGetMe;
}
