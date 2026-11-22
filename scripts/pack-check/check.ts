import * as core from 'tma-starter/nest-core';
import * as bot from 'tma-starter/nest-bot';
import * as payments from 'tma-starter/nest-payments';
import * as web from 'tma-starter/web';
import * as webReact from 'tma-starter/web/react';
import * as testing from 'tma-starter/testing';
import * as testingDom from 'tma-starter/testing/dom';
import tmaPackage from 'tma-starter/package.json';

export const imported = [core, bot, payments, web, webReact, testing, testingDom, tmaPackage];
