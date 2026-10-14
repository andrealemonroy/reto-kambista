import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mount, flushPromises, type VueWrapper } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { createMemoryHistory, createRouter, RouterView } from 'vue-router';
import { api } from '../api/client';
import { NetworkError } from '../api/errors';
import { useAuthStore } from '../stores/auth';
import AuthView from './AuthView.vue';

vi.mock('../api/client', () => ({ api: { login: vi.fn(), register: vi.fn() } }));

const user = { id: 'user-1', nombre: 'Andrea', email: 'andrea@example.com', rol: 'user' as const };
const mountedViews: VueWrapper[] = [];

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(api.register).mockResolvedValue(user);
  vi.mocked(api.login).mockResolvedValue({ access_token: 'session-token', usuario: user });
});

afterEach(() => {
  for (const view of mountedViews.splice(0)) view.unmount();
});

async function mountAuth(path: string) {
  const pinia = createPinia();
  setActivePinia(pinia);
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/login', name: 'login', component: AuthView, props: { mode: 'login' } },
      { path: '/register', name: 'register', component: AuthView, props: { mode: 'register' } },
      { path: '/exchange', name: 'exchange', component: { template: '<h1>Nueva solicitud</h1>' } },
      { path: '/history', name: 'history', component: { template: '<h1>Historial</h1>' } },
    ],
  });
  await router.push(path);
  await router.isReady();
  const view = mount({ components: { RouterView }, template: '<RouterView :key="$route.path" />' }, { global: { plugins: [pinia, router] } });
  mountedViews.push(view);
  return { view, router };
}

async function fillCredentials(view: VueWrapper) {
  await view.get('#auth-email').setValue(user.email);
  await view.get('#auth-password').setValue('password123');
}

describe('navegación de autenticación', () => {
  it('conserva el historial como destino durante login, registro y nuevo login', async () => {
    const { view, router } = await mountAuth('/login?redirect=/history');
    await view.get('.auth-switch a').trigger('click');
    await flushPromises();
    expect(router.currentRoute.value.path).toBe('/register');
    expect(router.currentRoute.value.query.redirect).toBe('/history');
    await view.get('#auth-name').setValue(user.nombre);
    await fillCredentials(view);
    await view.get('form').trigger('submit');
    await flushPromises();
    expect(router.currentRoute.value.path).toBe('/login');
    expect(router.currentRoute.value.query).toEqual({ registered: 'true', redirect: '/history' });
    expect(useAuthStore().authenticated).toBe(false);
    await fillCredentials(view);
    await view.get('form').trigger('submit');
    await flushPromises();
    expect(router.currentRoute.value.path).toBe('/history');
    expect(api.register).toHaveBeenCalledTimes(1);
    expect(api.login).toHaveBeenCalledTimes(1);
  });

  it('sanea un destino externo al alternar entre login y registro', async () => {
    const { view, router } = await mountAuth('/login?redirect=https%3A%2F%2Fevil.example');
    await view.get('.auth-switch a').trigger('click');
    await flushPromises();
    expect(router.currentRoute.value.path).toBe('/register');
    expect(router.currentRoute.value.query.redirect).toBe('/exchange');
    await view.get('.auth-switch a').trigger('click');
    await flushPromises();
    expect(router.currentRoute.value.path).toBe('/login');
    expect(router.currentRoute.value.query.redirect).toBe('/exchange');
    await fillCredentials(view);
    await view.get('form').trigger('submit');
    await flushPromises();
    expect(router.currentRoute.value.path).toBe('/exchange');
  });
});

describe('registro con respuesta incierta', () => {
  it('permite iniciar sesión sin reenviar el registro ni afirmar que la cuenta se creó', async () => {
    vi.mocked(api.register).mockRejectedValue(new NetworkError(true, 'registration'));
    const { view, router } = await mountAuth('/register?redirect=/history');
    await view.get('#auth-name').setValue(user.nombre);
    await fillCredentials(view);
    await view.get('form').trigger('submit');
    await flushPromises();
    expect(view.get('[role="alert"]').text()).toContain('No pudimos confirmar el registro.');
    expect(api.register).toHaveBeenCalledTimes(1);
    expect(api.login).not.toHaveBeenCalled();
    expect(useAuthStore().authenticated).toBe(false);
    await view.get('[role="alert"] .inline-action').trigger('click');
    await flushPromises();
    expect(router.currentRoute.value.path).toBe('/login');
    expect(router.currentRoute.value.query).toEqual({ redirect: '/history' });
    expect(view.find('.notice-success').exists()).toBe(false);
    expect(view.get<HTMLInputElement>('#auth-password').element.value).toBe('');
    await fillCredentials(view);
    await view.get('form').trigger('submit');
    await flushPromises();
    expect(router.currentRoute.value.path).toBe('/history');
    expect(api.register).toHaveBeenCalledTimes(1);
    expect(api.login).toHaveBeenCalledTimes(1);
  });
});
