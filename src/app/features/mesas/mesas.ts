import { CurrencyPipe, DatePipe } from '@angular/common';
import { httpResource } from '@angular/common/http';
import { Component, computed, effect, inject, input, output, signal } from '@angular/core';
import pdfMake from 'pdfmake/build/pdfmake';
import { MesaListo } from '../../models/cocina';
import { Familia, ItemCuenta, Producto } from '../../models/familia';
import { ProductoInventario, RecetaItem } from '../../models/inventario';
import { Mesa } from '../../models/mesa';
import { AuditExtras, AuditoriaService } from '../../core/auditoria.service';
import { RealtimeService } from '../../core/realtime.service';
import { logoToDataUrl } from '../../shared/util/logo';
import { sonarCampana } from '../../shared/util/campana';
import { CocinaService } from '../cocina/cocina.service';
import { InventarioService } from '../inventario/inventario.service';
import { UsuariosService } from '../usuarios/usuarios.service';
import { MesasService } from './mesas.service';
import { ProductosService } from '../productos/productos.service';
import { CuentaService } from '../cuenta/cuenta.service';

type MesasVista = 'salon' | 'familias' | 'productos' | 'cuenta';
type Presentacion = 'COMPLETA' | 'COPA';
type TipoPago = 'EFECTIVO' | 'TARJETA' | 'MIXTO';

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

/**
 * Flujo central de tomar y cobrar una orden: salón de mesas → familias/productos
 * → cuenta → pago → ticket, más comensales/dividir, transferir/unir, para llevar
 * y las autorizaciones con PIN. Se monta cuando la vista de App es 'mesas' y
 * maneja su propia sub-navegación (`subVista`). El estado compartido de largo
 * alcance vive en los stores (MesasService/ProductosService/CuentaService).
 */
@Component({
  selector: 'app-mesas',
  imports: [CurrencyPipe, DatePipe],
  templateUrl: './mesas.html',
  styleUrl: './mesas.scss',
})
export class Mesas {
  private readonly mesasSvc     = inject(MesasService);
  private readonly productosSvc = inject(ProductosService);
  private readonly cuentaSvc    = inject(CuentaService);
  private readonly inventarioSvc = inject(InventarioService);
  private readonly usuariosSvc  = inject(UsuariosService);
  private readonly cocina       = inject(CocinaService);
  private readonly auditoriaSvc = inject(AuditoriaService);
  private readonly realtimeSvc  = inject(RealtimeService);

  /** Empresa activa y datos de la empresa (los pasa el componente padre). */
  readonly companyId   = input.required<number>();
  readonly companyName = input.required<string>();
  readonly companyLogo = input<string | null>(null);
  /** true cuando se entró desde Cajas → Cobrar mesa (acceso rápido); al cerrar el ticket
   *  se regresa a la lista de cobro en vez de al salón completo de mesas. */
  readonly origenCaja = input(false);
  /** Pide al padre volver (al menú, o a Cajas si `origenCaja`). */
  readonly back = output<void>();

  // ── Sub-navegación interna (antes eran vistas 'mesas'/'familias'/'productos'/'cuenta') ──
  protected readonly subVista = signal<MesasVista>(
    this.cuentaSvc.selectedMesa()?.tieneCuentaAbierta ? 'cuenta' : 'salon',
  );

  // ── Estado en stores (alias para plantilla/métodos) ──
  protected readonly selectedMesa = this.cuentaSvc.selectedMesa;
  protected readonly mesas = this.mesasSvc.mesas;
  protected readonly loading = this.mesasSvc.loading;

  protected readonly selectedFamilia    = this.productosSvc.selectedFamilia;
  protected readonly selectedSubfamilia = this.productosSvc.selectedSubfamilia;
  protected readonly verInactivos       = this.productosSvc.verInactivos;
  protected readonly familias        = this.productosSvc.familias;
  protected readonly familiasLoading = this.productosSvc.familiasLoading;
  protected readonly familiasError   = this.productosSvc.familiasError;
  protected readonly familiasResource   = this.productosSvc.familiasResource;
  protected readonly subfamilias        = this.productosSvc.subfamilias;
  protected readonly subfamiliasResource = this.productosSvc.subfamiliasResource;
  protected readonly mostrarSubfamilias = this.productosSvc.mostrarSubfamilias;
  protected readonly productos        = this.productosSvc.productos;
  protected readonly productosLoading = this.productosSvc.productosLoading;
  protected readonly productosError   = this.productosSvc.productosError;
  protected readonly productosResource = this.productosSvc.productosResource;

