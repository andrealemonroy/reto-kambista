import type { Transaction } from '../domain/transaction';

export interface TransactionRepository {
  save(input: Omit<Transaction, 'id'>): Promise<Transaction>;
  history(userId: string, start: Date, endExclusive: Date): Promise<Transaction[]>;
}
