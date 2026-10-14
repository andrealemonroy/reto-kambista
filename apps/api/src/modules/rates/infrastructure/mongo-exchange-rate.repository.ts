import { Decimal128, ObjectId, type Collection, type Db } from 'mongodb';
import type { ExchangeRateRepository } from '../application/ports';
import type { ExchangeRate } from '../domain/exchange-rate';

interface ExchangeRateDocument {
  _id: ObjectId;
  compra: Decimal128;
  venta: Decimal128;
  origen: 'SUNAT';
  moneda: 'USD';
  providerDate: string;
  fetchedAt: Date;
}

export class MongoExchangeRateRepository implements ExchangeRateRepository {
  private readonly collection: Collection<ExchangeRateDocument>;

  constructor(db: Db) {
    this.collection = db.collection<ExchangeRateDocument>('exchange_rates');
  }

  async ensureIndexes(): Promise<void> {
    await this.collection.createIndex(
      { fetchedAt: -1, _id: -1 },
      { name: 'latest_rate_capture' },
    );
  }

  async save(input: Omit<ExchangeRate, 'id'>): Promise<ExchangeRate> {
    const document: ExchangeRateDocument = {
      _id: new ObjectId(),
      compra: Decimal128.fromString(input.compra),
      venta: Decimal128.fromString(input.venta),
      origen: input.origen,
      moneda: input.moneda,
      providerDate: input.providerDate,
      fetchedAt: new Date(input.fetchedAt),
    };

    await this.collection.insertOne(document);
    return this.toDomain(document);
  }

  async latest(): Promise<ExchangeRate | null> {
    const document = await this.collection.findOne(
      {},
      { sort: { fetchedAt: -1, _id: -1 } },
    );

    return document ? this.toDomain(document) : null;
  }

  private toDomain(document: ExchangeRateDocument): ExchangeRate {
    return {
      id: document._id.toHexString(),
      compra: document.compra.toString(),
      venta: document.venta.toString(),
      origen: document.origen,
      moneda: document.moneda,
      providerDate: document.providerDate,
      fetchedAt: new Date(document.fetchedAt),
    };
  }
}
