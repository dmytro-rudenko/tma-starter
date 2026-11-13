import { HttpException, HttpStatus, ValidationError, ValidationPipe } from '@nestjs/common';
import { apiError } from './api-error';

function messages(errors: ValidationError[]): string[] {
  return errors.flatMap((e) => [
    ...Object.values(e.constraints ?? {}),
    ...messages(e.children ?? []),
  ]);
}

export function validationExceptionFactory(errors: ValidationError[]): HttpException {
  return apiError(HttpStatus.BAD_REQUEST, 'VALIDATION', messages(errors).join('; '));
}

export function createValidationPipe(): ValidationPipe {
  return new ValidationPipe({
    whitelist: true,
    transform: true,
    exceptionFactory: validationExceptionFactory,
  });
}
