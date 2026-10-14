import type { Actor } from '../../../shared/domain/actor';
import type { Clock } from '../../../shared/domain/clock';
import { DomainError } from '../../../shared/domain/domain-error';
import type { ExchangeRateRepository } from '../../rates/application/ports';
import { parseCurrency } from '../domain/currency';
import { Money } from '../domain/money';
import type { Transaction } from '../domain/transaction';
import type { TransactionRepository } from './ports';

export class CreateTransaction {
  constructor(
    private readonly repository: TransactionRepository,
    private readonly rates: ExchangeRateRepository,
    private readonly clock: Clock,
  ) {}

  async execute(actor: Actor, input: unknown): Promise<Transaction> {
    if (typeof input !== 'object' || input === null || Array.isArray(input)) {
      throw new DomainError('VALIDATION_ERROR', 'Ingresa los datos de la solicitud.');
    }

    const payload = input as Record<string, unknown>;
    const monedaOrigen = parseCurrency(payload.monedaOrigen, 'monedaOrigen');
    const monedaDestino = parseCurrency(payload.monedaDestino, 'monedaDestino');

    if (monedaOrigen === monedaDestino) {
      throw new DomainError('VALIDATION_ERROR', 'Las monedas de origen y destino deben ser distintas.', {
        monedaDestino: 'Selecciona una moneda diferente a la de origen.',
      });
    }

    const amount = Money.fromInput(payload.monto);
    const rate = await this.rates.latest();

    if (rate === null) {
      throw new DomainError('EXCHANGE_RATE_UNAVAILABLE', 'Todavía no hay un tipo de cambio disponible.');
    }

    const rateSide = monedaOrigen === 'USD' ? 'venta' : 'compra';
    const appliedRate = rate[rateSide];

    return this.repository.save({
      userId: actor.id,
      monedaOrigen,
      monedaDestino,
      monto: amount.toString(),
      montoCambiado: amount.convert(appliedRate, rateSide),
      tipoCambio: appliedRate,
      fecha: this.clock.now(),
      rateId: rate.id,
      providerDate: rate.providerDate,
      rateSide,
    });
  }
}
