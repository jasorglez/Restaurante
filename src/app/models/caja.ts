export interface CajaInfo {
  idCaja: number;
  description: string;
  descCashRegister: string | null;
  idStore: number;
  idBranch: number;
  name: string | null;
  idRoot: number;
}

export interface Turno {
  id: number;
  idCompany: number;
  idCashRegister: number;
  idBranch?: number;
  cajero: string | null;
  fondoInicial: number;
  fechaInicio: string;
  fechaCierre: string | null;
  ventasEfectivo: number;
  ventasTarjeta: number;
  ventasCheque: number;
  ventasVales: number;
  ventasMixto: number;
  ventasTotal: number;
  efectivoContado: number | null;
  efectivoEsperado: number | null;
  diferencia: number | null;
  active: boolean;
  notas?: string | null;
}

export interface VentaPorTipo {
  paymentType: string;
  numVentas: number;
  total: number;
}

export interface EgresoCaja {
  id: number;
  idCashRegister: number;
  tipo: string;
  monto: number;
  descripcion: string | null;
  cajero: string | null;
  fecha: string;
  active: boolean;
}

export interface TotalesCorte {
  efectivo: number;
  tarjeta: number;
  cheque: number;
  vales: number;
  mixto: number;
  totalVentas: number;
  totalEgresos: number;
  efectivoEsperado: number;
}

export interface ResumenCorte {
  turno: Turno;
  ventas: VentaPorTipo[];
  egresos: EgresoCaja[];
  totales: TotalesCorte;
}
