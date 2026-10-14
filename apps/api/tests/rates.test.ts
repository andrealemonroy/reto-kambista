import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Clock } from '../src/shared/domain/clock';
import type { ExchangeRateRepository, RateProvider } from '../src/modules/rates/application/ports';
import { SyncExchangeRate } from '../src/modules/rates/application/sync-exchange-rate';
import type { ExchangeRate } from '../src/modules/rates/domain/exchange-rate';
import { FixtureRateProvider } from '../src/modules/rates/infrastructure/fixture-rate.provider';
import { SunatRateProvider } from '../src/modules/rates/infrastructure/sunat-rate.provider';

const payload = {
  compra: 3.733,
  venta: 3.739,
  origen: 'SUNAT',
  moneda: 'USD',
  fecha: '2024-01-18',
};

const rate: Omit<ExchangeRate, 'id' | 'fetchedAt'> = {
  compra: '3.733',
  venta: '3.739',
  origen: 'SUNAT',
  moneda: 'USD',
  providerDate: '2024-01-18',
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });

  return { promise, resolve, reject };
}

function repository(initial: ExchangeRate | null = null) {
  const saved = initial ? [initial] : [];
  const adapter: ExchangeRateRepository = {
    save: vi.fn(async (input: Omit<ExchangeRate, 'id'>) => {
      const result: ExchangeRate = { ...input, id: `rate-${saved.length + 1}` };
      saved.push(result);
      return result;
    }),
    latest: vi.fn(async () => saved.at(-1) ?? null),
  };

  return { adapter, saved };
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('SunatRateProvider', () => {
  it('validates the response and preserves decimal rate values', async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json(payload));
    vi.stubGlobal('fetch', fetchMock);
    const provider = new SunatRateProvider(
      'https://api.apis.net.pe/v1/tipo-cambio-sunat',
      undefined,
      5_000,
    );

    await expect(provider.fetch()).resolves.toEqual(rate);
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.apis.net.pe/v1/tipo-cambio-sunat',
      expect.objectContaining({
        method: 'GET',
        headers: { Accept: 'application/json' },
        redirect: 'error',
        signal: expect.any(AbortSignal),
      }),
    );
  });

  it('adds an explicitly configured provider token', async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json(payload));
    vi.stubGlobal('fetch', fetchMock);
    const provider = new SunatRateProvider('https://provider.example/rates', 'provider-token', 5_000);

    await provider.fetch();
    expect(fetchMock).toHaveBeenCalledWith(
      'https://provider.example/rates',
      expect.objectContaining({
        headers: { Accept: 'application/json', Authorization: 'Bearer provider-token' },
      }),
    );
  });

  it('accepts a real leap day', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ ...payload, fecha: '2024-02-29' })));

    await expect(new SunatRateProvider('https://provider.example/rates', undefined, 5_000).fetch())
      .resolves.toMatchObject({ providerDate: '2024-02-29' });
  });

  it.each([
    ['zero purchase rate', { ...payload, compra: 0 }],
    ['negative sale rate', { ...payload, venta: -1 }],
    ['string purchase rate', { ...payload, compra: '3.733' }],
    ['missing sale rate', { ...payload, venta: undefined }],
    ['incorrect source', { ...payload, origen: 'SBS' }],
    ['incorrect currency', { ...payload, moneda: 'EUR' }],
    ['impossible day', { ...payload, fecha: '2024-02-30' }],
    ['non-leap day', { ...payload, fecha: '2023-02-29' }],
    ['ambiguous date', { ...payload, fecha: '18/01/2024' }],
    ['array', [payload]],
    ['null', null],
  ])('rejects a %s response', async (_name, body) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json(body)));

    await expect(new SunatRateProvider('https://provider.example/rates', undefined, 5_000).fetch())
      .rejects.toMatchObject({ code: 'RATE_PROVIDER_UNAVAILABLE' });
  });

  it('rejects non-successful HTTP responses', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('unavailable', { status: 503 })));

    await expect(new SunatRateProvider('https://provider.example/rates', undefined, 5_000).fetch())
      .rejects.toMatchObject({ code: 'RATE_PROVIDER_UNAVAILABLE' });
  });

  it('rejects invalid JSON without returning response contents', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('private provider error', { status: 200 })));

    await expect(new SunatRateProvider('https://provider.example/rates', undefined, 5_000).fetch())
      .rejects.toMatchObject({
        code: 'RATE_PROVIDER_UNAVAILABLE',
        message: 'El proveedor de tipo de cambio no está disponible.',
      });
  });

  it('maps network and redirect failures to a domain error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('fetch failed')));

    await expect(new SunatRateProvider('https://provider.example/rates', undefined, 5_000).fetch())
      .rejects.toMatchObject({ code: 'RATE_PROVIDER_UNAVAILABLE' });
  });

  it('aborts a provider call when its timeout expires', async () => {
    vi.useFakeTimers();
    let signal: AbortSignal | undefined;
    vi.stubGlobal('fetch', vi.fn((_input: RequestInfo | URL, options?: RequestInit) => {
      signal = options?.signal ?? undefined;
      return new Promise<Response>((_resolve, reject) => {
        signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
      });
    }));
    const provider = new SunatRateProvider('https://provider.example/rates', undefined, 5_000);
    const assertion = expect(provider.fetch()).rejects.toMatchObject({ code: 'RATE_PROVIDER_UNAVAILABLE' });

    await vi.advanceTimersByTimeAsync(5_000);
    await assertion;
    expect(signal?.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('clears its timeout after a successful request', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json(payload)));

    await new SunatRateProvider('https://provider.example/rates', undefined, 5_000).fetch();
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([
    ['http://provider.example/rates', 5_000],
    ['https://user:password@provider.example/rates', 5_000],
    ['https://provider.example/rates#fragment', 5_000],
    ['not-a-url', 5_000],
    ['https://provider.example/rates', 0],
    ['https://provider.example/rates', 30_000],
  ])('rejects unsafe or unbounded configuration %s/%s', (url, timeoutMs) => {
    expect(() => new SunatRateProvider(String(url), undefined, Number(timeoutMs)))
      .toThrowError(expect.objectContaining({ code: 'RATE_PROVIDER_UNAVAILABLE' }));
  });
});

