import { computed, ref } from 'vue';
import { defineStore } from 'pinia';
import { api } from '../api/client';
import { SupersededRequestError } from '../api/errors';
import type { User } from '../api/types';

export const useAuthStore = defineStore('auth', () => {
  const accessToken = ref<string | null>(null);
  const user = ref<User | null>(null);
  const generation = ref(0);
  const reason = ref<'expired' | 'logout' | null>(null);
  const authenticated = computed(() => Boolean(accessToken.value && user.value));
  const isAdmin = computed(() => user.value?.rol === 'admin');

  async function login(email: string, password: string, signal?: AbortSignal) {
    const currentGeneration = generation.value;
    const result = await api.login(email, password, signal);
    if (currentGeneration !== generation.value || signal?.aborted) throw new SupersededRequestError();
    accessToken.value = result.access_token;
    user.value = result.usuario;
    reason.value = null;
    generation.value += 1;
  }

  function logout(nextReason: 'expired' | 'logout' = 'logout') {
    accessToken.value = null;
    user.value = null;
    reason.value = nextReason;
    generation.value += 1;
  }

  return { accessToken, user, generation, reason, authenticated, isAdmin, login, logout };
});
