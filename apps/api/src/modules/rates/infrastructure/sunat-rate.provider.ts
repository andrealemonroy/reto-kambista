import { DomainError } from '../../../shared/domain/domain-error';
import type { RateProvider } from '../application/ports';
import type { ExchangeRate } from '../domain/exchange-rate';

function unavailable(): DomainError {
  return new DomainError(
    'RATE_PROVIDER_UNAVAILABLE',
    'El proveedor de tipo de cambio no está disponible.',
  );
}

function validDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }

  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function positiveRate(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

export class SunatRateProvider implements RateProvider {
  private readonly url: string;

  constructor(
    url: string,
    private readonly token: string | undefined,
    private readonly timeoutMs: number,
  ) {
    let parsed: URL;

    try {
      parsed = new URL(url);
    } catch {
      throw unavailable();
    }

    const localHttp = parsed.protocol === 'http:'
      && ['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname);

    if (
      (parsed.protocol !== 'https:' && !localHttp)
      || parsed.username
      || parsed.password
      || parsed.hash
      || !Number.isInteger(timeoutMs)
      || timeoutMs <= 0
      || timeoutMs >= 30_000
    ) {
      throw unavailable();
    }

    this.url = parsed.toString();
  }

  async fetch(): Promise<Omit<ExchangeRate, 'id' | 'fetchedAt'>> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await fetch(this.url, {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}),
        },
        redirect: 'error',
        signal: controller.signal,
      });

      if (!response.ok) {
        throw unavailable();
      }

      const body: unknown = await response.json();

      if (!body || typeof body !== 'object' || Array.isArray(body)) {
        throw unavailable();
      }

      const payload = body as Record<string, unknown>;

      if (
        !positiveRate(payload.compra)
        || !positiveRate(payload.venta)
        || payload.origen !== 'SUNAT'
        || payload.moneda !== 'USD'
        || !validDate(payload.fecha)
      ) {
        throw unavailable();
      }

      return {
        compra: String(payload.compra),
        venta: String(payload.venta),
        origen: 'SUNAT',
        moneda: 'USD',
        providerDate: payload.fecha,
      };
    } catch {
      throw unavailable();
    } finally {
      clearTimeout(timer);
    }
  }
}
