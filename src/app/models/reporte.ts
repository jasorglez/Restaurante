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

export interface PlatilloTop {
  descripcion: string;
  cantidad: number;
  total: number;
}

export interface ResumenDia {
  cuentasCerradas: number;
  totalVentas: number;
  ticketPromedio: number;
  ventasEfectivo: number;
  ventasTarjeta: number;
  ventasOtros: number;
  topPlatillos: PlatilloTop[];
  mesaMayorNombre: string | null;
  mesaMayorTotal: number;
}

export interface GrupoMesa {
  nombreMesa: string;
  cuentas: ReporteMesa[];
  subtotal: number;
}
