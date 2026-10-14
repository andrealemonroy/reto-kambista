import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { effectScope, type EffectScope } from 'vue';
import { api } from '../api/client';
import type { Transaction } from '../api/types';
import { useAuthStore } from '../stores/auth';
import { useHistory } from './useHistory';

vi.mock('../api/client', () => ({ api: { login: vi.fn(), history: vi.fn() } }));

const transaction: Transaction = { id: 'transaction-1', monedaOrigen: 'USD', monedaDestino: 'PEN', monto: 100, montoCambiado: 373.9, tipoCambio: 3.739, fecha: '2026-10-14T15:00:00.000Z' };
let scope: EffectScope;

beforeEach(async () => {
  setActivePinia(createPinia());
  vi.resetAllMocks();
  vi.mocked(api.login).mockResolvedValue({ access_token: 'token', usuario: { id: 'user-1', nombre: 'Andrea', email: 'andrea@example.com', rol: 'user' } });
  await useAuthStore().login('andrea@example.com', 'password123');
  scope = effectScope();
});

afterEach(() => { scope.stop(); });

describe('consulta de historial', () => {
  it('mantiene el último filtro aunque una consulta anterior responda después', async () => {
    let resolveOlder!: (value: Transaction[]) => void;
    vi.mocked(api.history).mockReturnValueOnce(new Promise((next) => { resolveOlder = next; })).mockResolvedValueOnce([]);
    const flow = scope.run(() => useHistory())!;
    const older = flow.load({ startDate: '2026-10-01', endDate: '2026-10-07' });
    await flow.load({ startDate: '2026-10-08', endDate: '2026-10-14' });
    resolveOlder([transaction]);
    await older;
    expect(flow.transactions.value).toEqual([]);
    expect(flow.status.value).toBe('success');
  });

  it('borra resultados e ignora una consulta que termina después del logout', async () => {
    vi.mocked(api.history).mockResolvedValue([transaction]);
    const flow = scope.run(() => useHistory())!;
    await flow.load({ startDate: '2026-10-01', endDate: '2026-10-14' });
    expect(flow.transactions.value).toHaveLength(1);
    let resolve!: (value: Transaction[]) => void;
    vi.mocked(api.history).mockReturnValue(new Promise((next) => { resolve = next; }));
    const pending = flow.load({ startDate: '2026-10-01', endDate: '2026-10-14' });
    useAuthStore().logout();
    resolve([transaction]);
    await pending;
    expect(flow.transactions.value).toEqual([]);
    expect(flow.status.value).toBe('idle');
  });
});
