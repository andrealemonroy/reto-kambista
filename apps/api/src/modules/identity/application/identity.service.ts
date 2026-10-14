import type { Actor } from '../../../shared/domain/actor';
import type { Clock } from '../../../shared/domain/clock';
import { DomainError } from '../../../shared/domain/domain-error';
import { Email, validateName, validatePassword, type User } from '../domain/user';
import type { PasswordHasher, TokenSigner, UserRepository } from './ports';

export class IdentityService {
  constructor(
    private readonly users: UserRepository,
    private readonly passwords: PasswordHasher,
    private readonly tokens: TokenSigner,
    private readonly clock: Clock,
    private readonly dummyHash: string,
  ) {}

  async register(input: unknown): Promise<Actor> {
    const data = this.record(input);
    const nombre = validateName(data.nombre);
    const email = Email.normalize(data.email);
    const password = validatePassword(data.password);
    const user = await this.users.create({
      nombre,
      email,
      passwordHash: await this.passwords.hash(password),
      rol: 'user',
      createdAt: this.clock.now(),
    });
    return this.publicUser(user);
  }

  async login(input: unknown): Promise<{ access_token: string; usuario: Actor }> {
    const data = this.record(input);
    const email = Email.normalize(data.email);
    if (typeof data.password !== 'string' || data.password.length === 0 || data.password.length > 128) {
      throw new DomainError('INVALID_CREDENTIALS', 'El correo o la contraseña no son correctos.');
    }
    const user = await this.users.findByEmail(email);
    const valid = await this.passwords.verify(user?.passwordHash ?? this.dummyHash, data.password);
    if (!valid || !user || !this.validRole(user.rol)) {
      throw new DomainError('INVALID_CREDENTIALS', 'El correo o la contraseña no son correctos.');
    }
    return { access_token: this.tokens.issue(user.id), usuario: this.publicUser(user) };
  }

  async authenticate(token: string): Promise<Actor> {
    const { sub } = this.tokens.verify(token);
    const user = await this.users.findById(sub);
    if (!user || !this.validRole(user.rol)) throw new DomainError('UNAUTHORIZED', 'Vuelve a iniciar sesión.');
    return this.publicUser(user);
  }

  private record(input: unknown): Record<string, unknown> {
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
      throw new DomainError('VALIDATION_ERROR', 'Revisa los datos enviados.');
    }
    return input as Record<string, unknown>;
  }

  private validRole(role: unknown): boolean {
    return role === 'user' || role === 'admin';
  }

  private publicUser(user: User): Actor {
    return { id: user.id, nombre: user.nombre, email: user.email, rol: user.rol };
  }
}
