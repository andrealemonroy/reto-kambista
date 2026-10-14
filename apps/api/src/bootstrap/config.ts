import { DomainError } from '../shared/domain/domain-error';

export interface AppConfig {
  host: '127.0.0.1' | '0.0.0.0';
  port: number;
  webOrigin: string;
  mongoUri: string;
  database: string;
  jwtSecret: string;
  jwtIssuer: string;
  jwtAudience: string;
  accessTokenSeconds: number;
  rateProviderMode: 'live' | 'fixture';
  rateProviderUrl: string;
  rateProviderToken?: string;
  rateTimeoutMs: number;
  rateIntervalMs: number;
  authRateWindowMs: number;
  authRateIpLimit: number;
  authRateAccountLimit: number;
}

export class ConfigurationError extends Error {
  readonly code = 'INVALID_CONFIGURATION';

  constructor(readonly field: string, message: string) {
    super(message);
    this.name = 'ConfigurationError';
  }
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const required = (name: string): string => {
    const value = env[name]?.trim();
    if (!value) throw new ConfigurationError(name, `Falta la variable ${name}.`);
    return value;
  };
  const integer = (name: string, fallback: number, minimum = 1, maximum = 2_147_483_647): number => {
    const raw = env[name] ?? String(fallback);
    if (!/^\d+$/.test(raw)) throw new ConfigurationError(name, `La variable ${name} debe ser un entero.`);
    const value = Number(raw);
    if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
      throw new ConfigurationError(name, `La variable ${name} está fuera de rango.`);
    }
    return value;
  };
  const jwtSecret = required('JWT_SECRET');
  if (jwtSecret.length < 32 || jwtSecret.startsWith('replace-with-')) {
    throw new ConfigurationError('JWT_SECRET', 'JWT_SECRET debe ser un secreto propio de al menos 32 caracteres.');
  }
  const host = env.HOST ?? '127.0.0.1';
  if (host !== '127.0.0.1' && host !== '0.0.0.0') {
    throw new ConfigurationError('HOST', 'HOST debe ser 127.0.0.1 o 0.0.0.0.');
  }
  const webOrigin = env.WEB_ORIGIN ?? 'http://127.0.0.1:5173';
  try {
    const originUrl = new URL(webOrigin);
    if (!['http:', 'https:'].includes(originUrl.protocol) || originUrl.origin !== webOrigin) {
      throw new Error();
    }
  } catch {
    throw new ConfigurationError('WEB_ORIGIN', 'WEB_ORIGIN debe contener únicamente el origen HTTP o HTTPS.');
  }
  const mongoUri = required('MONGODB_URI');
  if (!/^mongodb(?:\+srv)?:\/\//.test(mongoUri)) throw new ConfigurationError('MONGODB_URI', 'MONGODB_URI no es válida.');
  const database = env.MONGODB_DATABASE ?? 'kambista';
  if (!/^[a-zA-Z][a-zA-Z0-9_-]{0,62}$/.test(database)) throw new ConfigurationError('MONGODB_DATABASE', 'MONGODB_DATABASE no es válida.');
  const mode = env.RATE_PROVIDER_MODE ?? 'live';
  if (mode !== 'live' && mode !== 'fixture') throw new ConfigurationError('RATE_PROVIDER_MODE', 'RATE_PROVIDER_MODE debe ser live o fixture.');
  if (mode === 'fixture' && env.NODE_ENV === 'production') {
    throw new ConfigurationError('RATE_PROVIDER_MODE', 'El proveedor de prueba no está habilitado en producción.');
  }
  const jwtIssuer = env.JWT_ISSUER?.trim() ?? 'exchange-api';
  const jwtAudience = env.JWT_AUDIENCE?.trim() ?? 'exchange-web';
  for (const [field, value] of [['JWT_ISSUER', jwtIssuer], ['JWT_AUDIENCE', jwtAudience]]) {
    if (!value || value.length > 100) {
      throw new ConfigurationError(field, 'JWT_ISSUER y JWT_AUDIENCE deben contener entre 1 y 100 caracteres.');
    }
  }
  const rateTimeoutMs = integer('RATE_TIMEOUT_MS', 5000, 100, 25000);
  const rateIntervalMs = integer('RATE_INTERVAL_MS', 30000, 1000, 3600000);
  if (rateTimeoutMs >= rateIntervalMs) throw new ConfigurationError('RATE_TIMEOUT_MS', 'RATE_TIMEOUT_MS debe ser menor que RATE_INTERVAL_MS.');
  return {
    host,
    port: integer('PORT', 4000, 1, 65535),
    webOrigin,
    mongoUri,
    database,
    jwtSecret,
    jwtIssuer,
    jwtAudience,
    accessTokenSeconds: integer('ACCESS_TOKEN_SECONDS', 900, 60, 3600),
    rateProviderMode: mode,
    rateProviderUrl: env.RATE_PROVIDER_URL ?? 'https://api.apis.net.pe/v1/tipo-cambio-sunat',
    rateProviderToken: env.RATE_PROVIDER_TOKEN || undefined,
    rateTimeoutMs,
    rateIntervalMs,
    authRateWindowMs: integer('AUTH_RATE_WINDOW_MS', 60000, 1000, 3600000),
    authRateIpLimit: integer('AUTH_RATE_IP_LIMIT', 30, 1, 10000),
    authRateAccountLimit: integer('AUTH_RATE_ACCOUNT_LIMIT', 10, 1, 10000),
  };
}

export function assertRecord(input: unknown): Record<string, unknown> {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw new DomainError('VALIDATION_ERROR', 'Revisa los datos enviados.');
  }
  return input as Record<string, unknown>;
}
