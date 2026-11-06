import { FakeBotApi, startFakeBotApi } from '@dmytro-rudenko/tma-testing';
import { Api } from 'grammy';
import { syncBotProfile } from './sync-bot-profile';

const WEBAPP_URL = 'https://app.example.com';

const profile = {
  menuButtonText: 'Відкрити',
  en: {
    short_description: 'Short en',
    description: 'Long en',
    commands: [{ command: 'start', description: 'Start' }],
  },
  uk: {
    short_description: 'Коротко',
    description: 'Довго',
    commands: [{ command: 'start', description: 'Почати' }],
  },
};

describe('syncBotProfile', () => {
  let fake: FakeBotApi;
  let api: Api;

  beforeAll(async () => {
    fake = await startFakeBotApi();
    api = new Api('123:TEST', { apiRoot: fake.url });
  });

  afterEach(() => fake.reset());

  afterAll(async () => {
    await fake.close();
  });

  const bodiesOf = (method: string) =>
    fake
      .callsOf(method)
      .map((c) => c.body)
      .sort((a, b) => String(a.language_code ?? '').localeCompare(String(b.language_code ?? '')));

  it('sets the web_app menu button with the profile text and webapp url', async () => {
    await syncBotProfile(api, profile, WEBAPP_URL);

    expect(bodiesOf('setChatMenuButton')).toEqual([
      { menu_button: { type: 'web_app', text: 'Відкрити', web_app: { url: WEBAPP_URL } } },
    ]);
  });

  it('sends en without language_code and every other language with its language_code', async () => {
    await syncBotProfile(api, profile, WEBAPP_URL);

    expect(bodiesOf('setMyDescription')).toEqual([
      { description: 'Long en' },
      { description: 'Довго', language_code: 'uk' },
    ]);
    expect(bodiesOf('setMyShortDescription')).toEqual([
      { short_description: 'Short en' },
      { short_description: 'Коротко', language_code: 'uk' },
    ]);
    expect(bodiesOf('setMyCommands')).toEqual([
      { commands: [{ command: 'start', description: 'Start' }] },
      { commands: [{ command: 'start', description: 'Почати' }], language_code: 'uk' },
    ]);
    expect(fake.calls.map((c) => c.method).sort()).toEqual([
      'setChatMenuButton',
      'setMyCommands',
      'setMyCommands',
      'setMyDescription',
      'setMyDescription',
      'setMyShortDescription',
      'setMyShortDescription',
    ]);
  });

  it('makes only the fallback calls for a profile with en alone', async () => {
    const { uk: _uk, ...enOnly } = profile;
    await syncBotProfile(api, enOnly, WEBAPP_URL);

    expect(bodiesOf('setMyDescription')).toEqual([{ description: 'Long en' }]);
    expect(bodiesOf('setMyShortDescription')).toEqual([{ short_description: 'Short en' }]);
    expect(bodiesOf('setMyCommands')).toEqual([
      { commands: [{ command: 'start', description: 'Start' }] },
    ]);
  });

  it('returns no failures when every call succeeds', async () => {
    await expect(syncBotProfile(api, profile, WEBAPP_URL)).resolves.toEqual([]);
  });

  it('settles every call and returns the failed ones instead of throwing', async () => {
    fake.badRequest('setMyCommands', 'Bad Request: invalid command');

    const failures = await syncBotProfile(api, profile, WEBAPP_URL);

    expect(failures).toHaveLength(2);
    expect(failures).toEqual(
      expect.arrayContaining([
        {
          method: 'setMyCommands',
          languageCode: null,
          error: "Call to 'setMyCommands' failed! (400: Bad Request: invalid command)",
        },
        {
          method: 'setMyCommands',
          languageCode: 'uk',
          error: "Call to 'setMyCommands' failed! (400: Bad Request: invalid command)",
        },
      ]),
    );
    expect(fake.callsOf('setChatMenuButton')).toHaveLength(1);
    expect(fake.callsOf('setMyDescription')).toHaveLength(2);
    expect(fake.callsOf('setMyShortDescription')).toHaveLength(2);
    expect(fake.callsOf('setMyCommands')).toHaveLength(2);
  });

  it('reports a failed menu button with a null language code', async () => {
    fake.badRequest('setChatMenuButton', 'Bad Request: invalid url');

    await expect(syncBotProfile(api, profile, WEBAPP_URL)).resolves.toEqual([
      {
        method: 'setChatMenuButton',
        languageCode: null,
        error: "Call to 'setChatMenuButton' failed! (400: Bad Request: invalid url)",
      },
    ]);
    expect(fake.callsOf('setMyDescription')).toHaveLength(2);
  });
});
