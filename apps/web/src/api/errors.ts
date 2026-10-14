import type { FieldErrors } from './types';

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly fields: FieldErrors = {},
    public readonly requestId?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export class NetworkError extends Error {
  constructor(public readonly uncertain: boolean) {
    super(uncertain
      ? 'No pudimos confirmar el resultado. La solicitud podría haberse registrado. Revisa tu historial antes de intentarlo otra vez.'
      : 'No pudimos conectar con el servicio. Revisa tu conexión e inténtalo nuevamente.');
    this.name = 'NetworkError';
  }
}

export class SupersededRequestError extends Error {
  constructor() {
    super('La sesión cambió mientras se procesaba la solicitud.');
    this.name = 'SupersededRequestError';
  }
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Ocurrió un problema. Inténtalo nuevamente.';
}
