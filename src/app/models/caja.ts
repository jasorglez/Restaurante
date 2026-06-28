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
  active: boolean;
}
