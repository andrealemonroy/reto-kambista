import type { Role } from '../../../shared/domain/actor';
import { DomainError } from '../../../shared/domain/domain-error';

export interface User {
  id: string;
  nombre: string;
  email: string;
  passwordHash: string;
  rol: Role;
  createdAt: Date;
}

export class Email {
  static normalize(value: unknown): string {
    if (typeof value !== 'string') {
      throw new DomainError('VALIDATION_ERROR', 'Ingresa un correo válido.', { email: 'Ingresa tu correo electrónico.' });
    }
    const normalized = value.trim().toLowerCase();
    if (normalized.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
      throw new DomainError('VALIDATION_ERROR', 'Ingresa un correo válido.', { email: 'Revisa el formato del correo.' });
    }
    return normalized;
  }
}

export function validateName(value: unknown): string {
  if (typeof value !== 'string' || value.trim().length < 2 || value.trim().length > 80) {
    throw new DomainError('VALIDATION_ERROR', 'Revisa tu nombre.', { nombre: 'Usa entre 2 y 80 caracteres.' });
  }
  return value.trim();
}

export function validatePassword(value: unknown): string {
  if (typeof value !== 'string' || value.length < 8 || value.length > 128) {
    throw new DomainError('VALIDATION_ERROR', 'Revisa tu contraseña.', { password: 'Usa entre 8 y 128 caracteres.' });
  }
  return value;
}
