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

export interface Producto {
  id: number;
  description: string;
  price: number;
}

export interface ItemCuenta {
  id: number;
  idMaterial: number;
  descripcion: string;
  cantidad: number;
  precioUnitario: number;
  subtotal: number;
  enviadoCocina: boolean;
  comensal?: number | null;
}
