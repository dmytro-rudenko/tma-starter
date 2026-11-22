#!/usr/bin/env node
import { readFileSync } from 'fs';
import { Api } from 'grammy';
import { BotProfile, syncBotProfile } from '../setup/sync-bot-profile';

const REQUIRED_ENV = ['BOT_TOKEN', 'WEBAPP_URL', 'WEBHOOK_PATH_TOKEN', 'WEBHOOK_SECRET', 'BOT_PROFILE'] as const;
const ALLOWED_UPDATES = ['message', 'callback_query', 'pre_checkout_query'] as const;

const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err));

async function setup(env: NodeJS.ProcessEnv): Promise<number> {
  const missing = REQUIRED_ENV.filter((key) => !env[key]);
  if (missing.length) {
    console.error(`tma-bot setup: missing env ${missing.join(', ')}`);
    return 1;
  }
  const webappUrl = env.WEBAPP_URL!.replace(/\/+$/, '');
  let profile: BotProfile;
  try {
    profile = JSON.parse(readFileSync(env.BOT_PROFILE!, 'utf8')) as BotProfile;
  } catch (err) {
    console.error(`tma-bot setup: cannot read BOT_PROFILE: ${errorText(err)}`);
    return 1;
  }
  const api = new Api(env.BOT_TOKEN!, env.BOT_API_ROOT ? { apiRoot: env.BOT_API_ROOT } : undefined);

  try {
    await api.setWebhook(`${webappUrl}/bot/${env.WEBHOOK_PATH_TOKEN}`, {
      secret_token: env.WEBHOOK_SECRET,
      allowed_updates: [...ALLOWED_UPDATES],
    });
    console.log('setWebhook: ok');
  } catch (err) {
    console.error(`setWebhook failed: ${errorText(err)}`);
    return 1;
  }

  const failures = await syncBotProfile(api, profile, webappUrl);
  for (const f of failures) {
    console.error(`${f.method}${f.languageCode ? ` [${f.languageCode}]` : ''} failed: ${f.error}`);
  }
  if (failures.length) return 2;
  console.log('bot profile: ok');
  return 0;
}

async function main(argv: string[]): Promise<number> {
  const [command] = argv;
  if (command === 'setup') return setup(process.env);
  console.error('usage: tma-bot setup');
  return 1;
}

main(process.argv.slice(2)).then(
  (code) => {
    process.exitCode = code;
  },
  (err) => {
    console.error(errorText(err));
    process.exitCode = 1;
  },
);
