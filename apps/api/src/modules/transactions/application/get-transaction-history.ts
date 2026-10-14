import type { Actor } from '../../../shared/domain/actor';
import { DomainError } from '../../../shared/domain/domain-error';
import { DateRange } from '../domain/date-range';
import type { Transaction } from '../domain/transaction';
import type { TransactionRepository } from './ports';

export class GetTransactionHistory {
  constructor(private readonly repository: TransactionRepository) {}

  async execute(actor: Actor, query: unknown): Promise<Transaction[]> {
    if (typeof query !== 'object' || query === null || Array.isArray(query)) {
      throw new DomainError('VALIDATION_ERROR', 'Ingresa las fechas del historial.');
    }

    const parameters = query as Record<string, unknown>;
    const range = DateRange.fromInput(parameters.startDate, parameters.endDate);
    let userId = actor.id;

    if (actor.rol === 'admin' && parameters.userId !== undefined) {
      if (typeof parameters.userId !== 'string' || !/^[a-f\d]{24}$/i.test(parameters.userId)) {
        throw new DomainError('VALIDATION_ERROR', 'El identificador de usuario no es válido.', {
          userId: 'Usa un identificador de usuario válido.',
        });
      }

      userId = parameters.userId;
    }

    return this.repository.history(userId, range.start, range.endExclusive);
  }
}
