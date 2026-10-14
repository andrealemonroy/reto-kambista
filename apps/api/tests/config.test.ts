import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/bootstrap/config';

function environment(overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return {
    NODE_ENV: 'test',
    JWT_SECRET: 'configuration-tests-use-a-secret-with-over-32-characters',
    MONGODB_URI: 'mongodb://127.0.0.1:27017',
    ...overrides,
  };
}

describe('loadConfig', () => {
  it('starts with required credentials and conservative access/provider defaults', () => {
    const config = loadConfig(environment());

    expect(config).toMatchObject({
      host: '127.0.0.1',
      accessTokenSeconds: 900,
      rateProviderMode: 'live',
      rateIntervalMs: 30000,
      webOrigin: 'http://127.0.0.1:5173',
    });
    expect(config.rateTimeoutMs).toBeLessThan(config.rateIntervalMs);
  });

  it.each(['127.0.0.1', '0.0.0.0'])('accepts the explicit bind address %s', (host) => {
    expect(loadConfig(environment({ HOST: host })).host).toBe(host);
  });

  it('accepts an external container bind address and the assigned production port', () => {
    expect(loadConfig(environment({ NODE_ENV: 'production', HOST: '0.0.0.0', PORT: '8080' })))
      .toMatchObject({ host: '0.0.0.0', port: 8080, rateProviderMode: 'live', rateIntervalMs: 30000 });
  });

  it.each([
    '', 'localhost', '::', '127.0.0.2', '192.168.1.1', '0.0.0.0:4000', 'http://0.0.0.0', ' 0.0.0.0 ',
  ])('rejects an unsupported bind address %j', (host) => {
    expect(() => loadConfig(environment({ HOST: host })))
      .toThrow('HOST debe ser 127.0.0.1 o 0.0.0.0.');
  });

  it.each([
    { JWT_SECRET: undefined },
    { JWT_SECRET: '' },
    { JWT_SECRET: ' '.repeat(40) },
    { JWT_SECRET: 'short-secret' },
    { JWT_SECRET: 'replace-with-a-strong-and-unique-secret' },
    { MONGODB_URI: undefined },
    { MONGODB_URI: '' },
    { MONGODB_URI: 'https://database.example.test' },
    { MONGODB_DATABASE: '../unsafe' },
    { MONGODB_DATABASE: '' },
  ])('fails early for missing or unsafe required configuration %j', (overrides) => {
    expect(() => loadConfig(environment(overrides))).toThrow();
  });

  it.each([
    ['PORT', '0'],
    ['PORT', '65536'],
    ['PORT', '4000.5'],
    ['PORT', '1e3'],
    ['ACCESS_TOKEN_SECONDS', '59'],
    ['ACCESS_TOKEN_SECONDS', '3601'],
    ['ACCESS_TOKEN_SECONDS', '-1'],
    ['RATE_TIMEOUT_MS', '99'],
    ['RATE_TIMEOUT_MS', '25001'],
    ['RATE_INTERVAL_MS', '999'],
    ['RATE_INTERVAL_MS', '3600001'],
    ['AUTH_RATE_WINDOW_MS', '999'],
    ['AUTH_RATE_IP_LIMIT', '0'],
    ['AUTH_RATE_ACCOUNT_LIMIT', '10001'],
    ['AUTH_RATE_ACCOUNT_LIMIT', '9007199254740992'],
  ])('rejects %s outside its operational range: %s', (name, value) => {
    expect(() => loadConfig(environment({ [name]: value }))).toThrow();
  });

  it.each(['60', '3600'])('allows the documented access-token duration boundary %s', (value) => {
    expect(loadConfig(environment({ ACCESS_TOKEN_SECONDS: value })).accessTokenSeconds).toBe(Number(value));
  });

  it.each(['1000', '1001'])('requires the provider timeout %s to be shorter than its interval', (value) => {
    expect(() => loadConfig(environment({ RATE_INTERVAL_MS: '1000', RATE_TIMEOUT_MS: value }))).toThrow();
  });

  it('accepts a short interval when provider calls are bounded below it', () => {
    expect(() => loadConfig(environment({ RATE_INTERVAL_MS: '1000', RATE_TIMEOUT_MS: '100' }))).not.toThrow();
  });

  it('allows fixtures only when explicitly enabled outside production', () => {
    expect(loadConfig(environment({ RATE_PROVIDER_MODE: 'fixture' })).rateProviderMode).toBe('fixture');
    expect(() => loadConfig(environment({ RATE_PROVIDER_MODE: 'fixture', NODE_ENV: 'production' })))
      .toThrow('El proveedor de prueba no está habilitado en producción.');
    expect(loadConfig(environment({ NODE_ENV: 'production' })).rateProviderMode).toBe('live');
  });

  it('rejects unknown provider modes', () => {
    expect(() => loadConfig(environment({ RATE_PROVIDER_MODE: 'automatic' }))).toThrow();
  });

  it.each([
    '*',
    'null',
    'file:///tmp/app',
    'https://web.example.test/private',
    'https://web.example.test?query=true',
    'https://web.example.test#fragment',
    'https://user:password@web.example.test',
    'https://web.example.test,https://other.example.test',
  ])('rejects unsafe or non-origin CORS configuration %s', (value) => {
    expect(() => loadConfig(environment({ WEB_ORIGIN: value }))).toThrow();
  });

  it.each(['http://localhost:5173', 'https://web.example.test'])('accepts an explicit HTTP origin %s', (value) => {
    expect(loadConfig(environment({ WEB_ORIGIN: value })).webOrigin).toBe(value);
  });

  it.each([
    { JWT_ISSUER: '' },
    { JWT_ISSUER: '   ' },
    { JWT_ISSUER: 'a'.repeat(101) },
    { JWT_AUDIENCE: '' },
    { JWT_AUDIENCE: '   ' },
    { JWT_AUDIENCE: 'a'.repeat(101) },
  ])('rejects an empty JWT trust boundary %j', (overrides) => {
    expect(() => loadConfig(environment(overrides))).toThrow();
  });

  it('normalizes explicitly configured JWT trust boundaries', () => {
    expect(loadConfig(environment({ JWT_ISSUER: '  exchange-api  ', JWT_AUDIENCE: '  exchange-web  ' })))
      .toMatchObject({ jwtIssuer: 'exchange-api', jwtAudience: 'exchange-web' });
  });
});
