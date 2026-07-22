import { HttpClient, httpResource } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../../environments/environment';
import { CuentaAbierta, ItemCuenta } from '../../models/familia';
import { Mesa } from '../../models/mesa';

/**
 * Endpoints del dominio Cuenta/Pago: apertura y cobro de cuentas, items,
 * modo (junta/separada), para-llevar, cobros del día, autorizaciones y lealtad.
 * Para las rutas por cuenta se expone `cuentaBase(id)`; el llamador agrega el
 * sufijo (/cobrar, /items, /por-cobrar, …).
 */
@Injectable({ providedIn: 'root' })
export class CuentaService {
  private readonly http = inject(HttpClient);
  private readonly pub = `${environment.urlChatBot}/restaurant-publico`;

  // ── Estado (store) ──────────────────────────────────────────────────────────
  /** Mesa/cuenta seleccionada (maneja el flujo cuenta/familias/productos/pago). */
  readonly selectedMesa = signal<Mesa | null>(null);
  /** Si estamos en una vista que muestra los items (familias/productos/cuenta). */
  readonly enCuentaVista = signal(false);

  /** Items de la cuenta seleccionada. */
  readonly itemsResource = httpResource<ItemCuenta[]>(
    () => {
      const mesa = this.selectedMesa();
      return mesa?.idCuentaActual != null && this.enCuentaVista()
        ? `${this.cuentaBase(mesa.idCuentaActual)}/items`
        : undefined;
    },
    { defaultValue: [] },
  );
  readonly items = this.itemsResource.value;
  /** Productos aún por cobrar (los pagados de una cuenta separada quedan aparte). */
  readonly itemsPendientes = computed(() => this.items().filter(i => !i.pagado));
  readonly totalCuenta = computed(() => this.itemsPendientes().reduce((s, i) => s + i.subtotal, 0));
  reloadItems(): void { this.itemsResource.reload(); }

  /** Modo de la cuenta: junta (normal) o separada (por persona) + comensales. */
  readonly cuentaSeparada = signal(false);
  readonly numComensales  = signal(1);
  readonly comensalSel    = signal(1);   // a quién se le carga el producto que se agrega

  /** Base de una cuenta: `${pub}/cuentas/${idCuenta}`. Agregar el sufijo de la acción. */
  cuentaBase(idCuenta: number | null | undefined): string { return `${this.pub}/cuentas/${idCuenta}`; }

  /** Marca/desmarca la cuenta como "por cobrar" (cola de cobro). */
  marcarPorCobrar(idCuenta: number, valor: boolean): Promise<unknown> {
    return firstValueFrom(this.http.post(`${this.cuentaBase(idCuenta)}/por-cobrar`, { valor }));
  }
  /** Transfiere la cuenta a otra mesa. */
  transferir(idCuenta: number, idMesaDestino: number): Promise<unknown> {
    return firstValueFrom(this.http.post(`${this.cuentaBase(idCuenta)}/transferir`, { idMesaDestino }));
  }
  /** Fusiona la cuenta con la de otra mesa. */
  fusionar(idCuenta: number, idCuentaDestino: number): Promise<unknown> {
    return firstValueFrom(this.http.post(`${this.cuentaBase(idCuenta)}/fusionar`, { idCuentaDestino }));
  }

  /** Abrir una cuenta nueva. */
  abrirUrl(): string { return `${this.pub}/cuentas/abrir`; }

