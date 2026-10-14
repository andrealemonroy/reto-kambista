import { DomainError } from '../../../shared/domain/domain-error';

const limaOffsetMilliseconds = 5 * 60 * 60 * 1000;
const dayMilliseconds = 24 * 60 * 60 * 1000;

export class DateRange {
  private constructor(
    readonly start: Date,
    readonly endExclusive: Date,
  ) {}

  static fromInput(startDate: unknown, endDate: unknown): DateRange {
    const start = DateRange.parseDate(startDate, 'startDate');
    const end = DateRange.parseDate(endDate, 'endDate');

    if (start.getTime() > end.getTime()) {
      throw new DomainError('VALIDATION_ERROR', 'La fecha de inicio no puede ser posterior a la fecha final.', {
        endDate: 'Selecciona una fecha final igual o posterior al inicio.',
      });
    }

    return new DateRange(start, new Date(end.getTime() + dayMilliseconds));
  }

  private static parseDate(value: unknown, field: string): Date {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      throw DateRange.invalidDate(field);
    }

    const date = new Date(`${value}T00:00:00.000-05:00`);

    if (
      !Number.isFinite(date.getTime())
      || new Date(date.getTime() - limaOffsetMilliseconds).toISOString().slice(0, 10) !== value
    ) {
      throw DateRange.invalidDate(field);
    }

    return date;
  }

  private static invalidDate(field: string): DomainError {
    return new DomainError('VALIDATION_ERROR', 'Ingresa un rango de fechas válido.', {
      [field]: 'Usa una fecha real con formato YYYY-MM-DD.',
    });
  }
}
