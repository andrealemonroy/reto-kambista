<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
import { RouterLink } from 'vue-router';
import type { Currency, FieldErrors } from '../api/types';
import { useExchange } from '../composables/useExchange';
import { formatAmount, formatDate, formatRate } from '../lib/format';
import { transactionInput, validateExchange } from '../lib/validation';
import { useAuthStore } from '../stores/auth';

const auth = useAuthStore();
const amount = ref('');
const origin = ref<Currency>('USD');
const destination = ref<Currency>('PEN');
const localErrors = ref<FieldErrors>({});
const { status, result, error, fieldErrors, requestId, submit } = useExchange();
const errors = computed(() => ({ ...localErrors.value, ...fieldErrors.value }));
const submitting = computed(() => status.value === 'loading');
const resultHeading = ref<HTMLElement | null>(null);

watch(() => auth.generation, () => {
  amount.value = '';
  origin.value = 'USD';
  destination.value = 'PEN';
  localErrors.value = {};
});

function validateField(field: string) {
  const validated = validateExchange(amount.value, origin.value, destination.value);
  if (validated[field]) localErrors.value[field] = validated[field];
  else delete localErrors.value[field];
  delete fieldErrors.value[field];
}

function amountChanged() {
  delete fieldErrors.value.monto;
  if (localErrors.value.monto) validateField('monto');
}

function swap() {
  [origin.value, destination.value] = [destination.value, origin.value];
  validateField('monedaOrigen');
  validateField('monedaDestino');
}

async function submitForm() {
  if (submitting.value) return;
  fieldErrors.value = {};
  localErrors.value = validateExchange(amount.value, origin.value, destination.value);
  const firstError = Object.keys(localErrors.value)[0];
  if (firstError) {
    const fieldIds: Record<string, string> = { monto: 'exchange-amount', monedaOrigen: 'exchange-origin', monedaDestino: 'exchange-destination' };
    await nextTick();
    document.getElementById(fieldIds[firstError] || 'exchange-amount')?.focus();
    return;
  }
  await submit(transactionInput(amount.value, origin.value, destination.value));
  if (status.value === 'success') {
    await nextTick();
    resultHeading.value?.focus();
  }
}
</script>

<template>
  <div class="workspace-page exchange-page">
    <h1>Nueva solicitud</h1>
    <div class="exchange-stack">
      <section
        class="surface exchange-form-card"
        aria-label="Solicitud de cambio"
      >
        <div
          v-if="error"
          class="notice"
          :class="status === 'uncertain' ? 'notice-warning' : 'notice-error'"
          role="alert"
        >
          {{ error }}
          <RouterLink
            v-if="status === 'uncertain'"
            class="inline-action"
            to="/history"
          >
            Ver mi historial
          </RouterLink>
          <small
            v-if="requestId"
            class="request-reference"
          >Referencia: {{ requestId }}</small>
        </div>
        <form
          class="exchange-form"
          novalidate
          :aria-busy="submitting"
          @submit.prevent="submitForm"
        >
          <div class="currency-fields">
            <div class="field">
              <label for="exchange-origin">Moneda que envías</label>
              <select
                id="exchange-origin"
                v-model="origin"
                name="monedaOrigen"
                :disabled="submitting"
                :aria-invalid="Boolean(errors.monedaOrigen)"
                :aria-describedby="errors.monedaOrigen ? 'exchange-origin-error' : undefined"
                @change="validateField('monedaOrigen'); validateField('monedaDestino')"
              >
                <option value="USD">
                  Dólares
                </option>
                <option value="PEN">
                  Soles
                </option>
              </select>
              <p
                v-if="errors.monedaOrigen"
                id="exchange-origin-error"
                class="field-error"
              >
                {{ errors.monedaOrigen }}
              </p>
            </div>
            <button
              class="swap-button"
              type="button"
              aria-label="Intercambiar monedas"
              :disabled="submitting"
              @click="swap"
            >
              <svg
                viewBox="0 0 24 24"
                fill="none"
                aria-hidden="true"
              >
                <path d="M4 8h15m0 0-4-4m4 4-4 4M20 16H5m0 0 4-4m-4 4 4 4" />
              </svg>
            </button>
            <div class="field">
              <label for="exchange-destination">Moneda que recibes</label>
              <select
                id="exchange-destination"
                v-model="destination"
                name="monedaDestino"
                :disabled="submitting"
                :aria-invalid="Boolean(errors.monedaDestino)"
                :aria-describedby="errors.monedaDestino ? 'exchange-destination-error' : undefined"
                @change="validateField('monedaDestino')"
              >
                <option value="PEN">
                  Soles
                </option>
                <option value="USD">
                  Dólares
                </option>
              </select>
              <p
                v-if="errors.monedaDestino"
                id="exchange-destination-error"
                class="field-error"
              >
                {{ errors.monedaDestino }}
              </p>
            </div>
          </div>
          <div class="field amount-field">
            <label for="exchange-amount">Monto a cambiar</label>
            <div class="amount-input-wrap">
              <span
                class="amount-currency"
                aria-hidden="true"
              >{{ origin === 'USD' ? '$' : 'S/' }}</span>
              <input
                id="exchange-amount"
                v-model="amount"
                name="monto"
                type="text"
                inputmode="decimal"
                autocomplete="off"
                placeholder="0.00"
                :disabled="submitting"
                :aria-invalid="Boolean(errors.monto)"
                :aria-describedby="errors.monto ? 'exchange-amount-error exchange-amount-hint' : 'exchange-amount-hint'"
                @input="amountChanged"
              />
            </div>
            <p
              v-if="errors.monto"
              id="exchange-amount-error"
              class="field-error"
            >
              {{ errors.monto }}
            </p>
            <p
              id="exchange-amount-hint"
              class="field-hint"
            >
              Hasta 9,999,999.99 · 2 decimales
            </p>
          </div>
          <button
            class="button button-primary button-full"
            type="submit"
            :disabled="submitting"
          >
            <span
              v-if="submitting"
              class="spinner"
              aria-hidden="true"
            />
            {{ submitting ? 'Registrando…' : 'Registrar solicitud' }}
          </button>
          <p class="form-note">
            Verás el resultado y la tasa al registrar.
          </p>
        </form>
      </section>
      <section
        v-if="result"
        class="surface result-card"
        data-testid="transaction-result"
        aria-labelledby="result-title"
        aria-live="polite"
      >
        <div class="result-topline">
          <span
            class="success-seal"
            aria-hidden="true"
          >✓</span>
          <h2
            id="result-title"
            ref="resultHeading"
            tabindex="-1"
          >
            Solicitud registrada
          </h2>
        </div>
        <p class="result-label">
          Recibes
        </p>
        <p class="result-amount">
          <span>{{ result.monedaDestino }}</span> {{ formatAmount(result.montoCambiado) }}
        </p>
        <dl class="result-details">
          <div><dt>Enviaste</dt><dd>{{ result.monedaOrigen }} {{ formatAmount(result.monto) }}</dd></div>
          <div><dt>Tipo de cambio</dt><dd>1 USD = PEN {{ formatRate(result.tipoCambio) }}</dd></div>
          <div><dt>Fecha · Lima</dt><dd>{{ formatDate(result.fecha) }}</dd></div>
          <div class="reference-detail">
            <dt>N.º de solicitud</dt><dd data-testid="transaction-id">
              {{ result.id }}
            </dd>
          </div>
        </dl>
        <RouterLink
          class="button button-outline button-full"
          to="/history"
        >
          Ver mi historial
        </RouterLink>
      </section>
    </div>
  </div>
</template>
