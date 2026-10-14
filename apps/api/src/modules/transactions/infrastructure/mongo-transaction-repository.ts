import { Decimal128, ObjectId, type Collection, type Db } from 'mongodb';
import type { TransactionRepository } from '../application/ports';
import type { Currency } from '../domain/currency';
import type { Transaction } from '../domain/transaction';

interface TransactionDocument {
  _id: ObjectId;
  userId: ObjectId;
  monedaOrigen: Currency;
  monedaDestino: Currency;
  monto: Decimal128;
  montoCambiado: Decimal128;
  tipoCambio: Decimal128;
  fecha: Date;
  rateId: ObjectId;
  providerDate: string;
  rateSide: 'compra' | 'venta';
}

export class MongoTransactionRepository implements TransactionRepository {
  private readonly collection: Collection<TransactionDocument>;

  constructor(db: Db) {
    this.collection = db.collection<TransactionDocument>('transactions');
  }

  async ensureIndexes(): Promise<void> {
    await this.collection.createIndex(
      { userId: 1, fecha: -1, _id: -1 },
      { name: 'transactions_user_date_id' },
    );
  }

  async save(input: Omit<Transaction, 'id'>): Promise<Transaction> {
    const document: TransactionDocument = {
      _id: new ObjectId(),
      userId: new ObjectId(input.userId),
      monedaOrigen: input.monedaOrigen,
      monedaDestino: input.monedaDestino,
      monto: Decimal128.fromString(input.monto),
      montoCambiado: Decimal128.fromString(input.montoCambiado),
      tipoCambio: Decimal128.fromString(input.tipoCambio),
      fecha: new Date(input.fecha.getTime()),
      rateId: new ObjectId(input.rateId),
      providerDate: input.providerDate,
      rateSide: input.rateSide,
    };

    await this.collection.insertOne(document);

    return this.toTransaction(document);
  }

  async history(userId: string, start: Date, endExclusive: Date): Promise<Transaction[]> {
    const documents = await this.collection.find({
      userId: new ObjectId(userId),
      fecha: { $gte: start, $lt: endExclusive },
    }).sort({ fecha: -1, _id: -1 }).toArray();

    return documents.map((document) => this.toTransaction(document));
  }

  private toTransaction(document: TransactionDocument): Transaction {
    return {
      id: document._id.toHexString(),
      userId: document.userId.toHexString(),
      monedaOrigen: document.monedaOrigen,
      monedaDestino: document.monedaDestino,
      monto: document.monto.toString(),
      montoCambiado: document.montoCambiado.toString(),
      tipoCambio: document.tipoCambio.toString(),
      fecha: document.fecha,
      rateId: document.rateId.toHexString(),
      providerDate: document.providerDate,
      rateSide: document.rateSide,
    };
  }
}