  // ── Operaciones de cuenta/pago ──
  /** Abre una cuenta para una mesa. */
  abrir(companyId: number, idMesa: number): Promise<CuentaAbierta> {
    return firstValueFrom(this.http.post<CuentaAbierta>(this.abrirUrl(), { idCompany: companyId, idMesa }));
  }
  /** Agrega un producto a la cuenta. */
  agregarItem(idCuenta: number, body: object): Promise<unknown> {
    return firstValueFrom(this.http.post(`${this.cuentaBase(idCuenta)}/items`, body));
  }
  /** Elimina un item de la cuenta (envía cantidad/precio en el body). */
  eliminarItem(idCuenta: number, idItem: number, body: object): Promise<unknown> {
    return firstValueFrom(this.http.delete(`${this.cuentaBase(idCuenta)}/items/${idItem}`, { body }));
  }
  /** Marca un item como cortesía (precio 0). */
  cortesiaItem(idCuenta: number, idItem: number, body: object): Promise<unknown> {
    return firstValueFrom(this.http.post(`${this.cuentaBase(idCuenta)}/items/${idItem}/cortesia`, body));
  }
  /** Registra una autorización (cancelación/descuento) en la cuenta. */
  autorizacion(idCuenta: number, body: object): Promise<unknown> {
    return firstValueFrom(this.http.post(`${this.cuentaBase(idCuenta)}/autorizacion`, body));
  }
  /** Cobra la cuenta completa. */
  cobrar(idCuenta: number, body: object): Promise<unknown> {
    return firstValueFrom(this.http.post(`${this.cuentaBase(idCuenta)}/cobrar`, body));
  }
  /** Cobra la parte de un comensal (cuenta separada). */
  cobrarComensal(idCuenta: number, body: object): Promise<any> {
    return firstValueFrom(this.http.post(`${this.cuentaBase(idCuenta)}/cobrar-comensal`, body));
  }

  /** Cancelar una venta ya cobrada (marca en reporte). */
  cancelarVentaUrl(idCuenta: number, companyId: number): string {
    return `${this.pub}/cuentas/${idCuenta}/cancelar-venta?idCompany=${companyId}`;
  }

  /** Cobros del día (para devoluciones). */
  cobrosDiaUrl(companyId: number, fecha: string): string {
    return `${this.pub}/cobros-dia/${companyId}?fecha=${fecha}`;
  }

  /** Bitácora de autorizaciones (cancelación/cortesía/descuento). */
  autorizacionesUrl(): string { return `${this.pub}/autorizaciones`; }

  /** Datos de lealtad por teléfono del cliente. */
  loyaltyUrl(companyId: number, tel: string): string {
    return `${this.pub}/loyalty/${companyId}/${encodeURIComponent(tel)}`;
  }

  // ── Para llevar / domicilio ──
  llevarUrl(companyId: number): string { return `${this.pub}/cuentas/llevar/${companyId}`; }
  llevarAbrirUrl(): string { return `${this.pub}/cuentas/llevar/abrir`; }

  // ── Modo de cuenta (junta/separada) ──
  getModo(idCuenta: number): Promise<any> {
    return firstValueFrom(this.http.get(`${this.cuentaBase(idCuenta)}/modo`));
  }
  guardarModo(idCuenta: number, separada: boolean, numComensales: number | null): Promise<unknown> {
    return firstValueFrom(this.http.post(`${this.cuentaBase(idCuenta)}/modo`, { separada, numComensales }));
  }
  /** Cancela una cuenta recién abierta que quedó vacía. */
  cancelarVacia(idCuenta: number): Promise<unknown> {
    return firstValueFrom(this.http.post(`${this.cuentaBase(idCuenta)}/cancelar-vacia`, {}));
  }
  /** Cancela una venta ya cobrada (para devoluciones). */
  cancelarVenta(idCuenta: number, companyId: number): Promise<unknown> {
    return firstValueFrom(this.http.post(this.cancelarVentaUrl(idCuenta, companyId), {}));
  }
  /** Registra una autorización suelta (p.ej. devolución). */
  registrarAutorizacion(body: object): Promise<unknown> {
    return firstValueFrom(this.http.post(this.autorizacionesUrl(), body));
  }
  /** Abre una cuenta para-llevar/domicilio. */
  abrirLlevar(body: object): Promise<any> {
    return firstValueFrom(this.http.post(this.llevarAbrirUrl(), body));
  }
  /** Consulta puntos de lealtad por teléfono. */
  consultarPuntos(companyId: number, tel: string): Promise<any> {
    return firstValueFrom(this.http.get(this.loyaltyUrl(companyId, tel)));
  }
}
