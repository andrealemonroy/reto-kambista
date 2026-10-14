import type { Currency } from './currency';

export interface Transaction {
  id: string;
  userId: string;
  monedaOrigen: Currency;
  monedaDestino: Currency;
  monto: string;
  montoCambiado: string;
  tipoCambio: string;
  fecha: Date;
  rateId: string;
  providerDate: string;
  rateSide: 'compra' | 'venta';
}
