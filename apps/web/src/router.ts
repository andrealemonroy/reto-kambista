import { createRouter, createWebHistory } from 'vue-router';
import { useAuthStore } from './stores/auth';
import { safeReturnPath } from './lib/validation';
import AuthView from './views/AuthView.vue';
import ExchangeView from './views/ExchangeView.vue';
import HistoryView from './views/HistoryView.vue';

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', redirect: '/exchange' },
    { path: '/login', name: 'login', component: AuthView, props: { mode: 'login' }, meta: { guest: true, title: 'Inicia sesión' } },
    { path: '/register', name: 'register', component: AuthView, props: { mode: 'register' }, meta: { guest: true, title: 'Crea tu cuenta' } },
    { path: '/exchange', name: 'exchange', component: ExchangeView, meta: { requiresAuth: true, title: 'Nueva solicitud' } },
    { path: '/history', name: 'history', component: HistoryView, meta: { requiresAuth: true, title: 'Historial' } },
    { path: '/:pathMatch(.*)*', redirect: '/exchange' },
  ],
  scrollBehavior: () => ({ top: 0 }),
});

router.beforeEach((to) => {
  const auth = useAuthStore();
  if (to.meta.requiresAuth && !auth.authenticated) return { name: 'login', query: { redirect: safeReturnPath(to.path) } };
  if (to.meta.guest && auth.authenticated) return { name: 'exchange' };
  return true;
});

router.afterEach((to) => {
  document.title = `${String(to.meta.title || 'Cambio de divisas')} · Kambista`;
});
