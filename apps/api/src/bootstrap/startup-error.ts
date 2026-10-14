import { DomainError } from '../shared/domain/domain-error';
import { ConfigurationError } from './config';

export function startupError(error: unknown): Record<string, string> {
  if (error instanceof ConfigurationError) {
    return { type: 'ConfigurationError', code: error.code, field: error.field };
  }
  if (error instanceof DomainError) {
    return { type: 'DomainError', code: error.code };
  }
  const type = error instanceof Error && /^[A-Za-z][A-Za-z0-9]{0,63}$/.test(error.name)
    ? error.name
    : 'UnknownError';
  return { type, code: 'STARTUP_FAILED' };
}
