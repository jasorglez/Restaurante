import { HttpClient, httpResource } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../../environments/environment';
import { Mesa } from '../../models/mesa';
import { ultimoValorConCache } from '../../shared/util/resource-fallback';

/**
 * Store del dominio Mesas: estado (lista de mesas + estado de cada mesa + cola de
 * cobro) y operaciones (alta/edición/liberar). App sincroniza `companyId` y
 * `enVista` (salón o caja) y dispara el auto-refresco con `refrescar()`.
 */
@Injectable({ providedIn: 'root' })
export class MesasService {
  private readonly http = inject(HttpClient);
  private readonly pub   = `${environment.urlChatBot}/restaurant-publico`;
  private readonly admin = `${environment.urlAdministration}/Restaurant`;

  // ── Estado (store) ──────────────────────────────────────────────────────────
  /** Empresa activa y si estamos en una vista que necesita mesas (salón/caja). */
  readonly companyId = signal<number | null>(null);
  readonly enVista   = signal(false);
  /** Latido de auto-refresco. */
  readonly tick = signal(0);
  refrescar(): void { this.tick.update(t => t + 1); }

  /** Lista de mesas (se carga en salón y en Caja, para la cola de cobro). */
  private readonly url = computed(() => {
    this.tick();
    const id = this.companyId();
    return this.enVista() && id != null ? this.listUrl(id) : undefined;
  });
  readonly mesasResource = httpResource<Mesa[]>(() => this.url(), { defaultValue: [] });
  /** Si se cae la red, sigue mostrando la última lista buena (memoria + localStorage). */
  readonly mesas   = ultimoValorConCache(this.mesasResource, this.url, []);
  readonly loading = this.mesasResource.isLoading;
  reload(): void { this.mesasResource.reload(); }

  /** Estado efectivo de una mesa (con fallback si el backend no lo envía). */
  estadoMesa(m: Mesa): string {
    return m.estado ?? (m.tieneCuentaAbierta ? 'ocupada' : 'libre');
  }

  /** Mesas ocupadas listas para cobrar: "por cobrar" primero, en orden FIFO. */
  readonly mesasParaCobrar = computed(() =>
    this.mesas()
      .filter(m => m.tieneCuentaAbierta)
      .sort((a, b) => {
        const pa = this.estadoMesa(a) === 'por_cobrar' ? 0 : 1;
        const pb = this.estadoMesa(b) === 'por_cobrar' ? 0 : 1;
        if (pa !== pb) return pa - pb;
        if (pa === 0) {
          const ta = a.porCobrarAt ? Date.parse(a.porCobrarAt) : 0;
          const tb = b.porCobrarAt ? Date.parse(b.porCobrarAt) : 0;
          return ta - tb;
        }
        return a.nombre.localeCompare(b.nombre, undefined, { numeric: true });
      }),
  );

  /** Cola de cobro: solo las mesas enviadas a cobrar, en orden de llegada. */
  readonly colaCobro = computed(() =>
    this.mesas()
      .filter(m => this.estadoMesa(m) === 'por_cobrar')
      .sort((a, b) => (a.porCobrarAt ? Date.parse(a.porCobrarAt) : 0) - (b.porCobrarAt ? Date.parse(b.porCobrarAt) : 0)),
  );

  /** Alta de mesa. */
  crear(companyId: number, nombre: string, capacidad: number | null): Promise<unknown> {
    return firstValueFrom(this.http.post(this.baseUrl(), { idCompany: companyId, nombre, capacidad }));
  }
  /** Edición de mesa. */
  editar(idMesa: number, companyId: number, nombre: string, capacidad: number | null): Promise<unknown> {
    return firstValueFrom(this.http.put(this.mesaUrl(idMesa),
      { id: idMesa, idCompany: companyId, nombre, capacidad, activo: true }));
  }
  /** Liberar mesa (marcar limpia tras cobrar). */
  liberar(idMesa: number): Promise<unknown> {
    return firstValueFrom(this.http.post(this.liberarUrl(idMesa), {}));
  }

  /** Mesas de una empresa. */
  listUrl(companyId: number): string { return `${this.admin}/mesas/${companyId}`; }

  /** Colección de mesas (POST = alta). */
  baseUrl(): string { return `${this.admin}/mesas`; }

  /** Una mesa (PUT = editar). */
  mesaUrl(idMesa: number): string { return `${this.admin}/mesas/${idMesa}`; }

  /** Liberar mesa (marcar limpia tras cobrar). */
  liberarUrl(idMesa: number): string { return `${this.pub}/mesas/${idMesa}/liberar`; }
}
