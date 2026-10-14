export type Role = 'user' | 'admin';

export interface Actor {
  id: string;
  nombre: string;
  email: string;
  rol: Role;
}
