import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { api } from '../api/client';
import type { LoginResponse } from '../api/types';
import { useAuthStore } from './auth';

vi.mock('../api/client', () => ({ api: { login: vi.fn() } }));

const session: LoginResponse = { access_token: 'token', usuario: { id: 'user-1', nombre: 'Andrea', email: 'andrea@example.com', rol: 'user' } };

beforeEach(() => {
  setActivePinia(createPinia());
  vi.resetAllMocks();
  vi.stubGlobal('localStorage', { setItem: vi.fn(), getItem: vi.fn(), removeItem: vi.fn() });
  vi.stubGlobal('sessionStorage', { setItem: vi.fn(), getItem: vi.fn(), removeItem: vi.fn() });
});

afterEach(() => { vi.unstubAllGlobals(); });

describe('sesión en memoria', () => {
  it('inicia sesión sin persistir credenciales y elimina los datos al salir', async () => {
    vi.mocked(api.login).mockResolvedValue(session);
    const store = useAuthStore();
    await store.login('andrea@example.com', 'password123');
    expect(store.authenticated).toBe(true);
    expect(store.user?.nombre).toBe('Andrea');
    expect(localStorage.setItem).not.toHaveBeenCalled();
    expect(sessionStorage.setItem).not.toHaveBeenCalled();
    store.logout();
    expect(store.authenticated).toBe(false);
    expect(store.accessToken).toBeNull();
    expect(store.user).toBeNull();
  });

  it('no restaura una sesión a partir de un login tardío después de salir', async () => {
    let resolve!: (value: LoginResponse) => void;
    vi.mocked(api.login).mockReturnValue(new Promise((next) => { resolve = next; }));
    const store = useAuthStore();
    const pending = store.login('andrea@example.com', 'password123');
    store.logout();
    resolve(session);
    await expect(pending).rejects.toMatchObject({ name: 'SupersededRequestError' });
    expect(store.authenticated).toBe(false);
  });

  it('una nueva instancia arranca sin sesión aunque otra instancia esté autenticada', async () => {
    vi.mocked(api.login).mockResolvedValue(session);
    await useAuthStore().login('andrea@example.com', 'password123');
    setActivePinia(createPinia());
    expect(useAuthStore().authenticated).toBe(false);
  });
});
