import type { LoggerService } from '@nestjs/common';

export class JsonLogger implements LoggerService {
  constructor(private readonly output: (line: string) => void = (line) => process.stdout.write(`${line}\n`)) {}

  event(level: string, event: string, fields: Record<string, unknown> = {}): void {
    this.output(JSON.stringify({ time: new Date().toISOString(), level, event, ...fields }));
  }

  log(message: unknown, context?: string): void {
    this.event('info', 'application', { message: typeof message === 'string' ? message : 'Evento de aplicación', context });
  }

  error(message: unknown, _trace?: string, context?: string): void {
    this.event('error', 'application', { message: typeof message === 'string' ? message : 'Error de aplicación', context });
  }

  warn(message: unknown, context?: string): void {
    this.event('warn', 'application', { message: typeof message === 'string' ? message : 'Aviso de aplicación', context });
  }
}
