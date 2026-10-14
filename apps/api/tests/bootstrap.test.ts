import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Clock } from '../src/shared/domain/clock';
import { AuthLimiter } from '../src/bootstrap/auth-limiter';
import { JsonLogger } from '../src/bootstrap/json-logger';
import { RatesLifecycle } from '../src/bootstrap/rates-lifecycle';
import { SyncExchangeRate } from '../src/modules/rates/application/sync-exchange-rate';
import type { ExchangeRateRepository, RateProvider } from '../src/modules/rates/application/ports';
import type { ExchangeRate } from '../src/modules/rates/domain/exchange-rate';

describe('AuthLimiter', () => {
  function fixture(ipLimit = 30, accountLimit = 2) {
    let timestamp = 0;
    const clock: Clock = { now: () => new Date(timestamp) };
    const limiter = new AuthLimiter(clock, 60000, ipLimit, accountLimit);

    return { limiter, advance: (milliseconds: number) => { timestamp += milliseconds; } };
  }

  it('counts padded and differently cased emails toward the same account limit', () => {
    const { limiter } = fixture();

    expect(limiter.consume('127.0.0.1', 'target@example.test')).toBeNull();
    expect(limiter.consume('127.0.0.2', ' TARGET@EXAMPLE.TEST '.padEnd(300, ' '))).toBeNull();
    expect(limiter.consume('127.0.0.3', 'target@example.test')).toBe(60);
    expect(limiter.consume('127.0.0.4', 'target@example.test'.padEnd(300, ' '))).toBe(60);
  });

  it('limits requests from one IP even when the account changes', () => {
    const { limiter } = fixture(2, 10);

    expect(limiter.consume('127.0.0.1', 'first@example.test')).toBeNull();
    expect(limiter.consume('127.0.0.1', 'second@example.test')).toBeNull();
    expect(limiter.consume('127.0.0.1', 'third@example.test')).toBe(60);
    expect(limiter.consume('127.0.0.2', 'third@example.test')).toBeNull();
  });

  it('still applies the IP limit without a usable email', () => {
    const { limiter } = fixture(2, 10);

    expect(limiter.consume('127.0.0.1', undefined)).toBeNull();
    expect(limiter.consume('127.0.0.1', { email: 'target@example.test' })).toBeNull();
    expect(limiter.consume('127.0.0.1', undefined)).toBe(60);
  });

  it('recovers at the window boundary without extending a blocked window', () => {
    const { limiter, advance } = fixture(30, 1);

    expect(limiter.consume('127.0.0.1', 'target@example.test')).toBeNull();
    advance(59001);
    expect(limiter.consume('127.0.0.2', 'target@example.test')).toBe(1);
    advance(999);
    expect(limiter.consume('127.0.0.2', 'target@example.test')).toBeNull();
  });
});

describe('RatesLifecycle', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-14T16:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function fixture() {
    const rate = {
      compra: '3.733',
      venta: '3.739',
      origen: 'SUNAT' as const,
      moneda: 'USD' as const,
      providerDate: '2026-10-14',
    };
    const fetch = vi.fn(async () => rate);
    const provider: RateProvider = { fetch };
    const save = vi.fn(async (input: Omit<ExchangeRate, 'id'>): Promise<ExchangeRate> => ({
      id: '507f1f77bcf86cd799439011',
      ...input,
    }));
    const repository: ExchangeRateRepository = { save, latest: async () => null };
    const logs: string[] = [];
    const logger = new JsonLogger((line) => { logs.push(line); });
    const sync = new SyncExchangeRate(repository, provider, { now: () => new Date() });
    const lifecycle = new RatesLifecycle(sync, 30000, logger);

    return { fetch, save, logs, lifecycle };
  }

  it('captures immediately and then at each 30-second boundary', async () => {
    const { fetch, save, lifecycle } = fixture();
    lifecycle.onApplicationBootstrap();
    await vi.advanceTimersByTimeAsync(0);

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(29999);
    expect(fetch).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(fetch).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(60000);
    expect(fetch).toHaveBeenCalledTimes(4);

    await lifecycle.onApplicationShutdown();
  });

  it('stops future captures after shutdown', async () => {
    const { fetch, lifecycle } = fixture();
    lifecycle.onApplicationBootstrap();
    await vi.advanceTimersByTimeAsync(0);
    await lifecycle.onApplicationShutdown();
    await vi.advanceTimersByTimeAsync(90000);

    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('reports a failed capture safely and retries on the next interval', async () => {
    const { fetch, save, logs, lifecycle } = fixture();
    fetch.mockRejectedValueOnce(new Error('sensitive-provider-token'));
    lifecycle.onApplicationBootstrap();
    await vi.advanceTimersByTimeAsync(0);

    expect(save).not.toHaveBeenCalled();
    expect(logs.map((line) => JSON.parse(line))).toContainEqual(expect.objectContaining({
      level: 'warn',
      event: 'rate_capture_failed',
      code: 'RATE_PROVIDER_UNAVAILABLE',
    }));
    expect(logs.join('')).not.toContain('sensitive-provider-token');
    await vi.advanceTimersByTimeAsync(30000);
    expect(save).toHaveBeenCalledTimes(1);
    expect(logs.map((line) => JSON.parse(line))).toContainEqual(expect.objectContaining({ event: 'rate_captured' }));

    await lifecycle.onApplicationShutdown();
  });
});
