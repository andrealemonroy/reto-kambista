import type { Currency } from '../api/types';

export function formatAmount(value: number): string {
  return new Intl.NumberFormat('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);
}

export function formatRate(value: number): string {
  return new Intl.NumberFormat('es-PE', { minimumFractionDigits: 3, maximumFractionDigits: 8 }).format(value);
}

export function formatDate(value: string): string {
  return new Intl.DateTimeFormat('es-PE', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'America/Lima' }).format(new Date(value));
}

export function currencyName(currency: Currency): string {
  return currency === 'USD' ? 'Dólares' : 'Soles';
}

export function defaultDateRange(now = new Date()): { startDate: string; endDate: string } {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Lima', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const part = (name: Intl.DateTimeFormatPartTypes) => parts.find((value) => value.type === name)?.value || '';
  const endDate = `${part('year')}-${part('month')}-${part('day')}`;
  const start = new Date(`${endDate}T12:00:00.000Z`);
  start.setUTCDate(start.getUTCDate() - 6);
  return { startDate: start.toISOString().slice(0, 10), endDate };
}
