import { CurrencyPipe, DatePipe } from '@angular/common';
import { HttpClient, httpResource } from '@angular/common/http';
import { Component, computed, effect, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';

import { environment } from '../environments/environment';
import { CajaInfo, EgresoCaja, ResumenCorte, Turno } from './models/caja';
import { CuentaAbierta, Familia, ItemCuenta, Producto } from './models/familia';
import { Mesa } from './models/mesa';
import { GrupoMesa, ReporteMesa } from './models/reporte';

type RestaurantModule = 'MESAS' | 'CAJAS' | 'REPORTES';
type View = 'menu' | 'mesas' | 'familias' | 'productos' | 'cuenta' | 'cajas' | 'reportes';
type TipoPago = 'EFECTIVO' | 'TARJETA' | 'MIXTO';

interface CompanyInfo { name: string; picture: string | null; picture2: string | null; }

interface TicketData {
  companyName: string;
  mesaNombre: string;
  idCuenta: number;
  items: ItemCuenta[];
  total: number;
  tipoPago: TipoPago;
  montoPagado: number;
  montoTarjeta: number;
  cambio: number;
  fecha: Date;
}

@Component({
  selector: 'app-root',
  imports: [CurrencyPipe, DatePipe],
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
export class App {
  private readonly http = inject(HttpClient);

  protected readonly view = signal<View>('menu');
  protected readonly selectedMesa = signal<Mesa | null>(null);
  protected readonly openingMesa = signal(false);
  protected readonly mesaActionError = signal('');

  protected readonly selectedFamilia = signal<Familia | null>(null);
  protected readonly selectedSubfamilia = signal<Familia | null>(null);
  protected readonly selectedProducto = signal<Producto | null>(null);
  protected readonly agregandoItem = signal(false);
  protected readonly addError = signal('');

  protected readonly eliminandoId = signal<number | null>(null);

  // ── Nueva mesa ────────────────────────────────────────────────────────────
  protected readonly showNuevaMesa = signal(false);
  protected readonly nuevaMesaNombre = signal('');
  protected readonly nuevaMesaCapacidad = signal<number | null>(null);
  protected readonly creandoMesa = signal(false);
  protected readonly crearMesaError = signal('');

  // ── Cajas / Turno ─────────────────────────────────────────────────────────
  protected readonly cajasResource = httpResource<CajaInfo[]>(
    () => this.view() === 'cajas'
      ? `${environment.urlAdministration}/Restaurant/cajas/${environment.companyId}`
      : undefined,
    { defaultValue: [] },
  );
  protected readonly cajas = this.cajasResource.value;
  protected readonly cajasLoading = this.cajasResource.isLoading;

  protected readonly cajaNombre = signal('');
  protected readonly fondoInicial = signal<number | null>(null);
  protected readonly iniciandoTurno = signal(false);
  protected readonly turnoActivo = signal<Turno | null>(null);
  protected readonly turnoError = signal('');
  protected readonly turnoActivoCargando = computed(() => this.turnoActivoResource.isLoading());

  protected readonly cajaSeleccionada = computed(() => {
    const list = this.cajas();
    return list.length === 1 ? list[0] : null;
  });

  protected readonly cajasSubView = signal<'inicio' | 'egresos' | 'corte'>('inicio');
  protected readonly totalEgresosLista = computed(() =>
    this.egresosLista().reduce((s, e) => s + e.monto, 0),
  );

  // Consulta turno activo en cuanto se conoce la caja y se está en la vista
  protected readonly turnoActivoResource = httpResource<Turno | null>(
    () => {
      const caja = this.cajaSeleccionada();
      if (!caja || this.view() !== 'cajas') return undefined;
      return `${environment.urlAdministration}/Restaurant/cajas/${caja.idCaja}/turno-activo`;
    },
  );

  constructor() {
    // Cuando el recurso resuelve un turno abierto, lo activa automáticamente
    effect(() => {
      const t = this.turnoActivoResource.value();
      if (t && !this.turnoActivo()) {
        this.turnoActivo.set(t);
      }
    });
  }

  // ── Egresos ──────────────────────────────────────────────────────────────
  protected readonly egresoDesc = signal('');
  protected readonly egresoMonto = signal<number | null>(null);
  protected readonly registrandoEgreso = signal(false);
  protected readonly egresoError = signal('');
  protected readonly egresosLista = signal<EgresoCaja[]>([]);

  // ── Corte ─────────────────────────────────────────────────────────────────
  protected readonly resumenCorteResource = httpResource<ResumenCorte>(
    () => {
      const t = this.turnoActivo();
      if (!t || this.cajasSubView() !== 'corte') return undefined;
      return `${environment.urlAdministration}/Restaurant/turnos/${t.id}/resumen`;
    },
  );
  protected readonly efectivoContado = signal<number | null>(null);
  protected readonly cerrandoTurno = signal(false);
  protected readonly cerrarError = signal('');
  protected readonly corteResultado = signal<Turno | null>(null);
  protected readonly corteResumenSnapshot = signal<ResumenCorte | null>(null);

  protected readonly diferencia = computed(() => {
    const esperado = this.resumenCorteResource.value()?.totales.efectivoEsperado ?? 0;
    const contado  = this.efectivoContado() ?? 0;
    return contado - esperado;
  });

  // ── Reportes ──────────────────────────────────────────────────────────────
  protected readonly reporteSubView = signal<'mesas' | 'caja'>('mesas');
  protected readonly reporteFecha   = signal<string>(new Date().toISOString().split('T')[0]);

  protected readonly reporteMesasResource = httpResource<ReporteMesa[]>(
    () => {
      if (this.view() !== 'reportes' || this.reporteSubView() !== 'mesas') return undefined;
      return `${environment.urlAdministration}/Restaurant/reportes/${environment.companyId}/mesas?fecha=${this.reporteFecha()}`;
    },
    { defaultValue: [] },
  );

  protected readonly reporteTurnosResource = httpResource<Turno[]>(
    () => {
      if (this.view() !== 'reportes' || this.reporteSubView() !== 'caja') return undefined;
      return `${environment.urlAdministration}/Restaurant/reportes/${environment.companyId}/turnos?fecha=${this.reporteFecha()}`;
    },
    { defaultValue: [] },
  );

  protected readonly mesasPorGrupo = computed<GrupoMesa[]>(() => {
    const mapa = new Map<string, ReporteMesa[]>();
    for (const c of this.reporteMesasResource.value()) {
      const arr = mapa.get(c.nombreMesa) ?? [];
      arr.push(c);
      mapa.set(c.nombreMesa, arr);
    }
    return Array.from(mapa.entries()).map(([nombreMesa, cuentas]) => ({
      nombreMesa,
      cuentas,
      subtotal: cuentas.reduce((s, c) => s + c.total, 0),
    }));
  });

  protected readonly totalReporteMesas = computed(() =>
    this.reporteMesasResource.value().reduce((s, c) => s + c.total, 0),
  );

  protected readonly totalReporteCaja = computed(() =>
    this.reporteTurnosResource.value().reduce((s, t) => s + (t.ventasTotal ?? 0), 0),
  );

  protected setReporteFecha(e: Event): void {
    this.reporteFecha.set((e.target as HTMLInputElement).value);
  }

  // ── Pago ──────────────────────────────────────────────────────────────────
  protected readonly showPayment = signal(false);
  protected readonly tipoPago = signal<TipoPago>('EFECTIVO');
  protected readonly montoPagado = signal<number | null>(null);
  protected readonly montoTarjeta = signal<number | null>(null);
  protected readonly cobrando = signal(false);
  protected readonly cobroError = signal('');

  protected readonly cambio = computed(() => {
    const total = this.totalCuenta();
    const tipo = this.tipoPago();
    if (tipo === 'TARJETA') return 0;
    const efectivo = this.montoPagado() ?? 0;
    if (tipo === 'EFECTIVO') return Math.max(0, efectivo - total);
    const tarjeta = this.montoTarjeta() ?? 0;
    return Math.max(0, efectivo - Math.max(0, total - tarjeta));
  });

  // ── Ticket ────────────────────────────────────────────────────────────────
  protected readonly ticketData = signal<TicketData | null>(null);
  protected readonly ticketVisible = signal(false);

  // ── Empresa ───────────────────────────────────────────────────────────────
  protected readonly companyResource = httpResource<CompanyInfo>(
    () => `${environment.urlSmp}/Root/${environment.companyId}/pdf-info`,
  );
  protected readonly companyName = computed(
    () => this.companyResource.value()?.name?.trim() || 'Cargando empresa…',
  );
  protected readonly companyLogo = computed(
    () => this.companyResource.value()?.picture ?? null,
  );
  protected readonly appVersion = environment.version;

  // ── Mesas ─────────────────────────────────────────────────────────────────
  protected readonly mesasResource = httpResource<Mesa[]>(
    () => this.view() === 'mesas'
      ? `${environment.urlAdministration}/Restaurant/mesas/${environment.companyId}`
      : undefined,
    { defaultValue: [] },
  );
  protected readonly mesas = this.mesasResource.value;
  protected readonly loading = this.mesasResource.isLoading;
  protected readonly error = computed(() =>
    this.mesasResource.error()
      ? 'No fue posible cargar las mesas. Verifica que el servicio de Administración esté activo.'
      : '',
  );
  protected readonly mesasOcupadas = computed(
    () => this.mesas().filter(m => m.tieneCuentaAbierta).length,
  );

  // ── Familias ──────────────────────────────────────────────────────────────
  protected readonly familiasResource = httpResource<Familia[]>(
    () => this.view() === 'familias'
      ? `${environment.urlChatBot}/restaurant-publico/familias/${environment.companyId}`
      : undefined,
    { defaultValue: [] },
  );
  protected readonly familias = this.familiasResource.value;
  protected readonly familiasLoading = this.familiasResource.isLoading;
  protected readonly familiasError = computed(() =>
    this.familiasResource.error() ? 'No fue posible cargar las familias del menú.' : '',
  );

  // ── Subfamilias ───────────────────────────────────────────────────────────
  protected readonly subfamiliasResource = httpResource<Familia[]>(
    () => {
      const fam = this.selectedFamilia();
      if (!fam || this.view() !== 'productos') return undefined;
      return `${environment.urlChatBot}/restaurant-publico/subfamilias/${environment.companyId}/${fam.id}`;
    },
    { defaultValue: [] },
  );

  protected readonly mostrarSubfamilias = computed(() => {
    if (this.selectedSubfamilia()) return false;
    return !this.subfamiliasResource.isLoading() && this.subfamiliasResource.value().length > 1;
  });

  // ── Productos ─────────────────────────────────────────────────────────────
  protected readonly productosResource = httpResource<Producto[]>(
    () => {
      if (this.view() !== 'productos') return undefined;
      const fam = this.selectedFamilia();
      if (!fam || this.subfamiliasResource.isLoading()) return undefined;
      const sub = this.selectedSubfamilia();
      if (sub) {
        return `${environment.urlChatBot}/restaurant-publico/productos/${environment.companyId}/subfamilia/${sub.id}`;
      }
      if (!this.mostrarSubfamilias()) {
        return `${environment.urlChatBot}/restaurant-publico/productos/${environment.companyId}/familia/${fam.id}`;
      }
      return undefined;
    },
    { defaultValue: [] },
  );
  protected readonly productosLoading = computed(
    () => this.subfamiliasResource.isLoading() || this.productosResource.isLoading(),
  );
  protected readonly productosError = computed(() =>
    this.productosResource.error() ? 'No fue posible cargar los productos.' : '',
  );

  // ── Items de la cuenta ────────────────────────────────────────────────────
  protected readonly itemsResource = httpResource<ItemCuenta[]>(
    () => {
      const mesa = this.selectedMesa();
      const v = this.view();
      if (!mesa?.idCuentaActual) return undefined;
      if (v !== 'familias' && v !== 'productos' && v !== 'cuenta') return undefined;
      return `${environment.urlChatBot}/restaurant-publico/cuentas/${mesa.idCuentaActual}/items`;
    },
    { defaultValue: [] },
  );
  protected readonly items = this.itemsResource.value;
  protected readonly totalCuenta = computed(() =>
    this.items().reduce((sum, i) => sum + i.subtotal, 0),
  );

  // ── Navegación ────────────────────────────────────────────────────────────
  protected selectModule(module: RestaurantModule): void {
    if (module === 'MESAS') this.view.set('mesas');
    if (module === 'CAJAS') {
      this.cajaNombre.set('');
      this.fondoInicial.set(null);
      this.turnoActivo.set(null);
      this.turnoError.set('');
      this.view.set('cajas');
    }
    if (module === 'REPORTES') {
      this.reporteSubView.set('mesas');
      this.reporteFecha.set(new Date().toISOString().split('T')[0]);
      this.view.set('reportes');
    }
  }

  protected setCajaNombre(e: Event): void {
    this.cajaNombre.set((e.target as HTMLInputElement).value);
  }

  protected setFondoInicial(e: Event): void {
    const val = +(e.target as HTMLInputElement).value;
    this.fondoInicial.set(val >= 0 ? val : null);
  }

  protected async iniciarTurno(): Promise<void> {
    const caja = this.cajaSeleccionada();
    if (!caja) return;

    this.iniciandoTurno.set(true);
    this.turnoError.set('');
    try {
      const turno = await firstValueFrom(
        this.http.post<Turno>(
          `${environment.urlAdministration}/Restaurant/turnos`,
          {
            idCompany:      environment.companyId,
            idCashRegister: caja.idCaja,
            idBranch:       caja.idBranch,
            cajero:         this.cajaNombre().trim() || null,
            fondoInicial:   this.fondoInicial() ?? 0,
          },
        ),
      );
      this.turnoActivo.set(turno);
    } catch {
      this.turnoError.set('No se pudo iniciar el turno. Intenta de nuevo.');
    } finally {
      this.iniciandoTurno.set(false);
    }
  }

  protected backToCajas(): void {
    this.turnoActivo.set(null);
    this.cajaNombre.set('');
    this.fondoInicial.set(null);
    this.turnoError.set('');
    this.cajasSubView.set('inicio');
    this.egresosLista.set([]);
    this.corteResultado.set(null);
    this.corteResumenSnapshot.set(null);
  }

  // ── Egresos ──────────────────────────────────────────────────────────────
  protected abrirEgresos(): void {
    this.egresoDesc.set('');
    this.egresoMonto.set(null);
    this.egresoError.set('');
    this.cajasSubView.set('egresos');
  }

  protected setEgresoDesc(e: Event): void {
    this.egresoDesc.set((e.target as HTMLInputElement).value);
  }

  protected setEgresoMonto(e: Event): void {
    const val = +(e.target as HTMLInputElement).value;
    this.egresoMonto.set(val > 0 ? val : null);
  }

  protected async registrarEgreso(): Promise<void> {
    const turno = this.turnoActivo();
    const monto = this.egresoMonto();
    if (!turno || !monto) return;

    this.registrandoEgreso.set(true);
    this.egresoError.set('');
    try {
      const egreso = await firstValueFrom(
        this.http.post<EgresoCaja>(
          `${environment.urlAdministration}/Restaurant/turnos/${turno.id}/egresos`,
          { descripcion: this.egresoDesc().trim() || null, monto },
        ),
      );
      this.egresosLista.update(list => [egreso, ...list]);
      this.egresoDesc.set('');
      this.egresoMonto.set(null);
    } catch {
      this.egresoError.set('No se pudo registrar el egreso.');
    } finally {
      this.registrandoEgreso.set(false);
    }
  }

  // ── Corte ─────────────────────────────────────────────────────────────────
  protected abrirCorte(): void {
    this.efectivoContado.set(null);
    this.cerrarError.set('');
    this.corteResultado.set(null);
    this.cajasSubView.set('corte');
  }

  protected setEfectivoContado(e: Event): void {
    const val = +(e.target as HTMLInputElement).value;
    this.efectivoContado.set(val >= 0 ? val : null);
  }

  protected async cerrarTurno(): Promise<void> {
    const turno = this.turnoActivo();
    if (!turno) return;

    // Snapshot del resumen antes de cerrar (para la nota impresa)
    const snapshotResumen = this.resumenCorteResource.value();

    this.cerrandoTurno.set(true);
    this.cerrarError.set('');
    try {
      const result = await firstValueFrom(
        this.http.put<Turno>(
          `${environment.urlAdministration}/Restaurant/turnos/${turno.id}/cerrar`,
          { efectivoContado: this.efectivoContado() ?? 0, notas: null },
        ),
      );
      this.corteResultado.set(result);
      if (snapshotResumen) {
        this.corteResumenSnapshot.set({
          ...snapshotResumen,
          totales: {
            ...snapshotResumen.totales,
            efectivoEsperado: snapshotResumen.totales.efectivoEsperado,
          },
        });
      }
      this.turnoActivo.set(null);
    } catch {
      this.cerrarError.set('No se pudo cerrar el turno. Intenta de nuevo.');
    } finally {
      this.cerrandoTurno.set(false);
    }
  }

  protected imprimirCorte(): void {
    window.print();
  }

  protected imprimirReporte(): void {
    window.print();
  }

  protected loadMesas(): void { this.mesasResource.reload(); }

  protected abrirNuevaMesa(): void {
    this.nuevaMesaNombre.set('');
    this.nuevaMesaCapacidad.set(null);
    this.crearMesaError.set('');
    this.showNuevaMesa.set(true);
  }

  protected setNuevaMesaNombre(e: Event): void {
    this.nuevaMesaNombre.set((e.target as HTMLInputElement).value);
  }

  protected setNuevaMesaCapacidad(e: Event): void {
    const val = +(e.target as HTMLInputElement).value;
    this.nuevaMesaCapacidad.set(val > 0 ? val : null);
  }

  protected async crearMesa(): Promise<void> {
    const nombre = this.nuevaMesaNombre().trim();
    if (!nombre) { this.crearMesaError.set('El nombre es obligatorio.'); return; }

    this.creandoMesa.set(true);
    this.crearMesaError.set('');
    try {
      await firstValueFrom(
        this.http.post(
          `${environment.urlAdministration}/Restaurant/mesas`,
          { idCompany: environment.companyId, nombre, capacidad: this.nuevaMesaCapacidad() },
        ),
      );
      this.showNuevaMesa.set(false);
      this.mesasResource.reload();
    } catch {
      this.crearMesaError.set('No se pudo crear la mesa. Intenta de nuevo.');
    } finally {
      this.creandoMesa.set(false);
    }
  }

  protected selectMesa(mesa: Mesa): void {
    this.selectedMesa.set(mesa);
    this.mesaActionError.set('');
    if (mesa.tieneCuentaAbierta) {
      this.view.set('familias');
    } else {
      void this.openFreeMesa(mesa);
    }
  }

  private async openFreeMesa(mesa: Mesa): Promise<void> {
    this.openingMesa.set(true);
    try {
      const cuenta = await firstValueFrom(
        this.http.post<CuentaAbierta>(
          `${environment.urlChatBot}/restaurant-publico/cuentas/abrir`,
          { idCompany: environment.companyId, idMesa: mesa.id },
        ),
      );
      this.selectedMesa.set({
        ...mesa,
        tieneCuentaAbierta: true,
        idCuentaActual: cuenta.id,
        totalActual: cuenta.total,
      });
      this.view.set('familias');
    } catch {
      this.mesaActionError.set('No fue posible abrir la cuenta de esta mesa.');
    } finally {
      this.openingMesa.set(false);
    }
  }

  protected selectFamilia(familia: Familia): void {
    this.selectedSubfamilia.set(null);
    this.selectedProducto.set(null);
    this.addError.set('');
    this.selectedFamilia.set(familia);
    this.view.set('productos');
  }

  protected selectSubfamilia(sub: Familia): void {
    this.selectedSubfamilia.set(sub);
    this.selectedProducto.set(null);
    this.addError.set('');
  }

  protected selectProducto(producto: Producto): void {
    this.selectedProducto.set(producto);
    this.addError.set('');
  }

  protected cancelarProducto(): void {
    this.selectedProducto.set(null);
    this.addError.set('');
  }

  protected async agregarProducto(cantidad: number): Promise<void> {
    const producto = this.selectedProducto();
    const mesa = this.selectedMesa();
    if (!producto || !mesa?.idCuentaActual) return;

    this.agregandoItem.set(true);
    this.addError.set('');
    try {
      await firstValueFrom(
        this.http.post(
          `${environment.urlChatBot}/restaurant-publico/cuentas/${mesa.idCuentaActual}/items`,
          { idMaterial: producto.id, descripcion: producto.description, cantidad, precio: producto.price },
        ),
      );
      this.selectedProducto.set(null);
      this.itemsResource.reload();
    } catch {
      this.addError.set('No se pudo agregar el producto. Intenta de nuevo.');
    } finally {
      this.agregandoItem.set(false);
    }
  }

  protected irACuenta(): void {
    this.selectedProducto.set(null);
    this.cobroError.set('');
    this.showPayment.set(false);
    this.view.set('cuenta');
  }

  protected async eliminarItem(item: ItemCuenta): Promise<void> {
    const mesa = this.selectedMesa();
    if (!mesa?.idCuentaActual) return;
    this.eliminandoId.set(item.id);
    try {
      await firstValueFrom(
        this.http.delete(
          `${environment.urlChatBot}/restaurant-publico/cuentas/${mesa.idCuentaActual}/items/${item.id}`,
          { body: { cantidad: item.cantidad, precio: item.precioUnitario } },
        ),
      );
      this.itemsResource.reload();
    } finally {
      this.eliminandoId.set(null);
    }
  }

  // ── Pago ──────────────────────────────────────────────────────────────────
  protected setTipoPago(tipo: TipoPago): void {
    this.tipoPago.set(tipo);
    this.montoPagado.set(null);
    this.montoTarjeta.set(null);
  }

  protected setMontoPagado(e: Event): void {
    const val = +(e.target as HTMLInputElement).value;
    this.montoPagado.set(val > 0 ? val : null);
  }

  protected setMontoTarjeta(e: Event): void {
    const val = +(e.target as HTMLInputElement).value;
    this.montoTarjeta.set(val > 0 ? val : null);
  }

  protected abrirPago(): void {
    this.tipoPago.set('EFECTIVO');
    this.montoPagado.set(null);
    this.montoTarjeta.set(null);
    this.cobroError.set('');
    this.showPayment.set(true);
  }

  protected cancelarPago(): void {
    this.showPayment.set(false);
    this.cobroError.set('');
  }

  protected async confirmarCobro(): Promise<void> {
    const mesa = this.selectedMesa();
    if (!mesa?.idCuentaActual) return;

    const tipo = this.tipoPago();
    const snapshotItems = [...this.items()];
    const snapshotTotal = this.totalCuenta();
    const snapshotCambio = this.cambio();
    const efectivoPagado = tipo === 'TARJETA' ? snapshotTotal : (this.montoPagado() ?? 0);
    const tarjetaPagada = tipo === 'MIXTO' ? (this.montoTarjeta() ?? 0) : 0;

    this.cobrando.set(true);
    this.cobroError.set('');
    try {
      await firstValueFrom(
        this.http.post(
          `${environment.urlChatBot}/restaurant-publico/cuentas/${mesa.idCuentaActual}/cobrar`,
          { idCompany: environment.companyId, tipoPago: tipo },
        ),
      );

      this.ticketData.set({
        companyName: this.companyName(),
        mesaNombre: mesa.nombre,
        idCuenta: mesa.idCuentaActual,
        items: snapshotItems,
        total: snapshotTotal,
        tipoPago: tipo,
        montoPagado: efectivoPagado,
        montoTarjeta: tarjetaPagada,
        cambio: snapshotCambio,
        fecha: new Date(),
      });

      this.showPayment.set(false);
      this.ticketVisible.set(true);
    } catch {
      this.cobroError.set('No se pudo procesar el cobro. Intenta de nuevo.');
    } finally {
      this.cobrando.set(false);
    }
  }

  protected imprimirTicket(): void {
    window.print();
  }

  protected cerrarTicket(): void {
    this.ticketVisible.set(false);
    this.ticketData.set(null);
    this.backToMesas();
  }

  // ── Navegación atrás ──────────────────────────────────────────────────────
  protected backToFamilias(): void {
    this.view.set('familias');
    this.selectedFamilia.set(null);
    this.selectedSubfamilia.set(null);
    this.selectedProducto.set(null);
    this.addError.set('');
  }

  protected backToMesas(): void {
    this.view.set('mesas');
    this.selectedMesa.set(null);
    this.selectedFamilia.set(null);
    this.selectedSubfamilia.set(null);
    this.selectedProducto.set(null);
    this.showPayment.set(false);
    this.mesasResource.reload();
  }

  protected backToMenu(): void {
    this.view.set('menu');
    this.selectedMesa.set(null);
    this.selectedFamilia.set(null);
    this.selectedSubfamilia.set(null);
    this.selectedProducto.set(null);
    this.showPayment.set(false);
    this.turnoActivo.set(null);
    this.turnoError.set('');
  }
}
