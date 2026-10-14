import type { ExchangeRate } from '../domain/exchange-rate';

export interface ExchangeRateRepository {
  save(input: Omit<ExchangeRate, 'id'>): Promise<ExchangeRate>;
  latest(): Promise<ExchangeRate | null>;
}

export interface RateProvider {
  fetch(): Promise<Omit<ExchangeRate, 'id' | 'fetchedAt'>>;
}
