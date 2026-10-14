import { randomUUID } from 'node:crypto';
import jwt from 'jsonwebtoken';
import type { Clock } from '../../../shared/domain/clock';
import { DomainError } from '../../../shared/domain/domain-error';
import type { TokenSigner } from '../application/ports';

export class JwtTokens implements TokenSigner {
  constructor(
    private readonly secret: string,
    private readonly issuer: string,
    private readonly audience: string,
    private readonly seconds: number,
    private readonly clock: Clock,
  ) {}

  issue(userId: string): string {
    const now = Math.floor(this.clock.now().getTime() / 1000);
    return jwt.sign({ sub: userId, iat: now, exp: now + this.seconds, iss: this.issuer, aud: this.audience, jti: randomUUID() }, this.secret, { algorithm: 'HS256' });
  }

  verify(token: string): { sub: string } {
    try {
      const claims = jwt.verify(token, this.secret, {
        algorithms: ['HS256'],
        issuer: this.issuer,
        audience: this.audience,
        clockTimestamp: Math.floor(this.clock.now().getTime() / 1000),
      });
      if (typeof claims === 'string' || typeof claims.sub !== 'string' || !/^[0-9a-f]{24}$/i.test(claims.sub) || !Number.isInteger(claims.exp)) {
        throw new Error('Invalid claims');
      }
      return { sub: claims.sub };
    } catch {
      throw new DomainError('UNAUTHORIZED', 'Tu sesión no es válida o ha expirado. Vuelve a ingresar.');
    }
  }
}
