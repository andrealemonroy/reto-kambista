import { onScopeDispose, ref, watch } from 'vue';
import { api } from '../api/client';
import { ApiError, errorMessage } from '../api/errors';
import type { FieldErrors, HistoryFilter, Transaction } from '../api/types';
import { useAuthStore } from '../stores/auth';

export function useHistory() {
  const auth = useAuthStore();
  const status = ref<'idle' | 'loading' | 'success' | 'error'>('idle');
  const transactions = ref<Transaction[]>([]);
  const error = ref('');
  const fieldErrors = ref<FieldErrors>({});
  const requestId = ref<string | undefined>();
  let controller: AbortController | undefined;
  let sequence = 0;

  function clear() {
    sequence += 1;
    controller?.abort();
    transactions.value = [];
    error.value = '';
    fieldErrors.value = {};
    requestId.value = undefined;
    status.value = 'idle';
  }

  watch(() => auth.generation, clear, { flush: 'sync' });
  onScopeDispose(() => controller?.abort());

  async function load(filter: HistoryFilter) {
    if (!auth.accessToken) return;
    controller?.abort();
    controller = new AbortController();
    const activeController = controller;
    const generation = auth.generation;
    const requestSequence = ++sequence;
    const token = auth.accessToken;
    status.value = 'loading';
    transactions.value = [];
    error.value = '';
    fieldErrors.value = {};
    requestId.value = undefined;
    try {
      const result = await api.history(filter, token, activeController.signal);
      if (generation !== auth.generation || sequence !== requestSequence || activeController.signal.aborted) return;
      transactions.value = result;
      status.value = 'success';
    } catch (caught) {
      if (generation !== auth.generation || sequence !== requestSequence || activeController.signal.aborted) return;
      if (caught instanceof ApiError && caught.status === 401) {
        auth.logout('expired');
        return;
      }
      status.value = 'error';
      error.value = errorMessage(caught);
      if (caught instanceof ApiError) {
        fieldErrors.value = caught.fields;
        requestId.value = caught.requestId;
      }
    }
  }

  return { status, transactions, error, fieldErrors, requestId, load, clear };
}
