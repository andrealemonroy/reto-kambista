import { onScopeDispose, ref, watch } from 'vue';
import { api } from '../api/client';
import { ApiError, NetworkError, errorMessage } from '../api/errors';
import type { FieldErrors, Transaction, TransactionInput } from '../api/types';
import { useAuthStore } from '../stores/auth';

export function useExchange() {
  const auth = useAuthStore();
  const status = ref<'idle' | 'loading' | 'success' | 'error' | 'uncertain'>('idle');
  const result = ref<Transaction | null>(null);
  const error = ref('');
  const fieldErrors = ref<FieldErrors>({});
  const requestId = ref<string | undefined>();
  let controller: AbortController | undefined;

  function clear() {
    controller?.abort();
    status.value = 'idle';
    result.value = null;
    error.value = '';
    fieldErrors.value = {};
    requestId.value = undefined;
  }

  watch(() => auth.generation, clear, { flush: 'sync' });
  onScopeDispose(() => controller?.abort());

  async function submit(payload: TransactionInput) {
    if (status.value === 'loading' || !auth.accessToken) return;
    controller?.abort();
    const activeController = new AbortController();
    controller = activeController;
    const generation = auth.generation;
    const token = auth.accessToken;
    status.value = 'loading';
    error.value = '';
    result.value = null;
    fieldErrors.value = {};
    requestId.value = undefined;
    try {
      const transaction = await api.createTransaction(payload, token, activeController.signal);
      if (generation !== auth.generation || activeController.signal.aborted) return;
      result.value = transaction;
      status.value = 'success';
    } catch (caught) {
      if (generation !== auth.generation || activeController.signal.aborted) return;
      if (caught instanceof ApiError && caught.status === 401) {
        auth.logout('expired');
        return;
      }
      error.value = errorMessage(caught);
      status.value = caught instanceof NetworkError && caught.uncertain ? 'uncertain' : 'error';
      if (caught instanceof ApiError) {
        fieldErrors.value = caught.fields;
        requestId.value = caught.requestId;
      }
    }
  }

  return { status, result, error, fieldErrors, requestId, submit, clear };
}
