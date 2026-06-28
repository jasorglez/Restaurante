export interface Mesa {
  id: number;
  nombre: string;
  capacidad: number | null;
  activo: boolean;
  tieneCuentaAbierta: boolean;
  idCuentaActual: number | null;
  totalActual: number | null;
  numItems: number;
}
