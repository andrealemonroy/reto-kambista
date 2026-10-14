import { Collection, Db, ObjectId } from 'mongodb';
import { DomainError } from '../../../shared/domain/domain-error';
import type { User } from '../domain/user';
import type { UserRepository } from '../application/ports';

type UserDocument = Omit<User, 'id'> & { _id: ObjectId };

export class MongoUserRepository implements UserRepository {
  private readonly users: Collection<UserDocument>;

  constructor(db: Db) {
    this.users = db.collection<UserDocument>('users');
  }

  async ensureIndexes(): Promise<void> {
    await this.users.createIndex({ email: 1 }, { unique: true, name: 'unique_email' });
  }

  async create(input: Omit<User, 'id'>): Promise<User> {
    const doc = { ...input, _id: new ObjectId() };
    try {
      await this.users.insertOne(doc);
      return this.toDomain(doc);
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && error.code === 11000) {
        throw new DomainError('EMAIL_ALREADY_EXISTS', 'Este correo ya está registrado.', { email: 'Prueba iniciar sesión.' });
      }
      throw error;
    }
  }

  async findByEmail(email: string): Promise<User | null> {
    const doc = await this.users.findOne({ email });
    return doc ? this.toDomain(doc) : null;
  }

  async findById(id: string): Promise<User | null> {
    if (!/^[0-9a-f]{24}$/i.test(id)) return null;
    const doc = await this.users.findOne({ _id: new ObjectId(id) });
    return doc ? this.toDomain(doc) : null;
  }

  private toDomain(doc: UserDocument): User {
    return {
      id: doc._id.toHexString(),
      nombre: doc.nombre,
      email: doc.email,
      passwordHash: doc.passwordHash,
      rol: doc.rol,
      createdAt: doc.createdAt,
    };
  }
}
