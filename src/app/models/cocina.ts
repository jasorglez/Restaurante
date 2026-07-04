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
