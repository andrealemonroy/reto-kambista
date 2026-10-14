import { DomainError } from '../../../shared/domain/domain-error';

export type Currency = 'USD' | 'PEN';

export function parseCurrency(value: unknown, field: string): Currency {
  if (value !== 'USD' && value !== 'PEN') {
    throw new DomainError('VALIDATION_ERROR', 'Selecciona una moneda válida.', {
      [field]: 'Las monedas permitidas son USD y PEN.',
    });
  }

  return value;
}
