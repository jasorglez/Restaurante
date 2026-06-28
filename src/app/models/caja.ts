export interface CajaInfo {
  id: number;
  description: string;
  idStore: number;
  active: boolean;
}

export interface Turno {
  id: number;
  idCompany: number;
  idCashRegister: number;
  idBranch: number;
  cajero: string | null;
  fondoInicial: number;
  fechaInicio: string;
  fechaCierre: string | null;
  ventasEfectivo: number | null;
  ventasTarjeta: number | null;
  ventasCheque: number | null;
  ventasVales: number | null;
  ventasMixto: number | null;
  ventasTotal: number | null;
  efectivoContado: number | null;
  efectivoEsperado: number | null;
  diferencia: number | null;
  active: boolean;
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