  protected readonly itemsResource   = this.cuentaSvc.itemsResource;
  protected readonly items           = this.cuentaSvc.items;
  protected readonly itemsPendientes = this.cuentaSvc.itemsPendientes;
  protected readonly totalCuenta     = this.cuentaSvc.totalCuenta;
  protected readonly cuentaSeparada  = this.cuentaSvc.cuentaSeparada;
  protected readonly numComensales   = this.cuentaSvc.numComensales;
  protected readonly comensalSel     = this.cuentaSvc.comensalSel;

  // ── Configuración de venta / inventario (alias a InventarioService) ──
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

  // ── Mesas (grid) ──
  protected readonly openingMesa = signal(false);
  protected readonly mesaActionError = signal('');
  protected readonly showNuevaMesa  = signal(false);
  protected readonly editandoMesa       = signal<Mesa | null>(null);
  protected readonly editMesaNombre     = signal('');
  protected readonly editMesaCapacidad  = signal<number | null>(null);
  protected readonly guardandoMesa      = signal(false);
  protected readonly editMesaError      = signal('');
  protected readonly nuevaMesaNombre = signal('');
  protected readonly nuevaMesaCapacidad = signal<number | null>(null);
  protected readonly creandoMesa = signal(false);
  protected readonly crearMesaError = signal('');

  // ── Familias / productos ──
  protected readonly selectedProducto = signal<Producto | null>(null);
  protected readonly agregandoItem = signal(false);
  protected readonly addError = signal('');
  protected readonly prodNota = signal('');
  protected readonly notasRapidas = ['Sin cebolla', 'Sin picante', 'Bien cocido', 'Para llevar'];
  protected readonly prodBusqueda = signal('');
  protected readonly eliminandoId = signal<number | null>(null);
  protected readonly prodActivo   = signal(true);

  // ── Nuevo agrupador (familia / subfamilia) ──
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

  // ── Editar agrupador (familia) ──
  protected readonly showEditarFamilia    = signal(false);
  protected readonly editandoFamilia      = signal<Familia | null>(null);
  protected readonly editarFamiliaNombre  = signal('');
  protected readonly guardandoFamilia     = signal(false);
  protected readonly editarFamiliaError   = signal('');

  // ── Nuevo producto ──
  protected readonly showNuevoProducto  = signal(false);
  protected readonly prodIdentificador  = signal('');
  protected readonly prodDescripcion    = signal('');
  protected readonly prodPrecio         = signal<number | null>(null);
  protected readonly prodCosto          = signal<number | null>(null);
  protected readonly creandoProducto    = signal(false);
  protected readonly crearProductoError = signal('');

