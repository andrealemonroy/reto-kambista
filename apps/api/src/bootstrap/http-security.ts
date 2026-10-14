import { Catch, HttpException, Inject, Injectable, SetMetadata, type ArgumentsHost, type CanActivate, type ExceptionFilter, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { isIP } from 'node:net';
import type { Request, Response } from 'express';
import { MongoError } from 'mongodb';
import type { Actor } from '../shared/domain/actor';
import { DomainError } from '../shared/domain/domain-error';
import { IdentityService } from '../modules/identity/application/identity.service';
import { AuthLimiter } from './auth-limiter';
import { JsonLogger } from './json-logger';

export interface ActorRequest extends Request {
  actor?: Actor;
  requestId?: string;
}

export const Public = () => SetMetadata('publicRoute', true);

export function authenticationIp(request: ActorRequest, env: NodeJS.ProcessEnv = process.env): string {
  const clientIp = request.headers['cf-connecting-ip'];
  if (env.RENDER === 'true' && env.RENDER_SERVICE_TYPE === 'web' && typeof clientIp === 'string' && isIP(clientIp)) {
    return clientIp;
  }
  return request.ip ?? request.socket.remoteAddress ?? 'unknown';
}

@Injectable()
export class AccessGuard implements CanActivate {
  constructor(
    @Inject(IdentityService) private readonly identity: IdentityService,
    @Inject(Reflector) private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (this.reflector.getAllAndOverride<boolean>('publicRoute', [context.getHandler(), context.getClass()])) return true;
    const request = context.switchToHttp().getRequest<ActorRequest>();
    const header = request.headers.authorization;
    const bearer = typeof header === 'string' ? /^Bearer\s+(\S+)$/i.exec(header) : null;
    if (!bearer) throw new DomainError('UNAUTHORIZED', 'Inicia sesión para continuar.');
    request.actor = await this.identity.authenticate(bearer[1]);
    return true;
  }
}

@Injectable()
export class AuthenticationLimitGuard implements CanActivate {
  constructor(@Inject(AuthLimiter) private readonly limiter: AuthLimiter) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<ActorRequest>();
    const body: unknown = request.body;
    const email = body && typeof body === 'object' ? (body as Record<string, unknown>).email : undefined;
    const retry = this.limiter.consume(authenticationIp(request), email);
    if (retry !== null) {
      context.switchToHttp().getResponse<Response>().setHeader('Retry-After', String(retry));
      throw new DomainError('REQUEST_LIMIT_EXCEEDED', 'Demasiados intentos. Espera un momento y vuelve a probar.');
    }
    return true;
  }
}

@Catch()
export class ApiErrorFilter implements ExceptionFilter {
  constructor(private readonly logger: JsonLogger) {}

  catch(error: unknown, host: ArgumentsHost): void {
    const request = host.switchToHttp().getRequest<ActorRequest>();
    const response = host.switchToHttp().getResponse<Response>();
    let status = 500;
    let code = 'INTERNAL_ERROR';
    let message = 'No pudimos procesar la solicitud. Intenta nuevamente.';
    let fields: Record<string, string> | undefined;
    if (error instanceof DomainError) {
      const statuses: Record<string, number> = {
        VALIDATION_ERROR: 400,
        INVALID_CREDENTIALS: 401,
        UNAUTHORIZED: 401,
        EMAIL_ALREADY_EXISTS: 409,
        REQUEST_LIMIT_EXCEEDED: 429,
        EXCHANGE_RATE_UNAVAILABLE: 503,
        RATE_PROVIDER_UNAVAILABLE: 503,
        PERSISTENCE_UNAVAILABLE: 503,
      };
      status = statuses[error.code] ?? 500;
      code = error.code;
      message = status < 500 || status === 503 ? error.message : message;
      fields = error.fields;
    } else if (error instanceof MongoError) {
      status = 503;
      code = 'PERSISTENCE_UNAVAILABLE';
      message = 'El servicio de datos no está disponible. Intenta nuevamente.';
    } else if (error instanceof HttpException) {
      status = error.getStatus();
      code = status === 404 ? 'NOT_FOUND' : 'REQUEST_ERROR';
      message = status === 404 ? 'No se encontró el recurso.' : 'La solicitud no es válida.';
    } else if (error && typeof error === 'object' && 'status' in error && error.status === 400) {
      status = 400;
      code = 'VALIDATION_ERROR';
      message = 'Envía un cuerpo JSON válido.';
    } else if (error && typeof error === 'object' && 'status' in error && error.status === 413) {
      status = 413;
      code = 'PAYLOAD_TOO_LARGE';
      message = 'La solicitud supera el tamaño permitido.';
    }
    this.logger.event(status >= 500 ? 'error' : 'warn', 'request_failed', { requestId: request.requestId, code, status });
    response.status(status).json({ code, message, ...(fields ? { fields } : {}), requestId: request.requestId });
  }
}
