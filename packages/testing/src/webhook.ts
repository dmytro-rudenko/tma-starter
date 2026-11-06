import type supertest = require('supertest');

export type HttpAgent = Pick<ReturnType<typeof supertest>, 'post'>;

export function postWebhook(
  http: HttpAgent,
  update: object,
  { pathToken, secret }: { pathToken: string; secret: string },
): supertest.Test {
  return http
    .post(`/bot/${pathToken}`)
    .set('X-Telegram-Bot-Api-Secret-Token', secret)
    .set('content-type', 'application/json')
    .send(update);
}
