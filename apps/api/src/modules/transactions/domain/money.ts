import Decimal from 'decimal.js';
import { DomainError } from '../../../shared/domain/domain-error';

const Arithmetic = Decimal.clone({ precision: 40, rounding: Decimal.ROUND_HALF_UP });

export class Money {
  private constructor(private readonly value: Decimal) {}

  static fromInput(value: unknown): Money {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw Money.invalid('Ingresa un monto numérico válido.');
    }

    const amount = new Arithmetic(value.toString());

    if (!amount.greaterThan(0)) {
      throw Money.invalid('El monto debe ser mayor a cero.');
    }

    if (amount.greaterThan('9999999.99')) {
      throw Money.invalid('El monto no puede superar 9,999,999.99.');
    }

    if (amount.decimalPlaces() > 2) {
      throw Money.invalid('El monto admite como máximo dos decimales.');
    }

    return new Money(amount);
  }

  toString(): string {
    return this.value.toFixed(2);
  }

  convert(rate: string, side: 'compra' | 'venta'): string {
    let exchangeRate: Decimal;

    try {
      exchangeRate = new Arithmetic(rate);
    } catch {
      throw new DomainError('EXCHANGE_RATE_UNAVAILABLE', 'El tipo de cambio registrado no es válido.');
    }

    if (!exchangeRate.isFinite() || !exchangeRate.greaterThan(0)) {
      throw new DomainError('EXCHANGE_RATE_UNAVAILABLE', 'El tipo de cambio registrado no es válido.');
    }

    const result = side === 'venta'
      ? this.value.times(exchangeRate)
      : this.value.dividedBy(exchangeRate);

    return result.toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toFixed(2);
  }

  private static invalid(message: string): DomainError {
    return new DomainError('VALIDATION_ERROR', message, { monto: message });
  }
}
