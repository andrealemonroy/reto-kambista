import jwt, { type JwtPayload } from 'jsonwebtoken';
import { describe, expect, it, vi } from 'vitest';
import type { Clock } from '../src/shared/domain/clock';
import { DomainError } from '../src/shared/domain/domain-error';
import { IdentityService } from '../src/modules/identity/application/identity.service';
import type { PasswordHasher, UserRepository } from '../src/modules/identity/application/ports';
import { Email, validateName, validatePassword, type User } from '../src/modules/identity/domain/user';
import { ArgonPasswordHasher } from '../src/modules/identity/infrastructure/argon-password.hasher';
import { JwtTokens } from '../src/modules/identity/infrastructure/jwt-tokens';

const userId = '507f1f77bcf86cd799439011';
const secret = 'identity-tests-use-a-fixed-secret-with-over-32-characters';
const issuer = 'identity-test-api';
const audience = 'identity-test-web';
const password = 'valid-password-123';
const passwordHash = 'opaque-test-password-hash';
const dummyHash = 'opaque-test-dummy-hash';
const startTime = new Date('2026-10-14T16:00:00.000Z');

class MutableClock implements Clock {
  current = new Date(startTime);

  now(): Date {
    return new Date(this.current);
  }
}

function dependencies() {
  const records = new Map<string, User>();
  const users: UserRepository = {
    create: vi.fn(async (input: Omit<User, 'id'>) => {
      if ([...records.values()].some((user) => user.email === input.email)) {
        throw new DomainError('EMAIL_ALREADY_EXISTS', 'Este correo ya está registrado.');
      }
      const user = { ...input, id: userId };
      records.set(user.id, user);
      return user;
    }),
    findByEmail: vi.fn(async (email: string) => [...records.values()].find((user) => user.email === email) ?? null),
    findById: vi.fn(async (id: string) => records.get(id.toLowerCase()) ?? null),
  };
  const passwords: PasswordHasher = {
    hash: vi.fn(async () => passwordHash),
    verify: vi.fn(async (hash: string, candidate: string) => hash === passwordHash && candidate === password),
  };
  const clock = new MutableClock();
  const tokens = new JwtTokens(secret, issuer, audience, 900, clock);
  const identity = new IdentityService(users, passwords, tokens, clock, dummyHash);

  return { records, users, passwords, clock, tokens, identity };
}

function claims(overrides: JwtPayload = {}): JwtPayload {
  return {
    sub: userId,
    iss: issuer,
    aud: audience,
    exp: Math.floor(startTime.getTime() / 1000) + 900,
    ...overrides,
  };
}

