import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { createMemoryHistory, createRouter } from 'vue-router';
import { api } from '../api/client';
import { NetworkError } from '../api/errors';
import { useAuthStore } from '../stores/auth';
import ExchangeView from './ExchangeView.vue';

vi.mock('../api/client', () => ({ api: { login: vi.fn(), createTransaction: vi.fn() } }));

beforeEach(() => { vi.resetAllMocks(); });

async function mountView() {
  const pinia = createPinia();
  setActivePinia(pinia);
  vi.mocked(api.login).mockResolvedValue({ access_token: 'token', usuario: { id: 'user-1', nombre: 'Andrea', email: 'andrea@example.com', rol: 'user' } });
  await useAuthStore().login('andrea@example.com', 'password123');
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/', component: ExchangeView }, { path: '/history', component: { template: '<div>Historial</div>' } }] });
  await router.push('/');
  await router.isReady();
  return mount(ExchangeView, { global: { plugins: [pinia, router] } });
}

describe('formulario de cambio', () => {
  it('muestra errores de campo sin enviar un monto inválido', async () => {
    const view = await mountView();
    await view.get('#exchange-amount').setValue('10.123');
    await view.get('form').trigger('submit');
    await flushPromises();
    expect(view.get('#exchange-amount').attributes('aria-invalid')).toBe('true');
    expect(view.text()).toContain('hasta 2 decimales');
    expect(api.createTransaction).not.toHaveBeenCalled();
    view.unmount();
  });

  it('presenta el resultado registrado y la tasa del servidor sin una cotización ficticia', async () => {
    vi.mocked(api.createTransaction).mockResolvedValue({ id: 'transaction-1', monedaOrigen: 'USD', monedaDestino: 'PEN', monto: 100, montoCambiado: 373.9, tipoCambio: 3.739, fecha: '2026-10-14T15:00:00.000Z' });
    const view = await mountView();
    expect(view.find('[data-testid="transaction-result"]').exists()).toBe(false);
    await view.get('#exchange-amount').setValue('100');
    await view.get('form').trigger('submit');
    await flushPromises();
    expect(view.get('[data-testid="transaction-result"]').text()).toContain('373.90');
    expect(view.get('[data-testid="transaction-result"]').text()).toContain('3.739');
    expect(view.get('[data-testid="transaction-id"]').text()).toBe('transaction-1');
    view.unmount();
  });

  it('ofrece consultar el historial ante un resultado incierto sin enviar nuevamente', async () => {
    vi.mocked(api.createTransaction).mockRejectedValue(new NetworkError(true));
    const view = await mountView();
    await view.get('#exchange-amount').setValue('100');
    await view.get('form').trigger('submit');
    await flushPromises();
    expect(view.get('[role="alert"]').text()).toContain('podría haberse registrado');
    expect(view.get('[role="alert"] a').attributes('href')).toBe('/history');
    expect(api.createTransaction).toHaveBeenCalledTimes(1);
    view.unmount();
  });
});
