export interface Mesa {
  id: number;
  nombre: string;
  capacidad: number | null;
  activo: boolean;
  tieneCuentaAbierta: boolean;
  idCuentaActual: number | null;
  totalActual: number | null;
  numItems: number;
  estado?: string;          // libre | ocupada | por_cobrar | sucia
  minutosAbierta?: number;
  sucia?: boolean;
  porCobrarAt?: string | null;   // cuándo se envió a cobrar (cola de caja)
  meseroApertura?: string | null; // nombre del usuario que abrió/atendió la mesa (para el ticket)
}
