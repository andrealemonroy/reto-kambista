<script setup lang="ts">
import { computed, nextTick, onScopeDispose, ref } from 'vue';
import { RouterLink, useRoute, useRouter } from 'vue-router';
import { api } from '../api/client';
import { ApiError, NetworkError, SupersededRequestError, errorMessage } from '../api/errors';
import type { FieldErrors } from '../api/types';
import { safeReturnPath } from '../lib/validation';
import { useAuthStore } from '../stores/auth';

const props = defineProps<{ mode: 'login' | 'register' }>();
const auth = useAuthStore();
const route = useRoute();
const router = useRouter();
const registering = computed(() => props.mode === 'register');
const returnQuery = computed(() => route.query.redirect === undefined ? {} : { redirect: safeReturnPath(route.query.redirect) });
const authSwitchTarget = computed(() => ({ name: registering.value ? 'login' : 'register', query: returnQuery.value }));
const nombre = ref('');
const email = ref('');
const password = ref('');
const passwordVisible = ref(false);
const loading = ref(false);
const errors = ref<FieldErrors>({});
const message = ref('');
const registrationUncertain = ref(false);
const requestId = ref<string | undefined>();
const summary = ref<HTMLElement | null>(null);
let controller: AbortController | undefined;

onScopeDispose(() => {
  controller?.abort();
  password.value = '';
});

async function submit() {
  if (loading.value) return;
  errors.value = {};
  message.value = '';
  registrationUncertain.value = false;
  requestId.value = undefined;
  if (registering.value && (nombre.value.trim().length < 2 || nombre.value.trim().length > 80)) errors.value.nombre = 'Ingresa un nombre de entre 2 y 80 caracteres.';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.value.trim()) || email.value.trim().length > 254) errors.value.email = 'Ingresa un correo electrónico válido.';
  if (!password.value) errors.value.password = 'Ingresa tu contraseña.';
  else if (password.value.length > 128 || (registering.value && password.value.length < 8)) errors.value.password = registering.value ? 'Usa entre 8 y 128 caracteres.' : 'La contraseña admite hasta 128 caracteres.';
  if (Object.keys(errors.value).length) {
    message.value = 'Revisa los campos indicados para continuar.';
    await nextTick();
    summary.value?.focus();
    return;
  }

  controller = new AbortController();
  const activeController = controller;
  loading.value = true;
  try {
    if (registering.value) {
      await api.register({ nombre: nombre.value.trim(), email: email.value.trim().toLowerCase(), password: password.value }, activeController.signal);
      if (activeController.signal.aborted) return;
      password.value = '';
      await router.replace({ name: 'login', query: { registered: 'true', ...returnQuery.value } });
    } else {
      await auth.login(email.value.trim().toLowerCase(), password.value, activeController.signal);
      if (activeController.signal.aborted) return;
      password.value = '';
      await router.replace(safeReturnPath(route.query.redirect));
    }
  } catch (caught) {
    if (activeController.signal.aborted || caught instanceof SupersededRequestError) return;
    message.value = errorMessage(caught);
    registrationUncertain.value = registering.value && caught instanceof NetworkError && caught.uncertain && caught.operation === 'registration';
    if (caught instanceof ApiError) {
      errors.value = caught.fields;
      requestId.value = caught.requestId;
    }
    await nextTick();
    summary.value?.focus();
  } finally {
    if (!activeController.signal.aborted) loading.value = false;
  }
}
</script>

