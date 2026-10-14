import type { Clock } from '../../../shared/domain/clock';
import { DomainError } from '../../../shared/domain/domain-error';
import type { ExchangeRate } from '../domain/exchange-rate';
import type { ExchangeRateRepository, RateProvider } from './ports';

export class SyncExchangeRate {
  private busy = false;

  constructor(
    private readonly repository: ExchangeRateRepository,
    private readonly provider: RateProvider,
    private readonly clock: Clock,
  ) {}

  async execute(): Promise<ExchangeRate | null> {
    if (this.busy) {
      return null;
    }

    this.busy = true;

    try {
      let rate: Awaited<ReturnType<RateProvider['fetch']>>;
      try {
        rate = await this.provider.fetch();
      } catch {
        throw new DomainError('RATE_PROVIDER_UNAVAILABLE', 'No se pudo consultar el tipo de cambio.');
      }
      try {
        return await this.repository.save({ ...rate, fetchedAt: new Date(this.clock.now()) });
      } catch {
        throw new DomainError('PERSISTENCE_UNAVAILABLE', 'No se pudo guardar el tipo de cambio.');
      }
    } finally {
      this.busy = false;
    }
  }
}
