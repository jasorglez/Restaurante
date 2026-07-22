import { CurrencyPipe, DatePipe } from '@angular/common';
import { HttpClient, httpResource } from '@angular/common/http';
import { Component, ViewEncapsulation, computed, inject, input, output, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { Producto } from '../../models/familia';
import { Equivalencia, Existencia, MovimientoInv, ResultadoMovimiento, ResumenMov } from '../../models/inventario';
import { ConfigService } from '../config/config.service';
import { ProductosService } from '../productos/productos.service';
import { descargarCsv } from '../../shared/util/csv';
import { InventarioService } from './inventario.service';

type InventarioSubView = 'existencias' | 'alta' | 'movimientos' | 'detalle' | 'equivalencias';

/**
 * Vista de Inventario (existencias, alta, movimientos, detalle, equivalencias).
 * El estado compartido con el modal de producto y las alertas vive en
 * InventarioService; aquí queda solo lo propio de la vista.
 *
 * Encapsulation.None por consistencia con las clases compartidas inv-*.
 */
@Component({
  selector: 'app-inventario',
  imports: [CurrencyPipe, DatePipe],
  templateUrl: './inventario.html',
  styleUrl: './inventario.scss',
  encapsulation: ViewEncapsulation.None,
})
export class Inventario {
  protected readonly inv = inject(InventarioService);
  private readonly productosSvc = inject(ProductosService);
  private readonly configSvc = inject(ConfigService);
  private readonly http = inject(HttpClient);

  readonly companyId   = input.required<number>();
  readonly companyName = input.required<string>();
  readonly back        = output<void>();

  protected readonly inventarioSubView = signal<InventarioSubView>('existencias');
  protected readonly existenciaUnidad = signal<'piezas' | 'onzas'>('piezas');

  // Mensaje de resultado (ingreso/ajuste/alta/alerta).
  protected readonly ingresoOk = signal('');

  // Existencias y equivalencias vienen del servicio compartido.
  protected readonly existencias        = this.inv.existencias;
  protected readonly existenciasLoading = this.inv.existenciasLoading;
  protected readonly equivalencias      = this.inv.equivalencias;
  protected readonly alertasStock       = this.inv.alertasStock;

  // Alias de la config del producto (form de alta) — delegan al servicio.
  protected readonly cfgVendeCopa  = this.inv.cfgVendeCopa;
  protected readonly cfgIdEquiv    = this.inv.cfgIdEquiv;
  protected readonly cfgPrecioCopa = this.inv.cfgPrecioCopa;
  protected readonly cfgStockMin   = this.inv.cfgStockMin;
  protected setCfgVendeCopa(e: Event): void { this.inv.setCfgVendeCopa(e); }
  protected setCfgIdEquiv(e: Event): void { this.inv.setCfgIdEquiv(e); }
  protected setCfgPrecioCopa(e: Event): void { this.inv.setCfgPrecioCopa(e); }
  protected setCfgStockMin(e: Event): void { this.inv.setCfgStockMin(e); }

  // ── Movimientos (resumen por producto) ──────────────────────────────────────
  protected readonly movDesde = signal<string>(new Date(Date.now() - 29 * 864e5).toISOString().split('T')[0]);
  protected readonly movHasta = signal<string>(new Date().toISOString().split('T')[0]);
  protected setMovDesde(e: Event): void { this.movDesde.set((e.target as HTMLInputElement).value); }
  protected setMovHasta(e: Event): void { this.movHasta.set((e.target as HTMLInputElement).value); }

  protected readonly resumenResource = httpResource<ResumenMov[]>(
    () => this.inventarioSubView() === 'movimientos'
      ? this.inv.url(`${this.companyId()}/resumen?desde=${this.movDesde()}&hasta=${this.movHasta()}`)
      : undefined,
    { defaultValue: [] },
  );
  protected readonly resumenLoading = this.resumenResource.isLoading;
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

  // ── Drill-down (modal de detalle de un producto) ────────────────────────────
  protected readonly drillProducto = signal<{ id: number; desc: string } | null>(null);
  protected readonly drillTipo     = signal<'INGRESO' | 'EGRESO'>('INGRESO');
  protected readonly drillResource = httpResource<MovimientoInv[]>(
    () => {
      const p = this.drillProducto();
      return p
        ? this.inv.url(`${this.companyId()}/movimientos?idMaterial=${p.id}&desde=${this.movDesde()}&hasta=${this.movHasta()}`)
        : undefined;
    },
    { defaultValue: [] },
  );
  protected readonly drillLoading = this.drillResource.isLoading;
  protected readonly drillMovs = computed(() => {
    const tipo = this.drillTipo();
    return this.drillResource.value().filter(m => tipo === 'INGRESO' ? m.tipo === 'INGRESO' : m.onzas < 0);
  });
  protected readonly drillTotalOnzas = computed(() =>
    this.drillMovs().reduce((s, m) => s + Math.abs(m.onzas), 0));
  protected abrirDrill(r: { idMaterial: number; descripcion: string }, tipo: 'INGRESO' | 'EGRESO'): void {
    this.drillTipo.set(tipo);
    this.drillProducto.set({ id: r.idMaterial, desc: r.descripcion });
  }
  protected cerrarDrill(): void { this.drillProducto.set(null); }

  // ── Detalle (kardex línea por línea con búsqueda) ───────────────────────────
  protected readonly movDetalleBusqueda = signal('');
  protected setMovBusqueda(e: Event): void { this.movDetalleBusqueda.set((e.target as HTMLInputElement).value); }
  protected readonly movimientosResource = httpResource<MovimientoInv[]>(
    () => this.inventarioSubView() === 'detalle'
      ? this.inv.url(`${this.companyId()}/movimientos?desde=${this.movDesde()}&hasta=${this.movHasta()}`)
      : undefined,
    { defaultValue: [] },
  );
  protected readonly movimientosLoading = this.movimientosResource.isLoading;
  protected readonly movimientos = computed(() => {
    const term = this.movDetalleBusqueda().trim().toLowerCase();
    const all = this.movimientosResource.value();
    return term ? all.filter(m => m.descripcion.toLowerCase().includes(term)) : all;
  });

  // ── Equivalencias (form de alta; la lista viene del servicio) ────────────────
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
      await this.inv.crearEquivalencia(nombre, onzas);
      this.equivNombre.set('');
      this.equivOnzas.set(null);
    } catch {
      this.equivError.set('No se pudo crear la equivalencia.');
    } finally {
      this.guardandoEquiv.set(false);
    }
  }
  protected async eliminarEquivalencia(eq: Equivalencia): Promise<void> {
    try { await this.inv.eliminarEquivalencia(eq.id); } catch { /* noop */ }
  }

  // ── Ingreso de existencias (inline por producto) ────────────────────────────
  protected readonly ingresoActivoId    = signal<number | null>(null);
  protected readonly ingresoPiezas      = signal<number | null>(null);
  protected readonly registrandoIngreso = signal(false);
  protected readonly ingresoError       = signal('');
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
        this.inv.url('ingreso'), { idCompany: this.companyId(), idMaterial: mat.idMaterial, piezas }));
      this.ingresoActivoId.set(null);
      this.ingresoPiezas.set(null);
      this.ingresoOk.set(`Ingreso registrado: +${piezas} pieza(s) de ${mat.descripcion}.`);
      this.inv.reloadExistencias();
    } catch {
      this.ingresoError.set('No se pudo registrar el ingreso.');
    } finally {
      this.registrandoIngreso.set(false);
    }
  }

  // ── Ajuste por conteo físico (inline por producto) ──────────────────────────
  protected readonly ajusteActivoId    = signal<number | null>(null);
  protected readonly ajustePiezas      = signal<number | null>(null);
  protected readonly ajusteOnzas       = signal<number | null>(null);
  protected readonly registrandoAjuste = signal(false);
  protected readonly ajusteError       = signal('');
  protected iniciarAjuste(mat: Existencia): void {
    this.ajusteActivoId.set(mat.idMaterial);
    this.ajustePiezas.set(mat.piezasEnteras);
    this.ajusteOnzas.set(mat.onzasSobrantes || null);
    this.ajusteError.set('');
    this.ingresoOk.set('');
  }
  protected cancelarAjuste(): void {
    this.ajusteActivoId.set(null);
    this.ajustePiezas.set(null);
    this.ajusteOnzas.set(null);
    this.ajusteError.set('');
  }
  protected setAjustePiezas(e: Event): void {
    const v = parseFloat((e.target as HTMLInputElement).value);
    this.ajustePiezas.set(!isNaN(v) && v >= 0 ? v : null);
  }
  protected setAjusteOnzas(e: Event): void {
    const v = parseFloat((e.target as HTMLInputElement).value);
    this.ajusteOnzas.set(!isNaN(v) && v >= 0 ? v : null);
  }
  protected async registrarAjuste(mat: Existencia): Promise<void> {
    const piezas = this.ajustePiezas() ?? 0;
    const onzas  = this.ajusteOnzas() ?? 0;
    this.registrandoAjuste.set(true);
    this.ajusteError.set('');
    try {
      await firstValueFrom(this.http.post<ResultadoMovimiento>(
        this.inv.url('ajuste'), { idCompany: this.companyId(), idMaterial: mat.idMaterial, piezas, onzas }));
      this.ajusteActivoId.set(null);
      this.ajustePiezas.set(null);
      this.ajusteOnzas.set(null);
      this.ingresoOk.set(`Existencia ajustada: ${mat.descripcion} = ${piezas} pza${onzas ? ` + ${onzas} oz` : ''}.`);
      this.inv.reloadExistencias();
    } catch {
      this.ajusteError.set('No se pudo registrar el ajuste.');
    } finally {
      this.registrandoAjuste.set(false);
    }
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
      if (this.inventarioSubView() !== 'alta' || term.length < 2) return undefined;
      return this.productosSvc.buscarUrl(this.companyId(), term);
    },
    { defaultValue: [] },
  );
  protected setAltaBusqueda(e: Event): void { this.altaBusqueda.set((e.target as HTMLInputElement).value); }
  protected async seleccionarAltaProducto(p: Producto): Promise<void> {
    this.altaProducto.set(p);
    this.altaBusqueda.set('');
    this.altaPiezas.set(null);
    this.altaError.set('');
    await this.inv.cargarConfigProducto(p.id);
    this.inv.cfgControla.set(true);
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
    if (this.inv.cfgVendeCopa() && this.inv.cfgIdEquiv() === null) {
      this.altaError.set('Selecciona la equivalencia (onzas por pieza).');
      return;
    }
    this.guardandoAlta.set(true);
    this.altaError.set('');
    try {
      await this.inv.guardarConfigProducto(prod.id);
      const piezas = this.altaPiezas();
      if (piezas && piezas > 0) {
        await firstValueFrom(this.http.post<ResultadoMovimiento>(
          this.inv.url('ingreso'), { idCompany: this.companyId(), idMaterial: prod.id, piezas }));
      }
      this.ingresoOk.set(`${prod.description}: inventario dado de alta${piezas ? ` (+${piezas} pza)` : ''}.`);
      this.altaProducto.set(null);
      this.altaPiezas.set(null);
      this.inventarioSubView.set('existencias');
      this.inv.reloadExistencias();
    } catch {
      this.altaError.set('No se pudo dar de alta el inventario. Intenta de nuevo.');
    } finally {
      this.guardandoAlta.set(false);
    }
  }

  // ── Export CSV + alerta de stock a Telegram ─────────────────────────────────
  protected exportarExistencias(): void {
    const rows = this.existencias().map(e => [
      e.descripcion, e.piezasEnteras, e.onzasSobrantes, e.existenciaOnzas, e.stockMinPiezas, e.bajoMinimo ? 'SÍ' : '',
    ]);
    descargarCsv('inventario', ['Producto', 'Piezas', 'Oz sobrantes', 'Total oz', 'Stock mín', 'Bajo mínimo'], rows,
      new Date().toISOString().split('T')[0]);
  }
  protected avisarStockBajo(): void {
    const bajos = this.inv.alertasStock();
    if (!bajos.length) return;
    const lista = bajos.map(e => `• ${e.descripcion}: ${e.piezasEnteras} pza (mín ${e.stockMinPiezas})`).join('\n');
    this.configSvc.enviarAlerta(this.companyId(), `⚠️ ${this.companyName()} · Stock bajo:\n${lista}`);
    this.ingresoOk.set('Alerta de stock enviada a Telegram.');
  }
}
