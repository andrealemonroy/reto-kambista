import { afterEach, describe, expect, it, vi } from 'vitest';
import { api } from './client';
import { ApiError, NetworkError } from './errors';

afterEach(() => { vi.unstubAllGlobals(); });

describe('cliente HTTP', () => {
  it('envía Bearer y el contrato de solicitud sin reintentos', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: 'transaction-1' }), { status: 201 }));
    vi.stubGlobal('fetch', fetchMock);
    await api.createTransaction({ monto: 100, monedaOrigen: 'USD', monedaDestino: 'PEN' }, 'session-token');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('/v1/transactions'), expect.objectContaining({
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json', Authorization: 'Bearer session-token' },
      body: JSON.stringify({ monto: 100, monedaOrigen: 'USD', monedaDestino: 'PEN' }),
      cache: 'no-store',
    }));
  });

  it('codifica los filtros del historial', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('[]'));
    vi.stubGlobal('fetch', fetchMock);
    await api.history({ startDate: '2026-10-01', endDate: '2026-10-14', userId: 'user with spaces' }, 'session-token');
    const url = new URL(fetchMock.mock.calls[0]?.[0] as string);
    expect(url.searchParams.get('userId')).toBe('user with spaces');
    expect(url.searchParams.get('startDate')).toBe('2026-10-01');
  });

  it('conserva errores estructurados, campos y referencia sin confiar en tipos inválidos', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ code: 'INVALID_INPUT', message: 'Monto inválido', fields: { monto: 'Debe ser positivo', ignored: 123 }, requestId: 'request-1' }), { status: 422 })));
    await expect(api.createTransaction({ monto: -1, monedaOrigen: 'USD', monedaDestino: 'PEN' }, 'token')).rejects.toMatchObject({ status: 422, code: 'INVALID_INPUT', fields: { monto: 'Debe ser positivo' }, requestId: 'request-1' });
  });

  it('marca el resultado de un POST de negocio fallido por red como incierto y no lo reintenta', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError('Network failed'));
    vi.stubGlobal('fetch', fetchMock);
    await expect(api.createTransaction({ monto: 100, monedaOrigen: 'USD', monedaDestino: 'PEN' }, 'token')).rejects.toMatchObject({ uncertain: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('no marca una consulta fallida como una operación posiblemente registrada', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Network failed')));
    await expect(api.history({ startDate: '2026-10-01', endDate: '2026-10-14' }, 'token')).rejects.toEqual(new NetworkError(false));
  });

  it.each(['network', 'invalid-success-body'])('marca un registro sin respuesta fiable como incierto: %s', async (failure) => {
    const fetchMock = failure === 'network'
      ? vi.fn().mockRejectedValue(new TypeError('Network failed'))
      : vi.fn().mockResolvedValue(new Response('invalid json', { status: 201 }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(api.register({ nombre: 'Andrea', email: 'andrea@example.com', password: 'password123' })).rejects.toMatchObject({ uncertain: true, operation: 'registration' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('retiene el estado HTTP 401 incluso si el servicio devuelve un cuerpo inválido', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('invalid json', { status: 401 })));
    await expect(api.history({ startDate: '2026-10-01', endDate: '2026-10-14' }, 'token')).rejects.toEqual(new ApiError(401, 'INVALID_RESPONSE', 'El servicio no pudo completar la solicitud.'));
  });
});
