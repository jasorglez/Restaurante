export interface ReporteMesaItem {
  descripcion: string;
  cantidad: number;
  precioUnitario: number;
  subtotal: number;
  createdAt: string;
}

export interface ReporteMesa {
  orden: number;
  idCuenta: number;
  nombreMesa: string;
  total: number;
  numItems: number;
  abiertaAt: string;
  cerradaAt: string | null;
  minutosAtencion: number;
  notas: string | null;
  items: ReporteMesaItem[];
}

export interface GrupoMesa {
  nombreMesa: string;
  cuentas: ReporteMesa[];
  subtotal: number;
}