describe('IdentityService', () => {
  it('normalizes identity and ignores an attempted admin registration', async () => {
    const fixture = dependencies();
    const actor = await fixture.identity.register({
      nombre: '  Ana Pérez  ',
      email: '  ANA@EXAMPLE.TEST ',
      password,
      rol: 'admin',
      userId: '507f1f77bcf86cd799439012',
    });

    expect(actor).toEqual({ id: userId, nombre: 'Ana Pérez', email: 'ana@example.test', rol: 'user' });
    expect(fixture.records.get(userId)).toMatchObject({ passwordHash, rol: 'user', createdAt: startTime });
    expect(fixture.passwords.hash).toHaveBeenCalledWith(password);
    expect(actor).not.toHaveProperty('password');
    expect(actor).not.toHaveProperty('passwordHash');
  });

  it('uses the same normalized email for registration and login', async () => {
    const fixture = dependencies();
    await fixture.identity.register({ nombre: 'Ana', email: ' ANA@example.test ', password });
    const result = await fixture.identity.login({ email: ' ana@EXAMPLE.TEST ', password });

    expect(result.usuario.email).toBe('ana@example.test');
    expect(fixture.tokens.verify(result.access_token)).toEqual({ sub: userId });
    expect(result.usuario).not.toHaveProperty('passwordHash');
    expect(JSON.stringify(result)).not.toContain(passwordHash);
    expect(JSON.stringify(result)).not.toContain(password);
  });

  it('keeps duplicate-email failures visible instead of issuing a session', async () => {
    const fixture = dependencies();
    await fixture.identity.register({ nombre: 'Ana', email: 'ana@example.test', password });

    await expect(fixture.identity.register({ nombre: 'Otra', email: ' ANA@example.test ', password }))
      .rejects.toMatchObject({ code: 'EMAIL_ALREADY_EXISTS' });
  });

  it('returns the same credential error for a wrong password and a missing account', async () => {
    const fixture = dependencies();
    await fixture.identity.register({ nombre: 'Ana', email: 'ana@example.test', password });
    const wrongPassword = await fixture.identity.login({ email: 'ana@example.test', password: 'incorrect-password' })
      .catch((error: unknown) => error);
    const missingAccount = await fixture.identity.login({ email: 'missing@example.test', password })
      .catch((error: unknown) => error);

    expect(wrongPassword).toBeInstanceOf(DomainError);
    expect(missingAccount).toMatchObject({
      code: 'INVALID_CREDENTIALS',
      message: (wrongPassword as DomainError).message,
    });
    expect(wrongPassword).toMatchObject({ code: 'INVALID_CREDENTIALS' });
    expect(fixture.passwords.verify).toHaveBeenCalledWith(dummyHash, password);
  });

  it.each([undefined, null, '', 'x'.repeat(129)])('rejects invalid login password %s', async (candidate) => {
    const fixture = dependencies();

    await expect(fixture.identity.login({ email: 'ana@example.test', password: candidate }))
      .rejects.toMatchObject({ code: 'INVALID_CREDENTIALS' });
  });

  it('uses the current database role with the same access token', async () => {
    const fixture = dependencies();
    await fixture.identity.register({ nombre: 'Ana', email: 'ana@example.test', password });
    const { access_token: token } = await fixture.identity.login({ email: 'ana@example.test', password });
    const storedUser = fixture.records.get(userId)!;

    expect((await fixture.identity.authenticate(token)).rol).toBe('user');
    storedUser.rol = 'admin';
    expect((await fixture.identity.authenticate(token)).rol).toBe('admin');
    storedUser.rol = 'user';
    expect((await fixture.identity.authenticate(token)).rol).toBe('user');
  });

  it('rejects a valid token when the account has been deleted', async () => {
    const fixture = dependencies();
    await fixture.identity.register({ nombre: 'Ana', email: 'ana@example.test', password });
    const token = fixture.tokens.issue(userId);
    fixture.records.delete(userId);

    await expect(fixture.identity.authenticate(token)).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  });

  it('rejects an unsupported database role for authentication and login', async () => {
    const fixture = dependencies();
    await fixture.identity.register({ nombre: 'Ana', email: 'ana@example.test', password });
    fixture.records.get(userId)!.rol = 'unsupported' as User['rol'];

    await expect(fixture.identity.authenticate(fixture.tokens.issue(userId)))
      .rejects.toMatchObject({ code: 'UNAUTHORIZED' });
    await expect(fixture.identity.login({ email: 'ana@example.test', password }))
      .rejects.toMatchObject({ code: 'INVALID_CREDENTIALS' });
  });

  it('does not expose storage metadata after authentication', async () => {
    const fixture = dependencies();
    await fixture.identity.register({ nombre: 'Ana', email: 'ana@example.test', password });
    const actor = await fixture.identity.authenticate(fixture.tokens.issue(userId));

    expect(Object.keys(actor).sort()).toEqual(['email', 'id', 'nombre', 'rol']);
  });

  it.each([null, [], 'invalid'])('rejects malformed registration and login bodies %j', async (input) => {
    const fixture = dependencies();

    await expect(fixture.identity.register(input)).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    await expect(fixture.identity.login(input)).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(fixture.passwords.hash).not.toHaveBeenCalled();
  });
});

describe('Identity validation', () => {
  it.each([undefined, null, '', 'a@', 'a b@example.test', 'a@@example.test', `${'a'.repeat(250)}@example.test`])(
    'rejects invalid email %s',
    (value) => {
      expect(() => Email.normalize(value)).toThrow(expect.objectContaining({
        code: 'VALIDATION_ERROR',
        fields: { email: expect.any(String) },
      }));
    },
  );

  it.each([undefined, null, '', ' ', 'A', 'a'.repeat(81)])('rejects unusable names %s', (value) => {
    expect(() => validateName(value)).toThrow(expect.objectContaining({ code: 'VALIDATION_ERROR' }));
  });

  it.each([undefined, null, '', 'short', 'a'.repeat(129)])('rejects passwords outside policy %s', (value) => {
    expect(() => validatePassword(value)).toThrow(expect.objectContaining({ code: 'VALIDATION_ERROR' }));
  });

  it('preserves meaningful password whitespace', () => {
    const value = '  password with spaces  ';

    expect(validatePassword(value)).toBe(value);
  });
});

