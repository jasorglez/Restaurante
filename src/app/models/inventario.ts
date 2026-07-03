export interface Equivalencia {
  id: number;
  nombre: string;
  onzas: number;
}

/** Configuración de inventario de un producto (material). */
export interface ProductoInventario {
  idMaterial: number;
  controlaInventario: boolean;
  vendePorCopa: boolean;
  idEquivalencia: number | null;
  onzasPorPieza: number;
  onzasPorCopa: number;
  precioCopa: number | null;
  stockMinPiezas: number;
  existenciaOnzas: number;
}

/** Fila del reporte de existencias. */
export interface Existencia {
  idMaterial: number;
  descripcion: string;
  vendePorCopa: boolean;
  onzasPorPieza: number;
  existenciaOnzas: number;
  piezasEnteras: number;
  onzasSobrantes: number;
  stockMinPiezas: number;
  bajoMinimo: boolean;
}

/** Movimiento del kardex (ingreso / venta / ajuste). */
export interface MovimientoInv {
  id: number;
  idMaterial: number;
  descripcion: string;
  tipo: string;              // 'INGRESO' | 'VENTA' | 'AJUSTE'
  presentacion: string | null; // 'COMPLETA' | 'COPA'
  piezas: number | null;
  onzas: number;
  existencia: number | null;
  nombreMesa: string | null;
  nota: string | null;
  fecha: string;
}

/** Resumen de movimientos por producto en un rango. */
export interface ResumenMov {
  idMaterial: number;
  descripcion: string;
  vendePorCopa: boolean;
  onzasPorPieza: number;
  ingresosOnzas: number;
  egresosOnzas: number;
  ingresosPiezas: number;
}

export interface ResultadoMovimiento {
  ok: boolean;
  existenciaOnzas: number;
  piezasEnteras: number;
  onzasSobrantes: number;
  mensaje?: string;
}
