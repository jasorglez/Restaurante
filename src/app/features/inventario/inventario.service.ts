import { HttpClient, httpResource } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../../environments/environment';
import { Equivalencia, Existencia, ProductoInventario, RecetaItem } from '../../models/inventario';

/**
 * Estado + acceso al microservicio de inventario. Es un servicio con estado
 * (providedIn root, singleton) porque su información se comparte entre TRES
 * consumidores: la vista de inventario (<app-inventario>), el modal de editar
 * producto (App) y las alertas de stock a Telegram.
 *
 *   - existencias / alertasStock  → vista + export + alertas
 *   - equivalencias (catálogo)    → vista + modal de producto
 *   - cfg* (config del producto)  → alta (vista) + modal de producto
 *
 * `companyId` la fija App al resolver la empresa.
 */
@Injectable({ providedIn: 'root' })
export class InventarioService {
  private readonly http = inject(HttpClient);
  private readonly base = `${environment.urlChatBot}/restaurant-publico/inventario`;

  /** Arma una URL del microservicio de inventario a partir del sub-path. */
  url(path: string): string { return `${this.base}/${path}`; }

  /** Empresa activa (la fija App). */
  readonly companyId = signal<number | null>(null);

  // ── Existencias (vista + export CSV + alertas de stock) ─────────────────────
  readonly existenciasResource = httpResource<Existencia[]>(
    () => { const id = this.companyId(); return id != null ? this.url(`${id}/existencias`) : undefined; },
    { defaultValue: [] },
  );
  readonly existencias        = this.existenciasResource.value;
  readonly existenciasLoading = this.existenciasResource.isLoading;
  readonly alertasStock       = computed(() => this.existencias().filter(e => e.bajoMinimo));
  reloadExistencias(): void { this.existenciasResource.reload(); }

  // ── Equivalencias (vista de inventario + modal de producto) ─────────────────
  readonly equivalenciasResource = httpResource<Equivalencia[]>(
    () => { const id = this.companyId(); return id != null ? this.url(`equivalencias/${id}`) : undefined; },
    { defaultValue: [] },
  );
  readonly equivalencias = this.equivalenciasResource.value;

  async crearEquivalencia(nombre: string, onzas: number): Promise<void> {
    await firstValueFrom(this.http.post<Equivalencia>(
      this.url('equivalencias'), { idCompany: this.companyId()!, nombre, onzas }));
    this.equivalenciasResource.reload();
  }
  async eliminarEquivalencia(id: number): Promise<void> {
    await firstValueFrom(this.http.delete(this.url(`equivalencias/${id}?idCompany=${this.companyId()!}`)));
    this.equivalenciasResource.reload();
  }

  // ── Configuración de inventario del producto (alta en la vista + modal) ─────
  readonly cfgControla   = signal(false);
  readonly cfgVendeCopa  = signal(false);
  readonly cfgIdEquiv    = signal<number | null>(null);
  readonly cfgPrecioCopa = signal<number | null>(null);
  readonly cfgStockMin   = signal<number | null>(null);

  setCfgControla(e: Event): void { this.cfgControla.set((e.target as HTMLInputElement).checked); }
  setCfgVendeCopa(e: Event): void { this.cfgVendeCopa.set((e.target as HTMLInputElement).checked); }
  setCfgIdEquiv(e: Event): void {
    const v = (e.target as HTMLSelectElement).value;
    this.cfgIdEquiv.set(v ? +v : null);
  }
  setCfgPrecioCopa(e: Event): void {
    const v = parseFloat((e.target as HTMLInputElement).value);
    this.cfgPrecioCopa.set(!isNaN(v) && v >= 0 ? v : null);
  }
  setCfgStockMin(e: Event): void {
    const v = parseInt((e.target as HTMLInputElement).value, 10);
    this.cfgStockMin.set(!isNaN(v) && v >= 0 ? v : null);
  }

  /** Carga la config de inventario de un producto en los cfg* (solo config, sin receta). */
  async cargarConfigProducto(idMaterial: number): Promise<void> {
    this.cfgControla.set(false);
    this.cfgVendeCopa.set(false);
    this.cfgIdEquiv.set(null);
    this.cfgPrecioCopa.set(null);
    this.cfgStockMin.set(null);
    try {
      const cfg = await firstValueFrom(this.http.get<ProductoInventario | null>(
        this.url(`${this.companyId()!}/producto/${idMaterial}`)));
      if (cfg) {
        this.cfgControla.set(cfg.controlaInventario);
        this.cfgVendeCopa.set(cfg.vendePorCopa);
        this.cfgIdEquiv.set(cfg.idEquivalencia);
        this.cfgPrecioCopa.set(cfg.precioCopa);
        this.cfgStockMin.set(cfg.stockMinPiezas || null);
      }
    } catch { /* sin config previa */ }
  }

  /** Config de inventario de un producto (para el flujo de venta), o null. */
  getConfig(idMaterial: number): Promise<ProductoInventario | null> {
    return firstValueFrom(this.http.get<ProductoInventario | null>(
      this.url(`${this.companyId()!}/producto/${idMaterial}`)));
  }

  /** Receta (insumos) de un platillo. */
  getReceta(idProducto: number): Promise<RecetaItem[]> {
    return firstValueFrom(this.http.get<RecetaItem[]>(this.url(`${this.companyId()!}/receta/${idProducto}`)));
  }
  /** Guarda la receta (insumos) de un platillo. */
  guardarReceta(idProducto: number, lineas: RecetaItem[]): Promise<unknown> {
    return firstValueFrom(this.http.put(this.url('receta'),
      { idCompany: this.companyId()!, idProducto, lineas }));
  }

  async guardarConfigProducto(idMaterial: number): Promise<void> {
    await firstValueFrom(this.http.put(
      this.url('producto'),
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
}
