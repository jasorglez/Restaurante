import { HttpClient, httpResource } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../../environments/environment';
import { Familia, Producto } from '../../models/familia';
import { ultimoValorConCache } from '../../shared/util/resource-fallback';

/**
 * Store del dominio Catálogo: familias, subfamilias y productos (microservicio
 * ChatBot / restaurant-publico). Además de los endpoints (URLs) y las operaciones
 * (HTTP) de alta/edición, mantiene el estado reactivo (recursos + selección) que
 * antes vivía en App; el componente de Mesas sincroniza `companyId` y las
 * banderas de sub-vista (`enFamilias`/`enProductos`) y App lee los recursos para
 * el indicador de conexión.
 */
@Injectable({ providedIn: 'root' })
export class ProductosService {
  private readonly http = inject(HttpClient);
  private readonly pub = `${environment.urlChatBot}/restaurant-publico`;

  // ── Estado (store) ──────────────────────────────────────────────────────────
  /** Empresa activa y sub-vista del menú (las fija el componente de Mesas). */
  readonly companyId   = signal<number | null>(null);
  readonly enFamilias  = signal(false);   // navegando el catálogo raíz (familias)
  readonly enProductos = signal(false);   // dentro de un agrupador (subfamilias/productos)
  /** Selección de navegación del menú. */
  readonly selectedFamilia    = signal<Familia | null>(null);
  readonly selectedSubfamilia = signal<Familia | null>(null);
  readonly verInactivos       = signal(false);

  // ── Familias ──
  private readonly familiasUrlSig = computed(() =>
    this.enFamilias() && this.companyId() != null ? this.familiasUrl(this.companyId()!) : undefined,
  );
  readonly familiasResource = httpResource<Familia[]>(() => this.familiasUrlSig(), { defaultValue: [] });
  // Si se cae la red, sigue mostrando el último catálogo bueno (memoria + localStorage).
  readonly familias = ultimoValorConCache(this.familiasResource, this.familiasUrlSig, []);
  readonly familiasLoading = this.familiasResource.isLoading;
  readonly familiasError = computed(() =>
    this.familiasResource.error() ? 'No fue posible cargar las familias del menú.' : '',
  );

  // ── Subfamilias ──
  private readonly subfamiliasUrlSig = computed(() => {
    const fam = this.selectedFamilia();
    if (!fam || !this.enProductos() || this.companyId() == null) return undefined;
    return this.subfamiliasUrl(this.companyId()!, fam.id);
  });
  readonly subfamiliasResource = httpResource<Familia[]>(() => this.subfamiliasUrlSig(), { defaultValue: [] });
  readonly subfamilias = ultimoValorConCache(this.subfamiliasResource, this.subfamiliasUrlSig, []);
  readonly mostrarSubfamilias = computed(() => {
    if (this.selectedSubfamilia()) return false;
    return !this.subfamiliasResource.isLoading() && this.subfamilias().length > 1;
  });

  // ── Productos ──
  private readonly productosUrlSig = computed(() => {
    if (!this.enProductos() || this.companyId() == null) return undefined;
    const fam = this.selectedFamilia();
    if (!fam || this.subfamiliasResource.isLoading()) return undefined;
    const q = this.verInactivos() ? '?inactivos=true' : '';
    const sub = this.selectedSubfamilia();
    if (sub) return this.porSubfamiliaUrl(this.companyId()!, sub.id, q);
    if (!this.mostrarSubfamilias()) return this.porFamiliaUrl(this.companyId()!, fam.id, q);
    return undefined;
  });
  readonly productosResource = httpResource<Producto[]>(() => this.productosUrlSig(), { defaultValue: [] });
  readonly productos = ultimoValorConCache(this.productosResource, this.productosUrlSig, []);
  readonly productosLoading = computed(
    () => this.subfamiliasResource.isLoading() || this.productosResource.isLoading(),
  );
  readonly productosError = computed(() =>
    this.productosResource.error() ? 'No fue posible cargar los productos.' : '',
  );

  // ── Familias ──
  familiasUrl(companyId: number): string { return `${this.pub}/familias/${companyId}`; }
  familiasBaseUrl(): string { return `${this.pub}/familias`; }
  familiaUrl(id: number): string { return `${this.pub}/familias/${id}`; }

  // ── Subfamilias ──
  subfamiliasUrl(companyId: number, famId: number): string { return `${this.pub}/subfamilias/${companyId}/${famId}`; }
  subfamiliasBaseUrl(): string { return `${this.pub}/subfamilias`; }

  // ── Productos ──
  buscarUrl(companyId: number, term: string): string {
    return `${this.pub}/productos/${companyId}/buscar?term=${encodeURIComponent(term)}`;
  }
  porSubfamiliaUrl(companyId: number, subId: number, query = ''): string {
    return `${this.pub}/productos/${companyId}/subfamilia/${subId}${query}`;
  }
  porFamiliaUrl(companyId: number, famId: number, query = ''): string {
    return `${this.pub}/productos/${companyId}/familia/${famId}${query}`;
  }
  productosBaseUrl(): string { return `${this.pub}/productos`; }
  productoUrl(id: number): string { return `${this.pub}/productos/${id}`; }
  productoMoverUrl(id: number): string { return `${this.pub}/productos/${id}/mover`; }
  productoActivoUrl(id: number): string { return `${this.pub}/productos/${id}/activo`; }

  // ── Operaciones (HTTP) ──
  crearFamilia(companyId: number, description: string): Promise<Familia> {
    return firstValueFrom(this.http.post<Familia>(this.familiasBaseUrl(), { idCompany: companyId, description }));
  }
  crearSubfamilia(companyId: number, idFamilia: number, description: string): Promise<Familia> {
    return firstValueFrom(this.http.post<Familia>(this.subfamiliasBaseUrl(),
      { idCompany: companyId, idFamilia, description }));
  }
  editarFamilia(id: number, companyId: number, description: string): Promise<unknown> {
    return firstValueFrom(this.http.put<Familia>(this.familiaUrl(id), { idCompany: companyId, description }));
  }
  crearProducto(body: object): Promise<Producto> {
    return firstValueFrom(this.http.post<Producto>(this.productosBaseUrl(), body));
  }
  editarProducto(id: number, companyId: number, description: string, ventaMN: number): Promise<unknown> {
    return firstValueFrom(this.http.put(this.productoUrl(id), { idCompany: companyId, description, ventaMN }));
  }
  moverProducto(id: number, companyId: number, idFamilia: number | null, idSubfamilia: number | null): Promise<unknown> {
    return firstValueFrom(this.http.put(this.productoMoverUrl(id), { idCompany: companyId, idFamilia, idSubfamilia }));
  }
  activarProducto(id: number, companyId: number, activo: boolean): Promise<unknown> {
    return firstValueFrom(this.http.put(this.productoActivoUrl(id), { idCompany: companyId, activo }));
  }
}
