import { CurrencyPipe, DatePipe } from '@angular/common';
import { httpResource } from '@angular/common/http';
import { Component, computed, effect, inject, signal } from '@angular/core';
import pdfMake from 'pdfmake/build/pdfmake';
import pdfFonts from 'pdfmake/build/vfs_fonts';

if (pdfFonts && (pdfFonts as any).pdfMake) {
  (pdfMake as any).vfs = (pdfFonts as any).pdfMake.vfs;
}

import { environment } from '../environments/environment';
import { CajaInfo, EgresoCaja, ResumenCorte, Turno, VentaPorTipo } from './models/caja';
import { MesaListo } from './models/cocina';
import { Cocina } from './features/cocina/cocina';
import { CocinaService } from './features/cocina/cocina.service';
import { InventarioService } from './features/inventario/inventario.service';
import { CajaService } from './features/caja/caja.service';
import { UsuariosService } from './features/usuarios/usuarios.service';
import { ConfigService } from './features/config/config.service';
import { MesasService } from './features/mesas/mesas.service';
import { ProductosService } from './features/productos/productos.service';
import { CuentaService } from './features/cuenta/cuenta.service';
import { EmpresaService } from './features/empresa/empresa.service';
import { AuditoriaService, AuditExtras } from './core/auditoria.service';
import { Reportes } from './features/reportes/reportes';
import { Inventario } from './features/inventario/inventario';
import { Config } from './features/config/config';
import { Rol, Usuario } from './models/usuario';
import { CuentaAbierta, Familia, ItemCuenta, Producto } from './models/familia';
import { Equivalencia, Existencia, MovimientoInv, ProductoInventario, RecetaItem, ResultadoMovimiento, ResumenMov } from './models/inventario';
import { Mesa } from './models/mesa';

type RestaurantModule = 'MESAS' | 'CAJAS' | 'REPORTES' | 'INVENTARIO' | 'COCINA' | 'CONFIG';
type View = 'menu' | 'mesas' | 'familias' | 'productos' | 'cuenta' | 'cajas' | 'reportes' | 'inventario' | 'cocina' | 'config';
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
  atendioPor: string | null;   // mesero que abrió la mesa (viene del backend)
  cobradoPor: string | null;   // usuario logueado que cobró
}

