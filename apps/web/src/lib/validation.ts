import type { Currency, FieldErrors, HistoryFilter, TransactionInput } from '../api/types';

export function normalizeAmount(value: string): string {
  return value.trim().replace(',', '.');
}

export function amountError(value: string): string | undefined {
  const normalized = normalizeAmount(value);
  if (!normalized) return 'Ingresa el monto que deseas cambiar.';
  if (!/^\d+(?:\.\d{1,2})?$/.test(normalized)) return 'Usa un número con hasta 2 decimales, sin separadores de miles.';
  if ((normalized.split('.')[0]?.length || 0) > 7 || Number(normalized) > 9_999_999.99) return 'El monto máximo es 9,999,999.99.';
  if (Number(normalized) <= 0) return 'El monto debe ser mayor que cero.';
  return undefined;
}

export function validateExchange(monto: string, monedaOrigen: string, monedaDestino: string): FieldErrors {
  const errors: FieldErrors = {};
  const amount = amountError(monto);
  if (amount) errors.monto = amount;
  if (!['USD', 'PEN'].includes(monedaOrigen)) errors.monedaOrigen = 'Selecciona la moneda que envías.';
  if (!['USD', 'PEN'].includes(monedaDestino)) errors.monedaDestino = 'Selecciona la moneda que recibes.';
  if (monedaOrigen && monedaOrigen === monedaDestino) errors.monedaDestino = 'Selecciona una moneda distinta de la que envías.';
  return errors;
}

export function transactionInput(monto: string, monedaOrigen: Currency, monedaDestino: Currency): TransactionInput {
  return { monto: Number(normalizeAmount(monto)), monedaOrigen, monedaDestino };
}

export function validDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T12:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function validateHistory(filter: HistoryFilter): FieldErrors {
  const errors: FieldErrors = {};
  if (!validDate(filter.startDate)) errors.startDate = 'Selecciona una fecha de inicio válida.';
  if (!validDate(filter.endDate)) errors.endDate = 'Selecciona una fecha de fin válida.';
  if (!errors.startDate && !errors.endDate && filter.startDate > filter.endDate) errors.endDate = 'La fecha de fin debe ser igual o posterior a la de inicio.';
  return errors;
}

export function safeReturnPath(value: unknown): string {
  return value === '/exchange' || value === '/history' ? value : '/exchange';
}
