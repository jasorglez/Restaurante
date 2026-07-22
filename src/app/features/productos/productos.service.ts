import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../../environments/environment';
import { Familia, Producto } from '../../models/familia';

/**
 * Catálogo: familias, subfamilias y productos (microservicio ChatBot /
 * restaurant-publico). Expone endpoints (URLs) + las operaciones (HTTP) de
 * alta/edición; App orquesta la UI y recarga los recursos.
 */
@Injectable({ providedIn: 'root' })
export class ProductosService {
  private readonly http = inject(HttpClient);
  private readonly pub = `${environment.urlChatBot}/restaurant-publico`;

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
