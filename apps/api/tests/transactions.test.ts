import { describe, expect, it, vi } from 'vitest';
import type { Actor } from '../src/shared/domain/actor';
import type { Clock } from '../src/shared/domain/clock';
import type { ExchangeRateRepository } from '../src/modules/rates/application/ports';
import type { ExchangeRate } from '../src/modules/rates/domain/exchange-rate';
import { CreateTransaction } from '../src/modules/transactions/application/create-transaction';
import { GetTransactionHistory } from '../src/modules/transactions/application/get-transaction-history';
import type { TransactionRepository } from '../src/modules/transactions/application/ports';
import { DateRange } from '../src/modules/transactions/domain/date-range';
import { Money } from '../src/modules/transactions/domain/money';
import type { Transaction } from '../src/modules/transactions/domain/transaction';

const user: Actor = {
  id: '507f1f77bcf86cd799439011',
  nombre: 'Ana',
  email: 'ana@example.test',
  rol: 'user',
};
const otherUserId = '507f1f77bcf86cd799439012';
const recordedAt = new Date('2026-10-14T16:00:00.000Z');

function exchangeRate(overrides: Partial<ExchangeRate> = {}): ExchangeRate {
  return {
    id: '507f1f77bcf86cd799439013',
    compra: '3.733',
    venta: '3.739',
    origen: 'SUNAT',
    moneda: 'USD',
    providerDate: '2026-10-14',
    fetchedAt: new Date('2026-10-14T15:59:30.000Z'),
    ...overrides,
  };
}

function createDependencies(rate: ExchangeRate | null = exchangeRate()) {
  const save = vi.fn(async (input: Omit<Transaction, 'id'>): Promise<Transaction> => ({
    id: '507f1f77bcf86cd799439014',
    ...input,
  }));
  const history = vi.fn(async (): Promise<Transaction[]> => []);
  const repository: TransactionRepository = { save, history };
  const latest = vi.fn(async (): Promise<ExchangeRate | null> => rate);
  const rates: ExchangeRateRepository = {
    save: vi.fn(async (input: Omit<ExchangeRate, 'id'>) => ({
      id: '507f1f77bcf86cd799439015',
      ...input,
    })),
    latest,
  };
  const clock: Clock = { now: () => recordedAt };

  return { save, history, repository, latest, rates, clock };
}

describe('Money', () => {
  it.each([0.01, 0.29, 1.1, 9999999.99])('accepts valid decimal input %s', (value) => {
    expect(() => Money.fromInput(value)).not.toThrow();
  });

  it.each([undefined, null, '100', true, NaN, Infinity, -Infinity, 0, -0.01, 1.001, 10000000])(
    'rejects invalid input %s instead of coercing or rounding it',
    (value) => {
      expect(() => Money.fromInput(value)).toThrow(expect.objectContaining({
        code: 'VALIDATION_ERROR',
        fields: { monto: expect.any(String) },
      }));
    },
  );

  it('rounds the final half-cent up', () => {
    expect(Money.fromInput(1).convert('1.005', 'venta')).toBe('1.01');
  });

  it('keeps recurring division precise until the final rounding', () => {
    expect(Money.fromInput(100).convert('3.733', 'compra')).toBe('26.79');
  });

  it('does not invent a minimum converted amount', () => {
    expect(Money.fromInput(0.01).convert('3.733', 'compra')).toBe('0.00');
  });

  it('does not apply the input maximum to the result', () => {
    expect(Money.fromInput(9999999.99).convert('3.739', 'venta')).toBe('37389999.96');
  });

  it.each(['0', '-1', 'NaN', 'Infinity', 'invalid'])('rejects an unusable stored rate %s', (rate) => {
    expect(() => Money.fromInput(100).convert(rate, 'compra')).toThrow(expect.objectContaining({
      code: 'EXCHANGE_RATE_UNAVAILABLE',
    }));
  });
});

