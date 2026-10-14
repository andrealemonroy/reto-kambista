import type { OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { SyncExchangeRate } from '../modules/rates/application/sync-exchange-rate';
import { DomainError } from '../shared/domain/domain-error';
import { JsonLogger } from './json-logger';

export class RatesLifecycle implements OnApplicationBootstrap, OnApplicationShutdown {
  private timer?: NodeJS.Timeout;

  constructor(private readonly sync: SyncExchangeRate, private readonly intervalMs: number, private readonly logger: JsonLogger) {}

  onApplicationBootstrap(): void {
    void this.capture();
    this.timer = setInterval(() => void this.capture(), this.intervalMs);
    this.timer.unref();
  }

  onApplicationShutdown(): void {
    if (this.timer) clearInterval(this.timer);
  }

  private async capture(): Promise<void> {
    try {
      const rate = await this.sync.execute();
      if (rate) this.logger.event('info', 'rate_captured', { rateId: rate.id, providerDate: rate.providerDate });
    } catch (error) {
      this.logger.event('warn', 'rate_capture_failed', { code: error instanceof DomainError ? error.code : 'RATE_PROVIDER_UNAVAILABLE' });
    }
  }
}
