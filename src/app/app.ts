import { CurrencyPipe, DatePipe } from '@angular/common';
import { HttpClient, httpResource } from '@angular/common/http';
import { Component, computed, effect, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import pdfMake from 'pdfmake/build/pdfmake';
import pdfFonts from 'pdfmake/build/vfs_fonts';

if (pdfFonts && (pdfFonts as any).pdfMake) {
  (pdfMake as any).vfs = (pdfFonts as any).pdfMake.vfs;
}

import { environment } from '../environments/environment';
import { CajaInfo, CajaReporte, EgresoCaja, ResumenCorte, Turno, VentaPorTipo } from './models/caja';
import { CuentaAbierta, Familia, ItemCuenta, Producto } from './models/familia';
import { Equivalencia, Existencia, MovimientoInv, ProductoInventario, ResultadoMovimiento, ResumenMov } from './models/inventario';
import { Mesa } from './models/mesa';
import { GrupoMesa, ReporteMesa } from './models/reporte';

type RestaurantModule = 'MESAS' | 'CAJAS' | 'REPORTES' | 'INVENTARIO';
type View = 'menu' | 'mesas' | 'familias' | 'productos' | 'cuenta' | 'cajas' | 'reportes' | 'inventario';
type Presentacion = 'COMPLETA' | 'COPA';
type InventarioSubView = 'existencias' | 'alta' | 'movimientos' | 'detalle' | 'equivalencias';
type TipoPago = 'EFECTIVO' | 'TARJETA' | 'MIXTO';

interface CompanyInfo { name: string; picture: string | null; picture2: string | null; }
interface EmpresaItem  { id: number; name: string; picture: string | null; }

const LS_EMPRESA = 'pv_empresa_id';

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

  // ── Selección de empresa ──────────────────────────────────────────────────
  protected readonly companyId   = signal<number | null>(this.resolveCompanyId());
  protected readonly selEmpresa  = signal(false);   // mostrar pantalla de selección
  protected readonly empresas    = signal<EmpresaItem[]>([]);
  protected readonly cargandoEmpresas = signal(false);

  private resolveCompanyId(): number | null {
    const param = new URLSearchParams(window.location.search).get('empresa');
    if (param) {
      const n = parseInt(param, 10);
      if (!isNaN(n)) { localStorage.setItem(LS_EMPRESA, String(n)); return n; }
    }
    const stored = localStorage.getItem(LS_EMPRESA);
    return stored ? parseInt(stored, 10) : null;
  }

  protected async cargarEmpresas(): Promise<void> {
    this.cargandoEmpresas.set(true);
    try {
      const lista = await firstValueFrom(
        this.http.get<EmpresaItem[]>(`${environment.urlSmp}/Root/lista-publica`),
      );
      this.empresas.set(lista ?? []);
    } finally {
      this.cargandoEmpresas.set(false);
    }
  }

  protected seleccionarEmpresa(e: EmpresaItem): void {
    localStorage.setItem(LS_EMPRESA, String(e.id));
    this.companyId.set(e.id);
    this.selEmpresa.set(false);
    // recargar para que todos los resources reactivos se actualicen
    window.location.replace(window.location.pathname + `?empresa=${e.id}`);
  }

  // Clave requerida para poder cambiar de empresa (evita que un usuario
  // normal salga de su propia empresa).
  private static readonly CLAVE_CAMBIO_EMPRESA = 'QAdmin9317';
  protected readonly pedirClave  = signal(false);
  protected readonly claveInput  = signal('');
  protected readonly claveError  = signal('');

  protected cambiarEmpresa(): void {
    this.claveInput.set('');
    this.claveError.set('');
    this.pedirClave.set(true);
  }

  protected cancelarClave(): void {
    this.pedirClave.set(false);
    this.claveInput.set('');
    this.claveError.set('');
  }

  protected confirmarClave(): void {
    if (this.claveInput() !== App.CLAVE_CAMBIO_EMPRESA) {
      this.claveError.set('Contraseña incorrecta.');
      return;                                        // se queda en su empresa
    }
    this.pedirClave.set(false);
    this.claveInput.set('');
    this.claveError.set('');
    this.cargarEmpresas();
    this.selEmpresa.set(true);
  }

  // ── Vista principal ────────────────────────────────────────────────────────
  protected readonly view = signal<View>('menu');
  protected readonly selectedMesa = signal<Mesa | null>(null);
  protected readonly openingMesa = signal(false);
  protected readonly mesaActionError = signal('');

  protected readonly selectedFamilia = signal<Familia | null>(null);
  protected readonly selectedSubfamilia = signal<Familia | null>(null);
  protected readonly selectedProducto = signal<Producto | null>(null);
  protected readonly agregandoItem = signal(false);
  protected readonly addError = signal('');
  // Nota / modificador del producto que se está agregando (ej. "sin cebolla").
  protected readonly prodNota = signal('');
  protected readonly notasRapidas = ['Sin cebolla', 'Sin picante', 'Bien cocido', 'Para llevar'];

  // ── Buscador de productos ──────────────────────────────────────────────────
  protected readonly prodBusqueda = signal('');

  protected readonly eliminandoId = signal<number | null>(null);

  // ── Nueva mesa ────────────────────────────────────────────────────────────
  protected readonly showNuevaMesa  = signal(false);

  // ── Editar mesa ───────────────────────────────────────────────────────────
  protected readonly editandoMesa       = signal<Mesa | null>(null);
  protected readonly editMesaNombre     = signal('');
  protected readonly editMesaCapacidad  = signal<number | null>(null);
  protected readonly guardandoMesa      = signal(false);
  protected readonly editMesaError      = signal('');
  protected readonly nuevaMesaNombre = signal('');
  protected readonly nuevaMesaCapacidad = signal<number | null>(null);
  protected readonly creandoMesa = signal(false);
  protected readonly crearMesaError = signal('');

  // ── Nuevo agrupador (familia / subfamilia) ─────────────────────────────────
  protected readonly showNuevoAgrupador   = signal(false);
  protected readonly agrupadorPaso        = signal<'inicio' | 'subfamilias'>('inicio');
  protected readonly agrupadorModo        = signal<'nueva' | 'existente'>('nueva');
  protected readonly nuevoAgrupadorNombre = signal('');
  protected readonly agrupadorFamiliaExistente = signal<number | null>(null);
  protected readonly agrupadorParent      = signal<Familia | null>(null);
  protected readonly nuevaSubfamiliaNombre = signal('');
  protected readonly subfamiliasCreadas   = signal<Familia[]>([]);
  protected readonly creandoAgrupador     = signal(false);
  protected readonly crearAgrupadorError  = signal('');

  // ── Editar agrupador (familia) ─────────────────────────────────────────────
  protected readonly showEditarFamilia    = signal(false);
  protected readonly editandoFamilia      = signal<Familia | null>(null);
  protected readonly editarFamiliaNombre  = signal('');
  protected readonly guardandoFamilia     = signal(false);
  protected readonly editarFamiliaError   = signal('');

  // ── Nuevo producto (dentro del agrupador) ──────────────────────────────────
  protected readonly showNuevoProducto  = signal(false);
  protected readonly prodIdentificador  = signal('');
  protected readonly prodDescripcion    = signal('');
  protected readonly prodPrecio         = signal<number | null>(null);
  protected readonly prodCosto          = signal<number | null>(null);
  protected readonly creandoProducto    = signal(false);
  protected readonly crearProductoError = signal('');

  // ── Editar producto ────────────────────────────────────────────────────────
  protected readonly editandoProducto     = signal<Producto | null>(null);
  protected readonly editProdDescripcion  = signal('');
  protected readonly editProdPrecioStr    = signal('');
  protected readonly editProdPrecio       = signal<number | null>(null);
  protected readonly guardandoProducto    = signal(false);
  protected readonly editProductoError    = signal('');

  // ── Cajas / Turno ─────────────────────────────────────────────────────────
  protected readonly cajasResource = httpResource<CajaInfo[]>(
    () => this.view() === 'cajas'
      ? `${environment.urlAdministration}/Restaurant/cajas/${this.companyId()!}`
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
    // Si no hay empresa guardada, carga lista y muestra selección
    if (!this.companyId()) {
      void this.cargarEmpresas();
      this.selEmpresa.set(true);
    }
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
  private efectivoContadoEl: HTMLInputElement | null = null;
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
      return `${environment.urlAdministration}/Restaurant/reportes/${this.companyId()!}/mesas?fecha=${this.reporteFecha()}`;
    },
    { defaultValue: [] },
  );

  protected readonly reporteTurnosResource = httpResource<any[]>(
    () => {
      if (this.view() !== 'reportes' || this.reporteSubView() !== 'caja') return undefined;
      return `${environment.urlAdministration}/Restaurant/reportes/${this.companyId()!}/turnos?fecha=${this.reporteFecha()}`;
    },
    { defaultValue: [] },
  );

  // Acepta tanto CajaReporte[] (nuevo backend) como Turno[] (backend viejo) y normaliza
  protected readonly reporteCajasAgrupadas = computed<CajaReporte[]>(() => {
    const raw = this.reporteTurnosResource.value();
    if (!raw.length) return [];
    // Nuevo formato: cada elemento tiene la propiedad 'turnos'
    if ('turnos' in raw[0]) return raw as CajaReporte[];
    // Formato viejo (Turno[]): agrupar por caja, ventas del primer turno de cada caja
    const mapa = new Map<number, { cajaId: number; turnos: Turno[] }>();
    for (const t of raw as Turno[]) {
      if (!mapa.has(t.idCashRegister)) mapa.set(t.idCashRegister, { cajaId: t.idCashRegister, turnos: [] });
      mapa.get(t.idCashRegister)!.turnos.push(t);
    }
    return Array.from(mapa.values()).map(({ cajaId, turnos }) => ({
      idCashRegister: cajaId,
      ventasEfectivo: turnos[0].ventasEfectivo || 0,
      ventasTarjeta:  turnos[0].ventasTarjeta  || 0,
      ventasCheque:   turnos[0].ventasCheque   || 0,
      ventasVales:    turnos[0].ventasVales     || 0,
      ventasMixto:    turnos[0].ventasMixto     || 0,
      ventasTotal:    turnos[0].ventasTotal     || 0,
      turnos,
    }));
  });

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
    this.reporteCajasAgrupadas().reduce((s, c) => s + (c.ventasTotal || 0), 0),
  );

  protected setReporteFecha(e: Event): void {
    this.reporteFecha.set((e.target as HTMLInputElement).value);
  }

  // ── Inventario ─────────────────────────────────────────────────────────────
  protected readonly inventarioSubView = signal<InventarioSubView>('existencias');
  protected readonly existenciaUnidad  = signal<'piezas' | 'onzas'>('piezas');

  private invUrl(path: string): string {
    return `${environment.urlChatBot}/restaurant-publico/inventario/${path}`;
  }

  // Existencias
  protected readonly existenciasResource = httpResource<Existencia[]>(
    () => this.view() === 'inventario' && this.inventarioSubView() === 'existencias'
      ? this.invUrl(`${this.companyId()!}/existencias`)
      : undefined,
    { defaultValue: [] },
  );
  protected readonly existencias        = this.existenciasResource.value;
  protected readonly existenciasLoading = this.existenciasResource.isLoading;
  protected readonly alertasStock = computed(() => this.existencias().filter(e => e.bajoMinimo));

  // Movimientos (historial)
  protected readonly movDesde = signal<string>(
    new Date(Date.now() - 29 * 864e5).toISOString().split('T')[0],
  );
  protected readonly movHasta = signal<string>(new Date().toISOString().split('T')[0]);
  // Resumen por producto (pestaña "Movimientos")
  protected readonly resumenResource = httpResource<ResumenMov[]>(
    () => this.view() === 'inventario' && this.inventarioSubView() === 'movimientos'
      ? this.invUrl(`${this.companyId()!}/resumen?desde=${this.movDesde()}&hasta=${this.movHasta()}`)
      : undefined,
    { defaultValue: [] },
  );
  protected readonly resumenLoading = this.resumenResource.isLoading;

  // Filas del resumen ya convertidas a la unidad elegida (piezas u onzas).
  protected readonly resumenView = computed(() => {
    const enOnzas = this.existenciaUnidad() === 'onzas';
    return this.resumenResource.value().map(r => {
      const ozPieza = r.onzasPorPieza > 0 ? r.onzasPorPieza : 1;
      const ingresos = enOnzas ? r.ingresosOnzas : r.ingresosPiezas;
      const egresos  = enOnzas ? r.egresosOnzas  : r.egresosOnzas / ozPieza;
      return { idMaterial: r.idMaterial, descripcion: r.descripcion, ingresos, egresos, total: ingresos - egresos };
    });
  });
  protected readonly resumenTotales = computed(() => {
    const rows = this.resumenView();
    return {
      ingresos: rows.reduce((s, r) => s + r.ingresos, 0),
      egresos:  rows.reduce((s, r) => s + r.egresos, 0),
      total:    rows.reduce((s, r) => s + r.total, 0),
    };
  });

  // Detalle línea por línea (pestaña "Detalle") con búsqueda por producto
  protected readonly movDetalleBusqueda = signal('');
  protected setMovBusqueda(e: Event): void { this.movDetalleBusqueda.set((e.target as HTMLInputElement).value); }
  protected readonly movimientosResource = httpResource<MovimientoInv[]>(
    () => this.view() === 'inventario' && this.inventarioSubView() === 'detalle'
      ? this.invUrl(`${this.companyId()!}/movimientos?desde=${this.movDesde()}&hasta=${this.movHasta()}`)
      : undefined,
    { defaultValue: [] },
  );
  protected readonly movimientosLoading = this.movimientosResource.isLoading;
  protected readonly movimientos = computed(() => {
    const term = this.movDetalleBusqueda().trim().toLowerCase();
    const all = this.movimientosResource.value();
    return term ? all.filter(m => m.descripcion.toLowerCase().includes(term)) : all;
  });
  protected setMovDesde(e: Event): void { this.movDesde.set((e.target as HTMLInputElement).value); }
  protected setMovHasta(e: Event): void { this.movHasta.set((e.target as HTMLInputElement).value); }

  // Catálogo de equivalencias (se usa en inventario y al configurar producto)
  protected readonly equivalenciasResource = httpResource<Equivalencia[]>(
    () => {
      const sub = this.inventarioSubView();
      const enInventario = this.view() === 'inventario' && (sub === 'equivalencias' || sub === 'alta');
      const configurando = this.editandoProducto() !== null;
      return enInventario || configurando
        ? this.invUrl(`equivalencias/${this.companyId()!}`)
        : undefined;
    },
    { defaultValue: [] },
  );
  protected readonly equivalencias = this.equivalenciasResource.value;

  protected readonly equivNombre = signal('');
  protected readonly equivOnzas  = signal<number | null>(null);
  protected readonly guardandoEquiv = signal(false);
  protected readonly equivError = signal('');
  protected setEquivNombre(e: Event): void { this.equivNombre.set((e.target as HTMLInputElement).value); }
  protected setEquivOnzas(e: Event): void {
    const v = parseFloat((e.target as HTMLInputElement).value);
    this.equivOnzas.set(!isNaN(v) && v > 0 ? v : null);
  }

  protected async crearEquivalencia(): Promise<void> {
    const nombre = this.equivNombre().trim();
    const onzas  = this.equivOnzas();
    if (!nombre) { this.equivError.set('El nombre es obligatorio.'); return; }
    if (onzas === null) { this.equivError.set('Las onzas deben ser mayores a cero.'); return; }
    this.guardandoEquiv.set(true);
    this.equivError.set('');
    try {
      await firstValueFrom(this.http.post<Equivalencia>(
        this.invUrl('equivalencias'),
        { idCompany: this.companyId()!, nombre, onzas },
      ));
      this.equivNombre.set('');
      this.equivOnzas.set(null);
      this.equivalenciasResource.reload();
    } catch {
      this.equivError.set('No se pudo crear la equivalencia.');
    } finally {
      this.guardandoEquiv.set(false);
    }
  }

  protected async eliminarEquivalencia(eq: Equivalencia): Promise<void> {
    try {
      await firstValueFrom(this.http.delete(
        this.invUrl(`equivalencias/${eq.id}?idCompany=${this.companyId()!}`),
      ));
      this.equivalenciasResource.reload();
    } catch { /* noop */ }
  }

  // Ingreso de existencias (siempre en piezas), inline por producto.
  protected readonly ingresoActivoId  = signal<number | null>(null);
  protected readonly ingresoPiezas    = signal<number | null>(null);
  protected readonly registrandoIngreso = signal(false);
  protected readonly ingresoError     = signal('');
  protected readonly ingresoOk        = signal('');

  protected iniciarIngreso(mat: Existencia): void {
    this.ingresoActivoId.set(mat.idMaterial);
    this.ingresoPiezas.set(null);
    this.ingresoError.set('');
    this.ingresoOk.set('');
  }
  protected cancelarIngreso(): void {
    this.ingresoActivoId.set(null);
    this.ingresoPiezas.set(null);
    this.ingresoError.set('');
  }
  protected setIngresoPiezas(e: Event): void {
    const v = parseFloat((e.target as HTMLInputElement).value);
    this.ingresoPiezas.set(!isNaN(v) && v > 0 ? v : null);
  }

  protected async registrarIngreso(mat: Existencia): Promise<void> {
    const piezas = this.ingresoPiezas();
    if (piezas === null) { this.ingresoError.set('Indica las piezas a ingresar.'); return; }
    this.registrandoIngreso.set(true);
    this.ingresoError.set('');
    try {
      await firstValueFrom(this.http.post<ResultadoMovimiento>(
        this.invUrl('ingreso'),
        { idCompany: this.companyId()!, idMaterial: mat.idMaterial, piezas },
      ));
      this.ingresoActivoId.set(null);
      this.ingresoPiezas.set(null);
      this.ingresoOk.set(`Ingreso registrado: +${piezas} pieza(s) de ${mat.descripcion}.`);
      this.existenciasResource.reload();
    } catch {
      this.ingresoError.set('No se pudo registrar el ingreso.');
    } finally {
      this.registrandoIngreso.set(false);
    }
  }

  // ── Configuración de inventario del producto (en modal de editar) ───────────
  protected readonly cfgControla   = signal(false);
  protected readonly cfgVendeCopa  = signal(false);
  protected readonly cfgIdEquiv    = signal<number | null>(null);
  protected readonly cfgPrecioCopa = signal<number | null>(null);
  protected readonly cfgStockMin   = signal<number | null>(null);

  protected setCfgControla(e: Event): void { this.cfgControla.set((e.target as HTMLInputElement).checked); }
  protected setCfgVendeCopa(e: Event): void { this.cfgVendeCopa.set((e.target as HTMLInputElement).checked); }
  protected setCfgIdEquiv(e: Event): void {
    const v = (e.target as HTMLSelectElement).value;
    this.cfgIdEquiv.set(v ? +v : null);
  }
  protected setCfgPrecioCopa(e: Event): void {
    const v = parseFloat((e.target as HTMLInputElement).value);
    this.cfgPrecioCopa.set(!isNaN(v) && v >= 0 ? v : null);
  }
  protected setCfgStockMin(e: Event): void {
    const v = parseInt((e.target as HTMLInputElement).value, 10);
    this.cfgStockMin.set(!isNaN(v) && v >= 0 ? v : null);
  }

  private async cargarConfigProducto(idMaterial: number): Promise<void> {
    this.cfgControla.set(false);
    this.cfgVendeCopa.set(false);
    this.cfgIdEquiv.set(null);
    this.cfgPrecioCopa.set(null);
    this.cfgStockMin.set(null);
    try {
      const cfg = await firstValueFrom(this.http.get<ProductoInventario | null>(
        this.invUrl(`${this.companyId()!}/producto/${idMaterial}`),
      ));
      if (cfg) {
        this.cfgControla.set(cfg.controlaInventario);
        this.cfgVendeCopa.set(cfg.vendePorCopa);
        this.cfgIdEquiv.set(cfg.idEquivalencia);
        this.cfgPrecioCopa.set(cfg.precioCopa);
        this.cfgStockMin.set(cfg.stockMinPiezas || null);
      }
    } catch { /* sin config previa */ }
  }

  private async guardarConfigProducto(idMaterial: number): Promise<void> {
    await firstValueFrom(this.http.put(
      this.invUrl('producto'),
      {
        idCompany:      this.companyId()!,
        idMaterial,
        controlaInventario: this.cfgControla(),
        vendePorCopa:   this.cfgVendeCopa(),
        idEquivalencia: this.cfgVendeCopa() ? this.cfgIdEquiv() : null,
        onzasPorCopa:   1,
        precioCopa:     this.cfgVendeCopa() ? this.cfgPrecioCopa() : null,
        stockMinPiezas: this.cfgStockMin() ?? 0,
      },
    ));
  }

  // ── Venta: presentación completa / copa ─────────────────────────────────────
  protected readonly prodInvVenta   = signal<ProductoInventario | null>(null);
  protected readonly presentacionSel = signal<Presentacion>('COMPLETA');

  protected readonly precioVentaActual = computed(() => {
    const prod = this.selectedProducto();
    if (!prod) return 0;
    const cfg = this.prodInvVenta();
    if (cfg?.vendePorCopa && this.presentacionSel() === 'COPA' && cfg.precioCopa != null)
      return cfg.precioCopa;
    return prod.price;
  });

  protected seleccionarPresentacion(p: Presentacion): void { this.presentacionSel.set(p); }

  private async cargarConfigVenta(idMaterial: number): Promise<void> {
    this.prodInvVenta.set(null);
    this.presentacionSel.set('COMPLETA');
    try {
      const cfg = await firstValueFrom(this.http.get<ProductoInventario | null>(
        this.invUrl(`${this.companyId()!}/producto/${idMaterial}`),
      ));
      this.prodInvVenta.set(cfg);
    } catch { /* producto sin inventario */ }
  }

  // ── Alta / inicio de inventario para cualquier producto ─────────────────────
  protected readonly altaBusqueda  = signal('');
  protected readonly altaProducto  = signal<Producto | null>(null);
  protected readonly altaPiezas    = signal<number | null>(null);
  protected readonly guardandoAlta = signal(false);
  protected readonly altaError     = signal('');

  protected readonly altaBusquedaResource = httpResource<Producto[]>(
    () => {
      const term = this.altaBusqueda().trim();
      if (this.view() !== 'inventario' || this.inventarioSubView() !== 'alta' || term.length < 2) return undefined;
      return `${environment.urlChatBot}/restaurant-publico/productos/${this.companyId()!}/buscar?term=${encodeURIComponent(term)}`;
    },
    { defaultValue: [] },
  );
  protected setAltaBusqueda(e: Event): void { this.altaBusqueda.set((e.target as HTMLInputElement).value); }

  protected async seleccionarAltaProducto(p: Producto): Promise<void> {
    this.altaProducto.set(p);
    this.altaBusqueda.set('');
    this.altaPiezas.set(null);
    this.altaError.set('');
    await this.cargarConfigProducto(p.id);  // precarga cfg* si ya tenía configuración
    this.cfgControla.set(true);             // al dar de alta siempre se controla
  }

  protected cancelarAlta(): void {
    this.altaProducto.set(null);
    this.altaPiezas.set(null);
    this.altaError.set('');
  }
  protected setAltaPiezas(e: Event): void {
    const v = parseFloat((e.target as HTMLInputElement).value);
    this.altaPiezas.set(!isNaN(v) && v > 0 ? v : null);
  }

  protected async guardarAlta(): Promise<void> {
    const prod = this.altaProducto();
    if (!prod) return;
    if (this.cfgVendeCopa() && this.cfgIdEquiv() === null) {
      this.altaError.set('Selecciona la equivalencia (onzas por pieza).');
      return;
    }
    this.guardandoAlta.set(true);
    this.altaError.set('');
    try {
      await this.guardarConfigProducto(prod.id);   // crea/actualiza la config (controla = true)
      const piezas = this.altaPiezas();
      if (piezas && piezas > 0) {
        await firstValueFrom(this.http.post<ResultadoMovimiento>(
          this.invUrl('ingreso'),
          { idCompany: this.companyId()!, idMaterial: prod.id, piezas },
        ));
      }
      this.ingresoOk.set(`${prod.description}: inventario dado de alta${piezas ? ` (+${piezas} pza)` : ''}.`);
      this.altaProducto.set(null);
      this.altaPiezas.set(null);
      this.inventarioSubView.set('existencias');
      this.existenciasResource.reload();
    } catch {
      this.altaError.set('No se pudo dar de alta el inventario. Intenta de nuevo.');
    } finally {
      this.guardandoAlta.set(false);
    }
  }

  // ── Pago ──────────────────────────────────────────────────────────────────
  protected readonly showPayment = signal(false);
  protected readonly tipoPago = signal<TipoPago>('EFECTIVO');
  protected readonly montoPagado  = signal<number | null>(null);
  protected readonly montoTarjeta = signal<number | null>(null);
  private montoPagadoEl:  HTMLInputElement | null = null;
  private montoTarjetaEl: HTMLInputElement | null = null;
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

  // El pago cubre la cuenta: efectivo (o efectivo+tarjeta en mixto) >= total.
  // Tarjeta exacta siempre alcanza. Evita confirmar con el monto vacío/insuficiente.
  protected readonly pagoSuficiente = computed(() => {
    const total = this.totalCuenta();
    const tipo = this.tipoPago();
    if (tipo === 'TARJETA') return true;
    const efectivo = this.montoPagado() ?? 0;
    if (tipo === 'EFECTIVO') return efectivo >= total;
    const tarjeta = this.montoTarjeta() ?? 0;
    return (efectivo + tarjeta) >= total;
  });

  // ── Ticket ────────────────────────────────────────────────────────────────
  protected readonly ticketData = signal<TicketData | null>(null);
  protected readonly ticketVisible = signal(false);

  // ── Empresa ───────────────────────────────────────────────────────────────
  protected readonly companyResource = httpResource<CompanyInfo>(
    () => this.companyId()
      ? `${environment.urlSmp}/Root/${this.companyId()}/pdf-info`
      : undefined,
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
      ? `${environment.urlAdministration}/Restaurant/mesas/${this.companyId()!}`
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
      ? `${environment.urlChatBot}/restaurant-publico/familias/${this.companyId()!}`
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
      return `${environment.urlChatBot}/restaurant-publico/subfamilias/${this.companyId()!}/${fam.id}`;
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
        return `${environment.urlChatBot}/restaurant-publico/productos/${this.companyId()!}/subfamilia/${sub.id}`;
      }
      if (!this.mostrarSubfamilias()) {
        return `${environment.urlChatBot}/restaurant-publico/productos/${this.companyId()!}/familia/${fam.id}`;
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

  // Búsqueda global en el catálogo (activa con 2+ caracteres).
  protected readonly buscando = computed(() => this.prodBusqueda().trim().length >= 2);
  protected readonly busquedaResource = httpResource<Producto[]>(
    () => {
      if (this.view() !== 'productos') return undefined;
      const term = this.prodBusqueda().trim();
      if (term.length < 2) return undefined;
      return `${environment.urlChatBot}/restaurant-publico/productos/${this.companyId()!}/buscar?term=${encodeURIComponent(term)}`;
    },
    { defaultValue: [] },
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

  // ── Dividir cuenta (partes iguales) ────────────────────────────────────────
  protected readonly dividirEntre = signal(1);
  protected readonly montoPorPersona = computed(() => {
    const n = this.dividirEntre();
    return n > 1 ? this.totalCuenta() / n : 0;
  });
  protected masComensales(): void { this.dividirEntre.update(n => Math.min(20, n + 1)); }
  protected menosComensales(): void { this.dividirEntre.update(n => Math.max(1, n - 1)); }

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
    if (module === 'INVENTARIO') {
      this.inventarioSubView.set('existencias');
      this.view.set('inventario');
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
            idCompany:      this.companyId()!,
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
    this.efectivoContadoEl = null;
    this.cerrarError.set('');
    this.corteResultado.set(null);
    this.cajasSubView.set('corte');
  }

  protected setEfectivoContado(e: Event): void {
    const input = e.target as HTMLInputElement;
    this.efectivoContadoEl = input;
    const str = input.value.trim();
    if (str.endsWith('.')) return; // punto sin decimales aún — no actualizar
    const val = parseFloat(str);
    this.efectivoContado.set(!isNaN(val) && val >= 0 ? val : null);
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

  private async logoToDataUrl(): Promise<string | null> {
    const url = this.companyLogo();
    if (!url) return null;
    if (url.startsWith('data:')) return url;
    try {
      const res = await fetch(url);
      const blob = await res.blob();
      return await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      });
    } catch { return null; }
  }

  protected async imprimirCorte(): Promise<void> {
    const corte = this.corteResumenSnapshot();
    if (!corte) return;

    const t = corte.turno;
    const logo = await this.logoToDataUrl();
    const docDef: any = {
      pageSize: 'A4',
      pageMargins: [20, 20, 20, 20],
      content: [
        ...(logo ? [{ image: logo, width: 60, height: 60, alignment: 'center', margin: [0, 0, 0, 8] }] : []),
        { text: this.companyName(), alignment: 'center', fontSize: 16, bold: true, margin: [0, 0, 0, 4] },
        { text: 'Corte de Caja', alignment: 'center', fontSize: 14, bold: true, margin: [0, 0, 0, 12] },
        {
          table: {
            widths: ['*', '*'],
            body: [
              [{ text: 'Caja:', fontSize: 10, bold: true }, { text: t.idCashRegister, fontSize: 10 }],
              [{ text: 'Cajero:', fontSize: 10, bold: true }, { text: t.cajero || 'N/A', fontSize: 10 }],
              [{ text: 'Fecha Inicio:', fontSize: 10, bold: true }, { text: new Date(t.fechaInicio).toLocaleString('es-MX'), fontSize: 10 }],
              [{ text: 'Fecha Cierre:', fontSize: 10, bold: true }, { text: t.fechaCierre ? new Date(t.fechaCierre).toLocaleString('es-MX') : 'Abierto', fontSize: 10 }]
            ]
          },
          margin: [0, 0, 0, 16]
        },
        { text: 'Resumen de Ventas', fontSize: 12, bold: true, margin: [0, 0, 0, 8] },
        {
          table: {
            widths: ['*', 80, 80],
            body: [
              [{ text: 'Tipo Pago', bold: true, fontSize: 10 }, { text: 'Cantidad', bold: true, fontSize: 10, alignment: 'center' }, { text: 'Total', bold: true, fontSize: 10, alignment: 'right' }],
              ...corte.ventas.map((v: VentaPorTipo) => [
                { text: v.paymentType, fontSize: 10 },
                { text: String(v.numVentas), fontSize: 10, alignment: 'center' },
                { text: `$${v.total.toFixed(2)}`, fontSize: 10, alignment: 'right' }
              ]),
              [{ text: 'TOTAL VENTAS', bold: true, fontSize: 10 }, { text: '', fontSize: 10 }, { text: `$${corte.totales.totalVentas.toFixed(2)}`, bold: true, fontSize: 10, alignment: 'right' }]
            ]
          },
          margin: [0, 0, 0, 16]
        },
        ...(corte.egresos.length > 0 ? [
          { text: 'Egresos', fontSize: 12, bold: true, margin: [0, 0, 0, 8] },
          {
            table: {
              widths: ['*', '*', 80],
              body: [
                [{ text: 'Tipo', bold: true, fontSize: 10 }, { text: 'Descripción', bold: true, fontSize: 10 }, { text: 'Monto', bold: true, fontSize: 10, alignment: 'right' }],
                ...corte.egresos.map((e: EgresoCaja) => [
                  { text: e.tipo, fontSize: 9 },
                  { text: e.descripcion || '—', fontSize: 9 },
                  { text: `$${e.monto.toFixed(2)}`, fontSize: 9, alignment: 'right' }
                ]),
                [{ text: 'TOTAL EGRESOS', bold: true, fontSize: 10 }, { text: '', fontSize: 10 }, { text: `$${corte.totales.totalEgresos.toFixed(2)}`, bold: true, fontSize: 10, alignment: 'right' }]
              ]
            },
            margin: [0, 0, 0, 16]
          }
        ] : []),
        { text: '═'.repeat(60), margin: [0, 0, 0, 8] },
        {
          table: {
            widths: ['*', 120],
            body: [
              [{ text: 'Fondo Inicial:', fontSize: 11, bold: true }, { text: `$${t.fondoInicial.toFixed(2)}`, fontSize: 11, alignment: 'right' }],
              [{ text: 'Total Ventas:', fontSize: 11, bold: true }, { text: `$${corte.totales.totalVentas.toFixed(2)}`, fontSize: 11, alignment: 'right' }],
              [{ text: 'Total Egresos:', fontSize: 11, bold: true }, { text: `$${corte.totales.totalEgresos.toFixed(2)}`, fontSize: 11, alignment: 'right' }],
              [{ text: 'ESPERADO:', fontSize: 11, bold: true }, { text: `$${corte.totales.efectivoEsperado.toFixed(2)}`, fontSize: 11, alignment: 'right', color: '#147a4b', bold: true }],
              [{ text: 'CONTADO:', fontSize: 11, bold: true }, { text: `$${(t.efectivoContado ?? 0).toFixed(2)}`, fontSize: 11, alignment: 'right', color: t.diferencia === 0 ? '#147a4b' : '#c0392b', bold: true }],
              [{ text: 'DIFERENCIA:', fontSize: 11, bold: true }, { text: `$${(t.diferencia ?? 0).toFixed(2)}`, fontSize: 11, alignment: 'right', color: t.diferencia === 0 ? '#147a4b' : '#c0392b', bold: true }]
            ]
          }
        }
      ]
    };

    pdfMake.createPdf(docDef).open();
  }

  protected async imprimirReporte(): Promise<void> {
    const fecha = this.reporteFecha();
    const subView = this.reporteSubView();

    const logo = await this.logoToDataUrl();

    if (subView === 'mesas') {
      const grupos = this.mesasPorGrupo();
      const docDef: any = {
        pageSize: 'A4',
        pageMargins: [20, 20, 20, 20],
        content: [
          ...(logo ? [{ image: logo, width: 60, height: 60, alignment: 'center', margin: [0, 0, 0, 12] }] : []),
          { text: this.companyName(), alignment: 'center', fontSize: 16, bold: true, margin: [0, 0, 0, 4] },
          { text: 'Reporte de Mesas', alignment: 'center', fontSize: 14, bold: true, margin: [0, 0, 0, 2] },
          { text: `Fecha: ${new Date(fecha).toLocaleDateString('es-MX')}`, alignment: 'center', fontSize: 10, color: '#666', margin: [0, 0, 0, 16] },
          ...grupos.flatMap(g => [
            { text: `Mesa: ${g.nombreMesa}`, fontSize: 12, bold: true, margin: [0, 12, 0, 8], color: '#147a4b' },
            {
              table: {
                widths: ['*', 60, 60, 80],
                body: [
                  [{ text: 'Descripción', bold: true, fontSize: 9 }, { text: 'Qty', bold: true, fontSize: 9, alignment: 'center' }, { text: 'Unitario', bold: true, fontSize: 9, alignment: 'right' }, { text: 'Subtotal', bold: true, fontSize: 9, alignment: 'right' }],
                  ...g.cuentas.flatMap(c => c.items.map(item => [
                    { text: item.descripcion ?? 'Item', fontSize: 9 },
                    { text: String(item.cantidad), fontSize: 9, alignment: 'center' },
                    { text: `$${item.precioUnitario.toFixed(2)}`, fontSize: 9, alignment: 'right' },
                    { text: `$${item.subtotal.toFixed(2)}`, fontSize: 9, alignment: 'right' }
                  ])),
                  [{ text: `Subtotal mesa: $${g.subtotal.toFixed(2)}`, colSpan: 4, bold: true, fontSize: 10, alignment: 'right' }]
                ]
              },
              margin: [0, 0, 0, 8]
            }
          ]),
          { text: '─'.repeat(80), margin: [0, 12, 0, 8] },
          {
            table: {
              widths: ['*', 120],
              body: [
                [{ text: 'TOTAL GENERAL:', bold: true, fontSize: 12 }, { text: `$${this.totalReporteMesas().toFixed(2)}`, bold: true, fontSize: 12, alignment: 'right', color: '#147a4b' }]
              ]
            }
          }
        ]
      };
      pdfMake.createPdf(docDef).open();
    } else {
      const cajas = this.reporteCajasAgrupadas();
      const fmt   = (n: number) => `$${n.toFixed(2)}`;
      const hora  = (d: string) => new Date(d).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' });
      const docDef: any = {
        pageSize: 'A4',
        pageMargins: [20, 20, 20, 20],
        content: [
          ...(logo ? [{ image: logo, width: 60, height: 60, alignment: 'center', margin: [0, 0, 0, 12] }] : []),
          { text: this.companyName(), alignment: 'center', fontSize: 16, bold: true, margin: [0, 0, 0, 4] },
          { text: 'Reporte de Caja', alignment: 'center', fontSize: 14, bold: true, margin: [0, 0, 0, 2] },
          { text: `Fecha: ${new Date(fecha).toLocaleDateString('es-MX')}`, alignment: 'center', fontSize: 10, color: '#666', margin: [0, 0, 0, 16] },
          ...cajas.flatMap((caja: CajaReporte) => [
            { text: `Caja ${caja.idCashRegister}`, fontSize: 11, bold: true, color: '#147a4b', margin: [0, 8, 0, 4] },
            {
              table: {
                widths: ['*', 100],
                body: [
                  [{ text: 'Tipo de Venta', bold: true, fontSize: 9 }, { text: 'Monto', bold: true, fontSize: 9, alignment: 'right' }],
                  ...(caja.ventasEfectivo > 0 ? [[{ text: 'Efectivo', fontSize: 9 }, { text: fmt(caja.ventasEfectivo), fontSize: 9, alignment: 'right' }]] : []),
                  ...(caja.ventasTarjeta > 0  ? [[{ text: 'Tarjeta',  fontSize: 9 }, { text: fmt(caja.ventasTarjeta),  fontSize: 9, alignment: 'right' }]] : []),
                  ...(caja.ventasCheque > 0   ? [[{ text: 'Cheque',   fontSize: 9 }, { text: fmt(caja.ventasCheque),   fontSize: 9, alignment: 'right' }]] : []),
                  ...(caja.ventasVales > 0    ? [[{ text: 'Vales',    fontSize: 9 }, { text: fmt(caja.ventasVales),    fontSize: 9, alignment: 'right' }]] : []),
                  ...(caja.ventasMixto > 0    ? [[{ text: 'Mixto',    fontSize: 9 }, { text: fmt(caja.ventasMixto),    fontSize: 9, alignment: 'right' }]] : []),
                  [{ text: 'TOTAL CAJA:', bold: true, fontSize: 10 }, { text: fmt(caja.ventasTotal), bold: true, fontSize: 10, alignment: 'right', color: '#147a4b' }]
                ]
              },
              margin: [0, 0, 0, 6]
            },
            { text: 'Turnos del día:', fontSize: 9, bold: true, margin: [0, 4, 0, 2] },
            {
              table: {
                widths: [30, '*', 45, 45, 70],
                body: [
                  [
                    { text: '#',       bold: true, fontSize: 8 },
                    { text: 'Cajero',  bold: true, fontSize: 8 },
                    { text: 'Apertura',bold: true, fontSize: 8, alignment: 'center' },
                    { text: 'Cierre',  bold: true, fontSize: 8, alignment: 'center' },
                    { text: 'Fondo',   bold: true, fontSize: 8, alignment: 'right' }
                  ],
                  ...caja.turnos.map((t: Turno) => [
                    { text: String(t.id), fontSize: 8 },
                    { text: t.cajero || '—', fontSize: 8 },
                    { text: hora(t.fechaInicio), fontSize: 8, alignment: 'center' },
                    { text: t.fechaCierre ? hora(t.fechaCierre) : 'Abierto', fontSize: 8, alignment: 'center' },
                    { text: fmt(t.fondoInicial), fontSize: 8, alignment: 'right' }
                  ])
                ]
              },
              margin: [0, 0, 0, 16]
            }
          ]),
          { text: '═'.repeat(60), margin: [0, 4, 0, 8] },
          {
            table: {
              widths: ['*', 120],
              body: [
                [{ text: 'TOTAL GENERAL DEL DÍA:', bold: true, fontSize: 11 }, { text: fmt(this.totalReporteCaja()), bold: true, fontSize: 11, alignment: 'right', color: '#147a4b' }]
              ]
            }
          }
        ]
      };
      pdfMake.createPdf(docDef).open();
    }
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
          { idCompany: this.companyId()!, nombre, capacidad: this.nuevaMesaCapacidad() },
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

  // ── Nuevo agrupador (familia / subfamilia) ─────────────────────────────────
  protected abrirNuevaFamilia(): void {
    this.agrupadorPaso.set('inicio');
    this.agrupadorModo.set('nueva');
    this.nuevoAgrupadorNombre.set('');
    this.agrupadorFamiliaExistente.set(null);
    this.agrupadorParent.set(null);
    this.nuevaSubfamiliaNombre.set('');
    this.subfamiliasCreadas.set([]);
    this.crearAgrupadorError.set('');
    this.showNuevoAgrupador.set(true);
  }

  protected abrirNuevaSubfamilia(): void {
    const fam = this.selectedFamilia();
    if (!fam) return;
    this.agrupadorPaso.set('subfamilias');
    this.agrupadorParent.set(fam);
    this.nuevaSubfamiliaNombre.set('');
    this.subfamiliasCreadas.set([]);
    this.crearAgrupadorError.set('');
    this.showNuevoAgrupador.set(true);
  }

  protected setAgrupadorModo(modo: 'nueva' | 'existente'): void {
    this.agrupadorModo.set(modo);
    this.crearAgrupadorError.set('');
  }

  protected setNuevoAgrupadorNombre(e: Event): void {
    this.nuevoAgrupadorNombre.set((e.target as HTMLInputElement).value);
  }

  protected setAgrupadorFamiliaExistente(e: Event): void {
    const val = (e.target as HTMLSelectElement).value;
    this.agrupadorFamiliaExistente.set(val ? +val : null);
  }

  protected setNuevaSubfamiliaNombre(e: Event): void {
    this.nuevaSubfamiliaNombre.set((e.target as HTMLInputElement).value);
  }

  // Paso 1: crear familia nueva o elegir una existente; luego pasa a subagrupadores.
  protected async continuarAgrupador(): Promise<void> {
    if (this.agrupadorModo() === 'existente') {
      const id  = this.agrupadorFamiliaExistente();
      const fam = this.familias().find(f => f.id === id) ?? null;
      if (!fam) { this.crearAgrupadorError.set('Selecciona una familia.'); return; }
      this.agrupadorParent.set(fam);
      this.crearAgrupadorError.set('');
      this.agrupadorPaso.set('subfamilias');
      return;
    }

    const nombre = this.nuevoAgrupadorNombre().trim();
    if (!nombre) { this.crearAgrupadorError.set('El nombre es obligatorio.'); return; }

    this.creandoAgrupador.set(true);
    this.crearAgrupadorError.set('');
    try {
      const fam = await firstValueFrom(
        this.http.post<Familia>(
          `${environment.urlChatBot}/restaurant-publico/familias`,
          { idCompany: this.companyId()!, description: nombre },
        ),
      );
      this.agrupadorParent.set(fam);
      this.familiasResource.reload();
      // Paso 2: preguntar si la familia tiene subagrupadores (subfamilias).
      this.agrupadorPaso.set('subfamilias');
    } catch {
      this.crearAgrupadorError.set('No se pudo crear el agrupador. Intenta de nuevo.');
    } finally {
      this.creandoAgrupador.set(false);
    }
  }

  protected async agregarSubfamilia(): Promise<void> {
    const parent = this.agrupadorParent();
    const nombre = this.nuevaSubfamiliaNombre().trim();
    if (!parent) return;
    if (!nombre) { this.crearAgrupadorError.set('El nombre es obligatorio.'); return; }

    this.creandoAgrupador.set(true);
    this.crearAgrupadorError.set('');
    try {
      const sub = await firstValueFrom(
        this.http.post<Familia>(
          `${environment.urlChatBot}/restaurant-publico/subfamilias`,
          { idCompany: this.companyId()!, idFamilia: parent.id, description: nombre },
        ),
      );
      this.subfamiliasCreadas.update(list => [...list, sub]);
      this.nuevaSubfamiliaNombre.set('');
      this.subfamiliasResource.reload();
    } catch {
      this.crearAgrupadorError.set('No se pudo crear el subagrupador. Intenta de nuevo.');
    } finally {
      this.creandoAgrupador.set(false);
    }
  }

  protected cerrarNuevoAgrupador(): void {
    this.showNuevoAgrupador.set(false);
    this.crearAgrupadorError.set('');
    this.familiasResource.reload();
    this.subfamiliasResource.reload();
  }

  // ── Editar agrupador (familia) ─────────────────────────────────────────────
  protected abrirEditarFamilia(familia: Familia): void {
    this.editandoFamilia.set(familia);
    this.editarFamiliaNombre.set(familia.description);
    this.editarFamiliaError.set('');
    this.showEditarFamilia.set(true);
  }

  protected setEditarFamiliaNombre(e: Event): void {
    this.editarFamiliaNombre.set((e.target as HTMLInputElement).value);
  }

  protected async guardarEditarFamilia(): Promise<void> {
    const familia = this.editandoFamilia();
    const nombre  = this.editarFamiliaNombre().trim();
    if (!familia) return;
    if (!nombre) { this.editarFamiliaError.set('El nombre es obligatorio.'); return; }

    this.guardandoFamilia.set(true);
    this.editarFamiliaError.set('');
    try {
      await firstValueFrom(
        this.http.put<Familia>(
          `${environment.urlChatBot}/restaurant-publico/familias/${familia.id}`,
          { idCompany: this.companyId()!, description: nombre },
        ),
      );
      // Refleja el nombre nuevo si la familia editada está seleccionada.
      if (this.selectedFamilia()?.id === familia.id) {
        this.selectedFamilia.set({ ...familia, description: nombre });
      }
      this.familiasResource.reload();
      this.showEditarFamilia.set(false);
    } catch {
      this.editarFamiliaError.set('No se pudo editar el agrupador. Intenta de nuevo.');
    } finally {
      this.guardandoFamilia.set(false);
    }
  }

  // ── Nuevo producto (dentro del agrupador) ──────────────────────────────────
  protected abrirNuevoProducto(): void {
    this.prodIdentificador.set('');
    this.prodDescripcion.set('');
    this.prodPrecio.set(null);
    this.prodCosto.set(null);
    this.crearProductoError.set('');
    this.showNuevoProducto.set(true);
  }

  protected setProdIdentificador(e: Event): void {
    this.prodIdentificador.set((e.target as HTMLInputElement).value);
  }

  protected setProdDescripcion(e: Event): void {
    this.prodDescripcion.set((e.target as HTMLInputElement).value);
  }

  protected setProdPrecio(e: Event): void {
    const str = (e.target as HTMLInputElement).value.trim();
    if (str.endsWith('.')) return; // punto sin decimales — no actualizar
    const val = parseFloat(str);
    this.prodPrecio.set(!isNaN(val) && val >= 0 ? val : null);
  }

  protected setProdCosto(e: Event): void {
    const str = (e.target as HTMLInputElement).value.trim();
    if (str.endsWith('.')) return;
    const val = parseFloat(str);
    this.prodCosto.set(!isNaN(val) && val >= 0 ? val : null);
  }

  protected async crearProducto(): Promise<void> {
    const fam    = this.selectedFamilia();
    const desc   = this.prodDescripcion().trim();
    const precio = this.prodPrecio();
    if (!fam) return;
    if (!desc) { this.crearProductoError.set('La descripción es obligatoria.'); return; }
    if (precio === null) { this.crearProductoError.set('El precio de venta es obligatorio.'); return; }

    this.creandoProducto.set(true);
    this.crearProductoError.set('');
    try {
      await firstValueFrom(
        this.http.post<Producto>(
          `${environment.urlChatBot}/restaurant-publico/productos`,
          {
            idCompany:     this.companyId()!,
            idFamilia:     fam.id,
            idSubfamilia:  this.selectedSubfamilia()?.id ?? null,
            identificador: this.prodIdentificador().trim() || null,
            description:   desc,
            ventaMN:       precio,
            costoMN:       this.prodCosto(),
          },
        ),
      );
      this.showNuevoProducto.set(false);
      this.productosResource.reload();
    } catch {
      this.crearProductoError.set('No se pudo crear el producto. Intenta de nuevo.');
    } finally {
      this.creandoProducto.set(false);
    }
  }

  // ── Editar producto (descripción y precio) ─────────────────────────────────
  protected abrirEditProducto(prod: Producto, e: Event): void {
    e.stopPropagation();
    this.editProdDescripcion.set(prod.description);
    this.editProdPrecioStr.set(prod.price != null ? String(prod.price) : '');
    this.editProdPrecio.set(prod.price ?? null);
    this.editProductoError.set('');
    this.editandoProducto.set(prod);
    void this.cargarConfigProducto(prod.id);
  }

  protected setEditProdDescripcion(e: Event): void {
    this.editProdDescripcion.set((e.target as HTMLInputElement).value);
  }

  protected setEditProdPrecio(e: Event): void {
    const str = (e.target as HTMLInputElement).value;
    this.editProdPrecioStr.set(str);
    const val = parseFloat(str.trim());
    this.editProdPrecio.set(!isNaN(val) && val >= 0 ? val : null);
  }

  protected async guardarProducto(): Promise<void> {
    const prod   = this.editandoProducto();
    const desc   = this.editProdDescripcion().trim();
    const precio = this.editProdPrecio();
    if (!prod) return;
    if (!desc) { this.editProductoError.set('La descripción es obligatoria.'); return; }
    if (precio === null) { this.editProductoError.set('El precio de venta es obligatorio.'); return; }

    this.guardandoProducto.set(true);
    this.editProductoError.set('');
    try {
      await firstValueFrom(
        this.http.put(
          `${environment.urlChatBot}/restaurant-publico/productos/${prod.id}`,
          { idCompany: this.companyId()!, description: desc, ventaMN: precio },
        ),
      );
      // Guardar configuración de inventario (no bloquea si falla).
      try { await this.guardarConfigProducto(prod.id); }
      catch { /* config opcional */ }
      this.editandoProducto.set(null);
      this.productosResource.reload();
    } catch {
      this.editProductoError.set('No se pudo guardar. Intenta de nuevo.');
    } finally {
      this.guardandoProducto.set(false);
    }
  }

  protected abrirEditMesa(mesa: Mesa, e: Event): void {
    e.stopPropagation();
    this.editMesaNombre.set(mesa.nombre);
    this.editMesaCapacidad.set(mesa.capacidad);
    this.editMesaError.set('');
    this.editandoMesa.set(mesa);
  }

  protected setEditMesaNombre(e: Event): void {
    this.editMesaNombre.set((e.target as HTMLInputElement).value);
  }

  protected setEditMesaCapacidad(e: Event): void {
    const v = (e.target as HTMLInputElement).value;
    this.editMesaCapacidad.set(v ? parseInt(v, 10) : null);
  }

  protected async guardarMesa(): Promise<void> {
    const mesa   = this.editandoMesa();
    const nombre = this.editMesaNombre().trim();
    if (!mesa || !nombre) { this.editMesaError.set('El nombre es obligatorio.'); return; }

    this.guardandoMesa.set(true);
    this.editMesaError.set('');
    try {
      await firstValueFrom(
        this.http.put(
          `${environment.urlAdministration}/Restaurant/mesas/${mesa.id}`,
          { id: mesa.id, idCompany: this.companyId()!, nombre, capacidad: this.editMesaCapacidad(), activo: true },
        ),
      );
      this.editandoMesa.set(null);
      this.mesasResource.reload();
    } catch {
      this.editMesaError.set('No se pudo guardar. Intenta de nuevo.');
    } finally {
      this.guardandoMesa.set(false);
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
          { idCompany: this.companyId()!, idMesa: mesa.id },
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
    this.prodNota.set('');
    this.addError.set('');
    void this.cargarConfigVenta(producto.id);
  }

  protected cancelarProducto(): void {
    this.selectedProducto.set(null);
    this.addError.set('');
  }

  protected setProdNota(e: Event): void {
    this.prodNota.set((e.target as HTMLInputElement).value);
  }

  // Agrega (o quita si ya está) una nota rápida a la nota del producto.
  protected toggleNotaChip(text: string): void {
    const partes = this.prodNota().split(',').map(s => s.trim()).filter(Boolean);
    const existe = partes.some(p => p.toLowerCase() === text.toLowerCase());
    const nuevas = existe
      ? partes.filter(p => p.toLowerCase() !== text.toLowerCase())
      : [...partes, text];
    this.prodNota.set(nuevas.join(', '));
  }

  protected notaChipActiva(text: string): boolean {
    return this.prodNota().split(',').map(s => s.trim().toLowerCase()).includes(text.toLowerCase());
  }

  protected async agregarProducto(cantidad: number): Promise<void> {
    const producto = this.selectedProducto();
    const mesa = this.selectedMesa();
    if (!producto || !mesa?.idCuentaActual) return;

    // Presentación y precio según configuración de inventario del producto.
    const cfg = this.prodInvVenta();
    let presentacion: Presentacion | null = null;
    if (cfg?.controlaInventario) {
      presentacion = cfg.vendePorCopa ? this.presentacionSel() : 'COMPLETA';
    }
    const precio = this.precioVentaActual();

    const nota = this.prodNota().trim();
    const etiqueta = presentacion === 'COPA' ? `${producto.description} (Copa)` : producto.description;
    const descripcion = nota ? `${etiqueta} (${nota})` : etiqueta;

    this.agregandoItem.set(true);
    this.addError.set('');
    try {
      await firstValueFrom(
        this.http.post(
          `${environment.urlChatBot}/restaurant-publico/cuentas/${mesa.idCuentaActual}/items`,
          { idMaterial: producto.id, descripcion, cantidad, precio, presentacion },
        ),
      );
      this.selectedProducto.set(null);
      this.prodNota.set('');
      this.itemsResource.reload();
    } catch {
      this.addError.set('No se pudo agregar el producto. Intenta de nuevo.');
    } finally {
      this.agregandoItem.set(false);
    }
  }

  protected limpiarBusqueda(): void {
    this.prodBusqueda.set('');
  }

  protected setProdBusqueda(e: Event): void {
    this.prodBusqueda.set((e.target as HTMLInputElement).value);
  }

  protected irACuenta(): void {
    this.selectedProducto.set(null);
    this.cobroError.set('');
    this.showPayment.set(false);
    this.dividirEntre.set(1);
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
    if (this.montoPagadoEl)  this.montoPagadoEl.value  = '';
    if (this.montoTarjetaEl) this.montoTarjetaEl.value = '';
  }

  protected setMontoPagado(e: Event): void {
    const input = e.target as HTMLInputElement;
    this.montoPagadoEl = input;
    const str = input.value.trim();
    if (str.endsWith('.')) return; // punto sin decimales — no actualizar
    const val = parseFloat(str);
    this.montoPagado.set(!isNaN(val) && val > 0 ? val : null);
  }

  protected setMontoTarjeta(e: Event): void {
    const input = e.target as HTMLInputElement;
    this.montoTarjetaEl = input;
    const str = input.value.trim();
    if (str.endsWith('.')) return;
    const val = parseFloat(str);
    this.montoTarjeta.set(!isNaN(val) && val > 0 ? val : null);
  }

  protected abrirPago(): void {
    this.tipoPago.set('EFECTIVO');
    this.montoPagado.set(null);
    this.montoTarjeta.set(null);
    this.montoPagadoEl  = null;
    this.montoTarjetaEl = null;
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
    if (!this.pagoSuficiente()) {
      this.cobroError.set('El monto recibido no cubre el total de la cuenta.');
      return;
    }

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
          { idCompany: this.companyId()!, tipoPago: tipo },
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
    } catch (err: any) {
      const msg = err?.error?.error ?? err?.message ?? 'No se pudo procesar el cobro. Intenta de nuevo.';
      this.cobroError.set(msg);
    } finally {
      this.cobrando.set(false);
    }
  }

  protected async imprimirTicket(): Promise<void> {
    const t = this.ticketData();
    if (!t) return;
    const logo = await this.logoToDataUrl();

    const docDef: any = {
      pageSize: { width: 80, height: 'auto' },
      pageMargins: [8, 8, 8, 8],
      content: [
        ...(logo ? [{ image: logo, width: 48, height: 48, alignment: 'center', margin: [0, 0, 0, 4] }] : []),
        { text: 'Bi2 · Punto de Venta', alignment: 'center', fontSize: 10, bold: true },
        { text: t.companyName, alignment: 'center', fontSize: 9, margin: [0, 2, 0, 6] },
        { text: '─'.repeat(32), alignment: 'center', fontSize: 7, margin: [0, 0, 0, 4] },
        { text: `Mesa: ${t.mesaNombre}`, fontSize: 8, margin: [0, 0, 0, 2] },
        { text: `Ticket #${t.idCuenta} · ${new Date(t.fecha).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })}`, fontSize: 7, color: '#666', margin: [0, 0, 0, 8] },
        {
          table: {
            widths: ['*', 40, 40],
            body: [
              [{ text: 'Producto', bold: true, fontSize: 7 }, { text: 'Qty', bold: true, fontSize: 7, alignment: 'center' }, { text: 'Total', bold: true, fontSize: 7, alignment: 'right' }],
              ...t.items.map(i => [
                { text: i.descripcion ?? 'Item', fontSize: 7 },
                { text: String(i.cantidad), fontSize: 7, alignment: 'center' },
                { text: `$${i.subtotal.toFixed(2)}`, fontSize: 7, alignment: 'right' }
              ])
            ]
          },
          margin: [0, 0, 0, 8]
        },
        { text: '─'.repeat(32), alignment: 'center', fontSize: 7, margin: [0, 0, 0, 4] },
        {
          table: {
            widths: ['*', 60],
            body: [
              [{ text: 'Subtotal:', fontSize: 7 }, { text: `$${t.total.toFixed(2)}`, fontSize: 7, alignment: 'right' }],
              [{ text: 'Total:', fontSize: 8, bold: true }, { text: `$${t.total.toFixed(2)}`, fontSize: 8, bold: true, alignment: 'right' }],
              [{ text: `Pago: ${t.tipoPago}`, fontSize: 7 }, { text: `$${t.montoPagado.toFixed(2)}`, fontSize: 7, alignment: 'right' }],
              ...(t.cambio > 0 ? [[{ text: 'Cambio:', fontSize: 7, color: '#147a4b', bold: true }, { text: `$${t.cambio.toFixed(2)}`, fontSize: 7, alignment: 'right', color: '#147a4b', bold: true }]] : [])
            ]
          },
          margin: [0, 0, 0, 8]
        },
        { text: '¡Gracias por su visita!', alignment: 'center', fontSize: 7, italics: true, color: '#888' }
      ]
    };

    pdfMake.createPdf(docDef).open();
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
