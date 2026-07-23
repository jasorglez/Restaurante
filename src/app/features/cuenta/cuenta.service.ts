import { HttpClient, httpResource } from '@angular/common/http';
import { Injectable, computed, effect, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../../environments/environment';
import { CuentaAbierta, ItemCuenta } from '../../models/familia';
import { Mesa } from '../../models/mesa';
import { ConnectivityService, esErrorDeRed } from '../../core/connectivity.service';
import { ultimoValorValido } from '../../shared/util/resource-fallback';

/** Body que espera el backend para agregar un producto a la cuenta. */
export interface AgregarItemBody {
  idMaterial: number;
  descripcion: string;
  cantidad: number;
  precio: number;
  presentacion: string | null;
  comensal: number;
}

/** Operación pendiente de sincronizar (se generó offline). */
interface ColaOp {
  id: string;
  idCuenta: number;
  kind: 'agregarItem' | 'eliminarItem';
  body: object;
  idItem?: number;       // eliminarItem: id real del item a borrar en el servidor
  idItemTemp?: number;   // agregarItem: id temporal del item optimista (para poder cancelarlo)
}

/**
 * Endpoints del dominio Cuenta/Pago: apertura y cobro de cuentas, items,
 * modo (junta/separada), para-llevar, cobros del día, autorizaciones y lealtad.
 * Para las rutas por cuenta se expone `cuentaBase(id)`; el llamador agrega el
 * sufijo (/cobrar, /items, /por-cobrar, …).
 */
@Injectable({ providedIn: 'root' })
export class CuentaService {
  private readonly http = inject(HttpClient);
  private readonly connectivity = inject(ConnectivityService);
  private readonly pub = `${environment.urlChatBot}/restaurant-publico`;

  constructor() {
    // En cuanto vuelve la red, intenta sincronizar lo que se quedó pendiente.
    effect(() => { if (this.connectivity.online() && this.colaPendiente().length > 0) void this.flushCola(); });
    // Respaldo cada 20s (mismo ritmo que el auto-refresco de mesas): `online` del
    // navegador no siempre refleja si el internet real ya volvió.
    setInterval(() => { if (this.colaPendiente().length > 0) void this.flushCola(); }, 20000);
  }

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
  // Si se cae la red a media comanda, sigue mostrando los últimos items buenos
  // en vez de reventar (no se persiste: la mesa seleccionada tampoco sobrevive un refresh).
  readonly items = ultimoValorValido(this.itemsResource, [] as ItemCuenta[]);
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

  // ── Cola offline (Nivel 2): agregar/quitar producto en una cuenta ya abierta ──
  // No cubre abrir mesa ni ninguna operación de dinero (cobrar, cerrar turno,
  // egresos, devoluciones) — esas siguen necesitando red.
  private static readonly LS_COLA = 'pv_cola_cuenta';
  private flushing = false;
  readonly colaPendiente = signal<ColaOp[]>(this.restaurarCola());
  readonly pendientesCount = computed(() => this.colaPendiente().length);

  private restaurarCola(): ColaOp[] {
    try {
      const s = localStorage.getItem(CuentaService.LS_COLA);
      return s ? JSON.parse(s) : [];
    } catch { return []; }
  }
  private guardarCola(): void {
    try { localStorage.setItem(CuentaService.LS_COLA, JSON.stringify(this.colaPendiente())); }
    catch { /* localStorage lleno o no disponible: la cola se queda solo en memoria */ }
  }
  private encolar(op: Omit<ColaOp, 'id'>): void {
    this.colaPendiente.update(l => [...l, { ...op, id: crypto.randomUUID() }]);
    this.guardarCola();
  }
  private quitarDeCola(id: string): void {
    this.colaPendiente.update(l => l.filter(o => o.id !== id));
    this.guardarCola();
  }

  /**
   * Agrega un producto; si no hay red, lo muestra optimista y lo deja encolado.
   * Devuelve 'pendiente' cuando quedó encolado (el llamador no debe recargar
   * `itemsResource` en ese caso: `.reload()` reintentaría contra la red y
   * pisaría el resultado; `flushCola()` ya recarga una sola vez al sincronizar).
   */
  async agregarItemConCola(idCuenta: number, body: AgregarItemBody): Promise<'sincronizado' | 'pendiente'> {
    try {
      await this.agregarItem(idCuenta, body);
      return 'sincronizado';
    } catch (err) {
      if (!esErrorDeRed(err)) throw err;
      const idTemp = -Date.now();
      const optimista: ItemCuenta = {
        id: idTemp, idMaterial: body.idMaterial, descripcion: body.descripcion,
        cantidad: body.cantidad, precioUnitario: body.precio, subtotal: body.precio * body.cantidad,
        enviadoCocina: false, comensal: body.comensal, pagado: false,
      };
      this.itemsResource.value.update(items => [...items, optimista]);
      this.encolar({ idCuenta, kind: 'agregarItem', body, idItemTemp: idTemp });
      return 'pendiente';
    }
  }

  /** Quita un producto; si era un item aún no sincronizado, solo cancela la cola. */
  async eliminarItemConCola(idCuenta: number, idItem: number, body: object): Promise<'sincronizado' | 'pendiente'> {
    const pendiente = this.colaPendiente().find(op => op.idItemTemp === idItem);
    if (pendiente) {
      this.quitarDeCola(pendiente.id);
      this.itemsResource.value.update(items => items.filter(i => i.id !== idItem));
      return 'pendiente';
    }
    try {
      await this.eliminarItem(idCuenta, idItem, body);
      return 'sincronizado';
    } catch (err) {
      if (!esErrorDeRed(err)) throw err;
      this.itemsResource.value.update(items => items.filter(i => i.id !== idItem));
      this.encolar({ idCuenta, kind: 'eliminarItem', body, idItem });
      return 'pendiente';
    }
  }

  /** Reintenta en orden la cola pendiente. Se detiene en el primer fallo de red
   * (sigue offline); un error real del servidor descarta esa operación sola. */
  async flushCola(): Promise<void> {
    if (this.flushing) return;
    this.flushing = true;
    let sincronizoAlguna = false;
    try {
      while (this.colaPendiente().length > 0) {
        const op = this.colaPendiente()[0];
        try {
          if (op.kind === 'agregarItem') {
            await this.agregarItem(op.idCuenta, op.body);
          } else {
            await this.eliminarItem(op.idCuenta, op.idItem!, op.body);
          }
          this.quitarDeCola(op.id);
          sincronizoAlguna = true;
        } catch (err) {
          if (esErrorDeRed(err)) return;   // sigue sin red: se reintenta después
          console.warn('No se pudo sincronizar un cambio pendiente, se descarta.', op, err);
          this.quitarDeCola(op.id);
        }
      }
    } finally {
      this.flushing = false;
      // Reconcilia los items temporales con la verdad del servidor.
      if (sincronizoAlguna) this.itemsResource.reload();
    }
  }
}
