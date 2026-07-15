export type Rol = 'mesero' | 'cajero' | 'admin';

export interface Usuario {
  id: number;
  nombre: string;
  rol: Rol;
  activo: boolean;
}
