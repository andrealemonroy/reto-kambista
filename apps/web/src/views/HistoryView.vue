<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue';
import { RouterLink } from 'vue-router';
import type { FieldErrors, HistoryFilter } from '../api/types';
import { useHistory } from '../composables/useHistory';
import { defaultDateRange, formatAmount, formatDate, formatRate } from '../lib/format';
import { validateHistory } from '../lib/validation';
import { useAuthStore } from '../stores/auth';

const auth = useAuthStore();
const initial = defaultDateRange();
const startDate = ref(initial.startDate);
const endDate = ref(initial.endDate);
const userId = ref('');
const localErrors = ref<FieldErrors>({});
const appliedFilter = ref<HistoryFilter | null>(null);
const { status, transactions, error, fieldErrors, requestId, load, clear } = useHistory();
const errors = computed(() => ({ ...localErrors.value, ...fieldErrors.value }));
const countLabel = computed(() => `${transactions.value.length} ${transactions.value.length === 1 ? 'solicitud' : 'solicitudes'}`);

watch(() => auth.generation, () => {
  userId.value = '';
  localErrors.value = {};
  appliedFilter.value = null;
});

watch([startDate, endDate, userId], () => {
  clear();
  localErrors.value = {};
  appliedFilter.value = null;
});

async function applyFilters() {
  const filter: HistoryFilter = { startDate: startDate.value, endDate: endDate.value };
  if (auth.isAdmin && userId.value.trim()) filter.userId = userId.value.trim();
  localErrors.value = validateHistory(filter);
  fieldErrors.value = {};
  const firstError = Object.keys(localErrors.value)[0];
  if (firstError) {
    await nextTick();
    document.getElementById(firstError === 'startDate' ? 'history-start' : 'history-end')?.focus();
    return;
  }
  appliedFilter.value = filter;
  await load(filter);
}

onMounted(() => { void applyFilters(); });
</script>

<template>
  <div class="workspace-page history-page">
    <section class="page-intro history-intro">
      <h1 id="history-title">
        Historial
      </h1><RouterLink
        class="button button-primary"
        to="/exchange"
      >
        Nueva solicitud
      </RouterLink>
    </section>
    <section
      class="surface history-surface"
      aria-labelledby="history-title"
    >
      <form
        class="history-filters"
        novalidate
        :aria-busy="status === 'loading'"
        @submit.prevent="applyFilters"
      >
        <div class="field">
          <label for="history-start">Desde</label><input
            id="history-start"
            v-model="startDate"
            name="startDate"
            type="date"
            :aria-invalid="Boolean(errors.startDate)"
            :aria-describedby="errors.startDate ? 'history-start-error' : undefined"
          /><p
            v-if="errors.startDate"
            id="history-start-error"
            class="field-error"
          >
            {{ errors.startDate }}
          </p>
        </div>
        <div class="field">
          <label for="history-end">Hasta</label><input
            id="history-end"
            v-model="endDate"
            name="endDate"
            type="date"
            :aria-invalid="Boolean(errors.endDate)"
            :aria-describedby="errors.endDate ? 'history-end-error' : undefined"
          /><p
            v-if="errors.endDate"
            id="history-end-error"
            class="field-error"
          >
            {{ errors.endDate }}
          </p>
        </div>
        <div
          v-if="auth.isAdmin"
          class="field admin-filter"
        >
          <label for="history-user">ID de usuario (opcional)</label><input
            id="history-user"
            v-model="userId"
            name="userId"
            type="text"
            autocomplete="off"
            placeholder="Vacío para ver tu historial"
            :aria-invalid="Boolean(errors.userId)"
            :aria-describedby="errors.userId ? 'history-user-error' : undefined"
          /><p
            v-if="errors.userId"
            id="history-user-error"
            class="field-error"
          >
            {{ errors.userId }}
          </p>
        </div>
        <button
          class="button button-primary filter-button"
          type="submit"
          :disabled="status === 'loading'"
        >
          <span
            v-if="status === 'loading'"
            class="spinner"
            aria-hidden="true"
          />{{ status === 'loading' ? 'Consultando…' : 'Consultar historial' }}
        </button>
      </form>
      <p class="range-note">
        Hora de Lima · Incluye ambas fechas
      </p>
      <div
        v-if="error"
        class="notice notice-error history-error"
        role="alert"
      >
        {{ error }}<small
          v-if="requestId"
          class="request-reference"
        >Referencia: {{ requestId }}</small>
      </div>
      <div
        v-if="status === 'loading'"
        class="history-state"
        role="status"
      >
        <span
          class="loading-orbit"
          aria-hidden="true"
        /><p>Cargando solicitudes…</p>
      </div>
      <div
        v-else-if="status === 'success' && transactions.length === 0"
        class="history-state"
        data-testid="history-empty"
        role="status"
      >
        <span
          class="empty-icon"
          aria-hidden="true"
        >↔</span><h2>No hay solicitudes en estas fechas.</h2><RouterLink
          class="text-link"
          to="/exchange"
        >
          Nueva solicitud
        </RouterLink>
      </div>
      <div
        v-else-if="status === 'success'"
        class="history-results"
        data-testid="history-results"
      >
        <div
          class="results-caption"
          aria-live="polite"
        >
          <strong>{{ countLabel }}</strong><span v-if="appliedFilter?.userId">Usuario: {{ appliedFilter.userId }}</span>
        </div>
        <div class="table-wrap">
          <table class="transactions-table">
            <caption class="sr-only">
              Solicitudes de cambio del rango seleccionado
            </caption><thead>
              <tr>
                <th scope="col">
                  Solicitud
                </th><th scope="col">
                  Enviaste
                </th><th scope="col">
                  Resultado
                </th><th scope="col">
                  Tipo de cambio
                </th><th scope="col">
                  Fecha · Lima
                </th>
              </tr>
            </thead><tbody>
              <tr
                v-for="transaction in transactions"
                :key="transaction.id"
                data-testid="transaction-row"
              >
                <td data-label="Solicitud">
                  <span class="transaction-direction">{{ transaction.monedaOrigen }} <span aria-hidden="true">→</span> {{ transaction.monedaDestino }}</span><span class="transaction-reference">{{ transaction.id }}</span>
                </td><td data-label="Enviaste">
                  <span class="table-currency">{{ transaction.monedaOrigen }}</span> {{ formatAmount(transaction.monto) }}
                </td><td
                  data-label="Resultado"
                  class="table-result"
                >
                  <span class="table-currency">{{ transaction.monedaDestino }}</span> {{ formatAmount(transaction.montoCambiado) }}
                </td><td data-label="Tipo de cambio">
                  {{ formatRate(transaction.tipoCambio) }}
                </td><td
                  data-label="Fecha · Lima"
                  class="table-date"
                >
                  {{ formatDate(transaction.fecha) }}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </section>
  </div>
</template>
