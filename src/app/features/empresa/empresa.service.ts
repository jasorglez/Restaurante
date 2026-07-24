import { HttpClient, httpResource } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../../environments/environment';

export interface EmpresaItem { id: number; name: string; picture: string | null; }
interface CompanyInfo { name: string; picture: string | null; picture2: string | null; }

const LS_EMPRESA = 'pv_empresa_id';

/**
 * Selección de empresa (super-usuario) y datos de la empresa activa
 * (nombre/logo, usados en el topbar, tickets y PDFs de todo el sistema).
 */
@Injectable({ providedIn: 'root' })
export class EmpresaService {
  private readonly http = inject(HttpClient);

  /** Lista pública de empresas para la pantalla de selección. */
  listaPublica(): Promise<EmpresaItem[]> {
    return firstValueFrom(this.http.get<EmpresaItem[]>(`${environment.urlSmp}/Root/lista-publica`));
  }

  // ── Empresa activa ───────────────────────────────────────────────────────
  readonly companyId = signal<number | null>(this.resolveCompanyId());

  private resolveCompanyId(): number | null {
    const param = new URLSearchParams(window.location.search).get('empresa');
    if (param) {
      const n = parseInt(param, 10);
      if (!isNaN(n)) { localStorage.setItem(LS_EMPRESA, String(n)); return n; }
    }
    const stored = localStorage.getItem(LS_EMPRESA);
    return stored ? parseInt(stored, 10) : null;
  }

  private readonly companyResource = httpResource<CompanyInfo>(
    () => this.companyId()
      ? `${environment.urlSmp}/Root/${this.companyId()}/pdf-info`
      : undefined,
  );
  readonly companyName = computed(
    () => this.companyResource.value()?.name?.trim() || 'Cargando empresa…',
  );
  readonly companyLogo = computed(
    () => this.companyResource.value()?.picture ?? null,
  );
}