  // ── Editar producto ──
  protected readonly editandoProducto     = signal<Producto | null>(null);
  protected readonly editProdDescripcion  = signal('');
  protected readonly editProdPrecioStr    = signal('');
  protected readonly editProdPrecio       = signal<number | null>(null);
  protected readonly guardandoProducto    = signal(false);
  protected readonly editProductoError    = signal('');
  protected readonly moverFamiliaId    = signal<number | null>(null);
  protected readonly moverSubfamiliaId = signal<number | null>(null);
  protected readonly famModalResource = httpResource<Familia[]>(
    () => this.editandoProducto() !== null
      ? this.productosSvc.familiasUrl(this.companyId())
      : undefined,
    { defaultValue: [] },
  );
  protected readonly subfamModalResource = httpResource<Familia[]>(
    () => {
      const fam = this.moverFamiliaId();
      return this.editandoProducto() !== null && fam
        ? this.productosSvc.subfamiliasUrl(this.companyId(), fam)
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
  protected toggleVerInactivos(): void {
    this.verInactivos.update(v => !v);
    this.productosResource.reload();
  }
  protected setProdActivo(e: Event): void { this.prodActivo.set((e.target as HTMLInputElement).checked); }

  // ── Receta / insumos del platillo ──
  protected readonly receta = signal<RecetaItem[]>([]);
  protected readonly recetaBusqueda = signal('');
  protected setRecetaBusqueda(e: Event): void { this.recetaBusqueda.set((e.target as HTMLInputElement).value); }
  protected readonly recetaBuscaResource = httpResource<Producto[]>(
    () => {
      const term = this.recetaBusqueda().trim();
      if (this.editandoProducto() === null || term.length < 2) return undefined;
      return this.productosSvc.buscarUrl(this.companyId(), term);
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

  // ── Venta: presentación completa / copa ──
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

  // ── Modificadores / extras (con precio) ──
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

  // Búsqueda global en el catálogo (activa con 2+ caracteres).
  protected readonly buscando = computed(() => this.prodBusqueda().trim().length >= 2);
  protected readonly busquedaResource = httpResource<Producto[]>(
    () => {
      if (this.subVista() !== 'productos' && this.subVista() !== 'familias') return undefined;
      const term = this.prodBusqueda().trim();
      if (term.length < 2) return undefined;
      return this.productosSvc.buscarUrl(this.companyId(), term);
    },
    { defaultValue: [] },
  );

  // ── Cuenta ──
  protected readonly descuentoAplicado = signal<{ monto: number; motivo: string; por: string } | null>(null);
  protected readonly enviandoACaja = signal(false);

  // ── Comensales ──
  protected readonly avisoJuntar     = signal(false);
  protected readonly juntarBloqueado = signal(false);
  protected readonly preguntaMesa = signal(false);
  protected readonly preguntaPaso = signal<'modo' | 'personas'>('modo');
  protected readonly prePersonas  = signal(2);
  protected readonly cobroComensal = signal<number | null>(null);
  protected readonly dividirEntre = signal(1);
  protected readonly montoPorPersona = computed(() => {
    const n = this.dividirEntre();
    return n > 1 ? this.totalCuenta() / n : 0;
  });
  protected readonly personasDisponibles = computed(() => {
    const maxItem = this.items().reduce((m, i) => Math.max(m, i.comensal ?? 1), 1);
    const total = Math.max(this.numComensales(), maxItem);
    return Array.from({ length: total }, (_, i) => i + 1);
  });
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

  // ── Pago ──
  protected readonly showPayment = signal(false);
  protected readonly tipoPago = signal<TipoPago>('EFECTIVO');
  protected readonly montoPagado  = signal<number | null>(null);
  protected readonly montoTarjeta = signal<number | null>(null);
  protected readonly referenciaTarjeta = signal('');
  protected setReferenciaTarjeta(e: Event): void { this.referenciaTarjeta.set((e.target as HTMLInputElement).value); }
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
      const acc: any = await this.cuentaSvc.consultarPuntos(this.companyId(), tel);
      this.clientePuntos.set(acc?.totalPoints ?? 0);
    } catch { this.clientePuntos.set(0); }
  }
  protected readonly propina = signal<number | null>(null);
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
  protected readonly pagoSuficiente = computed(() => {
    const total = this.totalAPagar();
    const tipo = this.tipoPago();
    if (tipo === 'TARJETA') return true;
    const efectivo = this.montoPagado() ?? 0;
    if (tipo === 'EFECTIVO') return efectivo >= total;
    const tarjeta = this.montoTarjeta() ?? 0;
    return (efectivo + tarjeta) >= total;
  });
  protected readonly totalAPagar = computed(() => {
    const c = this.cobroComensal();
    if (c != null) {
      return this.items().filter(i => (i.comensal ?? 1) === c && !i.pagado).reduce((s, i) => s + i.subtotal, 0);
    }
    return Math.max(0, this.totalCuenta() - (this.descuentoAplicado()?.monto ?? 0));
  });
  protected readonly showCobroSeparado = signal(false);
  protected readonly cuentaCerradaComensal = signal(false);

  // ── Ticket ──
  protected readonly ticketData = signal<TicketData | null>(null);
  protected readonly ticketVisible = signal(false);

  // ── Para llevar / domicilio ──
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
    () => this.subVista() === 'salon'
      ? this.cuentaSvc.llevarUrl(this.companyId())
      : undefined,
    { defaultValue: [] },
  );

  // ── Autorización de supervisor ──
  protected readonly authAccion = signal<{ tipo: 'cancelar' | 'cortesia' | 'descuento'; item?: ItemCuenta } | null>(null);
  protected readonly authMotivo = signal('');
  protected readonly authPor    = signal('');
  protected readonly authPin     = signal('');
  protected readonly authError   = signal('');
  protected readonly authProcesando = signal(false);
  protected readonly descModo  = signal<'porc' | 'monto'>('porc');
  protected readonly descValor = signal<number | null>(null);

  // ── Mostrar/ocultar claves (botón 👁 junto al campo de PIN) ──
  private readonly clavesVisibles = signal<ReadonlySet<string>>(new Set<string>());
  protected verClave(id: string): boolean { return this.clavesVisibles().has(id); }
  protected toggleClave(id: string): void {
    const s = new Set(this.clavesVisibles());
    if (s.has(id)) s.delete(id); else s.add(id);
    this.clavesVisibles.set(s);
  }

  // ── Aviso al mesero: platillos listos de cocina, pendientes de entregar ──
  protected readonly listosResource = httpResource<MesaListo[]>(
    () => {
      this.mesasSvc.tick();   // se refresca con el mismo latido que las mesas
      return this.subVista() === 'salon'
        ? this.cocina.listosUrl(this.companyId())
        : undefined;
    },
    { defaultValue: [] },
  );
  protected readonly mesaListos = computed(() => new Set(this.listosResource.value().map(l => l.idCuenta)));
  protected mesaTieneListo(mesa: Mesa): boolean {
    return mesa.idCuentaActual != null && this.mesaListos().has(mesa.idCuentaActual);
  }
  protected readonly marcandoEntregado = signal<number | null>(null);

  // Cuentas ya avisadas (para sonar la campana solo cuando aparece una NUEVA).
  private listosAvisados = new Set<number>();
  private cobradasAvisadas = new Set<number>();

  constructor() {
    // Sincroniza la empresa y la sub-vista activa hacia el store del catálogo,
    // que decide qué recursos (familias/subfamilias/productos) mantener vivos.
    effect(() => this.productosSvc.companyId.set(this.companyId()));
    effect(() => this.productosSvc.enFamilias.set(this.subVista() === 'familias'));
    effect(() => this.productosSvc.enProductos.set(this.subVista() === 'productos'));
    // Los items de la cuenta se cargan en familias/productos/cuenta.
    effect(() => {
      const v = this.subVista();
      this.cuentaSvc.enCuentaVista.set(v === 'familias' || v === 'productos' || v === 'cuenta');
    });

    // "Volver al salón" desde fuera (botón 🍽️ Mesas de la barra superior): App
    // pone `selectedMesa` en null; este efecto regresa a la grilla. También cubre
    // el montaje inicial (corre una vez de inmediato).
    effect(() => { if (!this.cuentaSvc.selectedMesa()) this.subVista.set('salon'); });

    // Si me montaron con una mesa ya abierta (Cajas → cobrar mesa rápido), arranco
    // en la cuenta y restauro su modo (junta/separada), que antes hacía Cajas.
    const preMesa = this.cuentaSvc.selectedMesa();
    if (preMesa?.tieneCuentaAbierta) {
      this.dividirEntre.set(1);
      if (preMesa.idCuentaActual) void this.cargarModoCuenta(preMesa.idCuentaActual);
    }

    // Suena la campana cuando cocina marca un platillo listo (cuenta nueva en la
    // lista). Solo en la grilla del salón, igual que antes.
    effect(() => {
      if (this.subVista() !== 'salon') return;
      const ids = this.listosResource.value().map(l => l.idCuenta);
      const hayNuevo = ids.some(id => !this.listosAvisados.has(id));
      this.listosAvisados = new Set(ids);   // solo las vigentes; si vuelve a salir, re-avisa
      if (hayNuevo) sonarCampana();
    });

    // Suena la campana al mesero cuando caja termina de cobrar una mesa (queda
    // "sucia", pendiente de limpiar). Solo mientras se está viendo el salón.
    effect(() => {
      if (this.subVista() !== 'salon') return;
      const ids = this.mesas().filter(m => this.estadoMesa(m) === 'sucia').map(m => m.id);
      const hayNueva = ids.some(id => !this.cobradasAvisadas.has(id));
      this.cobradasAvisadas = new Set(ids);
      if (hayNueva) sonarCampana();
    });

    // ── Tiempo real (SignalR): adelanta el refresco en vez de esperar al
    // siguiente polling. El polling sigue activo como respaldo si el socket
    // no está conectado. Cada evento trae idCompany — se ignora si es de otra
    // empresa (el socket es compartido por todo el sistema, no por empresa).
    effect(() => {
      const e = this.realtimeSvc.ultimaOrdenLista();
      if (e && e.idCompany === this.companyId()) this.listosResource.reload();
    });
    effect(() => {
      const e = this.realtimeSvc.ultimaPorCobrar();
      if (e && e.idCompany === this.companyId()) this.mesasSvc.reload();
    });
    effect(() => {
      const e = this.realtimeSvc.ultimaCobrada();
      if (e && e.idCompany === this.companyId()) this.mesasSvc.reload();
    });
  }

  // Registra un movimiento en la bitácora con el usuario actual (no bloquea si falla).
  private auditar(accion: string, extras: AuditExtras = {}): void {
    this.auditoriaSvc.auditar(accion, extras);
  }

  // ── Mesas (grid) ──
  protected estadoMesa(m: Mesa): string { return this.mesasSvc.estadoMesa(m); }
  protected etiquetaEstado(e: string): string {
    return e === 'por_cobrar' ? 'POR COBRAR'
      : e === 'sucia' ? 'SUCIA'
      : e === 'ocupada' ? 'OCUPADA' : 'LIBRE';
  }
  protected readonly error = computed(() =>
    this.mesasSvc.mesasResource.error()
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
  protected readonly mesaBusqueda = signal('');
  protected setMesaBusqueda(e: Event): void { this.mesaBusqueda.set((e.target as HTMLInputElement).value); }
  protected limpiarMesaBusqueda(): void { this.mesaBusqueda.set(''); }
  protected readonly mesasFiltradas = computed(() => {
    const t = this.mesaBusqueda().trim().toLowerCase();
    const lista = this.mesas();
    return t ? lista.filter(m => m.nombre.toLowerCase().includes(t)) : lista;
  });
  protected loadMesas(): void { this.mesasSvc.reload(); }

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
      await this.mesasSvc.crear(this.companyId(), nombre, this.nuevaMesaCapacidad());
      this.showNuevaMesa.set(false);
      this.mesasSvc.reload();
    } catch {
      this.crearMesaError.set('No se pudo crear la mesa. Intenta de nuevo.');
    } finally {
      this.creandoMesa.set(false);
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
      await this.mesasSvc.editar(mesa.id, this.companyId(), nombre, this.editMesaCapacidad());
      this.editandoMesa.set(null);
      this.mesasSvc.reload();
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
      this.subVista.set('familias');
      if (mesa.idCuentaActual) void this.cargarModoCuenta(mesa.idCuentaActual);
    } else {
      void this.openFreeMesa(mesa);
    }
  }
  private async openFreeMesa(mesa: Mesa): Promise<void> {
    this.openingMesa.set(true);
    try {
      const cuenta = await this.cuentaSvc.abrir(this.companyId(), mesa.id, this.auditoriaSvc.usuario()?.nombre ?? null);
      this.selectedMesa.set({
        ...mesa,
        tieneCuentaAbierta: true,
        idCuentaActual: cuenta.id,
        totalActual: cuenta.total,
      });
      this.subVista.set('familias');
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

  protected async marcarPorCobrar(mesa: Mesa, valor: boolean, e: Event): Promise<void> {
    e.stopPropagation();
    if (!mesa.idCuentaActual) return;
    try {
      await this.cuentaSvc.marcarPorCobrar(mesa.idCuentaActual, valor);
      this.mesasSvc.reload();
    } catch { /* reintenta al refrescar */ }
  }

  protected async liberarMesa(mesa: Mesa, e: Event): Promise<void> {
    e.stopPropagation();
    try {
      await this.mesasSvc.liberar(mesa.id);
      this.mesasSvc.reload();
    } catch { /* reintenta al refrescar */ }
  }

  // ── Enviar a caja (desde la vista de cuenta, sin volver al salón) ──
  protected async enviarACaja(): Promise<void> {
    const mesa = this.selectedMesa();
    if (!mesa?.idCuentaActual) return;
    const yaEnviada = this.estadoMesa(mesa) === 'por_cobrar';
    this.enviandoACaja.set(true);
    try {
      await this.cuentaSvc.marcarPorCobrar(mesa.idCuentaActual, !yaEnviada);
      this.selectedMesa.set({
        ...mesa,
        estado: yaEnviada ? 'ocupada' : 'por_cobrar',
        porCobrarAt: yaEnviada ? null : new Date().toISOString(),
      });
      this.mesasSvc.reload();
      if (!yaEnviada) {
        this.auditar('ENVIAR_A_COBRAR', {
          entidad: 'CUENTA', idEntidad: mesa.idCuentaActual, idMesa: mesa.id, nombreMesa: mesa.nombre,
        });
      }
    } catch {
      this.mesaActionError.set('No se pudo avisar a caja. Intenta de nuevo.');
    } finally {
      this.enviandoACaja.set(false);
    }
  }

  // ── Transferir / unir mesas ──
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
      this.mesasSvc.reload();
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
      this.mesasSvc.reload();
    } catch (err: any) {
      this.moverError.set(err?.error?.error ?? 'No se pudo unir las mesas.');
    } finally { this.moviendoMesa.set(false); }
  }

