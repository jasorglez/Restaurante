export interface ItemCocina {
  descripcion: string;
  cantidad: number;
  presentacion: string | null;
}

export interface OrdenCocina {
  idCuenta: number;
  nombreMesa: string;
  minutos: number;
  items: ItemCocina[];
}

export interface MesaListo {
  idCuenta: number;
  idMesa: number;
  nombreMesa: string;
  numItems: number;
  minutos: number;
  items: ItemCocina[];
}
