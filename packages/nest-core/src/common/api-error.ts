import { HttpException, HttpStatus } from '@nestjs/common';
import type { TmaCoreErrorCode } from './error-codes';

export function apiError(
  status: number,
  code: TmaCoreErrorCode | (string & {}),
  message?: string,
): HttpException {
  const name = HttpStatus[status];
  const error = name ? titleCase(name) : 'Error';
  return new HttpException({ statusCode: status, message: message ?? code, error, code }, status);
}

function titleCase(constName: string): string {
  return constName
    .toLowerCase()
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}
