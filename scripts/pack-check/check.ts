import * as core from '@dmytro-rudenko/tma-nest-core';
import * as bot from '@dmytro-rudenko/tma-nest-bot';
import botPackage from '@dmytro-rudenko/tma-nest-bot/package.json';
import * as payments from '@dmytro-rudenko/tma-nest-payments';
import * as web from '@dmytro-rudenko/tma-web';
import * as webReact from '@dmytro-rudenko/tma-web/react';
import * as testing from '@dmytro-rudenko/tma-testing';
import * as testingDom from '@dmytro-rudenko/tma-testing/dom';

export const imported = [core, bot, botPackage, payments, web, webReact, testing, testingDom];