describe('ArgonPasswordHasher', () => {
  it('stores an Argon2id hash and verifies passwords without plaintext storage', async () => {
    const hasher = new ArgonPasswordHasher();
    const hash = await hasher.hash(password);

    expect(hash).toMatch(/^\$argon2id\$/);
    expect(hash).not.toContain(password);
    await expect(hasher.verify(hash, password)).resolves.toBe(true);
    await expect(hasher.verify(hash, 'wrong-password')).resolves.toBe(false);
    await expect(hasher.verify('corrupted-hash', password)).resolves.toBe(false);
  });
});

describe('JwtTokens', () => {
  it('issues a short-lived signed identity without embedding role or personal data', () => {
    const clock = new MutableClock();
    const tokens = new JwtTokens(secret, issuer, audience, 900, clock);
    const token = tokens.issue(userId);
    const payload = jwt.decode(token) as JwtPayload;

    expect(tokens.verify(token)).toEqual({ sub: userId });
    expect(payload.exp! - payload.iat!).toBe(900);
    expect(payload).toMatchObject({ sub: userId, iss: issuer, aud: audience, jti: expect.any(String) });
    expect(payload).not.toHaveProperty('rol');
    expect(payload).not.toHaveProperty('email');
    expect(payload).not.toHaveProperty('nombre');
  });

  it('rejects an expired token using the injected clock', () => {
    const clock = new MutableClock();
    const tokens = new JwtTokens(secret, issuer, audience, 900, clock);
    const token = tokens.issue(userId);
    clock.current = new Date(startTime.getTime() + 900_000);

    expect(() => tokens.verify(token)).toThrow(expect.objectContaining({ code: 'UNAUTHORIZED' }));
  });

  it('rejects a token signed with a different secret', () => {
    const tokens = new JwtTokens(secret, issuer, audience, 900, new MutableClock());
    const token = jwt.sign(claims(), 'a-different-test-secret-with-over-32-characters');

    expect(() => tokens.verify(token)).toThrow(expect.objectContaining({ code: 'UNAUTHORIZED' }));
  });

  it('rejects a signed token that requests an unsupported algorithm', () => {
    const tokens = new JwtTokens(secret, issuer, audience, 900, new MutableClock());
    const token = jwt.sign(claims(), secret, { algorithm: 'HS512' });

    expect(() => tokens.verify(token)).toThrow(expect.objectContaining({ code: 'UNAUTHORIZED' }));
  });

  it.each(['exp', 'sub', 'iss', 'aud'])('requires the %s claim even with a valid signature', (field) => {
    const tokens = new JwtTokens(secret, issuer, audience, 900, new MutableClock());
    const payload = claims();
    delete payload[field];
    const token = jwt.sign(payload, secret);

    expect(() => tokens.verify(token)).toThrow(expect.objectContaining({ code: 'UNAUTHORIZED' }));
  });

  it.each([
    { iss: 'another-api' },
    { aud: 'another-application' },
    { sub: 'invalid-user' },
    { sub: '' },
    { exp: Math.floor(startTime.getTime() / 1000) + 900.5 },
    { nbf: Math.floor(startTime.getTime() / 1000) + 1 },
  ])('rejects unacceptable claims %j', (override) => {
    const tokens = new JwtTokens(secret, issuer, audience, 900, new MutableClock());
    const token = jwt.sign(claims(override), secret);

    expect(() => tokens.verify(token)).toThrow(expect.objectContaining({ code: 'UNAUTHORIZED' }));
  });

  it.each(['', 'invalid', 'a.b.c'])('rejects malformed tokens %s', (token) => {
    const tokens = new JwtTokens(secret, issuer, audience, 900, new MutableClock());

    expect(() => tokens.verify(token)).toThrow(expect.objectContaining({ code: 'UNAUTHORIZED' }));
  });
});