@Component({
  selector: 'app-root',
  imports: [CurrencyPipe, DatePipe, Cocina, Reportes, Inventario, Config],
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
export class App {
  private readonly cocina = inject(CocinaService);
  private readonly inventarioSvc = inject(InventarioService);
  private readonly cajaSvc = inject(CajaService);
  private readonly usuariosSvc = inject(UsuariosService);
  private readonly configSvc = inject(ConfigService);
  private readonly mesasSvc = inject(MesasService);
  private readonly productosSvc = inject(ProductosService);
  private readonly cuentaSvc = inject(CuentaService);
  private readonly empresaSvc = inject(EmpresaService);
  private readonly auditoriaSvc = inject(AuditoriaService);

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
      const lista = await this.empresaSvc.listaPublica();
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
  // El PIN de supervisor ahora se valida en el backend (por empresa); default 'Super2026'.
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
  // Módulo activo (para resaltar los accesos rápidos de arriba).
  protected readonly moduloActivo = computed<RestaurantModule | 'MENU'>(() => {
    switch (this.view()) {
      case 'mesas': case 'familias': case 'productos': case 'cuenta': return 'MESAS';
      case 'cajas': return 'CAJAS';
      case 'cocina': return 'COCINA';
      case 'reportes': return 'REPORTES';
      case 'inventario': return 'INVENTARIO';
      case 'config': return 'CONFIG';
      default: return 'MENU';
    }
  });
  protected readonly selectedMesa = this.cuentaSvc.selectedMesa;   // store
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

  // Mover producto a otra familia / subfamilia
  protected readonly moverFamiliaId    = signal<number | null>(null);
  protected readonly moverSubfamiliaId = signal<number | null>(null);
  protected readonly famModalResource = httpResource<Familia[]>(
    () => this.editandoProducto() !== null
      ? this.productosSvc.familiasUrl(this.companyId()!)
      : undefined,
    { defaultValue: [] },
  );
  protected readonly subfamModalResource = httpResource<Familia[]>(
    () => {
      const fam = this.moverFamiliaId();
      return this.editandoProducto() !== null && fam
        ? this.productosSvc.subfamiliasUrl(this.companyId()!, fam)
        : undefined;
    },
    { defaultValue: [] },
  );
  protected setMoverFamilia(e: Event): void {
    const v = (e.target as HTMLSelectElement).value;
    this.moverFamiliaId.set(v ? +v : null);
    this.moverSubfamiliaId.set(null);
  }
  protected setMoverSubfamilia(e: Event): void {
    const v = (e.target as HTMLSelectElement).value;
    this.moverSubfamiliaId.set(v ? +v : null);
  }

  // Activar / desactivar producto
  protected readonly verInactivos = signal(false);
  protected readonly prodActivo   = signal(true);
  protected toggleVerInactivos(): void {
    this.verInactivos.update(v => !v);
    this.productosResource.reload();
  }
  protected setProdActivo(e: Event): void { this.prodActivo.set((e.target as HTMLInputElement).checked); }

  // ── Cajas / Turno ─────────────────────────────────────────────────────────
  protected readonly cajasResource = httpResource<CajaInfo[]>(
    () => this.view() === 'cajas'
      ? this.cajaSvc.cajasUrl(this.companyId()!)
      : undefined,
    { defaultValue: [] },
  );
  protected readonly cajas = this.cajasResource.value;
  protected readonly cajasLoading = this.cajasResource.isLoading;

  protected readonly cajaNombre = signal('');
  protected readonly fondoInicial = signal<number | null>(null);
  protected readonly iniciandoTurno = signal(false);
  protected readonly turnoActivo = this.cajaSvc.turnoActivo;   // estado en CajaService
  protected readonly turnoError = signal('');
  protected readonly turnoActivoCargando = computed(() => this.turnoActivoResource.isLoading());

  protected readonly cajaSeleccionada = computed(() => {
    const list = this.cajas();
    return list.length === 1 ? list[0] : null;
  });

  protected readonly cajasSubView = signal<'inicio' | 'egresos' | 'corte' | 'cobrar' | 'devolucion'>('inicio');

  // ── Devolución de ticket (sale dinero de caja, con PIN de supervisor) ───────
  protected readonly devRef    = signal('');
  protected readonly devMonto  = signal<number | null>(null);
  protected readonly devMotivo = signal('');
  protected readonly devPor     = signal('');
  protected readonly devPin     = signal('');
  protected readonly devProcesando = signal(false);
  protected readonly devError   = signal('');
  protected readonly devOk      = signal('');
  protected setDevRef(e: Event): void { this.devRef.set((e.target as HTMLInputElement).value); }
  protected setDevMotivo(e: Event): void { this.devMotivo.set((e.target as HTMLInputElement).value); }
  protected setDevPor(e: Event): void { this.devPor.set((e.target as HTMLInputElement).value); }
  protected setDevPin(e: Event): void { this.devPin.set((e.target as HTMLInputElement).value); }
  protected setDevMonto(e: Event): void {
    const v = parseFloat((e.target as HTMLInputElement).value);
    this.devMonto.set(!isNaN(v) && v > 0 ? v : null);
  }
  // Cobros del día (para elegir cuál devolver/cancelar).
  protected readonly devCuentaSel = signal<number | null>(null);
  protected readonly cobrosDiaResource = httpResource<any[]>(
    () => this.view() === 'cajas' && this.cajasSubView() === 'devolucion'
      ? this.cuentaSvc.cobrosDiaUrl(this.companyId()!, new Date().toISOString().split('T')[0])
      : undefined,
    { defaultValue: [] },
  );
  protected setDevCuenta(e: Event): void {
    const v = (e.target as HTMLSelectElement).value;
    if (!v) { this.devCuentaSel.set(null); return; }
    const c = this.cobrosDiaResource.value().find((x: any) => x.idCuenta === +v);
    if (c) {
      this.devCuentaSel.set(c.idCuenta);
      this.devRef.set(`#${c.idCuenta} · ${c.mesa}`);
      this.devMonto.set(c.monto);
    }
  }

  protected abrirDevolucion(): void {
    this.devRef.set(''); this.devMonto.set(null); this.devMotivo.set('');
    this.devPor.set(''); this.devPin.set(''); this.devError.set(''); this.devOk.set('');
    this.devCuentaSel.set(null);
    this.cajasSubView.set('devolucion');
  }

  protected async registrarDevolucion(): Promise<void> {
    const turno = this.turnoActivo();
    const monto = this.devMonto();
    if (!turno) return;
    if (monto === null) { this.devError.set('Indica el monto a devolver.'); return; }
    if (!this.devPor().trim()) { this.devError.set('Indica quién autoriza.'); return; }

    this.devProcesando.set(true);
    this.devError.set(''); this.devOk.set('');
    try {
      // 1) Validar PIN de supervisor
      const r: any = await this.usuariosSvc.validarPin(this.companyId()!, this.devPin());
      if (!r?.ok) { this.devError.set('PIN de supervisor incorrecto.'); return; }

      const ref = this.devRef().trim();
      const motivo = this.devMotivo().trim();
      const desc = `Devolución${ref ? ' ticket ' + ref : ''}${motivo ? ': ' + motivo : ''}`;

      // 2) Registrar la salida de caja (egreso) → el corte lo resta
      await this.cajaSvc.registrarEgreso(turno.id, desc, monto);

      // 3) Bitácora de autorización (auditoría)
      try {
        await this.cuentaSvc.registrarAutorizacion(
          { idCompany: this.companyId()!, tipo: 'DEVOLUCION', descripcion: ref || null,
            monto, motivo: motivo || null, autorizadoPor: this.devPor().trim() });
      } catch { /* la salida ya quedó registrada */ }

      // Si se eligió un cobro del día, marca la venta como cancelada en el reporte.
      const cta = this.devCuentaSel();
      if (cta != null) {
        try {
          await this.cuentaSvc.cancelarVenta(cta, this.companyId()!);
        } catch { /* la devolución ya quedó registrada como egreso */ }
      }
      this.auditar('DEVOLUCION', { entidad: 'CAJA', idEntidad: cta, monto, descripcion: desc });
      this.devOk.set(`Devolución registrada: se sacaron ${monto} de la caja${cta != null ? ' y la venta quedó cancelada' : ''}.`);
      this.devRef.set(''); this.devMonto.set(null); this.devMotivo.set('');
      this.devPin.set('');
      this.resumenCorteResource.reload();
    } catch (err: any) {
      this.devError.set(err?.error?.error ?? 'No se pudo registrar la devolución.');
    } finally {
      this.devProcesando.set(false);
    }
  }
  protected readonly totalEgresosLista = computed(() =>
    this.egresosLista().reduce((s, e) => s + e.monto, 0),
  );

  // Consulta turno activo en cuanto se conoce la caja y se está en la vista
  protected readonly turnoActivoResource = httpResource<Turno | null>(
    () => {
      const caja = this.cajaSeleccionada();
      if (!caja || this.view() !== 'cajas') return undefined;
      return this.cajaSvc.turnoActivoUrl(caja.idCaja);
    },
  );

  constructor() {
    // Mantiene sincronizada la empresa activa en el servicio de inventario
    // (que comparte estado con el modal de producto y las alertas de stock).
    effect(() => this.inventarioSvc.companyId.set(this.companyId()));

    // Sincroniza el usuario logueado y la empresa hacia el logger de auditoría
    // (así cualquier dominio puede registrar en la bitácora sin depender de App).
    effect(() => this.auditoriaSvc.usuario.set(this.usuario()));
    effect(() => this.auditoriaSvc.companyId.set(this.companyId()));
    effect(() => this.cajaSvc.companyId.set(this.companyId()));
    effect(() => this.mesasSvc.companyId.set(this.companyId()));
    // El store de mesas se carga en el salón y en Caja (para la cola de cobro).
    effect(() => this.mesasSvc.enVista.set(this.view() === 'mesas' || this.view() === 'cajas'));
    // Los items de la cuenta se cargan en familias/productos/cuenta.
    effect(() => {
      const v = this.view();
      this.cuentaSvc.enCuentaVista.set(v === 'familias' || v === 'productos' || v === 'cuenta');
    });

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


    // Suena la campana cuando cocina marca un platillo listo (cuenta nueva en la lista).
    effect(() => {
      const ids = this.listosResource.value().map(l => l.idCuenta);
      const hayNuevo = ids.some(id => !this.listosAvisados.has(id));
      this.listosAvisados = new Set(ids);   // solo las vigentes; si vuelve a salir, re-avisa
      if (hayNuevo) this.sonarCampana();
    });

    // Auto-refresco de mesas (estados + cronómetro + cola de cobro) cada 20 s.
    setInterval(() => {
      if (this.view() === 'mesas' || this.view() === 'cajas') this.mesasTick.update(t => t + 1);
    }, 20000);

    const yaInstalada = window.matchMedia?.('(display-mode: standalone)').matches
      || (navigator as any).standalone === true;
    this.appStandalone.set(!!yaInstalada);
    if (!yaInstalada) {
      if ((window as any).__deferredInstallPrompt) this.puedeInstalar.set(true);
      window.addEventListener('pwa-installable', () => this.puedeInstalar.set(true));
      window.addEventListener('pwa-installed',   () => { this.puedeInstalar.set(false); this.appStandalone.set(true); });
    }
  }

  protected readonly appStandalone = signal(false);

  // ── Instalación PWA ─────────────────────────────────────────────────────────
  protected readonly puedeInstalar = signal(false);
  protected async instalarApp(): Promise<void> {
    const p = (window as any).__deferredInstallPrompt;
    if (!p) {
      // El navegador no ofreció el evento (ej. Samsung Internet o ya instalada):
      // guiar al usuario al menú del navegador.
      this.mostrarAyudaInstalar.set(true);
      return;
    }
    p.prompt();
    try { await p.userChoice; } catch { /* cancelado */ }
    (window as any).__deferredInstallPrompt = null;
    this.puedeInstalar.set(false);
  }
  protected readonly mostrarAyudaInstalar = signal(false);

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
      const sv = this.cajasSubView();
      if (!t || (sv !== 'corte' && sv !== 'egresos' && sv !== 'devolucion')) return undefined;
      return this.cajaSvc.resumenUrl(t.id);
    },
  );
  // Efectivo disponible en caja (fondo + ventas efectivo − egresos).
  protected readonly efectivoDisponible = computed(
    () => this.resumenCorteResource.value()?.totales.efectivoEsperado ?? null,
  );
  protected readonly egresoExcede = computed(() => {
    const disp = this.efectivoDisponible();
    const monto = this.egresoMonto();
    return disp != null && monto != null && monto > disp;
  });
  protected readonly efectivoContado = signal<number | null>(null);
  private efectivoContadoEl: HTMLInputElement | null = null;

  // Arqueo por denominación (MXN). Suma → efectivo contado.
  protected readonly denominaciones = [1000, 500, 200, 100, 50, 20, 10, 5, 2, 1, 0.5];
  protected readonly arqueo = signal<Record<number, number | null>>({});
  protected setArqueo(denom: number, e: Event): void {
    const v = parseInt((e.target as HTMLInputElement).value, 10);
    const qty = !isNaN(v) && v >= 0 ? v : null;
    this.arqueo.update(a => ({ ...a, [denom]: qty }));
    const mapa = this.arqueo();
    const hayAlguno = this.denominaciones.some(d => mapa[d] != null);
    const total = this.denominaciones.reduce((s, d) => s + d * (mapa[d] ?? 0), 0);
    this.efectivoContado.set(hayAlguno ? Math.round(total * 100) / 100 : null);
  }
  protected readonly cerrandoTurno = signal(false);
  protected readonly cerrarError = signal('');
  protected readonly corteResultado = signal<Turno | null>(null);
  protected readonly corteResumenSnapshot = signal<ResumenCorte | null>(null);

  protected readonly diferencia = computed(() => {
    const esperado = this.resumenCorteResource.value()?.totales.efectivoEsperado ?? 0;
    const contado  = this.efectivoContado() ?? 0;
    return contado - esperado;
  });

  // ── Reportes → extraído a features/reportes (componente <app-reportes>) ──────

  // ── Inventario → vista extraída a features/inventario (<app-inventario>) ─────
  // El estado compartido con el modal de producto vive en InventarioService;
  // aquí quedan solo alias para el modal de editar producto y la receta.
  protected readonly equivalencias = this.inventarioSvc.equivalencias;
  protected readonly cfgControla   = this.inventarioSvc.cfgControla;
  protected readonly cfgVendeCopa  = this.inventarioSvc.cfgVendeCopa;
  protected readonly cfgIdEquiv    = this.inventarioSvc.cfgIdEquiv;
  protected readonly cfgPrecioCopa = this.inventarioSvc.cfgPrecioCopa;
  protected readonly cfgStockMin   = this.inventarioSvc.cfgStockMin;
  protected setCfgControla(e: Event): void { this.inventarioSvc.setCfgControla(e); }
  protected setCfgVendeCopa(e: Event): void { this.inventarioSvc.setCfgVendeCopa(e); }
  protected setCfgIdEquiv(e: Event): void { this.inventarioSvc.setCfgIdEquiv(e); }
  protected setCfgPrecioCopa(e: Event): void { this.inventarioSvc.setCfgPrecioCopa(e); }
  protected setCfgStockMin(e: Event): void { this.inventarioSvc.setCfgStockMin(e); }

  // ── Receta / insumos del platillo ───────────────────────────────────────────
  protected readonly receta = signal<RecetaItem[]>([]);
  protected readonly recetaBusqueda = signal('');
  protected setRecetaBusqueda(e: Event): void { this.recetaBusqueda.set((e.target as HTMLInputElement).value); }
  protected readonly recetaBuscaResource = httpResource<Producto[]>(
    () => {
      const term = this.recetaBusqueda().trim();
      if (this.editandoProducto() === null || term.length < 2) return undefined;
      return this.productosSvc.buscarUrl(this.companyId()!, term);
    },
    { defaultValue: [] },
  );
  private async cargarReceta(idProducto: number): Promise<void> {
    this.receta.set([]);
    this.recetaBusqueda.set('');
    try {
      const r = await this.inventarioSvc.getReceta(idProducto);
      this.receta.set(r ?? []);
    } catch { /* sin receta */ }
  }
  protected agregarInsumo(p: Producto): void {
    if (this.receta().some(r => r.idInsumo === p.id)) return;
    this.receta.update(l => [...l, { idInsumo: p.id, descripcion: p.description, cantidad: 1 }]);
    this.recetaBusqueda.set('');
  }
  protected setInsumoCantidad(idInsumo: number, e: Event): void {
    const v = parseFloat((e.target as HTMLInputElement).value);
    this.receta.update(l => l.map(r => r.idInsumo === idInsumo ? { ...r, cantidad: !isNaN(v) && v > 0 ? v : 0 } : r));
  }
  protected quitarInsumo(idInsumo: number): void {
    this.receta.update(l => l.filter(r => r.idInsumo !== idInsumo));
  }
  private async guardarReceta(idProducto: number): Promise<void> {
    await this.inventarioSvc.guardarReceta(idProducto, this.receta().filter(r => r.cantidad > 0));
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
      const cfg = await this.inventarioSvc.getConfig(idMaterial);
      this.prodInvVenta.set(cfg);
    } catch { /* producto sin inventario */ }
  }

  // ── Pago ──────────────────────────────────────────────────────────────────
  protected readonly showPayment = signal(false);
  protected readonly tipoPago = signal<TipoPago>('EFECTIVO');
  protected readonly montoPagado  = signal<number | null>(null);
  protected readonly montoTarjeta = signal<number | null>(null);
  protected readonly referenciaTarjeta = signal('');   // opcional, para control
  protected setReferenciaTarjeta(e: Event): void { this.referenciaTarjeta.set((e.target as HTMLInputElement).value); }
  // Fidelización
  protected readonly clienteTel = signal('');
  protected readonly clientePuntos = signal<number | null>(null);
  protected setClienteTel(e: Event): void {
    this.clienteTel.set((e.target as HTMLInputElement).value);
    this.clientePuntos.set(null);
  }
  protected async consultarPuntos(): Promise<void> {
    const tel = this.clienteTel().trim();
    if (tel.length < 8) return;
    try {
      const acc: any = await this.cuentaSvc.consultarPuntos(this.companyId()!, tel);
      this.clientePuntos.set(acc?.totalPoints ?? 0);
    } catch { this.clientePuntos.set(0); }
  }

  protected readonly propina = signal<number | null>(null);   // propina del cobro (por mesero)
  protected setPropina(e: Event): void {
    const v = parseFloat((e.target as HTMLInputElement).value);
    this.propina.set(!isNaN(v) && v > 0 ? v : null);
  }
  protected propinaRapida(pct: number): void {
    this.propina.set(Math.round(this.totalAPagar() * pct / 100 * 100) / 100);
  }
  private montoPagadoEl:  HTMLInputElement | null = null;
  private montoTarjetaEl: HTMLInputElement | null = null;
  protected readonly cobrando = signal(false);
  protected readonly cobroError = signal('');

  protected readonly cambio = computed(() => {
    const total = this.totalAPagar();
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
    const total = this.totalAPagar();
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

  // ── Mesas → estado en MesasService (store); alias para plantilla/métodos ─────
  protected readonly mesasTick     = this.mesasSvc.tick;
  protected readonly mesasResource = this.mesasSvc.mesasResource;
  protected readonly mesas         = this.mesasSvc.mesas;

  // ── Aviso al mesero: platillos listos de cocina, pendientes de entregar ──────
  protected readonly listosResource = httpResource<MesaListo[]>(
    () => {
      this.mesasTick();   // se refresca con el mismo latido que las mesas
      return this.view() === 'mesas'
        ? this.cocina.listosUrl(this.companyId()!)
        : undefined;
    },
    { defaultValue: [] },
  );
  // idCuenta de cuentas con platillo listo por entregar.
  protected readonly mesaListos = computed(() => new Set(this.listosResource.value().map(l => l.idCuenta)));
  protected mesaTieneListo(mesa: Mesa): boolean {
    return mesa.idCuentaActual != null && this.mesaListos().has(mesa.idCuentaActual);
  }
  protected readonly marcandoEntregado = signal<number | null>(null);
  protected async marcarEntregado(mesa: Mesa, ev: Event): Promise<void> {
    ev.stopPropagation();
    if (mesa.idCuentaActual == null) return;
    this.marcandoEntregado.set(mesa.id);
    try {
      await this.cocina.marcarEntregado(mesa.idCuentaActual);
      this.listosResource.reload();
    } catch { /* reintenta en el siguiente refresco */ }
    finally { this.marcandoEntregado.set(null); }
  }
  // Cuentas ya avisadas (para sonar la campana solo cuando aparece una NUEVA).
  private listosAvisados = new Set<number>();
  private sonarCampana(): void {
    try {
      const Ctx = (window as any).AudioContext || (window as any).webkitAudioContext;
      if (!Ctx) return;
      const ctx = new Ctx();
      const beep = (inicio: number, freq: number) => {
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        o.connect(g); g.connect(ctx.destination);
        o.type = 'sine'; o.frequency.value = freq;
        g.gain.setValueAtTime(0.0001, ctx.currentTime + inicio);
        g.gain.exponentialRampToValueAtTime(0.3, ctx.currentTime + inicio + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + inicio + 0.35);
        o.start(ctx.currentTime + inicio);
        o.stop(ctx.currentTime + inicio + 0.37);
      };
      beep(0, 988); beep(0.22, 1319);   // ding-ding
      setTimeout(() => { try { ctx.close(); } catch { /* noop */ } }, 800);
    } catch { /* audio no disponible */ }
  }

  // Buscador de mesas (filtra por nombre/número).
  protected readonly mesaBusqueda = signal('');
  protected setMesaBusqueda(e: Event): void { this.mesaBusqueda.set((e.target as HTMLInputElement).value); }
  protected limpiarMesaBusqueda(): void { this.mesaBusqueda.set(''); }
  protected readonly mesasFiltradas = computed(() => {
    const t = this.mesaBusqueda().trim().toLowerCase();
    const lista = this.mesas();
    return t ? lista.filter(m => m.nombre.toLowerCase().includes(t)) : lista;
  });
  protected readonly loading = this.mesasResource.isLoading;
  protected readonly error = computed(() =>
    this.mesasResource.error()
      ? 'No fue posible cargar las mesas. Verifica que el servicio de Administración esté activo.'
      : '',
  );
  protected readonly mesasOcupadas = computed(
    () => this.mesas().filter(m => m.tieneCuentaAbierta).length,
  );
  protected readonly mesasPorCobrar = computed(
    () => this.mesas().filter(m => this.estadoMesa(m) === 'por_cobrar').length,
  );
  protected readonly mesasSucias = computed(
    () => this.mesas().filter(m => this.estadoMesa(m) === 'sucia').length,
  );

  // Colas de cobro → MesasService (store).
  protected readonly mesasParaCobrar = this.mesasSvc.mesasParaCobrar;
  protected readonly colaCobro       = this.mesasSvc.colaCobro;
  protected minutosEsperando(m: Mesa): number {
    if (!m.porCobrarAt) return 0;
    return Math.max(0, Math.floor((Date.now() - Date.parse(m.porCobrarAt)) / 60000));
  }

  protected readonly cobrarBusqueda = signal('');
  protected setCobrarBusqueda(e: Event): void { this.cobrarBusqueda.set((e.target as HTMLInputElement).value); }
  protected readonly mesasParaCobrarFiltradas = computed(() => {
    const t = this.cobrarBusqueda().trim().toLowerCase();
    const lista = this.mesasParaCobrar();
    return t ? lista.filter(m => m.nombre.toLowerCase().includes(t)) : lista;
  });

  // ── Para llevar / domicilio ─────────────────────────────────────────────────
  protected readonly showLlevar   = signal(false);
  protected readonly llevarTipo   = signal<'llevar' | 'domicilio'>('llevar');
  protected readonly llevarNombre = signal('');
  protected readonly llevarTel    = signal('');
  protected readonly llevarDir    = signal('');
  protected readonly abriendoLlevar = signal(false);
  protected setLlevarNombre(e: Event): void { this.llevarNombre.set((e.target as HTMLInputElement).value); }
  protected setLlevarTel(e: Event): void { this.llevarTel.set((e.target as HTMLInputElement).value); }
  protected setLlevarDir(e: Event): void { this.llevarDir.set((e.target as HTMLInputElement).value); }

  protected readonly llevarResource = httpResource<any[]>(
    () => this.view() === 'mesas'
      ? this.cuentaSvc.llevarUrl(this.companyId()!)
      : undefined,
    { defaultValue: [] },
  );

  protected abrirLlevarModal(): void {
    this.llevarTipo.set('llevar'); this.llevarNombre.set(''); this.llevarTel.set(''); this.llevarDir.set('');
    this.showLlevar.set(true);
  }
  protected async crearLlevar(): Promise<void> {
    this.abriendoLlevar.set(true);
    try {
      const res: any = await this.cuentaSvc.abrirLlevar(
        { idCompany: this.companyId()!, tipo: this.llevarTipo(), nombre: this.llevarNombre().trim() || null,
          tel: this.llevarTel().trim() || null, dir: this.llevarDir().trim() || null });
      const nom = this.llevarNombre().trim() || (this.llevarTipo() === 'domicilio' ? 'Domicilio' : 'Para llevar');
      this.selectedMesa.set({
        id: res.idMesa, nombre: `🥡 ${nom}`, capacidad: null, activo: true,
        tieneCuentaAbierta: true, idCuentaActual: res.idCuenta, totalActual: 0, numItems: 0,
      });
      this.showLlevar.set(false);
      this.cuentaSeparada.set(false);
      this.auditar('ABRIR_MESA', { entidad: 'CUENTA', idEntidad: res.idCuenta, nombreMesa: `${this.llevarTipo()} · ${nom}` });
      this.view.set('familias');
    } catch {
      this.mesaActionError.set('No se pudo crear el pedido para llevar.');
    } finally { this.abriendoLlevar.set(false); }
  }
  protected abrirPedidoLlevar(c: any): void {
    const et = c.tipo === 'domicilio' ? 'Domicilio' : 'Para llevar';
    this.selectedMesa.set({
      id: c.idMesa, nombre: `🥡 ${c.clienteNombre || et}`, capacidad: null, activo: true,
      tieneCuentaAbierta: true, idCuentaActual: c.idCuenta, totalActual: c.total, numItems: c.numItems,
    });
    this.view.set('familias');
  }

  protected abrirCobrarMesa(): void {
    this.cobrarBusqueda.set('');
    this.cajasSubView.set('cobrar');
    this.mesasResource.reload();
  }
  protected cobrarMesaRapido(m: Mesa): void {
    this.selectedMesa.set(m);
    this.mesaActionError.set('');
    this.dividirEntre.set(1);
    if (m.idCuentaActual) void this.cargarModoCuenta(m.idCuentaActual);
    this.view.set('cuenta');
  }

  // Estado efectivo (con fallback si el backend aún no lo envía).
  protected estadoMesa(m: Mesa): string {
    return this.mesasSvc.estadoMesa(m);   // store
  }
  protected etiquetaEstado(e: string): string {
    return e === 'por_cobrar' ? 'POR COBRAR'
      : e === 'sucia' ? 'SUCIA'
      : e === 'ocupada' ? 'OCUPADA' : 'LIBRE';
  }

  protected async marcarPorCobrar(mesa: Mesa, valor: boolean, e: Event): Promise<void> {
    e.stopPropagation();
    if (!mesa.idCuentaActual) return;
    try {
      await this.cuentaSvc.marcarPorCobrar(mesa.idCuentaActual, valor);
      this.mesasResource.reload();
    } catch { /* reintenta al refrescar */ }
  }

  protected async liberarMesa(mesa: Mesa, e: Event): Promise<void> {
    e.stopPropagation();
    try {
      await this.mesasSvc.liberar(mesa.id);
      this.mesasResource.reload();
    } catch { /* reintenta al refrescar */ }
  }

  // ── Transferir / unir mesas (Fase 2) ────────────────────────────────────────
  protected readonly moverMesa    = signal<Mesa | null>(null);
  protected readonly moverError   = signal('');
  protected readonly moviendoMesa = signal(false);

  protected readonly mesasLibresDestino = computed(
    () => this.mesas().filter(m => !m.tieneCuentaAbierta && m.id !== this.moverMesa()?.id),
  );
  protected readonly mesasOcupadasDestino = computed(
    () => this.mesas().filter(m => m.tieneCuentaAbierta && m.id !== this.moverMesa()?.id),
  );

  protected abrirMoverMesa(mesa: Mesa, e: Event): void {
    e.stopPropagation();
    this.moverError.set('');
    this.moverMesa.set(mesa);
  }
  protected cerrarMover(): void { this.moverMesa.set(null); }

  protected async transferirA(destino: Mesa): Promise<void> {
    const src = this.moverMesa();
    if (!src?.idCuentaActual) return;
    this.moviendoMesa.set(true);
    this.moverError.set('');
    try {
      await this.cuentaSvc.transferir(src.idCuentaActual, destino.id);
      this.moverMesa.set(null);
      this.mesasResource.reload();
    } catch (err: any) {
      this.moverError.set(err?.error?.error ?? 'No se pudo transferir.');
    } finally { this.moviendoMesa.set(false); }
  }

  protected async unirCon(destino: Mesa): Promise<void> {
    const src = this.moverMesa();
    if (!src?.idCuentaActual || !destino.idCuentaActual) return;
    this.moviendoMesa.set(true);
    this.moverError.set('');
    try {
      await this.cuentaSvc.fusionar(src.idCuentaActual, destino.idCuentaActual);
      this.moverMesa.set(null);
      this.mesasResource.reload();
    } catch (err: any) {
      this.moverError.set(err?.error?.error ?? 'No se pudo unir las mesas.');
    } finally { this.moviendoMesa.set(false); }
  }

  // ── Familias ──────────────────────────────────────────────────────────────
  protected readonly familiasResource = httpResource<Familia[]>(
    () => this.view() === 'familias'
      ? this.productosSvc.familiasUrl(this.companyId()!)
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
      return this.productosSvc.subfamiliasUrl(this.companyId()!, fam.id);
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
      const q = this.verInactivos() ? '?inactivos=true' : '';
      const sub = this.selectedSubfamilia();
      if (sub) {
        return this.productosSvc.porSubfamiliaUrl(this.companyId()!, sub.id, q);
      }
      if (!this.mostrarSubfamilias()) {
        return this.productosSvc.porFamiliaUrl(this.companyId()!, fam.id, q);
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
      if (this.view() !== 'productos' && this.view() !== 'familias') return undefined;
      const term = this.prodBusqueda().trim();
      if (term.length < 2) return undefined;
      return this.productosSvc.buscarUrl(this.companyId()!, term);
    },
    { defaultValue: [] },
  );

  // ── Items de la cuenta → CuentaService (store); alias para plantilla/métodos ─
  protected readonly itemsResource   = this.cuentaSvc.itemsResource;
  protected readonly items           = this.cuentaSvc.items;
  protected readonly itemsPendientes = this.cuentaSvc.itemsPendientes;
  protected readonly totalCuenta     = this.cuentaSvc.totalCuenta;

  // Descuento aplicado (autorizado por supervisor) y total a pagar.
  protected readonly descuentoAplicado = signal<{ monto: number; motivo: string; por: string } | null>(null);

  // ── Comensales (cada quien paga lo suyo) ────────────────────────────────────
  // Modo de la cuenta: junta (normal) o separada (por persona). Por defecto junta.
  protected readonly cuentaSeparada = this.cuentaSvc.cuentaSeparada;   // store
  protected setCuentaSeparada(v: boolean): void {
    this.cuentaSeparada.set(v);
    if (!v) { this.numComensales.set(1); this.comensalSel.set(1); }
    this.persistModo();
  }
  // Guarda el modo (junta/separada + personas) en la cuenta para que sea persistente.
  private persistModo(): void {
    const id = this.selectedMesa()?.idCuentaActual;
    if (!id) return;
    this.cuentaSvc.guardarModo(id, this.cuentaSeparada(), this.cuentaSeparada() ? this.numComensales() : null)
      .catch(() => { /* no bloquear */ });
  }
  // Restaura el modo al entrar a una mesa (persistencia).
  private async cargarModoCuenta(idCuenta: number): Promise<void> {
    try {
      const m: any = await this.cuentaSvc.getModo(idCuenta);
      this.cuentaSeparada.set(!!m?.separada);
      this.numComensales.set(m?.numComensales && m.numComensales > 0 ? m.numComensales : 1);
    } catch { /* deja junta por defecto */ }
  }

  // Aviso al intentar juntar una cuenta separada.
  protected readonly avisoJuntar     = signal(false);
  protected readonly juntarBloqueado = signal(false);
  protected intentarJunta(): void {
    if (!this.cuentaSeparada()) return;
    if (this.items().some(i => i.pagado)) { this.juntarBloqueado.set(true); return; }
    if (this.items().length > 0) { this.avisoJuntar.set(true); return; }
    this.setCuentaSeparada(false);
  }
  protected confirmarJuntar(): void { this.avisoJuntar.set(false); this.setCuentaSeparada(false); }
  protected cancelarJuntar(): void { this.avisoJuntar.set(false); }
  protected cerrarJuntarBloqueado(): void { this.juntarBloqueado.set(false); }
  protected readonly numComensales = this.cuentaSvc.numComensales;   // store
  protected readonly comensalSel   = this.cuentaSvc.comensalSel;     // store

  // Prompt al abrir la mesa: ¿junta o separada? y ¿cuántas personas?
  protected readonly preguntaMesa = signal(false);
  protected readonly preguntaPaso = signal<'modo' | 'personas'>('modo');
  protected readonly prePersonas  = signal(2);
  protected masPrePersonas(): void { this.prePersonas.update(n => Math.min(12, n + 1)); }
  protected menosPrePersonas(): void { this.prePersonas.update(n => Math.max(2, n - 1)); }
  protected responderJunta(): void {
    this.setCuentaSeparada(false);
    this.preguntaMesa.set(false);
  }
  protected responderSeparada(): void { this.preguntaPaso.set('personas'); }
  protected confirmarSeparada(): void {
    this.cuentaSeparada.set(true);
    this.numComensales.set(this.prePersonas());
    this.comensalSel.set(1);
    this.preguntaMesa.set(false);
    this.persistModo();
  }
  // Cancelar el prompt: la mesa se abrió por error → borrar la cuenta vacía y volver a mesas.
  protected async cancelarPregunta(): Promise<void> {
    this.preguntaMesa.set(false);
    const id = this.selectedMesa()?.idCuentaActual;
    if (id) {
      try {
        await this.cuentaSvc.cancelarVacia(id);
      } catch { /* si falla, igual regresa */ }
    }
    this.backToMesas();
  }
  protected readonly cobroComensal = signal<number | null>(null);  // comensal que se está cobrando
  protected setComensalSel(n: number): void { this.comensalSel.set(n); }
  protected masPersonas(): void { this.numComensales.update(n => Math.min(12, n + 1)); }
  // Personas disponibles = las que se hayan creado o las que ya tengan productos.
  protected readonly personasDisponibles = computed(() => {
    const maxItem = this.items().reduce((m, i) => Math.max(m, i.comensal ?? 1), 1);
    const total = Math.max(this.numComensales(), maxItem);
    return Array.from({ length: total }, (_, i) => i + 1);
  });
  // Items agrupados por comensal (NULL cuenta como 1). pendiente = por cobrar; pagado = ya cobrado.
  protected readonly comensalesConItems = computed(() => {
    const mapa = new Map<number, { comensal: number; items: ItemCuenta[]; subtotal: number; pendiente: number; pagado: boolean }>();
    for (const it of this.items()) {
      const c = it.comensal ?? 1;
      if (!mapa.has(c)) mapa.set(c, { comensal: c, items: [], subtotal: 0, pendiente: 0, pagado: false });
      const g = mapa.get(c)!;
      g.items.push(it);
      g.subtotal += it.subtotal;
      if (!it.pagado) g.pendiente += it.subtotal;
    }
    for (const g of mapa.values()) g.pagado = g.pendiente === 0;
    return Array.from(mapa.values()).sort((a, b) => a.comensal - b.comensal);
  });

  protected readonly totalAPagar = computed(() => {
    const c = this.cobroComensal();
    if (c != null) {
      return this.items().filter(i => (i.comensal ?? 1) === c && !i.pagado).reduce((s, i) => s + i.subtotal, 0);
    }
    return Math.max(0, this.totalCuenta() - (this.descuentoAplicado()?.monto ?? 0));
  });

  // ── Dividir cuenta (partes iguales) ────────────────────────────────────────
  protected readonly dividirEntre = signal(1);
  protected readonly montoPorPersona = computed(() => {
    const n = this.dividirEntre();
    return n > 1 ? this.totalCuenta() / n : 0;
  });
  protected masComensales(): void { this.dividirEntre.update(n => Math.min(20, n + 1)); }
  protected menosComensales(): void { this.dividirEntre.update(n => Math.max(1, n - 1)); }

  // ── Navegación ────────────────────────────────────────────────────────────
  // ── Usuarios / login por PIN / roles ────────────────────────────────────────
  private static readonly LS_USUARIO = 'pv_usuario';
  protected readonly usuario = signal<Usuario | null>(this.restoreUsuario());
  private restoreUsuario(): Usuario | null {
    try { const s = localStorage.getItem(App.LS_USUARIO); return s ? JSON.parse(s) : null; } catch { return null; }
  }
  protected readonly loginPin      = signal('');
  protected readonly loginError    = signal('');
  protected readonly loginProcesando = signal(false);
  protected pushPin(d: string): void { if (this.loginPin().length < 20) this.loginPin.update(p => p + d); this.loginError.set(''); }
  protected borrarPin(): void { this.loginPin.update(p => p.slice(0, -1)); }
  protected limpiarPin(): void { this.loginPin.set(''); }
  // Modo texto para escribir un PIN con letras (llave maestra de admin).
  protected readonly loginModoTexto = signal(false);
  protected toggleLoginTexto(): void { this.loginModoTexto.update(v => !v); this.loginPin.set(''); this.loginError.set(''); }
  protected setLoginPin(e: Event): void { this.loginPin.set((e.target as HTMLInputElement).value); this.loginError.set(''); }

  protected async login(): Promise<void> {
    const pin = this.loginPin();
    if (pin.length < 4) { this.loginError.set('Ingresa tu PIN (4+ dígitos).'); return; }
    this.loginProcesando.set(true);
    this.loginError.set('');
    try {
      const u = await this.usuariosSvc.login(this.companyId()!, pin);
      this.usuario.set(u);
      localStorage.setItem(App.LS_USUARIO, JSON.stringify(u));
      this.loginPin.set('');
      this.view.set('menu');
      this.auditar('LOGIN', { descripcion: `Entró ${u.nombre} (${u.rol})` });
    } catch {
      this.loginError.set('PIN incorrecto.');
    } finally {
      this.loginProcesando.set(false);
    }
  }

  // ── Checador (entrada / salida) ─────────────────────────────────────────────
  protected readonly checando = signal(false);
  protected readonly checarMsg = signal('');
  protected async checar(): Promise<void> {
    const u = this.usuario();
    if (!u) return;
    this.checando.set(true);
    try {
      const r: any = await this.usuariosSvc.checar(this.companyId()!, u.id || null, u.nombre);
      this.checarMsg.set(r?.tipo === 'SALIDA' ? '👋 Salida registrada' : '✅ Entrada registrada');
      setTimeout(() => this.checarMsg.set(''), 4000);
    } catch { this.checarMsg.set('No se pudo checar.'); }
    finally { this.checando.set(false); }
  }

  protected cerrarSesion(): void {
    this.auditar('LOGOUT', {});
    this.usuario.set(null);
    localStorage.removeItem(App.LS_USUARIO);
    this.loginPin.set('');
    this.view.set('menu');
  }

  // Registra un movimiento en la bitácora con el usuario actual (no bloquea si falla).
  protected auditar(accion: string, extras: AuditExtras = {}): void {
    this.auditoriaSvc.auditar(accion, extras);   // logger en AuditoriaService
  }

  // Permisos por rol. mesero: mesas/cocina · cajero: + cajas/reportes/inventario · admin: todo
  protected puedeVer(module: RestaurantModule): boolean {
    const rol: Rol = this.usuario()?.rol ?? 'mesero';
    if (module === 'MESAS' || module === 'COCINA') return true;
    if (module === 'CONFIG') return rol === 'admin';
    // CAJAS, REPORTES, INVENTARIO
    return rol === 'cajero' || rol === 'admin';
  }
  protected readonly esAdmin = computed(() => this.usuario()?.rol === 'admin');

  protected selectModule(module: RestaurantModule): void {
    if (!this.puedeVer(module)) return;   // sin permiso, no entra
    this.abrirModulo(module);
  }

  private abrirModulo(module: RestaurantModule): void {
    if (module === 'MESAS') this.view.set('mesas');
    if (module === 'CAJAS') {
      this.cajaNombre.set('');
      this.fondoInicial.set(null);
      this.turnoActivo.set(null);
      this.turnoError.set('');
      this.view.set('cajas');
    }
    if (module === 'REPORTES') {
      this.view.set('reportes');   // el componente <app-reportes> maneja subvista y fecha
    }
    if (module === 'INVENTARIO') {
      this.view.set('inventario');   // el componente <app-inventario> maneja la subvista
    }
    if (module === 'COCINA') {
      this.view.set('cocina');   // el componente <app-cocina> carga y se refresca solo
    }
    if (module === 'CONFIG') {
      this.view.set('config');   // el componente <app-config> maneja su estado
    }
  }

  // Envía una alerta a Telegram (no bloquea si falla).
  private enviarAlerta(mensaje: string): void {
    this.configSvc.enviarAlerta(this.companyId()!, mensaje);
  }

  // ── Configuración · Usuarios (solo admin) ───────────────────────────────────
  protected readonly usuariosResource = httpResource<Usuario[]>(
    () => {
      const enConfig = this.view() === 'config';
      const enAudit  = this.view() === 'reportes';   // carga usuarios para el filtro de auditoría
      return (enConfig || enAudit) && this.esAdmin()
        ? this.usuariosSvc.listUrl(this.companyId()!)
        : undefined;
    },
    { defaultValue: [] },
  );
  protected readonly usuarios = this.usuariosResource.value;

  // ── Mostrar/ocultar claves (botón 👁 junto a cada campo de PIN/contraseña) ──
  private readonly clavesVisibles = signal<ReadonlySet<string>>(new Set<string>());
  protected verClave(id: string): boolean { return this.clavesVisibles().has(id); }
  protected toggleClave(id: string): void {
    const s = new Set(this.clavesVisibles());
    if (s.has(id)) s.delete(id); else s.add(id);
    this.clavesVisibles.set(s);
  }

  // ── Cocina (KDS) → extraído a features/cocina (componente <app-cocina>) ──────

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
      const turno = await this.cajaSvc.abrirTurno(caja, this.cajaNombre().trim() || null, this.fondoInicial() ?? 0);
      this.auditar('ABRIR_TURNO', { entidad: 'TURNO', idEntidad: turno.id, monto: this.fondoInicial() ?? 0, descripcion: `Fondo ${this.fondoInicial() ?? 0}` });
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
      const egreso = await this.cajaSvc.registrarEgreso(turno.id, this.egresoDesc().trim() || null, monto);
      this.egresosLista.update(list => [egreso, ...list]);
      this.auditar('EGRESO', { entidad: 'CAJA', monto, descripcion: this.egresoDesc().trim() || 'Egreso' });
      this.egresoDesc.set('');
      this.egresoMonto.set(null);
      this.resumenCorteResource.reload();   // actualiza el disponible
    } catch (err: any) {
      this.egresoError.set(err?.error?.error ?? 'No se pudo registrar el egreso.');
    } finally {
      this.registrandoEgreso.set(false);
    }
  }

  // ── Corte ─────────────────────────────────────────────────────────────────
  protected abrirCorte(): void {
    this.efectivoContado.set(null);
    this.efectivoContadoEl = null;
    this.arqueo.set({});
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
      const result = await this.cajaSvc.cerrarTurno(turno.id, this.efectivoContado() ?? 0);
      this.corteResultado.set(result);
      this.auditar('CERRAR_TURNO', { entidad: 'TURNO', idEntidad: turno.id, monto: this.efectivoContado() ?? 0, descripcion: `Contado ${this.efectivoContado() ?? 0}` });
      const esp = snapshotResumen?.totales.efectivoEsperado ?? 0;
      const cont = this.efectivoContado() ?? 0;
      const dif = cont - esp;
      this.enviarAlerta(`📊 ${this.companyName()} · Corte de caja\nEsperado: $${esp.toFixed(2)}\nContado: $${cont.toFixed(2)}\nDiferencia: $${dif.toFixed(2)}`);
      if (snapshotResumen) {
        this.corteResumenSnapshot.set({
          ...snapshotResumen,
          totales: {
            ...snapshotResumen.totales,
            efectivoEsperado: snapshotResumen.totales.efectivoEsperado,
          },
        });
      }
      // turnoActivo lo limpia CajaService.cerrarTurno
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

  // exportarExistencias → movido al componente <app-inventario>

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
      await this.mesasSvc.crear(this.companyId()!, nombre, this.nuevaMesaCapacidad());
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
      const fam = await this.productosSvc.crearFamilia(this.companyId()!, nombre);
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
      const sub = await this.productosSvc.crearSubfamilia(this.companyId()!, parent.id, nombre);
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
      await this.productosSvc.editarFamilia(familia.id, this.companyId()!, nombre);
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
      await this.productosSvc.crearProducto({
        idCompany:     this.companyId()!,
        idFamilia:     fam.id,
        idSubfamilia:  this.selectedSubfamilia()?.id ?? null,
        identificador: this.prodIdentificador().trim() || null,
        description:   desc,
        ventaMN:       precio,
        costoMN:       this.prodCosto(),
      });
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
    this.moverFamiliaId.set(this.selectedFamilia()?.id ?? null);
    this.moverSubfamiliaId.set(this.selectedSubfamilia()?.id ?? null);
    this.prodActivo.set(!this.verInactivos());   // si estás viendo inactivos, el producto está inactivo
    this.editandoProducto.set(prod);
    void this.inventarioSvc.cargarConfigProducto(prod.id);   // cfg del producto (servicio)
    void this.cargarReceta(prod.id);                         // receta (queda en App)
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
      await this.productosSvc.editarProducto(prod.id, this.companyId()!, desc, precio);
      // Guardar configuración de inventario (no bloquea si falla).
      try { await this.inventarioSvc.guardarConfigProducto(prod.id); }
      catch { /* config opcional */ }
      // Guardar receta / insumos (no bloquea si falla).
      try { await this.guardarReceta(prod.id); }
      catch { /* receta opcional */ }
      // Mover a otra familia/subfamilia si cambió.
      const famDestino = this.moverFamiliaId();
      const subDestino = this.moverSubfamiliaId();
      const cambioFamilia = famDestino !== null &&
        (famDestino !== (this.selectedFamilia()?.id ?? null) ||
         subDestino !== (this.selectedSubfamilia()?.id ?? null));
      if (cambioFamilia) {
        try {
          await this.productosSvc.moverProducto(prod.id, this.companyId()!, famDestino, subDestino);
        } catch { /* si falla el movimiento, el resto ya se guardó */ }
      }
      // Activar / desactivar si cambió respecto al listado actual.
      const activoActual = !this.verInactivos();
      if (this.prodActivo() !== activoActual) {
        try {
          await this.productosSvc.activarProducto(prod.id, this.companyId()!, this.prodActivo());
        } catch { /* no bloquea */ }
      }
      this.editandoProducto.set(null);
      this.productosResource.reload();
      this.familiasResource.reload();
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
      await this.mesasSvc.editar(mesa.id, this.companyId()!, nombre, this.editMesaCapacidad());
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
      if (mesa.idCuentaActual) void this.cargarModoCuenta(mesa.idCuentaActual);
    } else {
      void this.openFreeMesa(mesa);
    }
  }

  private async openFreeMesa(mesa: Mesa): Promise<void> {
    this.openingMesa.set(true);
    try {
      const cuenta = await this.cuentaSvc.abrir(this.companyId()!, mesa.id);
      this.selectedMesa.set({
        ...mesa,
        tieneCuentaAbierta: true,
        idCuentaActual: cuenta.id,
        totalActual: cuenta.total,
      });
      this.view.set('familias');
      this.auditar('ABRIR_MESA', { entidad: 'MESA', idEntidad: mesa.id, idMesa: mesa.id, nombreMesa: mesa.nombre });
      // Mesa nueva → preguntar si la cuenta es junta o separada.
      this.preguntaPaso.set('modo');
      this.prePersonas.set(2);
      this.preguntaMesa.set(true);
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
    this.prodBusqueda.set('');   // evita que un filtro previo siga "vivo"
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
    this.extrasSel.set(new Set());
    void this.cargarConfigVenta(producto.id);
  }

  // ── Modificadores / extras (con precio) ─────────────────────────────────────
  protected readonly extrasComunes = [
    { n: 'Extra queso', p: 10 }, { n: 'Extra carne', p: 20 }, { n: 'Doble', p: 15 },
    { n: 'Tocino', p: 12 }, { n: 'Aguacate', p: 10 }, { n: 'Aderezo extra', p: 5 },
  ];
  protected readonly extrasSel = signal<Set<number>>(new Set());
  protected toggleExtra(i: number): void {
    this.extrasSel.update(s => { const n = new Set(s); n.has(i) ? n.delete(i) : n.add(i); return n; });
  }
  protected extraActivo(i: number): boolean { return this.extrasSel().has(i); }
  protected readonly extrasTotal = computed(() =>
    [...this.extrasSel()].reduce((sum, i) => sum + (this.extrasComunes[i]?.p ?? 0), 0));
  protected readonly extrasTexto = computed(() =>
    [...this.extrasSel()].map(i => this.extrasComunes[i]?.n).filter(Boolean).join(', '));

  protected cancelarProducto(): void {
    this.selectedProducto.set(null);
    this.addError.set('');
    this.cantidadCustom.set(null);
  }

  // Cantidades rápidas + cantidad personalizada.
  protected readonly cantidadesRapidas = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 15, 20];
  protected readonly cantidadCustom = signal<number | null>(null);
  protected setCantidadCustom(e: Event): void {
    const v = parseInt((e.target as HTMLInputElement).value, 10);
    this.cantidadCustom.set(!isNaN(v) && v > 0 ? v : null);
  }
  protected agregarCustom(): void {
    const n = this.cantidadCustom();
    if (n && n > 0) void this.agregarProducto(n);
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
    const precio = this.precioVentaActual() + this.extrasTotal();

    const nota = this.prodNota().trim();
    const extras = this.extrasTexto();
    let etiqueta = presentacion === 'COPA' ? `${producto.description} (Copa)` : producto.description;
    if (extras) etiqueta += ` + ${extras}`;
    const descripcion = nota ? `${etiqueta} (${nota})` : etiqueta;

    this.agregandoItem.set(true);
    this.addError.set('');
    try {
      await this.cuentaSvc.agregarItem(mesa.idCuentaActual, {
        idMaterial: producto.id, descripcion, cantidad, precio, presentacion,
        comensal: this.cuentaSeparada() ? this.comensalSel() : 1,
      });
      this.selectedProducto.set(null);
      this.prodNota.set('');
      this.cantidadCustom.set(null);
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
      await this.cuentaSvc.eliminarItem(mesa.idCuentaActual, item.id,
        { cantidad: item.cantidad, precio: item.precioUnitario });
      this.itemsResource.reload();
    } finally {
      this.eliminandoId.set(null);
    }
  }

  // Cambiar un producto: lo quita (sin PIN, antes de cobrar) y lleva a elegir el nuevo.
  protected async cambiarItem(item: ItemCuenta): Promise<void> {
    // Conserva la persona del producto que se cambia (cuenta separada).
    if (this.cuentaSeparada() && item.comensal) this.comensalSel.set(item.comensal);
    await this.eliminarItem(item);
    this.prodBusqueda.set('');
    this.view.set('familias');
  }

  // ── Autorización de supervisor (cancelación / cortesía / descuento) ─────────
  protected readonly authAccion = signal<{ tipo: 'cancelar' | 'cortesia' | 'descuento'; item?: ItemCuenta } | null>(null);
  protected readonly authMotivo = signal('');
  protected readonly authPor    = signal('');
  protected readonly authPin     = signal('');
  protected readonly authError   = signal('');
  protected readonly authProcesando = signal(false);
  protected readonly descModo  = signal<'porc' | 'monto'>('porc');
  protected readonly descValor = signal<number | null>(null);

  protected setAuthMotivo(e: Event): void { this.authMotivo.set((e.target as HTMLInputElement).value); }
  protected setAuthPor(e: Event): void { this.authPor.set((e.target as HTMLInputElement).value); }
  protected setAuthPin(e: Event): void { this.authPin.set((e.target as HTMLInputElement).value); }
  protected setDescModo(m: 'porc' | 'monto'): void { this.descModo.set(m); }
  protected setDescValor(e: Event): void {
    const v = parseFloat((e.target as HTMLInputElement).value);
    this.descValor.set(!isNaN(v) && v >= 0 ? v : null);
  }

  private resetAuth(): void {
    this.authMotivo.set('');
    this.authPor.set('');
    this.authPin.set('');
    this.authError.set('');
  }
  protected pedirCancelar(item: ItemCuenta): void { this.resetAuth(); this.authAccion.set({ tipo: 'cancelar', item }); }
  protected pedirCortesia(item: ItemCuenta): void { this.resetAuth(); this.authAccion.set({ tipo: 'cortesia', item }); }
  protected pedirDescuento(): void {
    this.resetAuth();
    this.descModo.set('porc');
    this.descValor.set(null);
    this.authAccion.set({ tipo: 'descuento' });
  }
  protected cerrarAuth(): void { this.authAccion.set(null); }

  protected calcDescuento(): number {
    const v = this.descValor() ?? 0;
    if (v <= 0) return 0;
    const total = this.totalCuenta();
    const monto = this.descModo() === 'porc' ? (total * v) / 100 : Math.min(v, total);
    return Math.round(monto * 100) / 100;
  }

  protected async confirmarAuth(): Promise<void> {
    const acc = this.authAccion();
    if (!acc) return;
    if (!this.authPor().trim()) { this.authError.set('Indica quién autoriza.'); return; }
    // Valida el PIN de supervisor en el backend (por empresa).
    try {
      const r: any = await this.usuariosSvc.validarPin(this.companyId()!, this.authPin());
      if (!r?.ok) { this.authError.set('PIN de supervisor incorrecto.'); return; }
    } catch {
      this.authError.set('No se pudo validar el PIN. Intenta de nuevo.'); return;
    }

    const mesa = this.selectedMesa();
    const idCuenta = mesa?.idCuentaActual;
    const motivo = this.authMotivo().trim();
    const por = this.authPor().trim();

    this.authProcesando.set(true);
    this.authError.set('');
    try {
      const nm = this.selectedMesa()?.nombre ?? null;
      if (acc.tipo === 'descuento') {
        const monto = this.calcDescuento();
        if (monto <= 0) { this.authError.set('Indica un descuento válido.'); return; }
        this.descuentoAplicado.set({ monto, motivo, por });
        this.auditar('DESCUENTO', { entidad: 'CUENTA', idEntidad: idCuenta, monto, nombreMesa: nm, descripcion: `${motivo || 'Descuento'} · autoriza ${por}` });
        this.authAccion.set(null);
      } else if (acc.tipo === 'cortesia' && acc.item && idCuenta) {
        await this.cuentaSvc.cortesiaItem(idCuenta, acc.item.id, {
          idCompany: this.companyId()!, tipo: 'CORTESIA', descripcion: acc.item.descripcion, motivo, autorizadoPor: por,
        });
        this.auditar('CORTESIA', { entidad: 'CUENTA', idEntidad: idCuenta, monto: acc.item.subtotal, nombreMesa: nm, descripcion: `${acc.item.descripcion} · autoriza ${por}` });
        this.itemsResource.reload();
        this.authAccion.set(null);
      } else if (acc.tipo === 'cancelar' && acc.item && idCuenta) {
        await this.cuentaSvc.eliminarItem(idCuenta, acc.item.id,
          { cantidad: acc.item.cantidad, precio: acc.item.precioUnitario });
        await this.cuentaSvc.autorizacion(idCuenta, {
          idCompany: this.companyId()!, tipo: 'CANCELACION', descripcion: acc.item.descripcion,
          monto: acc.item.subtotal, motivo, autorizadoPor: por,
        });
        this.auditar('CANCELAR_ITEM', { entidad: 'CUENTA', idEntidad: idCuenta, monto: acc.item.subtotal, nombreMesa: nm, descripcion: `${acc.item.descripcion} · autoriza ${por}` });
        this.itemsResource.reload();
        this.authAccion.set(null);
      }
    } catch {
      this.authError.set('No se pudo completar la acción.');
    } finally {
      this.authProcesando.set(false);
    }
  }

  protected quitarDescuento(): void { this.descuentoAplicado.set(null); }

  // ── Cobro: sigue el modo de la cuenta (junta → normal, separada → por persona) ─
  protected readonly showCobroSeparado = signal(false);
  protected readonly cuentaCerradaComensal = signal(false);

  protected iniciarCobro(): void {
    const separada = this.cuentaSeparada() || this.items().some(i => i.pagado);
    if (separada) {
      this.descuentoAplicado.set(null);   // el descuento global no aplica en separado
      this.showCobroSeparado.set(true);
    } else {
      this.cobroComensal.set(null);
      this.abrirPago();
    }
  }
  protected cerrarCobroSeparado(): void { this.showCobroSeparado.set(false); }
  protected cobrarEsteComensal(comensal: number): void {
    this.cobroComensal.set(comensal);
    this.showCobroSeparado.set(false);
    this.abrirPago();
  }

  // ── Pago ──────────────────────────────────────────────────────────────────
  protected setTipoPago(tipo: TipoPago): void {
    this.tipoPago.set(tipo);
    this.montoPagado.set(null);
    this.montoTarjeta.set(null);
    if (tipo === 'EFECTIVO') this.referenciaTarjeta.set('');
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
    this.referenciaTarjeta.set('');
    this.propina.set(null);
    this.clienteTel.set('');
    this.clientePuntos.set(null);
    this.montoPagadoEl  = null;
    this.montoTarjetaEl = null;
    this.cobroError.set('');
    this.showPayment.set(true);
    // Enfoca el campo de pago al abrir (evita tener que darle click).
    setTimeout(() => {
      const el = document.getElementById('monto-pagado-input') as HTMLInputElement | null;
      el?.focus();
      el?.select();
    }, 60);
  }

  protected cancelarPago(): void {
    this.showPayment.set(false);
    this.cobroError.set('');
    // Si estaba cobrando un comensal, regresa a la lista de comensales.
    if (this.cobroComensal() != null) {
      this.cobroComensal.set(null);
      this.showCobroSeparado.set(true);
    }
  }

  protected async confirmarCobro(): Promise<void> {
    const mesa = this.selectedMesa();
    if (!mesa?.idCuentaActual) return;
    if (!this.pagoSuficiente()) {
      this.cobroError.set('El monto recibido no cubre el total.');
      return;
    }

    const comensal = this.cobroComensal();
    const tipo = this.tipoPago();
    const desc = this.descuentoAplicado();
    const snapshotTotal = this.totalAPagar();
    const snapshotItems = comensal != null
      ? this.items().filter(i => (i.comensal ?? 1) === comensal)
      : [...this.items()];
    const snapshotCambio = this.cambio();
    const efectivoPagado = tipo === 'TARJETA' ? snapshotTotal : (this.montoPagado() ?? 0);
    const tarjetaPagada = tipo === 'MIXTO' ? (this.montoTarjeta() ?? 0) : 0;

    this.cobrando.set(true);
    this.cobroError.set('');
    try {
      const refTarjeta = tipo === 'EFECTIVO' ? null : (this.referenciaTarjeta().trim() || null);
      if (comensal != null) {
        const res: any = await this.cuentaSvc.cobrarComensal(mesa.idCuentaActual, {
          idCompany: this.companyId()!, tipoPago: tipo, comensal, referenciaTarjeta: refTarjeta,
        });
        this.cuentaCerradaComensal.set(!!res?.cuentaCerrada);
      } else {
        await this.cuentaSvc.cobrar(mesa.idCuentaActual, {
          idCompany: this.companyId()!,
          tipoPago: tipo,
          descuento: desc?.monto ?? 0,
          descuentoMotivo: desc?.motivo ?? null,
          descuentoAutorizadoPor: desc?.por ?? null,
          referenciaTarjeta: refTarjeta,
          telefonoCliente: this.clienteTel().trim() || null,
        });
        this.cuentaCerradaComensal.set(true);
      }

      this.ticketData.set({
        companyName: this.companyName(),
        mesaNombre: comensal != null ? `${mesa.nombre} · Persona ${comensal}` : mesa.nombre,
        idCuenta: mesa.idCuentaActual,
        items: snapshotItems,
        total: snapshotTotal,
        tipoPago: tipo,
        montoPagado: efectivoPagado,
        montoTarjeta: tarjetaPagada,
        cambio: snapshotCambio,
        fecha: new Date(),
        atendioPor: mesa.meseroApertura ?? null,   // mesero que abrió (backend)
        cobradoPor: this.usuario()?.nombre ?? null, // usuario logueado que cobra
      });

      this.showPayment.set(false);
      this.ticketVisible.set(true);
      this.auditar(comensal != null ? 'COBRO_COMENSAL' : 'COBRO', {
        entidad: 'CUENTA', idEntidad: mesa.idCuentaActual, monto: snapshotTotal,
        idMesa: mesa.id, nombreMesa: mesa.nombre,
        descripcion: `${tipo}${comensal != null ? ' · Persona ' + comensal : ''}`,
      });
      const prop = this.propina();
      if (prop && prop > 0) {
        this.auditar('PROPINA', { entidad: 'CUENTA', idEntidad: mesa.idCuentaActual, monto: prop, nombreMesa: mesa.nombre, descripcion: tipo });
      }
      this.itemsResource.reload();   // refresca lo que queda por cobrar
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
        { text: `Ticket #${t.idCuenta} · ${new Date(t.fecha).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })}`, fontSize: 7, color: '#666', margin: [0, 0, 0, (t.atendioPor || t.cobradoPor) ? 2 : 8] },
        ...(t.atendioPor ? [{ text: `Atendió: ${t.atendioPor}`, fontSize: 7, margin: [0, 0, 0, 1] }] : []),
        ...(t.cobradoPor ? [{ text: `Cobró: ${t.cobradoPor}`, fontSize: 7, margin: [0, 0, 0, 8] }] : []),
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

  // ── Impresión desde la TABLET (sistema Android, no la nube) ──────────────────
  // Genera HTML 80 mm y lo manda al diálogo de impresión del dispositivo.
  private printHtml80(inner: string): void {
    const css = `
      @page { size: 80mm auto; margin: 0; }
      * { box-sizing: border-box; }
      body { width: 80mm; margin: 0; padding: 4mm 3mm; font-family: 'Courier New', monospace; color: #000; }
      .c { text-align: center; }
      .b { font-weight: bold; }
      .big { font-size: 15px; }
      .ln { border-top: 1px dashed #000; margin: 4px 0; }
      table { width: 100%; border-collapse: collapse; font-size: 11px; }
      td { padding: 1px 0; vertical-align: top; }
      .r { text-align: right; }
      .ct { text-align: center; }
      .sm { font-size: 10px; color: #333; }
      h1 { font-size: 14px; margin: 2px 0; }
    `;
    const html = `<!doctype html><html><head><meta charset="utf-8"><style>${css}</style></head><body>${inner}</body></html>`;
    const iframe = document.createElement('iframe');
    iframe.style.position = 'fixed';
    iframe.style.right = '0';
    iframe.style.bottom = '0';
    iframe.style.width = '0';
    iframe.style.height = '0';
    iframe.style.border = '0';
    document.body.appendChild(iframe);
    const doc = iframe.contentWindow?.document;
    if (!doc) { document.body.removeChild(iframe); return; }
    doc.open(); doc.write(html); doc.close();
    setTimeout(() => {
      try { iframe.contentWindow?.focus(); iframe.contentWindow?.print(); }
      finally { setTimeout(() => iframe.remove(), 1000); }
    }, 250);
  }

  private esc(s: string): string {
    return (s ?? '').replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c] || c));
  }

  protected imprimirTicketTablet(): void {
    const t = this.ticketData();
    if (!t) return;
    const filas = t.items.map(i =>
      `<tr><td>${i.cantidad}x ${this.esc(i.descripcion ?? 'Item')}</td><td class="r">$${i.subtotal.toFixed(2)}</td></tr>`).join('');
    const inner = `
      <div class="c b big">${this.esc(t.companyName)}</div>
      <div class="c sm">${this.esc(t.mesaNombre)} · Ticket #${t.idCuenta}</div>
      <div class="c sm">${new Date(t.fecha).toLocaleString('es-MX')}</div>
      ${t.atendioPor ? `<div class="c sm">Atendió: ${this.esc(t.atendioPor)}</div>` : ''}
      ${t.cobradoPor ? `<div class="c sm">Cobró: ${this.esc(t.cobradoPor)}</div>` : ''}
      <div class="ln"></div>
      <table>${filas}</table>
      <div class="ln"></div>
      <table>
        <tr><td class="b">TOTAL</td><td class="r b">$${t.total.toFixed(2)}</td></tr>
        <tr><td>Pago (${this.esc(t.tipoPago)})</td><td class="r">$${t.montoPagado.toFixed(2)}</td></tr>
        ${t.cambio > 0 ? `<tr><td class="b">Cambio</td><td class="r b">$${t.cambio.toFixed(2)}</td></tr>` : ''}
      </table>
      <div class="ln"></div>
      <div class="c sm">¡Gracias por su visita!</div>
    `;
    this.printHtml80(inner);
  }

  // Comanda para cocina (desde la cuenta) — imprime lo que hay en la mesa.
  protected imprimirComandaTablet(): void {
    const mesa = this.selectedMesa();
    const items = this.items();
    if (!items.length) return;
    const filas = items.map(i => `<tr><td class="b">${i.cantidad}x ${this.esc(i.descripcion)}</td></tr>`).join('');
    const inner = `
      <div class="c b big">COCINA</div>
      <div class="c b">${this.esc(mesa?.nombre ?? 'Mesa')}</div>
      <div class="c sm">${new Date().toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })}</div>
      <div class="ln"></div>
      <table>${filas}</table>
      <div class="ln"></div>
      <div class="c sm">*** COMANDA ***</div>
    `;
    this.printHtml80(inner);
  }

  protected cerrarTicket(): void {
    this.ticketVisible.set(false);
    this.ticketData.set(null);
    // Cobro por comensal con productos aún pendientes → vuelve a la lista.
    if (this.cobroComensal() != null && !this.cuentaCerradaComensal()) {
      this.cobroComensal.set(null);
      this.showCobroSeparado.set(true);
      return;
    }
    this.cobroComensal.set(null);
    this.backToMesas();
  }

  // ── Navegación atrás ──────────────────────────────────────────────────────
  protected backToFamilias(): void {
    this.view.set('familias');
    this.selectedFamilia.set(null);
    this.selectedSubfamilia.set(null);
    this.selectedProducto.set(null);
    this.addError.set('');
    this.prodBusqueda.set('');
  }

  protected backToMesas(): void {
    this.view.set('mesas');
    this.selectedMesa.set(null);
    this.selectedFamilia.set(null);
    this.selectedSubfamilia.set(null);
    this.selectedProducto.set(null);
    this.showPayment.set(false);
    this.prodBusqueda.set('');
    this.descuentoAplicado.set(null);
    this.cuentaSeparada.set(false);
    this.numComensales.set(1);
    this.comensalSel.set(1);
    this.cobroComensal.set(null);
    this.showCobroSeparado.set(false);
    this.mesasResource.reload();
  }

  protected backToMenu(): void {
    this.view.set('menu');
    this.selectedMesa.set(null);
    this.selectedFamilia.set(null);
    this.selectedSubfamilia.set(null);
    this.selectedProducto.set(null);
    this.showPayment.set(false);
    this.prodBusqueda.set('');
    this.turnoActivo.set(null);
    this.turnoError.set('');
  }
}