describe('CreateTransaction', () => {
  it.each([
    { monedaOrigen: 'USD', monedaDestino: 'PEN', result: '373.90', side: 'venta', rate: '3.739' },
    { monedaOrigen: 'PEN', monedaDestino: 'USD', result: '26.79', side: 'compra', rate: '3.733' },
  ])('records the specified $monedaOrigen to $monedaDestino conversion', async (example) => {
    const dependencies = createDependencies();
    const create = new CreateTransaction(dependencies.repository, dependencies.rates, dependencies.clock);
    const result = await create.execute(user, {
      monedaOrigen: example.monedaOrigen,
      monedaDestino: example.monedaDestino,
      monto: 100,
    });

    expect(result).toMatchObject({
      userId: user.id,
      monto: '100.00',
      montoCambiado: example.result,
      tipoCambio: example.rate,
      rateSide: example.side,
      providerDate: '2026-10-14',
      fecha: recordedAt,
    });
    expect(dependencies.latest).toHaveBeenCalledTimes(1);
    expect(dependencies.save).toHaveBeenCalledTimes(1);
  });

  it('preserves its rate snapshot when a new rate is available', async () => {
    const dependencies = createDependencies();
    const create = new CreateTransaction(dependencies.repository, dependencies.rates, dependencies.clock);
    const first = await create.execute(user, { monedaOrigen: 'USD', monedaDestino: 'PEN', monto: 100 });
    dependencies.latest.mockResolvedValue(exchangeRate({
      id: '507f1f77bcf86cd799439016',
      venta: '4.1',
      providerDate: '2026-10-15',
    }));
    const second = await create.execute(user, { monedaOrigen: 'USD', monedaDestino: 'PEN', monto: 100 });

    expect(first).toMatchObject({
      montoCambiado: '373.90',
      tipoCambio: '3.739',
      rateId: '507f1f77bcf86cd799439013',
      providerDate: '2026-10-14',
    });
    expect(second).toMatchObject({ montoCambiado: '410.00', tipoCambio: '4.1' });
  });

  it.each(['user', 'admin'] as const)('records the authenticated %s as owner despite a forged body', async (rol) => {
    const dependencies = createDependencies();
    const create = new CreateTransaction(dependencies.repository, dependencies.rates, dependencies.clock);
    const result = await create.execute({ ...user, rol }, {
      monedaOrigen: 'USD',
      monedaDestino: 'PEN',
      monto: 100,
      userId: otherUserId,
    });

    expect(result.userId).toBe(user.id);
  });

  it.each([
    null,
    [],
    { monedaOrigen: 'USD', monedaDestino: 'USD', monto: 100 },
    { monedaOrigen: 'EUR', monedaDestino: 'PEN', monto: 100 },
    { monedaOrigen: 'USD', monedaDestino: 'EUR', monto: 100 },
    { monedaOrigen: 'USD', monedaDestino: 'PEN', monto: 0 },
  ])('rejects invalid requests before reading rates or saving', async (input) => {
    const dependencies = createDependencies();
    const create = new CreateTransaction(dependencies.repository, dependencies.rates, dependencies.clock);

    await expect(create.execute(user, input)).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(dependencies.latest).not.toHaveBeenCalled();
    expect(dependencies.save).not.toHaveBeenCalled();
  });

  it('refuses to save when no exchange rate is available', async () => {
    const dependencies = createDependencies(null);
    const create = new CreateTransaction(dependencies.repository, dependencies.rates, dependencies.clock);

    await expect(create.execute(user, { monedaOrigen: 'USD', monedaDestino: 'PEN', monto: 100 }))
      .rejects.toMatchObject({ code: 'EXCHANGE_RATE_UNAVAILABLE' });
    expect(dependencies.save).not.toHaveBeenCalled();
  });

  it('does not confirm an operation that failed to persist', async () => {
    const dependencies = createDependencies();
    const failure = new Error('Database unavailable');
    dependencies.save.mockRejectedValue(failure);
    const create = new CreateTransaction(dependencies.repository, dependencies.rates, dependencies.clock);

    await expect(create.execute(user, { monedaOrigen: 'USD', monedaDestino: 'PEN', monto: 100 }))
      .rejects.toBe(failure);
  });
});

