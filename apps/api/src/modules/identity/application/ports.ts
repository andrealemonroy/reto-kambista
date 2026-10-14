import type { User } from '../domain/user';

export interface UserRepository {
  create(input: Omit<User, 'id'>): Promise<User>;
  findByEmail(email: string): Promise<User | null>;
  findById(id: string): Promise<User | null>;
}

export interface PasswordHasher {
  hash(password: string): Promise<string>;
  verify(hash: string, password: string): Promise<boolean>;
}

export interface TokenSigner {
  issue(userId: string): string;
  verify(token: string): { sub: string };
}