describe('SyncExchangeRate', () => {
  const fetchedAt = new Date('2026-10-14T15:00:00.000Z');
  const clock: Clock = { now: () => fetchedAt };

  it('persists validated provider values with the capture timestamp', async () => {
    const { adapter, saved } = repository();
    const sync = new SyncExchangeRate(adapter, new FixtureRateProvider(), clock);

    await expect(sync.execute()).resolves.toEqual({ ...rate, id: 'rate-1', fetchedAt });
    expect(saved).toHaveLength(1);
    expect(saved[0]?.fetchedAt).not.toBe(fetchedAt);
  });

  it('persists repeated captures even if the provider values have not changed', async () => {
    const { adapter, saved } = repository();
    const sync = new SyncExchangeRate(adapter, new FixtureRateProvider(), clock);

    await sync.execute();
    await sync.execute();
    expect(saved).toHaveLength(2);
    expect(saved[1]?.id).not.toBe(saved[0]?.id);
  });

  it('skips overlapping execution while fetching', async () => {
    const pending = deferred<Omit<ExchangeRate, 'id' | 'fetchedAt'>>();
    const fetchMock = vi.fn(() => pending.promise);
    const provider: RateProvider = { fetch: fetchMock };
    const { adapter, saved } = repository();
    const sync = new SyncExchangeRate(adapter, provider, clock);
    const first = sync.execute();

    await expect(sync.execute()).resolves.toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(saved).toHaveLength(0);
    pending.resolve(rate);
    await first;
    expect(saved).toHaveLength(1);
  });

  it('keeps execution exclusive until persistence completes', async () => {
    const pending = deferred<ExchangeRate>();
    const persisted = { ...rate, id: 'rate-1', fetchedAt };
    const saveMock = vi.fn(() => pending.promise);
    const adapter: ExchangeRateRepository = { save: saveMock, latest: async () => null };
    const sync = new SyncExchangeRate(adapter, new FixtureRateProvider(), clock);
    const first = sync.execute();
    await vi.waitFor(() => expect(saveMock).toHaveBeenCalledTimes(1));

    await expect(sync.execute()).resolves.toBeNull();
    pending.resolve(persisted);
    await expect(first).resolves.toEqual(persisted);
    expect(saveMock).toHaveBeenCalledTimes(1);
  });

  it('preserves a previous capture on failure and permits the next execution', async () => {
    const previous = { ...rate, id: 'previous-rate', fetchedAt: new Date('2026-10-14T14:59:30.000Z') };
    const { adapter, saved } = repository(previous);
    const provider: RateProvider = {
      fetch: vi.fn().mockRejectedValueOnce(new Error('provider unavailable')).mockResolvedValue(rate),
    };
    const sync = new SyncExchangeRate(adapter, provider, clock);

    await expect(sync.execute()).rejects.toMatchObject({ code: 'RATE_PROVIDER_UNAVAILABLE' });
    await expect(adapter.latest()).resolves.toEqual(previous);
    expect(saved).toHaveLength(1);
    await expect(sync.execute()).resolves.toMatchObject({ id: 'rate-2', fetchedAt });
    expect(saved).toHaveLength(2);
  });

  it('releases exclusion after a persistence failure', async () => {
    const persisted = { ...rate, id: 'rate-1', fetchedAt };
    const saveMock = vi.fn().mockRejectedValueOnce(new Error('database unavailable')).mockResolvedValue(persisted);
    const adapter: ExchangeRateRepository = { save: saveMock, latest: async () => null };
    const sync = new SyncExchangeRate(adapter, new FixtureRateProvider(), clock);

    await expect(sync.execute()).rejects.toMatchObject({ code: 'PERSISTENCE_UNAVAILABLE' });
    await expect(sync.execute()).resolves.toEqual(persisted);
    expect(saveMock).toHaveBeenCalledTimes(2);
  });
});