describe('DateRange', () => {
  it('includes a full Lima day and excludes the next day', () => {
    const range = DateRange.fromInput('2026-10-14', '2026-10-14');

    expect(range.start.toISOString()).toBe('2026-10-14T05:00:00.000Z');
    expect(range.endExclusive.toISOString()).toBe('2026-10-15T05:00:00.000Z');
  });

  it('handles leap day and a month boundary', () => {
    const range = DateRange.fromInput('2024-02-29', '2024-02-29');

    expect(range.start.toISOString()).toBe('2024-02-29T05:00:00.000Z');
    expect(range.endExclusive.toISOString()).toBe('2024-03-01T05:00:00.000Z');
  });

  it.each([undefined, null, '', '2026-02-30', '2025-02-29', '2026-13-01', '2026-01-00', '2026-10-14T00:00:00Z'])(
    'rejects invalid calendar dates %s',
    (date) => {
      expect(() => DateRange.fromInput(date, '2026-10-14')).toThrow(expect.objectContaining({
        code: 'VALIDATION_ERROR',
      }));
      expect(() => DateRange.fromInput('2026-10-14', date)).toThrow(expect.objectContaining({
        code: 'VALIDATION_ERROR',
      }));
    },
  );

  it('rejects an inverted range', () => {
    expect(() => DateRange.fromInput('2026-10-15', '2026-10-14')).toThrow(expect.objectContaining({
      code: 'VALIDATION_ERROR',
    }));
  });
});

describe('GetTransactionHistory', () => {
  const dates = { startDate: '2026-10-14', endDate: '2026-10-14' };

  it.each([otherUserId, 'invalid', '', null, ['invalid'], { $ne: user.id }, 1])(
    'ignores userId %j for an ordinary user',
    async (userId) => {
      const dependencies = createDependencies();
      const history = new GetTransactionHistory(dependencies.repository);

      await history.execute(user, { ...dates, userId });

      expect(dependencies.history).toHaveBeenCalledWith(
        user.id,
        new Date('2026-10-14T05:00:00.000Z'),
        new Date('2026-10-15T05:00:00.000Z'),
      );
    },
  );

  it('defaults an admin to their own history', async () => {
    const dependencies = createDependencies();
    const history = new GetTransactionHistory(dependencies.repository);

    await history.execute({ ...user, rol: 'admin' }, dates);

    expect(dependencies.history).toHaveBeenCalledWith(user.id, expect.any(Date), expect.any(Date));
  });

  it('allows an admin to choose another valid user', async () => {
    const dependencies = createDependencies();
    const history = new GetTransactionHistory(dependencies.repository);

    await history.execute({ ...user, rol: 'admin' }, { ...dates, userId: otherUserId });

    expect(dependencies.history).toHaveBeenCalledWith(otherUserId, expect.any(Date), expect.any(Date));
  });

  it.each(['invalid', '', null, ['invalid'], { $ne: user.id }, 1])(
    'rejects invalid admin userId %j before querying',
    async (userId) => {
      const dependencies = createDependencies();
      const history = new GetTransactionHistory(dependencies.repository);

      await expect(history.execute({ ...user, rol: 'admin' }, { ...dates, userId }))
        .rejects.toMatchObject({ code: 'VALIDATION_ERROR', fields: { userId: expect.any(String) } });
      expect(dependencies.history).not.toHaveBeenCalled();
    },
  );

  it('returns an empty array for a valid range without records', async () => {
    const dependencies = createDependencies();
    const history = new GetTransactionHistory(dependencies.repository);

    await expect(history.execute(user, dates)).resolves.toEqual([]);
  });

  it('rejects missing or inverted dates before querying', async () => {
    const dependencies = createDependencies();
    const history = new GetTransactionHistory(dependencies.repository);

    await expect(history.execute(user, { startDate: '2026-10-14' }))
      .rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    await expect(history.execute(user, { startDate: '2026-10-15', endDate: '2026-10-14' }))
      .rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(dependencies.history).not.toHaveBeenCalled();
  });
});
