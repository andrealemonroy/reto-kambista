<script setup lang="ts">
import { watch } from 'vue';
import { RouterLink, RouterView, useRoute, useRouter } from 'vue-router';
import { useAuthStore } from './stores/auth';
import { safeReturnPath } from './lib/validation';
import logo from './assets/kambista-logo.svg';

const auth = useAuthStore();
const route = useRoute();
const router = useRouter();
const demo = import.meta.env.VITE_DEMO_MODE === 'true';

watch(() => auth.authenticated, (authenticated) => {
  if (!authenticated && auth.reason === 'expired' && route.meta.requiresAuth) {
    void router.replace({ name: 'login', query: { redirect: safeReturnPath(route.path) } });
  }
});

async function logout() {
  auth.logout();
  await router.replace({ name: 'login' });
}
</script>

<template>
  <div class="app-shell">
    <a
      class="skip-link"
      href="#main-content"
    >Saltar al contenido</a>
    <div
      v-if="demo"
      class="demo-banner"
      role="status"
    >
      <strong>Modo demostración.</strong> Las tasas son de prueba y no representan el tipo de cambio real.
    </div>
    <header class="site-header">
      <div class="header-inner">
        <RouterLink
          class="brand"
          :to="auth.authenticated ? '/exchange' : '/login'"
          aria-label="Kambista, inicio"
        >
          <img
            :src="logo"
            width="152"
            height="35"
            alt="Kambista"
          />
        </RouterLink>
        <nav
          v-if="auth.authenticated"
          class="main-nav"
          aria-label="Navegación principal"
        >
          <RouterLink to="/exchange">
            Cambiar
          </RouterLink>
          <RouterLink to="/history">
            Historial
          </RouterLink>
        </nav>
        <div
          v-if="auth.authenticated"
          class="account-nav"
        >
          <span class="account-name">{{ auth.user?.nombre }}</span>
          <span
            v-if="auth.isAdmin"
            class="role-badge"
          >Admin</span>
          <button
            class="logout-button"
            type="button"
            @click="logout"
          >
            Cerrar sesión
          </button>
        </div>
      </div>
    </header>
    <main
      id="main-content"
      class="main-content"
      tabindex="-1"
    >
      <RouterView :key="route.path" />
    </main>
  </div>
</template>
