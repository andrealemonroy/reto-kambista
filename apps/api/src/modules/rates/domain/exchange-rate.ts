export interface ExchangeRate {
  id: string;
  compra: string;
  venta: string;
  origen: 'SUNAT';
  moneda: 'USD';
  providerDate: string;
  fetchedAt: Date;
}
