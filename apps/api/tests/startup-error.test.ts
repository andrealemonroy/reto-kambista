import { describe, expect, it } from 'vitest';
import { ConfigurationError, loadConfig } from '../src/bootstrap/config';
import { startupError } from '../src/bootstrap/startup-error';
import { DomainError } from '../src/shared/domain/domain-error';

describe('startup diagnostics', () => {
  it.each([
    ['JWT_SECRET', 'short-secret'],
    ['HOST', 'localhost'],
    ['PORT', '0'],
    ['WEB_ORIGIN', 'https://user:private-password@'],
    ['MONGODB_URI', 'https://user:private-password@database.example'],
    ['MONGODB_DATABASE', '../private-database'],
    ['RATE_PROVIDER_MODE', 'automatic'],
    ['JWT_ISSUER', ''],
    ['JWT_AUDIENCE', ''],
  ])('identifies the invalid %s field without exposing its value', (field, value) => {
    let failure: unknown;
    try {
      loadConfig({
        JWT_SECRET: 'test-secret-over-32-characters-long',
        MONGODB_URI: 'mongodb://127.0.0.1:27017',
        [field]: value,
      });
    } catch (error) {
      failure = error;
    }

    expect(failure).toBeInstanceOf(ConfigurationError);
    expect(startupError(failure)).toEqual({ type: 'ConfigurationError', code: 'INVALID_CONFIGURATION', field });
  });

  it('keeps useful domain codes without serializing errors or causes', () => {
    const error = new DomainError('RATE_PROVIDER_UNAVAILABLE', 'private-token');
    expect(startupError(error)).toEqual({ type: 'DomainError', code: 'RATE_PROVIDER_UNAVAILABLE' });
    expect(JSON.stringify(startupError(error))).not.toContain('private-token');
  });

  it('keeps a safe error type without logging a database URI or stack', () => {
    const error = new Error('mongodb://user:private-password@database.example');
    error.name = 'MongoServerSelectionError';
    error.cause = new Error('private-cause');

    expect(startupError(error)).toEqual({ type: 'MongoServerSelectionError', code: 'STARTUP_FAILED' });
    expect(JSON.stringify(startupError(error))).not.toMatch(/mongodb|private|stack|cause/);
  });

  it('does not serialize unexpected throws or unsafe error names', () => {
    const error = new Error('private-password');
    error.name = 'mongodb://user:private-password@database.example';

    expect(startupError(error)).toEqual({ type: 'UnknownError', code: 'STARTUP_FAILED' });
    expect(startupError({ secret: 'private-password' })).toEqual({ type: 'UnknownError', code: 'STARTUP_FAILED' });
  });
});
