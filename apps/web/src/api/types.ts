export type Currency = 'USD' | 'PEN';

export interface User {
  id: string;
  nombre: string;
  email: string;
  rol: 'user' | 'admin';
}

export interface LoginResponse {
  access_token: string;
  usuario: User;
}

export interface RegisterInput {
  nombre: string;
  email: string;
  password: string;
}

export interface TransactionInput {
  monedaOrigen: Currency;
  monedaDestino: Currency;
  monto: number;
}

export interface Transaction extends TransactionInput {
  id: string;
  montoCambiado: number;
  tipoCambio: number;
  fecha: string;
}

export interface HistoryFilter {
  startDate: string;
  endDate: string;
  userId?: string;
}

export type FieldErrors = Record<string, string>;
