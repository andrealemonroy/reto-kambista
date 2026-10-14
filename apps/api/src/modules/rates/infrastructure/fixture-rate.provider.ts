import type { RateProvider } from '../application/ports';
import type { ExchangeRate } from '../domain/exchange-rate';

export class FixtureRateProvider implements RateProvider {
  async fetch(): Promise<Omit<ExchangeRate, 'id' | 'fetchedAt'>> {
    return {
      compra: '3.733',
      venta: '3.739',
      origen: 'SUNAT',
      moneda: 'USD',
      providerDate: '2024-01-18',
    };
  }
}
