import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { effectScope, type EffectScope } from 'vue';
import { api } from '../api/client';
import { ApiError, NetworkError } from '../api/errors';
import type { Transaction } from '../api/types';
import { useAuthStore } from '../stores/auth';
import { useExchange } from './useExchange';

vi.mock('../api/client', () => ({ api: { login: vi.fn(), createTransaction: vi.fn() } }));

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

describe('flujo de solicitud', () => {
  it('muestra solo el resultado devuelto por el servidor y evita solicitudes concurrentes', async () => {
    let resolve!: (value: Transaction) => void;
    vi.mocked(api.createTransaction).mockReturnValue(new Promise((next) => { resolve = next; }));
    const flow = scope.run(() => useExchange())!;
    const pending = flow.submit({ monedaOrigen: 'USD', monedaDestino: 'PEN', monto: 100 });
    await flow.submit({ monedaOrigen: 'USD', monedaDestino: 'PEN', monto: 100 });
    expect(api.createTransaction).toHaveBeenCalledTimes(1);
    expect(flow.result.value).toBeNull();
    resolve(transaction);
    await pending;
    expect(flow.status.value).toBe('success');
    expect(flow.result.value).toEqual(transaction);
  });

  it('borra el resultado privado e ignora respuestas tardías después de cerrar sesión', async () => {
    let resolve!: (value: Transaction) => void;
    vi.mocked(api.createTransaction).mockReturnValue(new Promise((next) => { resolve = next; }));
    const flow = scope.run(() => useExchange())!;
    const pending = flow.submit({ monedaOrigen: 'USD', monedaDestino: 'PEN', monto: 100 });
    useAuthStore().logout();
    resolve(transaction);
    await pending;
    expect(flow.result.value).toBeNull();
    expect(flow.status.value).toBe('idle');
  });

  it('elimina la sesión frente a un 401', async () => {
    vi.mocked(api.createTransaction).mockRejectedValue(new ApiError(401, 'TOKEN_EXPIRED', 'Sesión expirada'));
    const flow = scope.run(() => useExchange())!;
    await flow.submit({ monedaOrigen: 'USD', monedaDestino: 'PEN', monto: 100 });
    expect(useAuthStore().authenticated).toBe(false);
    expect(useAuthStore().reason).toBe('expired');
    expect(flow.error.value).toBe('');
  });

  it('distingue un resultado incierto de un rechazo confirmado del servidor', async () => {
    vi.mocked(api.createTransaction).mockRejectedValue(new NetworkError(true));
    const flow = scope.run(() => useExchange())!;
    await flow.submit({ monedaOrigen: 'USD', monedaDestino: 'PEN', monto: 100 });
    expect(flow.status.value).toBe('uncertain');
    expect(flow.error.value).toContain('historial');
    expect(flow.result.value).toBeNull();
    expect(api.createTransaction).toHaveBeenCalledTimes(1);
  });
});