<template>
  <div class="auth-layout">
    <section
      class="surface auth-panel"
      :aria-labelledby="registering ? 'register-title' : 'login-title'"
    >
      <div class="auth-form-wrap">
        <h1 :id="registering ? 'register-title' : 'login-title'">
          {{ registering ? 'Crea tu cuenta' : 'Inicia sesión' }}
        </h1>
        <div
          v-if="!registering && route.query.registered === 'true'"
          class="notice notice-success"
          role="status"
        >
          Cuenta creada. Inicia sesión para continuar.
        </div>
        <div
          v-if="!registering && auth.reason === 'expired'"
          class="notice notice-warning"
          role="status"
        >
          Tu sesión terminó. Inicia sesión nuevamente para continuar.
        </div>
        <div
          v-if="message"
          ref="summary"
          class="notice"
          :class="registrationUncertain ? 'notice-warning' : 'notice-error'"
          role="alert"
          tabindex="-1"
        >
          {{ message }}
          <RouterLink
            v-if="registrationUncertain"
            class="inline-action"
            :to="authSwitchTarget"
          >
            Iniciar sesión
          </RouterLink>
          <small
            v-if="requestId"
            class="request-reference"
          >Referencia: {{ requestId }}</small>
        </div>
        <form
          class="auth-form"
          novalidate
          :aria-busy="loading"
          @submit.prevent="submit"
        >
          <div
            v-if="registering"
            class="field"
          >
            <label for="auth-name">Nombre completo</label>
            <input
              id="auth-name"
              v-model="nombre"
              name="nombre"
              autocomplete="name"
              required
              placeholder="¿Cómo te llamas?"
              :disabled="loading"
              :aria-invalid="Boolean(errors.nombre)"
              :aria-describedby="errors.nombre ? 'auth-name-error' : undefined"
            />
            <p
              v-if="errors.nombre"
              id="auth-name-error"
              class="field-error"
            >
              {{ errors.nombre }}
            </p>
          </div>
          <div class="field">
            <label for="auth-email">Correo electrónico</label>
            <input
              id="auth-email"
              v-model="email"
              name="email"
              type="email"
              autocomplete="email"
              inputmode="email"
              required
              placeholder="tu@correo.com"
              :disabled="loading"
              :aria-invalid="Boolean(errors.email)"
              :aria-describedby="errors.email ? 'auth-email-error' : undefined"
            />
            <p
              v-if="errors.email"
              id="auth-email-error"
              class="field-error"
            >
              {{ errors.email }}
            </p>
          </div>
          <div class="field">
            <label for="auth-password">Contraseña</label>
            <div class="password-field">
              <input
                id="auth-password"
                v-model="password"
                name="password"
                required
                :type="passwordVisible ? 'text' : 'password'"
                :autocomplete="registering ? 'new-password' : 'current-password'"
                :placeholder="registering ? 'Crea una contraseña segura' : 'Ingresa tu contraseña'"
                :disabled="loading"
                :aria-invalid="Boolean(errors.password)"
                :aria-describedby="errors.password ? 'auth-password-error' : registering ? 'auth-password-hint' : undefined"
              />
              <button
                type="button"
                class="password-toggle"
                :aria-label="passwordVisible ? 'Ocultar contraseña' : 'Mostrar contraseña'"
                :aria-pressed="passwordVisible"
                :disabled="loading"
                @click="passwordVisible = !passwordVisible"
              >
                {{ passwordVisible ? 'Ocultar' : 'Ver' }}
              </button>
            </div>
            <p
              v-if="errors.password"
              id="auth-password-error"
              class="field-error"
            >
              {{ errors.password }}
            </p>
            <p
              v-else-if="registering"
              id="auth-password-hint"
              class="field-hint"
            >
              Usa al menos 8 caracteres.
            </p>
          </div>
          <button
            class="button button-primary button-full"
            type="submit"
            :disabled="loading"
          >
            <span
              v-if="loading"
              class="spinner"
              aria-hidden="true"
            />
            {{ loading ? 'Un momento…' : registering ? 'Crear mi cuenta' : 'Iniciar sesión' }}
          </button>
        </form>
        <p class="auth-switch">
          {{ registering ? '¿Ya tienes cuenta?' : '¿No tienes cuenta?' }}
          <RouterLink :to="authSwitchTarget">
            {{ registering ? 'Inicia sesión' : 'Crea tu cuenta' }}
          </RouterLink>
        </p>
      </div>
    </section>
  </div>
</template>
