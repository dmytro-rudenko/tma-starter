import * as core from '@pctea/tma/nest-core';
import * as bot from '@pctea/tma/nest-bot';
import * as payments from '@pctea/tma/nest-payments';
import * as web from '@pctea/tma/web';
import * as webReact from '@pctea/tma/web/react';
import * as testing from '@pctea/tma/testing';
import * as testingDom from '@pctea/tma/testing/dom';
import tmaPackage from '@pctea/tma/package.json';

export const imported = [core, bot, payments, web, webReact, testing, testingDom, tmaPackage];
