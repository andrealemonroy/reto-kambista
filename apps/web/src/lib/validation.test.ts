import { describe, expect, it } from 'vitest';
import { amountError, safeReturnPath, transactionInput, validateExchange, validateHistory } from './validation';
import { defaultDateRange } from './format';

describe('validación de solicitudes', () => {
  it.each(['0.01', '100', '100.5', '9999999.99', ' 25,40 '])('acepta montos válidos: %s', (value) => {
    expect(amountError(value)).toBeUndefined();
  });

  it.each(['', '0', '0.00', '-1', '10000000', '1.999', '1e3', '1,234.56', '1.234,56', 'Infinity', '00000001'])('rechaza montos inválidos: %s', (value) => {
    expect(amountError(value)).toEqual(expect.any(String));
  });

  it('normaliza el separador decimal y entrega el contrato numérico', () => {
    expect(transactionInput(' 125,50 ', 'USD', 'PEN')).toEqual({ monto: 125.5, monedaOrigen: 'USD', monedaDestino: 'PEN' });
  });

  it('impide monedas iguales y valores fuera de USD/PEN', () => {
    expect(validateExchange('100', 'USD', 'USD')).toHaveProperty('monedaDestino');
    expect(validateExchange('100', '', 'EUR')).toEqual({ monedaOrigen: expect.any(String), monedaDestino: expect.any(String) });
  });
});

describe('fechas y redirecciones', () => {
  it('acepta un rango de un día y rechaza un rango invertido', () => {
    expect(validateHistory({ startDate: '2026-10-14', endDate: '2026-10-14' })).toEqual({});
    expect(validateHistory({ startDate: '2026-10-15', endDate: '2026-10-14' })).toHaveProperty('endDate');
  });

  it('rechaza fechas inexistentes, formatos ambiguos y campos vacíos', () => {
    expect(validateHistory({ startDate: '2026-02-31', endDate: '' })).toHaveProperty('startDate');
    expect(validateHistory({ startDate: '14/10/2026', endDate: '' })).toHaveProperty('endDate');
  });

  it('calcula el rango desde el día de Lima, incluso antes de medianoche UTC', () => {
    expect(defaultDateRange(new Date('2026-10-15T02:00:00.000Z'))).toEqual({ startDate: '2026-10-08', endDate: '2026-10-14' });
  });

  it('solo permite volver a las rutas de negocio conocidas', () => {
    expect(safeReturnPath('/history')).toBe('/history');
    expect(safeReturnPath('https://malicioso.example')).toBe('/exchange');
    expect(safeReturnPath('//malicioso.example')).toBe('/exchange');
    expect(safeReturnPath(['/history'])).toBe('/exchange');
  });
});