  // ── Para llevar / domicilio ──
  protected abrirLlevarModal(): void {
    this.llevarTipo.set('llevar'); this.llevarNombre.set(''); this.llevarTel.set(''); this.llevarDir.set('');
    this.showLlevar.set(true);
  }
  protected async crearLlevar(): Promise<void> {
    this.abriendoLlevar.set(true);
    try {
      const res: any = await this.cuentaSvc.abrirLlevar(
        { idCompany: this.companyId(), tipo: this.llevarTipo(), nombre: this.llevarNombre().trim() || null,
          tel: this.llevarTel().trim() || null, dir: this.llevarDir().trim() || null });
      const nom = this.llevarNombre().trim() || (this.llevarTipo() === 'domicilio' ? 'Domicilio' : 'Para llevar');
      this.selectedMesa.set({
        id: res.idMesa, nombre: `🥡 ${nom}`, capacidad: null, activo: true,
        tieneCuentaAbierta: true, idCuentaActual: res.idCuenta, totalActual: 0, numItems: 0,
      });
      this.showLlevar.set(false);
      this.cuentaSeparada.set(false);
      this.auditar('ABRIR_MESA', { entidad: 'CUENTA', idEntidad: res.idCuenta, nombreMesa: `${this.llevarTipo()} · ${nom}` });
      this.subVista.set('familias');
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
    this.subVista.set('familias');
  }

  // ── Nuevo agrupador (familia / subfamilia) ──
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
      const fam = await this.productosSvc.crearFamilia(this.companyId(), nombre);
      this.agrupadorParent.set(fam);
      this.familiasResource.reload();
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
      const sub = await this.productosSvc.crearSubfamilia(this.companyId(), parent.id, nombre);
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

  // ── Editar agrupador (familia) ──
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
      await this.productosSvc.editarFamilia(familia.id, this.companyId(), nombre);
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

  // ── Nuevo producto ──
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
    if (str.endsWith('.')) return;
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
        idCompany:     this.companyId(),
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

  // ── Editar producto ──
  protected abrirEditProducto(prod: Producto, e: Event): void {
    e.stopPropagation();
    this.editProdDescripcion.set(prod.description);
    this.editProdPrecioStr.set(prod.price != null ? String(prod.price) : '');
    this.editProdPrecio.set(prod.price ?? null);
    this.editProductoError.set('');
    this.moverFamiliaId.set(this.selectedFamilia()?.id ?? null);
    this.moverSubfamiliaId.set(this.selectedSubfamilia()?.id ?? null);
    this.prodActivo.set(!this.verInactivos());
    this.editandoProducto.set(prod);
    void this.inventarioSvc.cargarConfigProducto(prod.id);
    void this.cargarReceta(prod.id);
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
      await this.productosSvc.editarProducto(prod.id, this.companyId(), desc, precio);
      try { await this.inventarioSvc.guardarConfigProducto(prod.id); }
      catch { /* config opcional */ }
      try { await this.guardarReceta(prod.id); }
      catch { /* receta opcional */ }
      const famDestino = this.moverFamiliaId();
      const subDestino = this.moverSubfamiliaId();
      const cambioFamilia = famDestino !== null &&
        (famDestino !== (this.selectedFamilia()?.id ?? null) ||
         subDestino !== (this.selectedSubfamilia()?.id ?? null));
      if (cambioFamilia) {
        try {
          await this.productosSvc.moverProducto(prod.id, this.companyId(), famDestino, subDestino);
        } catch { /* si falla el movimiento, el resto ya se guardó */ }
      }
      const activoActual = !this.verInactivos();
      if (this.prodActivo() !== activoActual) {
        try {
          await this.productosSvc.activarProducto(prod.id, this.companyId(), this.prodActivo());
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

  // ── Navegación del menú ──
  protected selectFamilia(familia: Familia): void {
    this.selectedSubfamilia.set(null);
    this.selectedProducto.set(null);
    this.addError.set('');
    this.prodBusqueda.set('');
    this.selectedFamilia.set(familia);
    this.subVista.set('productos');
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
  protected cancelarProducto(): void {
    this.selectedProducto.set(null);
    this.addError.set('');
    this.cantidadCustom.set(null);
  }
  protected setProdNota(e: Event): void {
    this.prodNota.set((e.target as HTMLInputElement).value);
  }
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
      const resultado = await this.cuentaSvc.agregarItemConCola(mesa.idCuentaActual, {
        idMaterial: producto.id, descripcion, cantidad, precio, presentacion,
        comensal: this.cuentaSeparada() ? this.comensalSel() : 1,
      });
      this.selectedProducto.set(null);
      this.prodNota.set('');
      this.cantidadCustom.set(null);
      if (resultado === 'sincronizado') this.itemsResource.reload();
    } catch {
      this.addError.set('No se pudo agregar el producto. Intenta de nuevo.');
    } finally {
      this.agregandoItem.set(false);
    }
  }
  protected limpiarBusqueda(): void { this.prodBusqueda.set(''); }
  protected setProdBusqueda(e: Event): void { this.prodBusqueda.set((e.target as HTMLInputElement).value); }

  // ── Cuenta ──
  protected irACuenta(): void {
    this.selectedProducto.set(null);
    this.cobroError.set('');
    this.showPayment.set(false);
    this.dividirEntre.set(1);
    this.subVista.set('cuenta');
  }
  protected async eliminarItem(item: ItemCuenta): Promise<void> {
    const mesa = this.selectedMesa();
    if (!mesa?.idCuentaActual) return;
    this.eliminandoId.set(item.id);
    try {
      const resultado = await this.cuentaSvc.eliminarItemConCola(mesa.idCuentaActual, item.id,
        { cantidad: item.cantidad, precio: item.precioUnitario });
      if (resultado === 'sincronizado') this.itemsResource.reload();
    } finally {
      this.eliminandoId.set(null);
    }
  }
  protected async cambiarItem(item: ItemCuenta): Promise<void> {
    if (this.cuentaSeparada() && item.comensal) this.comensalSel.set(item.comensal);
    await this.eliminarItem(item);
    this.prodBusqueda.set('');
    this.subVista.set('familias');
  }

  // ── Comensales ──
  protected setCuentaSeparada(v: boolean): void {
    this.cuentaSeparada.set(v);
    if (!v) { this.numComensales.set(1); this.comensalSel.set(1); }
    this.persistModo();
  }
  private persistModo(): void {
    const id = this.selectedMesa()?.idCuentaActual;
    if (!id) return;
    this.cuentaSvc.guardarModo(id, this.cuentaSeparada(), this.cuentaSeparada() ? this.numComensales() : null)
      .catch(() => { /* no bloquear */ });
  }
  private async cargarModoCuenta(idCuenta: number): Promise<void> {
    try {
      const m: any = await this.cuentaSvc.getModo(idCuenta);
      this.cuentaSeparada.set(!!m?.separada);
      this.numComensales.set(m?.numComensales && m.numComensales > 0 ? m.numComensales : 1);
    } catch { /* deja junta por defecto */ }
  }
  protected intentarJunta(): void {
    if (!this.cuentaSeparada()) return;
    if (this.items().some(i => i.pagado)) { this.juntarBloqueado.set(true); return; }
    if (this.items().length > 0) { this.avisoJuntar.set(true); return; }
    this.setCuentaSeparada(false);
  }
  protected confirmarJuntar(): void { this.avisoJuntar.set(false); this.setCuentaSeparada(false); }
  protected cancelarJuntar(): void { this.avisoJuntar.set(false); }
  protected cerrarJuntarBloqueado(): void { this.juntarBloqueado.set(false); }
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
  protected setComensalSel(n: number): void { this.comensalSel.set(n); }
  protected masPersonas(): void { this.numComensales.update(n => Math.min(12, n + 1)); }
  protected masComensales(): void { this.dividirEntre.update(n => Math.min(20, n + 1)); }
  protected menosComensales(): void { this.dividirEntre.update(n => Math.max(1, n - 1)); }

  // ── Autorización de supervisor (cancelación / cortesía / descuento) ──
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
    try {
      const r: any = await this.usuariosSvc.validarPin(this.companyId(), this.authPin());
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
          idCompany: this.companyId(), tipo: 'CORTESIA', descripcion: acc.item.descripcion, motivo, autorizadoPor: por,
        });
        this.auditar('CORTESIA', { entidad: 'CUENTA', idEntidad: idCuenta, monto: acc.item.subtotal, nombreMesa: nm, descripcion: `${acc.item.descripcion} · autoriza ${por}` });
        this.itemsResource.reload();
        this.authAccion.set(null);
      } else if (acc.tipo === 'cancelar' && acc.item && idCuenta) {
        await this.cuentaSvc.eliminarItem(idCuenta, acc.item.id,
          { cantidad: acc.item.cantidad, precio: acc.item.precioUnitario });
        await this.cuentaSvc.autorizacion(idCuenta, {
          idCompany: this.companyId(), tipo: 'CANCELACION', descripcion: acc.item.descripcion,
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

  // ── Cobro ──
  protected iniciarCobro(): void {
    const separada = this.cuentaSeparada() || this.items().some(i => i.pagado);
    if (separada) {
      this.descuentoAplicado.set(null);
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

  // ── Pago ──
  protected setTipoPago(tipo: TipoPago): void {
    this.tipoPago.set(tipo);
    this.montoPagado.set(null);
    this.montoTarjeta.set(null);
    if (tipo === 'EFECTIVO') this.referenciaTarjeta.set('');
    if (this.montoPagadoEl)  this.montoPagadoEl.value  = '';
    if (this.montoTarjetaEl) this.montoTarjetaEl.value = '';
  }
  /** Llena "¿Con cuánto paga?" con el total exacto — evita teclear cuando el cliente paga justo. */
  protected pagoExacto(): void {
    const total = this.totalAPagar();
    this.montoPagado.set(total);
    const el = this.montoPagadoEl ?? (document.getElementById('monto-pagado-input') as HTMLInputElement | null);
    if (el) { el.value = total.toFixed(2); this.montoPagadoEl = el; }
  }
  protected setMontoPagado(e: Event): void {
    const input = e.target as HTMLInputElement;
    this.montoPagadoEl = input;
    const str = input.value.trim();
    if (str.endsWith('.')) return;
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
    setTimeout(() => {
      const el = document.getElementById('monto-pagado-input') as HTMLInputElement | null;
      el?.focus();
      el?.select();
    }, 60);
  }
  protected cancelarPago(): void {
    this.showPayment.set(false);
    this.cobroError.set('');
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
          idCompany: this.companyId(), tipoPago: tipo, comensal, referenciaTarjeta: refTarjeta,
        });
        this.cuentaCerradaComensal.set(!!res?.cuentaCerrada);
      } else {
        await this.cuentaSvc.cobrar(mesa.idCuentaActual, {
          idCompany: this.companyId(),
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
        atendioPor: mesa.meseroApertura ?? null,
        cobradoPor: this.auditoriaSvc.usuario()?.nombre ?? null,
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
      this.itemsResource.reload();
    } catch (err: any) {
      const msg = err?.error?.error ?? err?.message ?? 'No se pudo procesar el cobro. Intenta de nuevo.';
      this.cobroError.set(msg);
    } finally {
      this.cobrando.set(false);
    }
  }

  // ── Ticket ──
  protected async imprimirTicket(): Promise<void> {
    const t = this.ticketData();
    if (!t) return;
    const logo = await logoToDataUrl(this.companyLogo());
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

  // ── Impresión desde la TABLET (sistema Android, no la nube) ──
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
    if (this.cobroComensal() != null && !this.cuentaCerradaComensal()) {
      this.cobroComensal.set(null);
      this.showCobroSeparado.set(true);
      return;
    }
    this.cobroComensal.set(null);
    if (this.origenCaja()) { this.back.emit(); return; }
    this.backToMesas();
  }

  // ── Navegación atrás ──
  protected backToFamilias(): void {
    this.subVista.set('familias');
    this.selectedFamilia.set(null);
    this.selectedSubfamilia.set(null);
    this.selectedProducto.set(null);
    this.addError.set('');
    this.prodBusqueda.set('');
  }
  protected backToMesas(): void {
    this.subVista.set('salon');
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
    this.mesasSvc.reload();
  }
}
