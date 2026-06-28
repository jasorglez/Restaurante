export interface Familia {
  id: number;
  description: string;
}

export interface CuentaAbierta {
  id: number;
  idMesa: number;
  total: number;
  nueva: boolean;
}
