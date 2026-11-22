import * as core from '@pctea/tma-nest-core';
import * as bot from '@pctea/tma-nest-bot';
import botPackage from '@pctea/tma-nest-bot/package.json';
import * as payments from '@pctea/tma-nest-payments';
import * as web from '@pctea/tma-web';
import * as webReact from '@pctea/tma-web/react';
import * as testing from '@pctea/tma-testing';
import * as testingDom from '@pctea/tma-testing/dom';

export const imported = [core, bot, botPackage, payments, web, webReact, testing, testingDom];
